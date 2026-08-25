import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

import {
  acquireIndexerLease,
  createDatabaseClient,
  ledgerCheckpoints,
  provisionRuntimeDatabaseRoles,
  releaseIndexerLease,
  renewIndexerLease,
  schemaEvents,
  schemas,
  updateIndexerStatus,
  type DatabaseClient,
} from '@xcs-protocol/db'
import { and, eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { computeProjectionDigest } from '../src/projection-digest.js'
import { QuorumLedgerSource } from '../src/quorum-ledger-source.js'
import { PostgresIndexerRepository } from '../src/repository.js'
import { IndexerWorker } from '../src/worker.js'
import type {
  IndexerStatusUpdate,
  LedgerProjection,
  LedgerSource,
  LedgerSourcePreflight,
  NetworkProfile,
  SchemaDefinition,
  ValidatedLedger,
} from '../src/types.js'

const rawAdminDatabaseUrl = process.env.XCS_TEST_DATABASE_URL?.trim()
const adminDatabaseUrl = rawAdminDatabaseUrl === '' ? undefined : rawAdminDatabaseUrl
const postgresTestsRequired = process.env.XCS_REQUIRE_POSTGRES_TESTS === '1'

if (postgresTestsRequired && adminDatabaseUrl === undefined) {
  throw new Error('XCS_TEST_DATABASE_URL is required by test:postgres')
}

const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../../packages/db/drizzle/', import.meta.url))
const TEMPORARY_DATABASE_PATTERN = /^xcs_it_[0-9a-f]{32}$/u
const TEMPORARY_LEGACY_ROLE_PATTERN = /^xcs_legacy_[0-9a-f]{32}$/u
const ACTIVATION_LEDGER_INDEX = 100
const ACTIVATION_LEDGER_HASH = 'a'.repeat(64)
const SCHEMA_UID = 'd'.repeat(64)
const SCHEMA_TRANSACTION_HASH = 'c'.repeat(64)
const CREDENTIAL_TRANSACTION_HASH = 'e'.repeat(64)
const CREDENTIAL_OBJECT_ID = 'f'.repeat(64)
const ISSUER = 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh'
const SUBJECT = 'rLs1MzkFWCxTbuAHgjeTZK4fcCDDnf2KRv'

interface TemporaryDatabase {
  name: string
  url: string
  client: DatabaseClient
}

let adminClient: DatabaseClient | undefined
const temporaryDatabases: TemporaryDatabase[] = []
const createdDatabaseNames = new Set<string>()
const createdLegacyRoleNames = new Set<string>()
let runtimeRoleCleanupAllowed = false

const INDEXER_DATABASE_PASSWORD = 'indexer-integration-password-000001'
const API_DATABASE_PASSWORD = 'api-integration-password-0000000001'

function temporaryDatabaseName(): string {
  const name = `xcs_it_${randomUUID().replaceAll('-', '')}`
  if (!TEMPORARY_DATABASE_PATTERN.test(name)) {
    throw new Error('Generated PostgreSQL test database name is invalid')
  }
  return name
}

function temporaryLegacyRoleName(): string {
  const name = `xcs_legacy_${randomUUID().replaceAll('-', '')}`
  if (!TEMPORARY_LEGACY_ROLE_PATTERN.test(name)) {
    throw new Error('Generated PostgreSQL legacy test role name is invalid')
  }
  return name
}

function databaseUrl(baseUrl: string, databaseName: string): string {
  if (!TEMPORARY_DATABASE_PATTERN.test(databaseName)) {
    throw new Error('Refusing to use an invalid PostgreSQL test database name')
  }
  const parsed = new URL(baseUrl)
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error('XCS_TEST_DATABASE_URL must use the postgres protocol')
  }
  parsed.pathname = `/${databaseName}`
  return parsed.toString()
}

async function closeAndDropTemporaryDatabases(): Promise<void> {
  const cleanupErrors: unknown[] = []

  for (const database of temporaryDatabases.splice(0).reverse()) {
    try {
      await database.client.close()
    } catch (error) {
      cleanupErrors.push(error)
    }
  }

  if (adminClient !== undefined) {
    for (const name of [...createdDatabaseNames].reverse()) {
      try {
        if (!TEMPORARY_DATABASE_PATTERN.test(name)) {
          throw new Error('Refusing to drop an invalid PostgreSQL test database name')
        }
        await adminClient.sql`DROP DATABASE IF EXISTS ${adminClient.sql(name)} WITH (FORCE)`
        createdDatabaseNames.delete(name)
      } catch (error) {
        cleanupErrors.push(error)
      }
    }

    for (const name of [...createdLegacyRoleNames].reverse()) {
      try {
        if (!TEMPORARY_LEGACY_ROLE_PATTERN.test(name)) {
          throw new Error('Refusing to drop an invalid PostgreSQL legacy test role name')
        }
        await adminClient.sql`DROP ROLE IF EXISTS ${adminClient.sql(name)}`
        createdLegacyRoleNames.delete(name)
      } catch (error) {
        cleanupErrors.push(error)
      }
    }

    if (runtimeRoleCleanupAllowed) {
      try {
        await adminClient.sql`DROP ROLE IF EXISTS xcs_indexer, xcs_api`
        runtimeRoleCleanupAllowed = false
      } catch (error) {
        cleanupErrors.push(error)
      }
    }

    try {
      await adminClient.close()
    } catch (error) {
      cleanupErrors.push(error)
    } finally {
      adminClient = undefined
    }
  }

  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, 'Failed to clean PostgreSQL integration databases')
  }
}

function runtimeDatabaseUrl(baseUrl: string, role: string, password: string): string {
  const parsed = new URL(baseUrl)
  parsed.username = role
  parsed.password = password
  return parsed.toString()
}

async function expectPermissionDenied(operation: Promise<unknown>): Promise<void> {
  await expect(operation).rejects.toMatchObject({ code: '42501' })
}

async function createTemporaryDatabase(baseUrl: string): Promise<TemporaryDatabase> {
  if (adminClient === undefined) throw new Error('PostgreSQL admin client is not initialized')

  const name = temporaryDatabaseName()
  const url = databaseUrl(baseUrl, name)
  await adminClient.sql`CREATE DATABASE ${adminClient.sql(name)} TEMPLATE template0 ENCODING 'UTF8'`
  createdDatabaseNames.add(name)

  const client = createDatabaseClient(url)
  const database = { name, url, client }
  temporaryDatabases.push(database)
  await migrate(client.db, { migrationsFolder: MIGRATIONS_FOLDER })
  return database
}

async function restartConnection(database: TemporaryDatabase): Promise<DatabaseClient> {
  await database.client.close()
  database.client = createDatabaseClient(database.url)
  return database.client
}

function ledgerHash(ledgerIndex: number): string {
  return ledgerIndex === ACTIVATION_LEDGER_INDEX
    ? ACTIVATION_LEDGER_HASH
    : ledgerIndex.toString(16).padStart(64, '0')
}

function transactionRoot(ledgerIndex: number): string {
  return (ledgerIndex + 1_000).toString(16).padStart(64, '0')
}

function profile(profileId: string): NetworkProfile {
  return {
    profileId,
    xcsVersion: '0.1',
    networkId: 1,
    requiredAmendment: 'b'.repeat(64),
    registryAddress: ISSUER,
    registrationAmountDrops: '1',
    activationLedgerIndex: ACTIVATION_LEDGER_INDEX,
    activationLedgerHash: ACTIVATION_LEDGER_HASH,
  }
}

function ledger(ledgerIndex: number, transactionHashes: string[] = []): ValidatedLedger {
  return {
    ledgerIndex,
    ledgerHash: ledgerHash(ledgerIndex),
    parentHash:
      ledgerIndex === ACTIVATION_LEDGER_INDEX ? '0'.repeat(64) : ledgerHash(ledgerIndex - 1),
    accountRoot: (ledgerIndex + 2_000).toString(16).padStart(64, '0'),
    transactionRoot: transactionRoot(ledgerIndex),
    parentCloseTime: 999 + ledgerIndex,
    closeTime: 1_000 + ledgerIndex,
    closeTimeResolution: 10,
    closeFlags: 0,
    totalCoins: '100000000000000000',
    transactions: transactionHashes.map((hash, transactionIndex) => ({
      hash,
      transactionIndex,
      transaction: { TransactionType: 'Payment' },
      metadata: { TransactionResult: 'tesSUCCESS', AffectedNodes: [] },
    })),
  }
}

function emptyProjection(value: ValidatedLedger): LedgerProjection {
  return {
    ledger: value,
    schemaRegistrations: [],
    credentialMutations: [],
    malformedCredentialNodes: 0,
  }
}

class DeterministicLedgerSource implements LedgerSource {
  constructor(
    private readonly replayProfile: NetworkProfile,
    private readonly tip: number,
  ) {}

  async connect(): Promise<void> {}

  async disconnect(): Promise<void> {}

  async preflight(profileToCheck: NetworkProfile): Promise<LedgerSourcePreflight> {
    expect(profileToCheck).toEqual(this.replayProfile)
    return {
      networkId: this.replayProfile.networkId,
      completeLedgerRanges: [{ min: this.replayProfile.activationLedgerIndex, max: this.tip }],
      activationLedger: ledger(this.replayProfile.activationLedgerIndex),
      tips: { primary: this.tip, secondary: this.tip, effective: this.tip },
    }
  }

  async assertAmendmentEnabled(): Promise<void> {}

  async getValidatedLedgerIndex(): Promise<number> {
    return this.tip
  }

  async getValidatedLedgerTips() {
    return { primary: this.tip, secondary: this.tip, effective: this.tip }
  }

  async getLedger(ledgerIndex: number): Promise<ValidatedLedger> {
    return ledger(ledgerIndex)
  }
}

function readyStatus(value: ValidatedLedger): IndexerStatusUpdate {
  return {
    state: 'ready',
    primarySourceTip: value.ledgerIndex,
    secondarySourceTip: value.ledgerIndex,
    lastAgreedLedgerIndex: value.ledgerIndex,
    lastAgreedLedgerHash: value.ledgerHash,
  }
}

const schemaDefinition: SchemaDefinition = {
  xcsVersion: '0.1',
  name: 'Race participation',
  description: 'Confirms that the subject participated in a race.',
  fields: {
    raceId: { type: 'string' },
    participatedAt: { type: 'string' },
  },
}

function replayProjections(): [LedgerProjection, LedgerProjection] {
  const registrationLedger = ledger(ACTIVATION_LEDGER_INDEX, [SCHEMA_TRANSACTION_HASH])
  const credentialLedger = ledger(ACTIVATION_LEDGER_INDEX + 1, [CREDENTIAL_TRANSACTION_HASH])

  return [
    {
      ledger: registrationLedger,
      schemaRegistrations: [
        {
          status: 'accepted',
          transactionHash: SCHEMA_TRANSACTION_HASH,
          transactionIndex: 0,
          publisher: ISSUER,
          schemaUid: SCHEMA_UID,
          definition: schemaDefinition,
          resolved: {
            definition: schemaDefinition,
            fields: schemaDefinition.fields,
            lineage: [],
          },
        },
      ],
      credentialMutations: [],
      malformedCredentialNodes: 0,
    },
    {
      ledger: credentialLedger,
      schemaRegistrations: [],
      credentialMutations: [
        {
          transactionHash: CREDENTIAL_TRANSACTION_HASH,
          transactionIndex: 0,
          nodeIndex: 0,
          ledgerObjectId: CREDENTIAL_OBJECT_ID,
          eventType: 'created',
          issuer: ISSUER,
          subject: SUBJECT,
          schemaUid: SCHEMA_UID,
          accepted: false,
          snapshot: {
            Issuer: ISSUER,
            Subject: SUBJECT,
            CredentialType: SCHEMA_UID.toUpperCase(),
          },
        },
      ],
      malformedCredentialNodes: 0,
    },
  ]
}

async function replayProjection(database: TemporaryDatabase, replayProfile: NetworkProfile) {
  const repository = new PostgresIndexerRepository(database.client.db)
  await repository.initializeProfile(replayProfile)
  const token = await repository.acquireLease(
    replayProfile.profileId,
    `writer-${database.name.replaceAll('_', '-')}`,
    300_000,
  )
  const [first, second] = replayProjections()

  await expect(
    repository.persistLedger(replayProfile, first, token, {
      state: 'catching_up',
      primarySourceTip: second.ledger.ledgerIndex,
      secondarySourceTip: second.ledger.ledgerIndex,
      lastAgreedLedgerIndex: first.ledger.ledgerIndex,
      lastAgreedLedgerHash: first.ledger.ledgerHash,
    }),
  ).resolves.toBe('inserted')
  await expect(
    repository.persistLedger(replayProfile, second, token, readyStatus(second.ledger)),
  ).resolves.toBe('inserted')
}

async function boundedReplay(
  database: TemporaryDatabase,
  replayProfile: NetworkProfile,
  primaryTip: number,
  secondaryTip: number,
) {
  const target = ledger(ACTIVATION_LEDGER_INDEX + 2)
  let caughtUpLedger: number | undefined
  const worker = new IndexerWorker({
    profile: replayProfile,
    source: new QuorumLedgerSource(
      new DeterministicLedgerSource(replayProfile, primaryTip),
      new DeterministicLedgerSource(replayProfile, secondaryTip),
    ),
    repository: new PostgresIndexerRepository(database.client.db),
    pollIntervalMs: 250,
    batchSize: 2,
    writerId: `bounded-${database.name.replaceAll('_', '-')}`,
    replayTarget: {
      ledgerIndex: target.ledgerIndex,
      ledgerHash: target.ledgerHash,
    },
    observer: {
      caughtUp: (ledgerIndex) => {
        caughtUpLedger = ledgerIndex
      },
    },
  })

  await worker.start(new AbortController().signal)
  expect(caughtUpLedger).toBe(target.ledgerIndex)
  return computeProjectionDigest(database.client.db, replayProfile.profileId)
}

const describePostgres = describe.skipIf(adminDatabaseUrl === undefined)

describePostgres('PostgreSQL 18 indexer integration', () => {
  beforeAll(async () => {
    if (adminDatabaseUrl === undefined) return
    adminClient = createDatabaseClient(adminDatabaseUrl)

    try {
      const [version] = await adminClient.sql<{ serverVersion: number }[]>`
        SELECT current_setting('server_version_num')::integer AS "serverVersion"
      `
      expect(Math.trunc((version?.serverVersion ?? 0) / 10_000)).toBe(18)
      await createTemporaryDatabase(adminDatabaseUrl)
      await createTemporaryDatabase(adminDatabaseUrl)
    } catch (setupError) {
      try {
        await closeAndDropTemporaryDatabases()
      } catch (cleanupError) {
        throw new AggregateError(
          [setupError, cleanupError],
          'PostgreSQL integration setup and cleanup failed',
        )
      }
      throw setupError
    }
  }, 60_000)

  afterAll(async () => {
    await closeAndDropTemporaryDatabases()
  }, 60_000)

  it('applies 0000 then 0001 to a fresh database and is migration-idempotent', async () => {
    const database = temporaryDatabases[0]
    if (database === undefined) throw new Error('First temporary database was not created')

    await migrate(database.client.db, { migrationsFolder: MIGRATIONS_FOLDER })

    const [migrationCount] = await database.client.sql<{ count: number }[]>`
      SELECT count(*)::integer AS count FROM drizzle.__drizzle_migrations
    `
    const columns = await database.client.sql<{ columnName: string }[]>`
      SELECT column_name AS "columnName"
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'ledger_checkpoints'
    `
    const [statusTable] = await database.client.sql<{ exists: boolean }[]>`
      SELECT to_regclass('public.indexer_status') IS NOT NULL AS exists
    `

    expect(migrationCount?.count).toBe(2)
    expect(columns.map((row) => row.columnName)).toContain('transaction_root')
    expect(statusTable?.exists).toBe(true)
  })

  it('provisions idempotent least-privilege indexer and API roles', async () => {
    const database = temporaryDatabases[0]
    if (database === undefined) throw new Error('First temporary database was not created')
    if (adminClient === undefined) throw new Error('PostgreSQL admin client is not initialized')

    const preexisting = await adminClient.sql<{ roleName: string }[]>`
      SELECT rolname AS "roleName"
      FROM pg_roles
      WHERE rolname IN ('xcs_indexer', 'xcs_api')
    `
    if (preexisting.length > 0) {
      throw new Error(
        'PostgreSQL integration tests require a disposable cluster without xcs runtime roles',
      )
    }
    runtimeRoleCleanupAllowed = true

    await provisionRuntimeDatabaseRoles(database.client, {
      indexerPassword: INDEXER_DATABASE_PASSWORD,
      apiPassword: API_DATABASE_PASSWORD,
    })
    const legacyMemberRole = temporaryLegacyRoleName()
    await adminClient.sql`CREATE ROLE ${adminClient.sql(legacyMemberRole)} NOLOGIN`
    createdLegacyRoleNames.add(legacyMemberRole)
    const downstreamRole = temporaryLegacyRoleName()
    await adminClient.sql`CREATE ROLE ${adminClient.sql(downstreamRole)} NOLOGIN`
    createdLegacyRoleNames.add(downstreamRole)
    const intermediateGrantorRole = temporaryLegacyRoleName()
    await adminClient.sql`CREATE ROLE ${adminClient.sql(intermediateGrantorRole)} NOLOGIN`
    createdLegacyRoleNames.add(intermediateGrantorRole)
    await adminClient.sql`GRANT xcs_indexer TO ${adminClient.sql(legacyMemberRole)}`
    await adminClient.sql`GRANT xcs_api TO ${adminClient.sql(legacyMemberRole)}`
    await adminClient.sql`
      GRANT pg_read_all_data TO ${adminClient.sql(intermediateGrantorRole)} WITH ADMIN OPTION
    `
    await adminClient.sql.begin(async (sql) => {
      await sql`SET LOCAL ROLE ${sql(intermediateGrantorRole)}`
      await sql`GRANT pg_read_all_data TO xcs_api WITH ADMIN OPTION`
    })
    await adminClient.sql`ALTER ROLE xcs_api CREATEDB`

    const delegatingApiClient = createDatabaseClient(
      runtimeDatabaseUrl(database.url, 'xcs_api', API_DATABASE_PASSWORD),
    )
    try {
      await delegatingApiClient.sql`
        GRANT pg_read_all_data TO ${delegatingApiClient.sql(downstreamRole)}
      `
    } finally {
      await delegatingApiClient.close()
    }
    const delegationsBeforeProvisioning = await adminClient.sql<
      Array<{ memberRole: string; grantorRole: string; adminOption: boolean }>
    >`
      SELECT
        member_role.rolname AS "memberRole",
        grantor_role.rolname AS "grantorRole",
        membership.admin_option AS "adminOption"
      FROM pg_auth_members membership
      JOIN pg_roles granted_role ON granted_role.oid = membership.roleid
      JOIN pg_roles member_role ON member_role.oid = membership.member
      JOIN pg_roles grantor_role ON grantor_role.oid = membership.grantor
      WHERE granted_role.rolname = 'pg_read_all_data'
        AND member_role.rolname IN ('xcs_api', ${downstreamRole})
      ORDER BY member_role.rolname
    `
    expect(delegationsBeforeProvisioning).toEqual(
      [
        { memberRole: 'xcs_api', grantorRole: intermediateGrantorRole, adminOption: true },
        { memberRole: downstreamRole, grantorRole: 'xcs_api', adminOption: false },
      ].sort((left, right) => left.memberRole.localeCompare(right.memberRole)),
    )

    await provisionRuntimeDatabaseRoles(database.client, {
      indexerPassword: INDEXER_DATABASE_PASSWORD,
      apiPassword: API_DATABASE_PASSWORD,
    })

    const roleProperties = await adminClient.sql<
      Array<{
        roleName: string
        canLogin: boolean
        isSuperuser: boolean
        canCreateDatabase: boolean
        canCreateRole: boolean
        canReplicate: boolean
        canBypassRls: boolean
        inheritsPrivileges: boolean
        configuration: string[] | null
      }>
    >`
      SELECT
        rolname AS "roleName",
        rolcanlogin AS "canLogin",
        rolsuper AS "isSuperuser",
        rolcreatedb AS "canCreateDatabase",
        rolcreaterole AS "canCreateRole",
        rolreplication AS "canReplicate",
        rolbypassrls AS "canBypassRls",
        rolinherit AS "inheritsPrivileges",
        rolconfig AS configuration
      FROM pg_roles
      WHERE rolname IN ('xcs_indexer', 'xcs_api')
      ORDER BY rolname
    `
    expect(roleProperties).toEqual([
      {
        roleName: 'xcs_api',
        canLogin: true,
        isSuperuser: false,
        canCreateDatabase: false,
        canCreateRole: false,
        canReplicate: false,
        canBypassRls: false,
        inheritsPrivileges: false,
        configuration: null,
      },
      {
        roleName: 'xcs_indexer',
        canLogin: true,
        isSuperuser: false,
        canCreateDatabase: false,
        canCreateRole: false,
        canReplicate: false,
        canBypassRls: false,
        inheritsPrivileges: false,
        configuration: null,
      },
    ])
    const [runtimeMemberships] = await adminClient.sql<{ count: number }[]>`
      SELECT count(*)::integer AS count
      FROM pg_auth_members membership
      JOIN pg_roles granted_role ON granted_role.oid = membership.roleid
      JOIN pg_roles member_role ON member_role.oid = membership.member
      WHERE granted_role.rolname IN ('xcs_indexer', 'xcs_api')
        OR member_role.rolname IN ('xcs_indexer', 'xcs_api')
        OR (
          granted_role.rolname = 'pg_read_all_data'
          AND member_role.rolname = ${downstreamRole}
        )
    `
    expect(runtimeMemberships?.count).toBe(0)
    const legacyRoles = await adminClient.sql<{ roleName: string; canLogin: boolean }[]>`
      SELECT rolname AS "roleName", rolcanlogin AS "canLogin"
      FROM pg_roles
      WHERE rolname IN (${legacyMemberRole}, ${downstreamRole}, ${intermediateGrantorRole})
      ORDER BY rolname
    `
    expect(legacyRoles).toEqual(
      [legacyMemberRole, downstreamRole, intermediateGrantorRole]
        .sort()
        .map((roleName) => ({ roleName, canLogin: false })),
    )

    const indexerClient = createDatabaseClient(
      runtimeDatabaseUrl(database.url, 'xcs_indexer', INDEXER_DATABASE_PASSWORD),
    )
    const apiClient = createDatabaseClient(
      runtimeDatabaseUrl(database.url, 'xcs_api', API_DATABASE_PASSWORD),
    )
    try {
      const permissionsProfile = profile('runtime-role-permissions')
      const repository = new PostgresIndexerRepository(indexerClient.db)
      await repository.initializeProfile(permissionsProfile)
      const lease = await repository.acquireLease(
        permissionsProfile.profileId,
        'role-test-writer',
        300_000,
      )
      const activation = ledger(ACTIVATION_LEDGER_INDEX)
      await expect(
        repository.persistLedger(
          permissionsProfile,
          emptyProjection(activation),
          lease,
          readyStatus(activation),
        ),
      ).resolves.toBe('inserted')
      await repository.releaseLease(lease)

      const [projectionRead] = await apiClient.sql<{ count: number }[]>`
        SELECT count(*)::integer AS count
        FROM ledger_checkpoints
        WHERE profile_id = ${permissionsProfile.profileId}
      `
      expect(projectionRead?.count).toBe(1)

      await expectPermissionDenied(
        apiClient.sql`
          UPDATE network_profiles
          SET enabled = false
          WHERE profile_id = ${permissionsProfile.profileId}
        `,
      )
      await expectPermissionDenied(
        indexerClient.sql`
          INSERT INTO pin_challenges (
            challenge_id, profile_id, wallet, requester_ip_hash, message, expires_at
          ) VALUES (
            ${'7'.repeat(64)}, ${permissionsProfile.profileId}, ${ISSUER},
            ${'8'.repeat(64)}, 'not-authorized', CURRENT_TIMESTAMP + interval '5 minutes'
          )
        `,
      )

      const challengeId = '1'.repeat(64)
      const pinId = '2'.repeat(64)
      await apiClient.sql`
        INSERT INTO pin_challenges (
          challenge_id, profile_id, wallet, requester_ip_hash, message, expires_at
        ) VALUES (
          ${challengeId}, ${permissionsProfile.profileId}, ${ISSUER},
          ${'3'.repeat(64)}, 'authorized', CURRENT_TIMESTAMP + interval '5 minutes'
        )
      `
      await apiClient.sql`
        INSERT INTO demo_pins (
          pin_id, challenge_id, profile_id, wallet, requester_ip_hash,
          cid, byte_length, status, expires_at
        ) VALUES (
          ${pinId}, ${challengeId}, ${permissionsProfile.profileId}, ${ISSUER},
          ${'3'.repeat(64)}, 'bafybeigdyrzt', 128, 'pending',
          CURRENT_TIMESTAMP + interval '1 hour'
        )
      `
      const [pinRead] = await apiClient.sql<{ status: string }[]>`
        SELECT status FROM demo_pins WHERE pin_id = ${pinId}
      `
      expect(pinRead?.status).toBe('pending')
      await apiClient.sql`
        UPDATE demo_pins SET status = 'pinned' WHERE pin_id = ${pinId}
      `
      await apiClient.sql`DELETE FROM demo_pins WHERE pin_id = ${pinId}`
      await apiClient.sql`DELETE FROM pin_challenges WHERE challenge_id = ${challengeId}`

      await expectPermissionDenied(apiClient.sql`CREATE TABLE forbidden_api (id integer)`)
      await expectPermissionDenied(indexerClient.sql`CREATE TABLE forbidden_indexer (id integer)`)
    } finally {
      await Promise.allSettled([indexerClient.close(), apiClient.close()])
    }
  })

  it('enforces NULL-safe agreed-ledger, ready and writer/lease shapes', async () => {
    const database = temporaryDatabases[0]
    if (database === undefined) throw new Error('First temporary database was not created')
    const constrainedProfile = profile('constraint-shapes')
    await new PostgresIndexerRepository(database.client.db).initializeProfile(constrainedProfile)

    await expect(
      database.client.sql`
        INSERT INTO indexer_status (
          profile_id, state, last_agreed_ledger_index, writer_epoch
        ) VALUES (${constrainedProfile.profileId}, 'catching_up', 100, 1)
      `,
    ).rejects.toMatchObject({ code: '23514', constraint_name: 'indexer_status_agreed_ledger' })

    await expect(
      database.client.sql`
        INSERT INTO indexer_status (
          profile_id, state, primary_source_tip, secondary_source_tip,
          last_agreed_ledger_index, last_agreed_ledger_hash, writer_epoch
        ) VALUES (
          ${constrainedProfile.profileId}, 'ready', 100, 100,
          100, ${ACTIVATION_LEDGER_HASH}, 1
        )
      `,
    ).rejects.toMatchObject({ code: '23514', constraint_name: 'indexer_status_ready_shape' })

    await expect(
      database.client.sql`
        INSERT INTO indexer_status (
          profile_id, state, writer_id, writer_epoch
        ) VALUES (${constrainedProfile.profileId}, 'starting', 'writer-without-lease', 1)
      `,
    ).rejects.toMatchObject({ code: '23514', constraint_name: 'indexer_status_lease_window' })
  })

  it('fences writers across lease contention, expiry and takeover', async () => {
    const database = temporaryDatabases[0]
    if (database === undefined) throw new Error('First temporary database was not created')
    const fencedProfile = profile('lease-fencing')
    const repository = new PostgresIndexerRepository(database.client.db)
    await repository.initializeProfile(fencedProfile)

    const acquiredAt = new Date()
    const first = await acquireIndexerLease(database.client.db, {
      profileId: fencedProfile.profileId,
      writerId: 'writer-one',
      leaseDurationMs: 10_000,
      now: acquiredAt,
    })
    await expect(
      acquireIndexerLease(database.client.db, {
        profileId: fencedProfile.profileId,
        writerId: 'writer-two',
        leaseDurationMs: 10_000,
        now: new Date(acquiredAt.getTime() + 9_999),
      }),
    ).rejects.toMatchObject({
      code: 'INDEXER_LEASE_UNAVAILABLE',
    })

    const renewed = await renewIndexerLease(database.client.db, first, {
      leaseDurationMs: 10_000,
      now: new Date(acquiredAt.getTime() + 1_000),
    })
    expect(renewed.epoch).toBe(first.epoch)

    const takeoverAt = new Date(acquiredAt.getTime() + 11_000)
    const second = await acquireIndexerLease(database.client.db, {
      profileId: fencedProfile.profileId,
      writerId: 'writer-two',
      leaseDurationMs: 10_000,
      now: takeoverAt,
    })
    expect(second.epoch).toBe(first.epoch + 1)

    await expect(
      renewIndexerLease(database.client.db, first, {
        leaseDurationMs: 10_000,
        now: takeoverAt,
      }),
    ).rejects.toMatchObject({ code: 'INDEXER_LEASE_LOST' })
    await expect(
      updateIndexerStatus(database.client.db, first, { state: 'catching_up' }, { now: takeoverAt }),
    ).rejects.toMatchObject({ code: 'INDEXER_LEASE_LOST' })
    await expect(
      releaseIndexerLease(database.client.db, first, { now: takeoverAt }),
    ).rejects.toMatchObject({ code: 'INDEXER_LEASE_LOST' })

    const activation = ledger(ACTIVATION_LEDGER_INDEX)
    await expect(
      repository.persistLedger(
        fencedProfile,
        emptyProjection(activation),
        first,
        readyStatus(activation),
      ),
    ).rejects.toMatchObject({ code: 'INDEXER_LEASE_LOST' })

    const checkpointsAfterFencedWrite = await database.client.db
      .select()
      .from(ledgerCheckpoints)
      .where(eq(ledgerCheckpoints.profileId, fencedProfile.profileId))
    expect(checkpointsAfterFencedWrite).toEqual([])

    await expect(
      repository.persistLedger(
        fencedProfile,
        emptyProjection(activation),
        second,
        readyStatus(activation),
      ),
    ).resolves.toBe('inserted')
  })

  it('rolls back all projection writes when a later mutation fails', async () => {
    const database = temporaryDatabases[0]
    if (database === undefined) throw new Error('First temporary database was not created')
    const rollbackProfile = profile('transaction-rollback')
    const repository = new PostgresIndexerRepository(database.client.db)
    await repository.initializeProfile(rollbackProfile)
    const token = await repository.acquireLease(
      rollbackProfile.profileId,
      'rollback-writer',
      300_000,
    )
    const [projection] = replayProjections()
    const failingProjection: LedgerProjection = {
      ...projection,
      credentialMutations: [
        {
          transactionHash: CREDENTIAL_TRANSACTION_HASH,
          transactionIndex: 0,
          nodeIndex: 0,
          ledgerObjectId: CREDENTIAL_OBJECT_ID,
          eventType: 'accepted',
          issuer: ISSUER,
          subject: SUBJECT,
          schemaUid: SCHEMA_UID,
          accepted: true,
          snapshot: { accepted: true },
        },
      ],
    }

    await expect(
      repository.persistLedger(
        rollbackProfile,
        failingProjection,
        token,
        readyStatus(failingProjection.ledger),
      ),
    ).rejects.toThrow('without a live generation')

    const [checkpointRows, eventRows, schemaRows] = await Promise.all([
      database.client.db
        .select()
        .from(ledgerCheckpoints)
        .where(eq(ledgerCheckpoints.profileId, rollbackProfile.profileId)),
      database.client.db
        .select()
        .from(schemaEvents)
        .where(eq(schemaEvents.profileId, rollbackProfile.profileId)),
      database.client.db
        .select()
        .from(schemas)
        .where(eq(schemas.profileId, rollbackProfile.profileId)),
    ])
    expect(checkpointRows).toEqual([])
    expect(eventRows).toEqual([])
    expect(schemaRows).toEqual([])
  })

  it('persists transactionRoot and remains idempotent after a connection restart', async () => {
    const database = temporaryDatabases[0]
    if (database === undefined) throw new Error('First temporary database was not created')
    const restartProfile = profile('restart-idempotence')
    let repository = new PostgresIndexerRepository(database.client.db)
    await repository.initializeProfile(restartProfile)
    const token = await repository.acquireLease(restartProfile.profileId, 'restart-writer', 300_000)
    const projection = emptyProjection(ledger(ACTIVATION_LEDGER_INDEX))

    await expect(
      repository.persistLedger(restartProfile, projection, token, readyStatus(projection.ledger)),
    ).resolves.toBe('inserted')

    const [storedBeforeRestart] = await database.client.db
      .select()
      .from(ledgerCheckpoints)
      .where(
        and(
          eq(ledgerCheckpoints.profileId, restartProfile.profileId),
          eq(ledgerCheckpoints.ledgerIndex, ACTIVATION_LEDGER_INDEX),
        ),
      )
      .limit(1)
    expect(storedBeforeRestart?.transactionRoot).toBe(projection.ledger.transactionRoot)

    const restartedClient = await restartConnection(database)
    repository = new PostgresIndexerRepository(restartedClient.db)
    await expect(
      repository.persistLedger(restartProfile, projection, token, readyStatus(projection.ledger)),
    ).resolves.toBe('already_processed')

    const rowsAfterRestart = await restartedClient.db
      .select()
      .from(ledgerCheckpoints)
      .where(eq(ledgerCheckpoints.profileId, restartProfile.profileId))
    expect(rowsAfterRestart).toHaveLength(1)
  })

  it('produces the same digest for two replays despite different database timestamps', async () => {
    const firstDatabase = temporaryDatabases[0]
    const secondDatabase = temporaryDatabases[1]
    if (firstDatabase === undefined || secondDatabase === undefined) {
      throw new Error('Two temporary databases are required for replay comparison')
    }
    const replayProfile = profile('digest-replay')

    await replayProjection(firstDatabase, replayProfile)
    await replayProjection(secondDatabase, replayProfile)

    const timestamps = [new Date('2025-01-01T00:00:00.000Z'), new Date('2035-01-01T00:00:00.000Z')]
    for (const [index, database] of [firstDatabase, secondDatabase].entries()) {
      const timestamp = timestamps[index]
      if (timestamp === undefined) throw new Error('Replay timestamp fixture is missing')
      const timestampIso = timestamp.toISOString()
      await database.client.sql`
        UPDATE network_profiles SET created_at = ${timestampIso}
        WHERE profile_id = ${replayProfile.profileId}
      `
      await database.client.sql`
        UPDATE ledger_checkpoints SET processed_at = ${timestampIso}
        WHERE profile_id = ${replayProfile.profileId}
      `
      await database.client.sql`
        UPDATE schema_events SET recorded_at = ${timestampIso}
        WHERE profile_id = ${replayProfile.profileId}
      `
      await database.client.sql`
        UPDATE schemas SET registered_at = ${timestampIso}
        WHERE profile_id = ${replayProfile.profileId}
      `
      await database.client.sql`
        UPDATE credential_events SET recorded_at = ${timestampIso}
        WHERE profile_id = ${replayProfile.profileId}
      `
      await database.client.sql`
        UPDATE credential_generations
        SET created_at = ${timestampIso}, updated_at = ${timestampIso}
        WHERE profile_id = ${replayProfile.profileId}
      `
    }

    const [firstDigest, secondDigest] = await Promise.all([
      computeProjectionDigest(firstDatabase.client.db, replayProfile.profileId),
      computeProjectionDigest(secondDatabase.client.db, replayProfile.profileId),
    ])

    expect(secondDigest).toEqual(firstDigest)
    expect(firstDigest.rowCounts).toEqual({
      ledgerCheckpoints: 2,
      schemaEvents: 1,
      schemas: 1,
      credentialEvents: 1,
      credentialGenerations: 1,
    })
  })

  it('stops two quorum-backed replays at the same bound despite different source tips', async () => {
    const firstDatabase = temporaryDatabases[0]
    const secondDatabase = temporaryDatabases[1]
    if (firstDatabase === undefined || secondDatabase === undefined) {
      throw new Error('Two temporary databases are required for bounded replay comparison')
    }
    const replayProfile = profile('bounded-replay')

    const [firstDigest, secondDigest] = await Promise.all([
      boundedReplay(firstDatabase, replayProfile, 105, 104),
      boundedReplay(secondDatabase, replayProfile, 111, 109),
    ])

    expect(secondDigest).toEqual(firstDigest)
    expect(firstDigest.rowCounts).toEqual({
      ledgerCheckpoints: 3,
      schemaEvents: 0,
      schemas: 0,
      credentialEvents: 0,
      credentialGenerations: 0,
    })
  })
})
