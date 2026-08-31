import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  acquireIndexerLease,
  credentialEvents,
  credentialGenerations,
  createDatabaseClient,
  haltIndexer,
  indexerIncidents,
  indexerStatuses,
  ledgerCheckpoints,
  migrateDatabase,
  PROJECTION_INTEGRITY_MIGRATION_ERROR,
  provisionRuntimeDatabaseRoles,
  releaseIndexerLease,
  renewIndexerLease,
  schemaEvents,
  schemas,
  updateIndexerStatus,
  XCS_API_DATABASE_CONNECTION_LIMIT,
  XCS_INDEXER_DATABASE_CONNECTION_LIMIT,
  XCS_MONITOR_DATABASE_CONNECTION_LIMIT,
  XCS_PROVISION_CONTROL_ROLE,
  type DatabaseClient,
} from '@xcs-protocol/db'
import {
  canonicalize,
  computeSchemaUid,
  createIpfsRawPayloadUri,
  encodeUtf8,
  type JsonValue,
} from '@xcs-protocol/core'
import { and, asc, eq } from 'drizzle-orm'
import { migrate as drizzleMigrate } from 'drizzle-orm/postgres-js/migrator'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { captureLedgerFixtureBundle, ledgerFixtureBundleDigest } from '../src/fixture-bundle.js'
import { prepareFixtureReplay } from '../src/fixture-replay.js'
import { computeProjectionDigest } from '../src/projection-digest.js'
import { QuorumLedgerSource } from '../src/quorum-ledger-source.js'
import { PostgresIndexerRepository } from '../src/repository.js'
import { IndexerWorker } from '../src/worker.js'
import type {
  CredentialDeletionCause,
  IndexerStatusUpdate,
  LedgerProjection,
  LedgerSource,
  LedgerSourcePreflight,
  LedgerTransaction,
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
const PUBLIC_LARGE_OBJECT_ID = 8_100_001
const ISSUER = 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh'
const SUBJECT = 'rLs1MzkFWCxTbuAHgjeTZK4fcCDDnf2KRv'
const FIXTURE_SUBJECTS = [
  SUBJECT,
  'r9cZA1mLK5R5Am25ArfXFmqgNwjZgnfk59',
  'rG1QQv2nh2gr7RCZ1P8YYcBUKCCN633jCn',
  'rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY',
  'rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe',
  'rrrrrrrrrrrrrrrrrrrrBZbvji',
] as const
const PROJECTION_INTEGRITY_CONSTRAINT_NAMES = [
  'ledger_checkpoints_index_uint32',
  'ledger_checkpoints_close_time_uint32',
  'schema_events_ledger_index_uint32',
  'schemas_ledger_index_uint32',
  'schemas_transaction_index',
  'credential_generations_expiration_uint32',
  'credential_generations_created_ledger_uint32',
  'credential_generations_created_transaction_index',
  'credential_generations_last_ledger_uint32',
  'credential_generations_deleted_ledger_uint32',
  'credential_generations_ledger_order',
  'credential_events_generation_id',
  'credential_events_node_index',
  'credential_events_ledger_index_uint32',
  'credential_events_transaction_index',
  'credential_events_expiration_uint32',
] as const

interface TemporaryDatabase {
  name: string
  url: string
  client: DatabaseClient
}

interface TemporaryDatabaseOptions {
  applyMigrations?: boolean
}

let adminClient: DatabaseClient | undefined
const temporaryDatabases: TemporaryDatabase[] = []
const createdDatabaseNames = new Set<string>()
const createdLegacyRoleNames = new Set<string>()
let runtimeRoleCleanupAllowed = false

const INDEXER_DATABASE_PASSWORD = 'indexer-integration-password-000001'
const API_DATABASE_PASSWORD = 'api-integration-password-0000000001'
const MONITOR_DATABASE_PASSWORD = 'monitor-integration-password-00000001'
const ROTATED_INDEXER_DATABASE_PASSWORD = 'rotated-indexer-integration-password-01'
const ROTATED_API_DATABASE_PASSWORD = 'rotated-api-integration-password-00001'
const ROTATED_MONITOR_DATABASE_PASSWORD = 'rotated-monitor-integration-password-01'
const RUNTIME_MEMBER_DATABASE_PASSWORD = 'runtime-member-integration-password-001'
const DOWNSTREAM_ROLE_DATABASE_PASSWORD = 'downstream-role-integration-password-01'

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
        await adminClient.sql`
          DROP ROLE IF EXISTS
            xcs_indexer,
            xcs_api,
            xcs_monitor,
            ${adminClient.sql(XCS_PROVISION_CONTROL_ROLE)}
        `
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

async function createTemporaryDatabase(
  baseUrl: string,
  options: TemporaryDatabaseOptions = {},
): Promise<TemporaryDatabase> {
  if (adminClient === undefined) throw new Error('PostgreSQL admin client is not initialized')

  const name = temporaryDatabaseName()
  const url = databaseUrl(baseUrl, name)
  await adminClient.sql`CREATE DATABASE ${adminClient.sql(name)} TEMPLATE template0 ENCODING 'UTF8'`
  createdDatabaseNames.add(name)

  const client = createDatabaseClient(url)
  const database = { name, url, client }
  temporaryDatabases.push(database)
  if (options.applyMigrations !== false) {
    await migrateDatabase(client, { migrationsFolder: MIGRATIONS_FOLDER })
  }
  return database
}

async function createLegacyMigrationsFolder(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), 'xcs-migrations-0002-'))
  const metadataFolder = join(folder, 'meta')
  await mkdir(metadataFolder)
  await Promise.all(
    ['0000_initial.sql', '0001_durable_indexer_status.sql', '0002_discovery_indexes.sql'].map(
      (fileName) => copyFile(join(MIGRATIONS_FOLDER, fileName), join(folder, fileName)),
    ),
  )

  const journalPath = join(MIGRATIONS_FOLDER, 'meta', '_journal.json')
  const journal = JSON.parse(await readFile(journalPath, 'utf8')) as {
    entries: Array<{ idx: number }>
  }
  journal.entries = journal.entries.filter((entry) => entry.idx <= 2)
  await writeFile(join(metadataFolder, '_journal.json'), `${JSON.stringify(journal, null, 2)}\n`)
  return folder
}

async function projectionIntegrityConstraintStates(database: TemporaryDatabase) {
  const rows = await database.client.sql<
    Array<{ constraintName: string; tableName: string; validated: boolean }>
  >`
    SELECT
      constraint_object.conname AS "constraintName",
      relation.relname AS "tableName",
      constraint_object.convalidated AS validated
    FROM pg_constraint constraint_object
    JOIN pg_class relation ON relation.oid = constraint_object.conrelid
    JOIN pg_namespace namespace_object ON namespace_object.oid = relation.relnamespace
    WHERE namespace_object.nspname = 'public'
      AND constraint_object.contype = 'c'
      AND relation.relname IN (
        'ledger_checkpoints',
        'schema_events',
        'schemas',
        'credential_generations',
        'credential_events'
      )
  `
  const expectedNames = new Set<string>(PROJECTION_INTEGRITY_CONSTRAINT_NAMES)
  return rows
    .filter((row) => expectedNames.has(row.constraintName))
    .sort((left, right) => left.constraintName.localeCompare(right.constraintName))
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
const schemaMemoJson = {
  ...schemaDefinition,
  fields: {
    raceId: { type: 'string', optional: false },
    participatedAt: { type: 'string' },
  },
} as unknown as JsonValue

interface FixtureDeletionCase {
  cause: CredentialDeletionCause
  subject: (typeof FIXTURE_SUBJECTS)[number]
  transactionType: string
  actor: string
  accepted: boolean
  expiration?: number
  result: string
}

const FIXTURE_DELETION_CASES: readonly FixtureDeletionCase[] = [
  {
    cause: 'issuer_revoked',
    subject: FIXTURE_SUBJECTS[0],
    transactionType: 'CredentialDelete',
    actor: ISSUER,
    accepted: false,
    result: 'tesSUCCESS',
  },
  {
    cause: 'subject_rejected',
    subject: FIXTURE_SUBJECTS[1],
    transactionType: 'CredentialDelete',
    actor: FIXTURE_SUBJECTS[1],
    accepted: false,
    result: 'tesSUCCESS',
  },
  {
    cause: 'subject_removed',
    subject: FIXTURE_SUBJECTS[2],
    transactionType: 'CredentialDelete',
    actor: FIXTURE_SUBJECTS[2],
    accepted: true,
    result: 'tesSUCCESS',
  },
  {
    cause: 'expired_cleanup',
    subject: FIXTURE_SUBJECTS[3],
    transactionType: 'CredentialAccept',
    actor: FIXTURE_SUBJECTS[3],
    accepted: false,
    expiration: 1_102,
    result: 'tecEXPIRED',
  },
  {
    cause: 'account_deleted',
    subject: FIXTURE_SUBJECTS[4],
    transactionType: 'AccountDelete',
    actor: FIXTURE_SUBJECTS[4],
    accepted: false,
    result: 'tesSUCCESS',
  },
  {
    cause: 'self_deleted',
    subject: FIXTURE_SUBJECTS[5],
    transactionType: 'Payment',
    actor: ISSUER,
    accepted: false,
    expiration: 1_104,
    result: 'tesSUCCESS',
  },
]

const FIXTURE_URI_HEX = Buffer.from(createIpfsRawPayloadUri('complete-projection-fixture'), 'utf8')
  .toString('hex')
  .toUpperCase()

function fixtureHex(value: number): string {
  return value.toString(16).padStart(64, '0')
}

function fixtureObjectId(index: number): string {
  return fixtureHex(0x500 + index)
}

function fixtureCredentialFields(
  fixtureCase: FixtureDeletionCase,
  schemaUid: string,
  accepted = fixtureCase.accepted,
): Record<string, unknown> {
  return {
    Issuer: ISSUER,
    Subject: fixtureCase.subject,
    CredentialType: schemaUid.toUpperCase(),
    URI: FIXTURE_URI_HEX,
    Flags: accepted ? 0x0001_0000 : 0,
    ...(fixtureCase.expiration === undefined ? {} : { Expiration: fixtureCase.expiration }),
  }
}

function fixtureTransaction(input: {
  hash: string
  transactionIndex: number
  transaction: Record<string, unknown>
  affectedNodes?: unknown[]
  result?: string
}): LedgerTransaction {
  return {
    hash: input.hash,
    transactionIndex: input.transactionIndex,
    transaction: input.transaction,
    metadata: {
      TransactionIndex: input.transactionIndex,
      TransactionResult: input.result ?? 'tesSUCCESS',
      AffectedNodes: input.affectedNodes ?? [],
    },
  }
}

function completeProjectionFixture(replayProfile: NetworkProfile): {
  ledgers: ReadonlyMap<number, ValidatedLedger>
  schemaUid: string
} {
  const registrationText = canonicalize(schemaDefinition as unknown as JsonValue)
  const schemaUid = computeSchemaUid({
    networkId: replayProfile.networkId,
    ledgerHash: replayProfile.activationLedgerHash,
    ledgerIndex: replayProfile.activationLedgerIndex,
    transactionIndex: 0,
    publisher: ISSUER,
    schema: schemaDefinition,
  })
  const registration = fixtureTransaction({
    hash: fixtureHex(0x400),
    transactionIndex: 0,
    transaction: {
      TransactionType: 'Payment',
      Account: ISSUER,
      Destination: replayProfile.registryAddress,
      Amount: replayProfile.registrationAmountDrops,
      Memos: [
        {
          Memo: {
            MemoType: Buffer.from('xcs:schema_register', 'utf8').toString('hex').toUpperCase(),
            MemoFormat: Buffer.from('application/json', 'utf8').toString('hex').toUpperCase(),
            MemoData: Buffer.from(registrationText, 'utf8').toString('hex').toUpperCase(),
          },
        },
      ],
    },
  })
  const creations = FIXTURE_DELETION_CASES.map((fixtureCase, index) =>
    fixtureTransaction({
      hash: fixtureHex(0x600 + index),
      transactionIndex: index,
      transaction: { TransactionType: 'CredentialCreate', Account: ISSUER },
      affectedNodes: [
        {
          CreatedNode: {
            LedgerEntryType: 'Credential',
            LedgerIndex: fixtureObjectId(index),
            NewFields: fixtureCredentialFields(fixtureCase, schemaUid, false),
          },
        },
      ],
    }),
  )
  const acceptedCaseIndex = FIXTURE_DELETION_CASES.findIndex(
    (fixtureCase) => fixtureCase.cause === 'subject_removed',
  )
  const acceptedCase = FIXTURE_DELETION_CASES[acceptedCaseIndex]
  if (acceptedCase === undefined) throw new Error('Accepted fixture case is missing')
  const acceptance = fixtureTransaction({
    hash: fixtureHex(0x700),
    transactionIndex: 0,
    transaction: { TransactionType: 'CredentialAccept', Account: acceptedCase.subject },
    affectedNodes: [
      {
        ModifiedNode: {
          LedgerEntryType: 'Credential',
          LedgerIndex: fixtureObjectId(acceptedCaseIndex),
          PreviousFields: { Flags: 0 },
          FinalFields: fixtureCredentialFields(acceptedCase, schemaUid, true),
        },
      },
    ],
  })
  const deletions = FIXTURE_DELETION_CASES.map((fixtureCase, index) =>
    fixtureTransaction({
      hash: fixtureHex(0x800 + index),
      transactionIndex: index,
      transaction: {
        TransactionType: fixtureCase.transactionType,
        Account: fixtureCase.actor,
      },
      affectedNodes: [
        {
          DeletedNode: {
            LedgerEntryType: 'Credential',
            LedgerIndex: fixtureObjectId(index),
            FinalFields: fixtureCredentialFields(fixtureCase, schemaUid),
          },
        },
      ],
      result: fixtureCase.result,
    }),
  )

  return {
    schemaUid,
    ledgers: new Map([
      [
        ACTIVATION_LEDGER_INDEX,
        { ...ledger(ACTIVATION_LEDGER_INDEX), transactions: [registration] },
      ],
      [
        ACTIVATION_LEDGER_INDEX + 1,
        { ...ledger(ACTIVATION_LEDGER_INDEX + 1), transactions: creations },
      ],
      [
        ACTIVATION_LEDGER_INDEX + 2,
        { ...ledger(ACTIVATION_LEDGER_INDEX + 2), transactions: [acceptance] },
      ],
      [
        ACTIVATION_LEDGER_INDEX + 3,
        { ...ledger(ACTIVATION_LEDGER_INDEX + 3), transactions: deletions },
      ],
    ]),
  }
}

class CompleteProjectionFixtureSource implements LedgerSource {
  private readonly tip: number

  constructor(
    private readonly replayProfile: NetworkProfile,
    private readonly ledgers: ReadonlyMap<number, ValidatedLedger>,
  ) {
    this.tip = Math.max(...ledgers.keys())
  }

  async connect(): Promise<void> {}

  async disconnect(): Promise<void> {}

  async preflight(profileToCheck: NetworkProfile): Promise<LedgerSourcePreflight> {
    if (
      canonicalize(profileToCheck as unknown as JsonValue) !==
      canonicalize(this.replayProfile as unknown as JsonValue)
    ) {
      throw new Error('Fixture replay profile mismatch')
    }
    return {
      networkId: this.replayProfile.networkId,
      completeLedgerRanges: [{ min: this.replayProfile.activationLedgerIndex, max: this.tip }],
      activationLedger: await this.getLedger(this.replayProfile.activationLedgerIndex),
      tips: this.tips(),
    }
  }

  async assertAmendmentEnabled(): Promise<void> {}

  async getValidatedLedgerIndex(): Promise<number> {
    return this.tip
  }

  async getValidatedLedgerTips() {
    return this.tips()
  }

  async getLedger(ledgerIndex: number): Promise<ValidatedLedger> {
    const value = this.ledgers.get(ledgerIndex)
    if (value === undefined) throw new Error(`Missing fixture ledger ${ledgerIndex}`)
    return structuredClone(value)
  }

  private tips() {
    return { primary: this.tip, secondary: this.tip, effective: this.tip }
  }
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
          memoJson: schemaMemoJson,
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

  it('applies migrations 0000 through 0004 to a fresh database and is migration-idempotent', async () => {
    const database = temporaryDatabases[0]
    if (database === undefined) throw new Error('First temporary database was not created')

    await migrateDatabase(database.client, { migrationsFolder: MIGRATIONS_FOLDER })

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
    const [incidentTable] = await database.client.sql<{ exists: boolean }[]>`
      SELECT to_regclass('public.indexer_incidents') IS NOT NULL AS exists
    `
    const discoveryIndexes = await database.client.sql<{ indexName: string }[]>`
      SELECT indexname AS "indexName"
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN (
          'credential_generations_stats_idx',
          'schema_events_activity_idx',
          'schemas_order_idx',
          'schemas_search_idx'
        )
      ORDER BY indexname
    `

    const integrityConstraints = await projectionIntegrityConstraintStates(database)

    expect(migrationCount?.count).toBe(5)
    expect(columns.map((row) => row.columnName)).toContain('transaction_root')
    expect(statusTable?.exists).toBe(true)
    expect(incidentTable?.exists).toBe(true)
    expect(discoveryIndexes.map((row) => row.indexName)).toEqual([
      'credential_generations_stats_idx',
      'schema_events_activity_idx',
      'schemas_order_idx',
      'schemas_search_idx',
    ])
    expect(integrityConstraints.map((constraint) => constraint.constraintName)).toEqual(
      [...PROJECTION_INTEGRITY_CONSTRAINT_NAMES].sort(),
    )
    expect(integrityConstraints.every((constraint) => constraint.validated)).toBe(true)
  })

  it('allows exact restarts but rejects another profile in exclusive database scope', async () => {
    if (adminDatabaseUrl === undefined) throw new Error('PostgreSQL admin URL is not initialized')
    const database = await createTemporaryDatabase(adminDatabaseUrl)
    const candidates = [profile('exclusive-profile-a'), profile('exclusive-profile-b')] as const
    const repository = new PostgresIndexerRepository(database.client.db, {
      databaseScope: 'exclusive-profile',
    })

    const concurrentResults = await Promise.allSettled(
      candidates.map((candidate) => repository.initializeProfile(candidate)),
    )
    expect(concurrentResults.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const rejected = concurrentResults.find((result) => result.status === 'rejected')
    expect(rejected).toMatchObject({
      status: 'rejected',
      reason: { code: 'DATABASE_SCOPE_CONFLICT' },
    })

    const storedProfiles = await database.client.sql<Array<{ profileId: string }>>`
      SELECT profile_id AS "profileId" FROM network_profiles
    `
    expect(storedProfiles).toHaveLength(1)
    const winningProfile = candidates.find(
      (candidate) => candidate.profileId === storedProfiles[0]?.profileId,
    )
    const losingProfile = candidates.find(
      (candidate) => candidate.profileId !== storedProfiles[0]?.profileId,
    )
    if (winningProfile === undefined || losingProfile === undefined) {
      throw new Error('Concurrent exclusive-profile result is invalid')
    }
    await expect(repository.initializeProfile(winningProfile)).resolves.toBeUndefined()
    await expect(repository.initializeProfile(losingProfile)).rejects.toMatchObject({
      code: 'DATABASE_SCOPE_CONFLICT',
    })
  })

  it('fails closed on invalid 0002 history and resumes 0003 validation after replay repair', async () => {
    if (adminDatabaseUrl === undefined) throw new Error('PostgreSQL admin URL is not initialized')
    const database = await createTemporaryDatabase(adminDatabaseUrl, { applyMigrations: false })
    const legacyMigrationsFolder = await createLegacyMigrationsFolder()
    try {
      await drizzleMigrate(database.client.db, { migrationsFolder: legacyMigrationsFolder })
    } finally {
      await rm(legacyMigrationsFolder, { recursive: true, force: true })
    }

    const upgradeProfile = profile('projection-integrity-upgrade')
    await replayProjection(database, upgradeProfile)
    await database.client.sql`
      UPDATE credential_generations
      SET expiration = 4294967296,
          last_ledger_index = created_ledger_index - 1
      WHERE profile_id = ${upgradeProfile.profileId}
    `

    await expect(
      migrateDatabase(database.client, { migrationsFolder: MIGRATIONS_FOLDER }),
    ).rejects.toMatchObject({
      code: PROJECTION_INTEGRITY_MIGRATION_ERROR,
      databaseCode: '23514',
      tableName: 'credential_generations',
    })

    const [failedMigrationCount] = await database.client.sql<{ count: number }[]>`
      SELECT count(*)::integer AS count FROM drizzle.__drizzle_migrations
    `
    const failedConstraintStates = await projectionIntegrityConstraintStates(database)
    const generationConstraintStates = failedConstraintStates.filter(
      (constraint) => constraint.tableName === 'credential_generations',
    )
    const eventConstraintStates = failedConstraintStates.filter(
      (constraint) => constraint.tableName === 'credential_events',
    )
    expect(failedMigrationCount?.count).toBe(5)
    expect(generationConstraintStates).toHaveLength(6)
    expect(generationConstraintStates.every((constraint) => !constraint.validated)).toBe(true)
    expect(eventConstraintStates).toHaveLength(5)
    expect(eventConstraintStates.every((constraint) => !constraint.validated)).toBe(true)
    await expect(
      provisionRuntimeDatabaseRoles(database.client, {
        clusterScope: 'dedicated',
        administratorPassword: new URL(database.url).password,
        indexerPassword: INDEXER_DATABASE_PASSWORD,
        apiPassword: API_DATABASE_PASSWORD,
        monitorPassword: MONITOR_DATABASE_PASSWORD,
      }),
    ).rejects.toThrow('fully migrated PostgreSQL 18 control database')
    const [controlMarkerAfterFailedValidation] = await database.client.sql<
      Array<{ exists: boolean }>
    >`
      SELECT EXISTS (
        SELECT 1 FROM pg_roles WHERE rolname = ${XCS_PROVISION_CONTROL_ROLE}
      ) AS exists
    `
    expect(controlMarkerAfterFailedValidation?.exists).toBe(false)

    await expect(
      database.client.sql`
        UPDATE credential_events
        SET node_index = -1
        WHERE profile_id = ${upgradeProfile.profileId}
      `,
    ).rejects.toMatchObject({
      code: '23514',
      constraint_name: 'credential_events_node_index',
    })

    // Production recovery rebuilds ledger-derived rows. Updating this isolated
    // fixture is the minimal equivalent needed to exercise the resumable runner.
    await database.client.sql`
      UPDATE credential_generations
      SET expiration = NULL,
          last_ledger_index = created_ledger_index
      WHERE profile_id = ${upgradeProfile.profileId}
    `
    await migrateDatabase(database.client, { migrationsFolder: MIGRATIONS_FOLDER })

    const recoveredConstraintStates = await projectionIntegrityConstraintStates(database)
    expect(recoveredConstraintStates).toHaveLength(PROJECTION_INTEGRITY_CONSTRAINT_NAMES.length)
    expect(recoveredConstraintStates.every((constraint) => constraint.validated)).toBe(true)

    await expect(
      database.client.sql`
        UPDATE ledger_checkpoints
        SET close_time = 4294967296
        WHERE profile_id = ${upgradeProfile.profileId}
      `,
    ).rejects.toMatchObject({
      code: '23514',
      constraint_name: 'ledger_checkpoints_close_time_uint32',
    })
    await expect(
      database.client.sql`
        UPDATE schema_events
        SET ledger_index = 4294967296
        WHERE profile_id = ${upgradeProfile.profileId}
      `,
    ).rejects.toMatchObject({
      code: '23514',
      constraint_name: 'schema_events_ledger_index_uint32',
    })
    await expect(
      database.client.sql`
        UPDATE schemas
        SET transaction_index = -1
        WHERE profile_id = ${upgradeProfile.profileId}
      `,
    ).rejects.toMatchObject({ code: '23514', constraint_name: 'schemas_transaction_index' })
    await expect(
      database.client.sql`
        UPDATE credential_generations
        SET expiration = 4294967296
        WHERE profile_id = ${upgradeProfile.profileId}
      `,
    ).rejects.toMatchObject({
      code: '23514',
      constraint_name: 'credential_generations_expiration_uint32',
    })
    await expect(
      database.client.sql`
        UPDATE credential_generations
        SET last_ledger_index = created_ledger_index - 1
        WHERE profile_id = ${upgradeProfile.profileId}
      `,
    ).rejects.toMatchObject({
      code: '23514',
      constraint_name: 'credential_generations_ledger_order',
    })
    await expect(
      database.client.sql`
        UPDATE credential_events
        SET generation_id = NULL
        WHERE profile_id = ${upgradeProfile.profileId}
      `,
    ).rejects.toMatchObject({
      code: '23514',
      constraint_name: 'credential_events_generation_id',
    })

    await database.client.sql`
      UPDATE ledger_checkpoints
      SET close_time = 4294967295
      WHERE profile_id = ${upgradeProfile.profileId}
    `
    await database.client.sql`
      UPDATE credential_generations
      SET expiration = 4294967295
      WHERE profile_id = ${upgradeProfile.profileId}
    `
    await database.client.sql`
      UPDATE ledger_checkpoints
      SET close_time = 0
      WHERE profile_id = ${upgradeProfile.profileId}
    `
    await database.client.sql`
      UPDATE credential_generations
      SET expiration = NULL
      WHERE profile_id = ${upgradeProfile.profileId}
    `
  }, 30_000)

  it('provisions idempotent least-privilege indexer, API and monitor roles', async () => {
    const database = temporaryDatabases[0]
    const otherMigratedDatabase = temporaryDatabases[1]
    if (database === undefined) throw new Error('First temporary database was not created')
    if (otherMigratedDatabase === undefined) {
      throw new Error('Second temporary database was not created')
    }
    if (adminClient === undefined) throw new Error('PostgreSQL admin client is not initialized')

    const emptyDatabase = await createTemporaryDatabase(database.url, { applyMigrations: false })
    await expect(
      provisionRuntimeDatabaseRoles(emptyDatabase.client, {
        clusterScope: 'dedicated',
        administratorPassword: new URL(emptyDatabase.url).password,
        indexerPassword: INDEXER_DATABASE_PASSWORD,
        apiPassword: API_DATABASE_PASSWORD,
        monitorPassword: MONITOR_DATABASE_PASSWORD,
      }),
    ).rejects.toThrow('fully migrated PostgreSQL 18 control database')
    const [prematureControlMarker] = await adminClient.sql<Array<{ exists: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM pg_roles WHERE rolname = ${XCS_PROVISION_CONTROL_ROLE}
      ) AS exists
    `
    expect(prematureControlMarker?.exists).toBe(false)

    const weakenedConstraintDatabase = await createTemporaryDatabase(database.url)
    await weakenedConstraintDatabase.client.sql`
      ALTER TABLE public.credential_events
        DROP CONSTRAINT credential_events_ledger_index_uint32,
        ADD CONSTRAINT credential_events_ledger_index_uint32 CHECK (true)
    `
    await expect(
      provisionRuntimeDatabaseRoles(weakenedConstraintDatabase.client, {
        clusterScope: 'dedicated',
        administratorPassword: new URL(weakenedConstraintDatabase.url).password,
        indexerPassword: INDEXER_DATABASE_PASSWORD,
        apiPassword: API_DATABASE_PASSWORD,
        monitorPassword: MONITOR_DATABASE_PASSWORD,
      }),
    ).rejects.toThrow('exact validated projection constraints')
    const [controlMarkerAfterWeakenedConstraint] = await adminClient.sql<
      Array<{ exists: boolean }>
    >`
      SELECT EXISTS (
        SELECT 1 FROM pg_roles WHERE rolname = ${XCS_PROVISION_CONTROL_ROLE}
      ) AS exists
    `
    expect(controlMarkerAfterWeakenedConstraint?.exists).toBe(false)

    const duplicatedHistoryDatabase = await createTemporaryDatabase(database.url)
    await duplicatedHistoryDatabase.client.sql`
      DELETE FROM drizzle.__drizzle_migrations
      WHERE id = (SELECT max(id) FROM drizzle.__drizzle_migrations)
    `
    await duplicatedHistoryDatabase.client.sql`
      INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
      SELECT hash, created_at
      FROM drizzle.__drizzle_migrations
      ORDER BY id
      LIMIT 1
    `
    await expect(
      provisionRuntimeDatabaseRoles(duplicatedHistoryDatabase.client, {
        clusterScope: 'dedicated',
        administratorPassword: new URL(duplicatedHistoryDatabase.url).password,
        indexerPassword: INDEXER_DATABASE_PASSWORD,
        apiPassword: API_DATABASE_PASSWORD,
        monitorPassword: MONITOR_DATABASE_PASSWORD,
      }),
    ).rejects.toThrow('exact 5-migration database history')
    const [controlMarkerAfterDuplicatedHistory] = await adminClient.sql<Array<{ exists: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM pg_roles WHERE rolname = ${XCS_PROVISION_CONTROL_ROLE}
      ) AS exists
    `
    expect(controlMarkerAfterDuplicatedHistory?.exists).toBe(false)

    const preexisting = await adminClient.sql<{ roleName: string }[]>`
      SELECT rolname AS "roleName"
      FROM pg_roles
      WHERE rolname IN (
        'xcs_indexer',
        'xcs_api',
        'xcs_monitor',
        ${XCS_PROVISION_CONTROL_ROLE}
      )
    `
    if (preexisting.length > 0) {
      throw new Error(
        'PostgreSQL integration tests require a disposable cluster without xcs runtime roles',
      )
    }
    runtimeRoleCleanupAllowed = true

    const driftedPasswordEncryptionUrl = new URL(database.url)
    driftedPasswordEncryptionUrl.searchParams.set('options', '-c password_encryption=md5')
    const driftedPasswordEncryptionClient = createDatabaseClient(
      driftedPasswordEncryptionUrl.toString(),
    )
    try {
      await provisionRuntimeDatabaseRoles(driftedPasswordEncryptionClient, {
        clusterScope: 'dedicated',
        administratorPassword: new URL(database.url).password,
        indexerPassword: INDEXER_DATABASE_PASSWORD,
        apiPassword: API_DATABASE_PASSWORD,
        monitorPassword: MONITOR_DATABASE_PASSWORD,
      })
    } finally {
      await driftedPasswordEncryptionClient.close()
    }
    const [runtimePasswordState] = await adminClient.sql<Array<{ scramRoles: number }>>`
      SELECT count(*)::integer AS "scramRoles"
      FROM pg_authid
      WHERE rolname IN ('xcs_indexer', 'xcs_api', 'xcs_monitor')
        AND rolpassword LIKE 'SCRAM-SHA-256$%'
    `
    expect(runtimePasswordState?.scramRoles).toBe(3)
    await expect(
      provisionRuntimeDatabaseRoles(otherMigratedDatabase.client, {
        clusterScope: 'dedicated',
        administratorPassword: new URL(otherMigratedDatabase.url).password,
        indexerPassword: INDEXER_DATABASE_PASSWORD,
        apiPassword: API_DATABASE_PASSWORD,
        monitorPassword: MONITOR_DATABASE_PASSWORD,
      }),
    ).rejects.toMatchObject({ code: '42501' })
    await database.client.sql`CREATE SCHEMA xcs_hostile_runtime`
    await database.client.sql`CREATE TABLE xcs_hostile_runtime.secret_rows (value integer)`
    await database.client.sql`CREATE SEQUENCE xcs_hostile_runtime.secret_sequence`
    await database.client.sql`
      CREATE FUNCTION xcs_hostile_runtime.secret_value() RETURNS integer
      LANGUAGE SQL AS 'SELECT 1'
    `
    await database.client.sql`
      GRANT ALL PRIVILEGES ON SCHEMA xcs_hostile_runtime
      TO PUBLIC, xcs_indexer, xcs_api, xcs_monitor
    `
    await database.client.sql`
      GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA xcs_hostile_runtime
      TO PUBLIC, xcs_indexer, xcs_api, xcs_monitor
    `
    await database.client.sql`
      GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA xcs_hostile_runtime
      TO PUBLIC, xcs_indexer, xcs_api, xcs_monitor
    `
    await database.client.sql`
      GRANT ALL PRIVILEGES ON ALL ROUTINES IN SCHEMA xcs_hostile_runtime
      TO PUBLIC, xcs_indexer, xcs_api, xcs_monitor
    `
    await database.client.sql`
      CREATE TYPE xcs_hostile_runtime.public_enum AS ENUM ('hostile')
    `
    await database.client.sql`
      GRANT USAGE ON TYPE xcs_hostile_runtime.public_enum TO PUBLIC
    `
    await database.client.sql`
      CREATE FOREIGN DATA WRAPPER xcs_hostile_fdw NO HANDLER
    `
    await database.client.sql`
      CREATE SERVER xcs_hostile_server FOREIGN DATA WRAPPER xcs_hostile_fdw
    `
    await database.client.sql`
      GRANT USAGE ON FOREIGN DATA WRAPPER xcs_hostile_fdw TO PUBLIC
    `
    await database.client.sql`
      GRANT USAGE ON FOREIGN SERVER xcs_hostile_server TO PUBLIC
    `
    await database.client.sql`SELECT lo_create(${PUBLIC_LARGE_OBJECT_ID}::oid)`
    await database.client.sql.unsafe(
      `GRANT SELECT ON LARGE OBJECT ${PUBLIC_LARGE_OBJECT_ID} TO PUBLIC`,
    )
    await database.client.sql`REVOKE USAGE ON LANGUAGE plpgsql FROM PUBLIC`
    await database.client.sql`
      ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO PUBLIC
    `
    await database.client.sql`
      ALTER DEFAULT PRIVILEGES IN SCHEMA xcs_hostile_runtime
      GRANT USAGE ON TYPES TO PUBLIC
    `
    const legacyMemberRole = temporaryLegacyRoleName()
    await adminClient.sql`
      CREATE ROLE ${adminClient.sql(legacyMemberRole)}
      LOGIN PASSWORD 'runtime-member-integration-password-001'
    `
    createdLegacyRoleNames.add(legacyMemberRole)
    const downstreamRole = temporaryLegacyRoleName()
    await adminClient.sql`
      CREATE ROLE ${adminClient.sql(downstreamRole)}
      LOGIN PASSWORD 'downstream-role-integration-password-01'
    `
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
    await adminClient.sql`
      GRANT CONNECT ON DATABASE ${adminClient.sql(database.name)} TO ${adminClient.sql(downstreamRole)}
    `

    await database.client.sql`GRANT UPDATE ON TABLE network_profiles TO pg_monitor`
    await database.client.sql`GRANT pg_write_all_data TO pg_monitor`
    await expect(
      provisionRuntimeDatabaseRoles(database.client, {
        clusterScope: 'dedicated',
        administratorPassword: new URL(database.url).password,
        indexerPassword: ROTATED_INDEXER_DATABASE_PASSWORD,
        apiPassword: ROTATED_API_DATABASE_PASSWORD,
        monitorPassword: ROTATED_MONITOR_DATABASE_PASSWORD,
      }),
    ).rejects.toMatchObject({ code: '42501' })
    await database.client.sql`REVOKE UPDATE ON TABLE network_profiles FROM pg_monitor CASCADE`
    await database.client.sql`REVOKE pg_write_all_data FROM pg_monitor CASCADE`

    const runtimeOwnedDatabase = temporaryDatabaseName()
    await adminClient.sql`
      CREATE DATABASE ${adminClient.sql(runtimeOwnedDatabase)}
      OWNER xcs_api TEMPLATE template0 ENCODING 'UTF8'
    `
    createdDatabaseNames.add(runtimeOwnedDatabase)
    await expect(
      provisionRuntimeDatabaseRoles(database.client, {
        clusterScope: 'dedicated',
        administratorPassword: new URL(database.url).password,
        indexerPassword: ROTATED_INDEXER_DATABASE_PASSWORD,
        apiPassword: ROTATED_API_DATABASE_PASSWORD,
        monitorPassword: ROTATED_MONITOR_DATABASE_PASSWORD,
      }),
    ).rejects.toMatchObject({ code: '42501' })
    const quarantinedRoles = await adminClient.sql<
      Array<{ roleName: string; canLogin: boolean; canCreateDatabase: boolean }>
    >`
      SELECT
        rolname AS "roleName",
        rolcanlogin AS "canLogin",
        rolcreatedb AS "canCreateDatabase"
      FROM pg_roles
      WHERE rolname IN ('xcs_indexer', 'xcs_api', 'xcs_monitor')
      ORDER BY rolname
    `
    expect(quarantinedRoles).toEqual([
      { roleName: 'xcs_api', canLogin: false, canCreateDatabase: false },
      { roleName: 'xcs_indexer', canLogin: false, canCreateDatabase: false },
      { roleName: 'xcs_monitor', canLogin: false, canCreateDatabase: false },
    ])
    const [quarantinedMemberships] = await adminClient.sql<Array<{ count: number }>>`
      SELECT count(*)::integer AS count
      FROM pg_auth_members membership
      JOIN pg_roles granted_role ON granted_role.oid = membership.roleid
      JOIN pg_roles member_role ON member_role.oid = membership.member
      WHERE granted_role.rolname IN ('xcs_indexer', 'xcs_api', 'xcs_monitor')
         OR member_role.rolname IN ('xcs_indexer', 'xcs_api', 'xcs_monitor')
    `
    expect(quarantinedMemberships?.count).toBe(0)
    await adminClient.sql`
      ALTER DATABASE ${adminClient.sql(runtimeOwnedDatabase)} OWNER TO CURRENT_USER
    `

    const [ownedLargeObject] = await database.client.sql<Array<{ objectId: number }>>`
      SELECT lo_create(0)::integer AS "objectId"
    `
    if (ownedLargeObject === undefined) throw new Error('Could not create ownership-guard fixture')
    await database.client.sql.unsafe(
      `ALTER LARGE OBJECT ${ownedLargeObject.objectId} OWNER TO xcs_api`,
    )
    await expect(
      provisionRuntimeDatabaseRoles(database.client, {
        clusterScope: 'dedicated',
        administratorPassword: new URL(database.url).password,
        indexerPassword: ROTATED_INDEXER_DATABASE_PASSWORD,
        apiPassword: ROTATED_API_DATABASE_PASSWORD,
        monitorPassword: ROTATED_MONITOR_DATABASE_PASSWORD,
      }),
    ).rejects.toMatchObject({ code: '42501' })
    await database.client.sql.unsafe(
      `ALTER LARGE OBJECT ${ownedLargeObject.objectId} OWNER TO CURRENT_USER`,
    )
    await database.client.sql`SELECT lo_unlink(${ownedLargeObject.objectId}::oid)`

    await database.client.sql`
      CREATE COLLATION public.xcs_runtime_owned_collation FROM pg_catalog."C"
    `
    await database.client.sql`
      ALTER COLLATION public.xcs_runtime_owned_collation OWNER TO xcs_api
    `
    await expect(
      provisionRuntimeDatabaseRoles(database.client, {
        clusterScope: 'dedicated',
        administratorPassword: new URL(database.url).password,
        indexerPassword: ROTATED_INDEXER_DATABASE_PASSWORD,
        apiPassword: ROTATED_API_DATABASE_PASSWORD,
        monitorPassword: ROTATED_MONITOR_DATABASE_PASSWORD,
      }),
    ).rejects.toMatchObject({ code: '42501' })
    await database.client.sql`
      ALTER COLLATION public.xcs_runtime_owned_collation OWNER TO CURRENT_USER
    `
    await database.client.sql`DROP COLLATION public.xcs_runtime_owned_collation`

    // Ownership failures intentionally leave every runtime NOLOGIN. Restore
    // the original generation before constructing sessions for rotation.
    await provisionRuntimeDatabaseRoles(database.client, {
      clusterScope: 'dedicated',
      administratorPassword: new URL(database.url).password,
      indexerPassword: INDEXER_DATABASE_PASSWORD,
      apiPassword: API_DATABASE_PASSWORD,
      monitorPassword: MONITOR_DATABASE_PASSWORD,
    })
    await adminClient.sql`GRANT xcs_indexer TO ${adminClient.sql(legacyMemberRole)}`
    await adminClient.sql`GRANT xcs_api TO ${adminClient.sql(legacyMemberRole)}`
    await adminClient.sql.begin(async (sql) => {
      await sql`SET LOCAL ROLE ${sql(intermediateGrantorRole)}`
      await sql`GRANT pg_read_all_data TO xcs_api WITH ADMIN OPTION`
    })
    await adminClient.sql`ALTER ROLE xcs_api CREATEDB`
    const restoredDelegatingApiClient = createDatabaseClient(
      runtimeDatabaseUrl(database.url, 'xcs_api', API_DATABASE_PASSWORD),
    )
    try {
      await restoredDelegatingApiClient.sql`
        GRANT pg_read_all_data TO ${restoredDelegatingApiClient.sql(downstreamRole)}
      `
    } finally {
      await restoredDelegatingApiClient.close()
    }
    await database.client.sql`
      GRANT UPDATE (issuer) ON TABLE credential_generations TO xcs_indexer
    `
    await database.client.sql`
      GRANT SELECT (rolpassword) ON TABLE pg_catalog.pg_authid TO xcs_api, PUBLIC
    `
    await database.client.sql`
      GRANT SELECT ON TABLE pg_catalog.pg_subscription TO PUBLIC
    `
    await database.client.sql`GRANT CREATE ON SCHEMA pg_catalog TO PUBLIC`
    await database.client.sql`GRANT SELECT ON ALL TABLES IN SCHEMA pg_toast TO PUBLIC`
    await database.client.sql`GRANT UPDATE ON TABLE information_schema.tables TO PUBLIC`
    await database.client.sql`
      GRANT EXECUTE ON FUNCTION pg_catalog.pg_read_file(text) TO PUBLIC
    `
    await database.client.sql`
      GRANT SET ON PARAMETER session_replication_role TO xcs_indexer
    `
    await database.client.sql`
      GRANT ALTER SYSTEM ON PARAMETER work_mem TO xcs_api
    `
    await database.client.sql`
      GRANT CREATE ON TABLESPACE pg_default TO xcs_monitor
    `
    await database.client.sql`
      ALTER DEFAULT PRIVILEGES FOR ROLE xcs_api
      GRANT SELECT ON TABLES TO ${database.client.sql(downstreamRole)}
    `
    await database.client.sql`
      GRANT EXECUTE ON FUNCTION pg_catalog.pg_advisory_lock(integer, integer) TO xcs_api
    `
    await adminClient.sql`
      GRANT CONNECT ON DATABASE ${adminClient.sql(database.name)} TO ${adminClient.sql(downstreamRole)}
    `

    const staleApiClient = createDatabaseClient(
      runtimeDatabaseUrl(database.url, 'xcs_api', API_DATABASE_PASSWORD),
    )
    const staleMemberClient = createDatabaseClient(
      runtimeDatabaseUrl(database.url, legacyMemberRole, RUNTIME_MEMBER_DATABASE_PASSWORD),
    )
    const staleDelegatedClient = createDatabaseClient(
      runtimeDatabaseUrl(database.url, downstreamRole, DOWNSTREAM_ROLE_DATABASE_PASSWORD),
    )
    await staleApiClient.sql`
      SELECT pg_advisory_lock(1480807217, 1)
    `
    await staleMemberClient.sql`SET ROLE xcs_api`
    const [assumedRuntimeRole] = await staleMemberClient.sql<{ currentRole: string }[]>`
      SELECT current_user AS "currentRole"
    `
    expect(assumedRuntimeRole?.currentRole).toBe('xcs_api')
    await staleDelegatedClient.sql`SET ROLE pg_read_all_data`
    const [assumedDelegatedRole] = await staleDelegatedClient.sql<{ currentRole: string }[]>`
      SELECT current_user AS "currentRole"
    `
    expect(assumedDelegatedRole?.currentRole).toBe('pg_read_all_data')
    await provisionRuntimeDatabaseRoles(database.client, {
      clusterScope: 'dedicated',
      administratorPassword: new URL(database.url).password,
      indexerPassword: ROTATED_INDEXER_DATABASE_PASSWORD,
      apiPassword: ROTATED_API_DATABASE_PASSWORD,
      monitorPassword: ROTATED_MONITOR_DATABASE_PASSWORD,
    })
    try {
      await expect(staleApiClient.sql`SELECT 1`).rejects.toThrow()
      await expect(staleMemberClient.sql`SELECT 1`).rejects.toThrow()
      await expect(staleDelegatedClient.sql`SELECT 1`).rejects.toThrow()
    } finally {
      await Promise.allSettled([
        staleApiClient.close(),
        staleMemberClient.close(),
        staleDelegatedClient.close(),
      ])
    }
    await adminClient.sql`
      REVOKE CONNECT ON DATABASE ${adminClient.sql(database.name)} FROM ${adminClient.sql(downstreamRole)}
    `

    const oldPasswordClient = createDatabaseClient(
      runtimeDatabaseUrl(database.url, 'xcs_api', API_DATABASE_PASSWORD),
    )
    try {
      await expect(oldPasswordClient.sql`SELECT 1`).rejects.toMatchObject({ code: '28P01' })
    } finally {
      await oldPasswordClient.close()
    }

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
        connectionLimit: number
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
        rolconnlimit AS "connectionLimit",
        ARRAY(
          SELECT setting
          FROM unnest(COALESCE(rolconfig, ARRAY[]::text[])) setting
          ORDER BY setting
        ) AS configuration
      FROM pg_roles
      WHERE rolname IN ('xcs_indexer', 'xcs_api', 'xcs_monitor')
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
        connectionLimit: XCS_API_DATABASE_CONNECTION_LIMIT,
        configuration: [
          'idle_in_transaction_session_timeout=30s',
          'lock_timeout=15s',
          'statement_timeout=30s',
        ],
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
        connectionLimit: XCS_INDEXER_DATABASE_CONNECTION_LIMIT,
        configuration: [
          'idle_in_transaction_session_timeout=30s',
          'lock_timeout=30s',
          'statement_timeout=5min',
        ],
      },
      {
        roleName: 'xcs_monitor',
        canLogin: true,
        isSuperuser: false,
        canCreateDatabase: false,
        canCreateRole: false,
        canReplicate: false,
        canBypassRls: false,
        inheritsPrivileges: true,
        connectionLimit: XCS_MONITOR_DATABASE_CONNECTION_LIMIT,
        configuration: [
          'idle_in_transaction_session_timeout=30s',
          'lock_timeout=10s',
          'statement_timeout=30s',
        ],
      },
    ])
    const runtimeMemberships = await adminClient.sql<
      Array<{
        grantedRole: string
        memberRole: string
        adminOption: boolean
        inheritOption: boolean
        setOption: boolean
      }>
    >`
      SELECT
        granted_role.rolname AS "grantedRole",
        member_role.rolname AS "memberRole",
        membership.admin_option AS "adminOption",
        membership.inherit_option AS "inheritOption",
        membership.set_option AS "setOption"
      FROM pg_auth_members membership
      JOIN pg_roles granted_role ON granted_role.oid = membership.roleid
      JOIN pg_roles member_role ON member_role.oid = membership.member
      WHERE granted_role.rolname IN ('xcs_indexer', 'xcs_api', 'xcs_monitor')
        OR member_role.rolname IN ('xcs_indexer', 'xcs_api', 'xcs_monitor')
        OR (
          granted_role.rolname = 'pg_read_all_data'
          AND member_role.rolname = ${downstreamRole}
        )
      ORDER BY granted_role.rolname, member_role.rolname
    `
    expect(runtimeMemberships).toEqual([
      {
        grantedRole: 'pg_monitor',
        memberRole: 'xcs_monitor',
        adminOption: false,
        inheritOption: true,
        setOption: false,
      },
    ])
    const [monitorMembership] = await adminClient.sql<
      Array<{ inheritsMonitor: boolean; canSetMonitor: boolean }>
    >`
      SELECT
        pg_has_role('xcs_monitor', 'pg_monitor', 'USAGE') AS "inheritsMonitor",
        pg_has_role('xcs_monitor', 'pg_monitor', 'SET') AS "canSetMonitor"
    `
    expect(monitorMembership).toEqual({ inheritsMonitor: true, canSetMonitor: false })
    const legacyRoles = await adminClient.sql<{ roleName: string; canLogin: boolean }[]>`
      SELECT rolname AS "roleName", rolcanlogin AS "canLogin"
      FROM pg_roles
      WHERE rolname IN (${legacyMemberRole}, ${downstreamRole}, ${intermediateGrantorRole})
      ORDER BY rolname
    `
    expect(legacyRoles).toEqual(
      [
        { roleName: legacyMemberRole, canLogin: true },
        { roleName: downstreamRole, canLogin: true },
        { roleName: intermediateGrantorRole, canLogin: false },
      ].sort((left, right) => left.roleName.localeCompare(right.roleName)),
    )

    const [privilegeDrift] = await adminClient.sql<
      Array<{
        indexerCanRewriteIssuer: boolean
        indexerCanSetReplicationRole: boolean
        apiCanAlterSystemWorkMem: boolean
        monitorCanCreateInDefaultTablespace: boolean
        apiDefaultAclCount: number
        publicPasswordColumnAclCount: number
        publicSubscriptionAclCount: number
        apiCanCreateInPgCatalog: boolean
        apiCanUpdateInformationSchema: boolean
        apiCanReadServerFiles: boolean
        plpgsqlPublicUsage: boolean
        publicDefaultAclCount: number
        publicFdwAclCount: number
        publicForeignServerAclCount: number
        publicLargeObjectAclCount: number
        publicToastAclCount: number
        publicTypeAclCount: number
      }>
    >`
      SELECT
        has_column_privilege(
          'xcs_indexer',
          'public.credential_generations',
          'issuer',
          'UPDATE'
        ) AS "indexerCanRewriteIssuer",
        has_parameter_privilege(
          'xcs_indexer',
          'session_replication_role',
          'SET'
        ) AS "indexerCanSetReplicationRole",
        has_parameter_privilege(
          'xcs_api',
          'work_mem',
          'ALTER SYSTEM'
        ) AS "apiCanAlterSystemWorkMem",
        has_tablespace_privilege(
          'xcs_monitor',
          'pg_default',
          'CREATE'
        ) AS "monitorCanCreateInDefaultTablespace",
        (
          SELECT count(*)::integer
          FROM pg_default_acl
          WHERE defaclrole = 'xcs_api'::regrole
        ) AS "apiDefaultAclCount",
        (
          SELECT count(*)::integer
          FROM pg_attribute attribute_object
          CROSS JOIN LATERAL aclexplode(attribute_object.attacl) privilege
          WHERE attribute_object.attrelid = 'pg_catalog.pg_authid'::regclass
            AND attribute_object.attname = 'rolpassword'
            AND privilege.grantee = 0
        ) AS "publicPasswordColumnAclCount",
        (
          SELECT count(*)::integer
          FROM pg_class relation
          CROSS JOIN LATERAL aclexplode(relation.relacl) privilege
          WHERE relation.oid = 'pg_catalog.pg_subscription'::regclass
            AND privilege.grantee = 0
        ) AS "publicSubscriptionAclCount",
        has_schema_privilege(
          'xcs_api',
          'pg_catalog',
          'CREATE'
        ) AS "apiCanCreateInPgCatalog",
        has_table_privilege(
          'xcs_api',
          'information_schema.tables',
          'UPDATE'
        ) AS "apiCanUpdateInformationSchema",
        has_function_privilege(
          'xcs_api',
          'pg_catalog.pg_read_file(text)',
          'EXECUTE'
        ) AS "apiCanReadServerFiles",
        EXISTS (
          SELECT 1
          FROM pg_language language_object
          CROSS JOIN LATERAL aclexplode(
            COALESCE(language_object.lanacl, acldefault('l'::"char", language_object.lanowner))
          ) privilege
          WHERE language_object.lanname = 'plpgsql'
            AND privilege.grantee = 0
            AND privilege.privilege_type = 'USAGE'
        ) AS "plpgsqlPublicUsage",
        (
          SELECT count(*)::integer
          FROM pg_default_acl default_acl
          CROSS JOIN LATERAL aclexplode(default_acl.defaclacl) privilege
          WHERE privilege.grantee = 0
        ) AS "publicDefaultAclCount",
        (
          SELECT count(*)::integer
          FROM pg_foreign_data_wrapper wrapper
          CROSS JOIN LATERAL aclexplode(wrapper.fdwacl) privilege
          WHERE wrapper.fdwname = 'xcs_hostile_fdw'
            AND privilege.grantee = 0
        ) AS "publicFdwAclCount",
        (
          SELECT count(*)::integer
          FROM pg_foreign_server server_object
          CROSS JOIN LATERAL aclexplode(server_object.srvacl) privilege
          WHERE server_object.srvname = 'xcs_hostile_server'
            AND privilege.grantee = 0
        ) AS "publicForeignServerAclCount",
        (
          SELECT count(*)::integer
          FROM pg_largeobject_metadata large_object_metadata
          CROSS JOIN LATERAL aclexplode(large_object_metadata.lomacl) privilege
          WHERE large_object_metadata.oid = ${PUBLIC_LARGE_OBJECT_ID}::oid
            AND privilege.grantee = 0
        ) AS "publicLargeObjectAclCount",
        (
          SELECT count(*)::integer
          FROM pg_class relation
          JOIN pg_namespace namespace_object ON namespace_object.oid = relation.relnamespace
          CROSS JOIN LATERAL aclexplode(relation.relacl) privilege
          WHERE namespace_object.nspname = 'pg_toast'
            AND privilege.grantee = 0
        ) AS "publicToastAclCount",
        (
          SELECT count(*)::integer
          FROM pg_type type_object
          JOIN pg_namespace namespace_object ON namespace_object.oid = type_object.typnamespace
          CROSS JOIN LATERAL aclexplode(type_object.typacl) privilege
          WHERE namespace_object.nspname = 'xcs_hostile_runtime'
            AND type_object.typname = 'public_enum'
            AND privilege.grantee = 0
        ) AS "publicTypeAclCount"
    `
    expect(privilegeDrift).toEqual({
      indexerCanRewriteIssuer: false,
      indexerCanSetReplicationRole: false,
      apiCanAlterSystemWorkMem: false,
      monitorCanCreateInDefaultTablespace: false,
      apiDefaultAclCount: 0,
      publicPasswordColumnAclCount: 0,
      publicSubscriptionAclCount: 0,
      apiCanCreateInPgCatalog: false,
      apiCanUpdateInformationSchema: false,
      apiCanReadServerFiles: false,
      plpgsqlPublicUsage: true,
      publicDefaultAclCount: 0,
      publicFdwAclCount: 0,
      publicForeignServerAclCount: 0,
      publicLargeObjectAclCount: 0,
      publicToastAclCount: 0,
      publicTypeAclCount: 0,
    })

    if (adminDatabaseUrl === undefined) throw new Error('PostgreSQL admin URL is not initialized')
    for (const [roleName, password] of [
      ['xcs_indexer', ROTATED_INDEXER_DATABASE_PASSWORD],
      ['xcs_api', ROTATED_API_DATABASE_PASSWORD],
      ['xcs_monitor', ROTATED_MONITOR_DATABASE_PASSWORD],
    ] as const) {
      const foreignDatabaseClient = createDatabaseClient(
        runtimeDatabaseUrl(adminDatabaseUrl, roleName, password),
      )
      try {
        await expectPermissionDenied(foreignDatabaseClient.sql`SELECT 1`)
      } finally {
        await foreignDatabaseClient.close()
      }
    }

    const indexerClient = createDatabaseClient(
      runtimeDatabaseUrl(database.url, 'xcs_indexer', ROTATED_INDEXER_DATABASE_PASSWORD),
    )
    const apiClient = createDatabaseClient(
      runtimeDatabaseUrl(database.url, 'xcs_api', ROTATED_API_DATABASE_PASSWORD),
    )
    const monitorClient = createDatabaseClient(
      runtimeDatabaseUrl(database.url, 'xcs_monitor', ROTATED_MONITOR_DATABASE_PASSWORD),
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
      await repository.haltIndexer(
        lease,
        {
          primarySourceTip: activation.ledgerIndex,
          secondarySourceTip: activation.ledgerIndex,
          lastAgreedLedgerIndex: activation.ledgerIndex,
          lastAgreedLedgerHash: activation.ledgerHash,
        },
        'OPERATOR_TEST_HALT',
      )

      const [projectionRead] = await apiClient.sql<{ count: number }[]>`
        SELECT count(*)::integer AS count
        FROM ledger_checkpoints
        WHERE profile_id = ${permissionsProfile.profileId}
      `
      expect(projectionRead?.count).toBe(1)
      const [incidentRead] = await apiClient.sql<Array<{ writerEpoch: string; errorCode: string }>>`
        SELECT writer_epoch::text AS "writerEpoch", error_code AS "errorCode"
        FROM indexer_incidents
        WHERE profile_id = ${permissionsProfile.profileId}
      `
      expect(incidentRead).toEqual({
        writerEpoch: String(lease.epoch),
        errorCode: 'OPERATOR_TEST_HALT',
      })

      const [operationalRead] = await apiClient.sql<
        Array<{
          usedConnections: string
          maxConnections: string
          logicalSizeBytes: string
        }>
      >`
        SELECT
          (
            SELECT COUNT(*)::text
            FROM pg_stat_activity
            WHERE backend_type = 'client backend'
          ) AS "usedConnections",
          current_setting('max_connections') AS "maxConnections",
          pg_database_size(current_database())::text AS "logicalSizeBytes"
      `
      expect(Number(operationalRead?.usedConnections)).toBeGreaterThan(0)
      expect(Number(operationalRead?.maxConnections)).toBeGreaterThan(0)
      expect(Number(operationalRead?.logicalSizeBytes)).toBeGreaterThan(0)

      const [monitorRead] = await monitorClient.sql<
        Array<{ databaseName: string; logicalSizeBytes: string }>
      >`
        SELECT
          datname AS "databaseName",
          pg_database_size(datname)::text AS "logicalSizeBytes"
        FROM pg_stat_database
        WHERE datname = current_database()
      `
      expect(monitorRead?.databaseName).toBe(new URL(database.url).pathname.slice(1))
      expect(Number(monitorRead?.logicalSizeBytes)).toBeGreaterThan(0)
      await expectPermissionDenied(monitorClient.sql`SELECT * FROM network_profiles`)
      await expectPermissionDenied(
        monitorClient.sql`SELECT lo_from_bytea(0::oid, decode('00', 'hex'))`,
      )
      await expectPermissionDenied(apiClient.sql`SELECT pg_advisory_xact_lock(1::bigint)`)
      await expectPermissionDenied(apiClient.sql`SELECT pg_advisory_lock(1::bigint)`)
      await expectPermissionDenied(apiClient.sql`SELECT pg_advisory_xact_lock(1, 1)`)
      await expectPermissionDenied(monitorClient.sql`SELECT pg_advisory_xact_lock(1::bigint)`)
      await expectPermissionDenied(
        apiClient.sql`SELECT rolpassword FROM pg_catalog.pg_authid LIMIT 1`,
      )
      await expectPermissionDenied(
        apiClient.sql`SELECT subconninfo FROM pg_catalog.pg_subscription LIMIT 1`,
      )
      await expectPermissionDenied(
        apiClient.sql`
          SELECT pg_logical_emit_message(false, 'xcs-test', 'payload', false)
        `,
      )
      await expectPermissionDenied(apiClient.sql`SELECT pg_notify('xcs_test', 'payload')`)
      await expectPermissionDenied(
        monitorClient.sql`
          INSERT INTO indexer_incidents (profile_id, writer_epoch, error_code)
          VALUES (${permissionsProfile.profileId}, 998, 'FORBIDDEN_MONITOR_WRITE')
        `,
      )
      await expectPermissionDenied(monitorClient.sql`SELECT * FROM xcs_hostile_runtime.secret_rows`)
      await expectPermissionDenied(apiClient.sql`SELECT * FROM xcs_hostile_runtime.secret_rows`)
      await expectPermissionDenied(indexerClient.sql`SELECT * FROM xcs_hostile_runtime.secret_rows`)
      await expectPermissionDenied(
        apiClient.sql`SELECT nextval('xcs_hostile_runtime.secret_sequence')`,
      )
      await expectPermissionDenied(apiClient.sql`SELECT xcs_hostile_runtime.secret_value()`)

      await expectPermissionDenied(
        indexerClient.sql`
          UPDATE ledger_checkpoints
          SET close_time = 4294967295
          WHERE profile_id = ${permissionsProfile.profileId}
        `,
      )
      await expectPermissionDenied(
        indexerClient.sql`
          UPDATE schemas
          SET name = 'forbidden rewrite'
          WHERE profile_id = ${permissionsProfile.profileId}
        `,
      )
      await expectPermissionDenied(
        indexerClient.sql`
          UPDATE credential_events
          SET event_type = 'deleted'
          WHERE profile_id = ${permissionsProfile.profileId}
        `,
      )

      await indexerClient.sql`
        INSERT INTO schema_events (
          profile_id, transaction_hash, ledger_index, ledger_hash, transaction_index,
          publisher, status, schema_uid, memo_json
        ) VALUES (
          ${permissionsProfile.profileId}, ${SCHEMA_TRANSACTION_HASH},
          ${ACTIVATION_LEDGER_INDEX}, ${ACTIVATION_LEDGER_HASH}, 1,
          ${ISSUER}, 'accepted', ${SCHEMA_UID}, ${JSON.stringify(schemaDefinition)}::jsonb
        )
      `
      await indexerClient.sql`
        INSERT INTO schemas (
          profile_id, schema_uid, publisher, name, description, definition,
          resolved_definition, registration_transaction_hash, ledger_index, transaction_index
        ) VALUES (
          ${permissionsProfile.profileId}, ${SCHEMA_UID}, ${ISSUER},
          ${schemaDefinition.name}, ${schemaDefinition.description},
          ${JSON.stringify(schemaDefinition)}::jsonb,
          ${JSON.stringify({ definition: schemaDefinition, fields: schemaDefinition.fields, lineage: [] })}::jsonb,
          ${SCHEMA_TRANSACTION_HASH}, ${ACTIVATION_LEDGER_INDEX}, 1
        )
      `
      await indexerClient.sql`
        INSERT INTO credential_generations (
          profile_id, generation_id, ledger_object_id, issuer, subject, schema_uid,
          uri_hex, accepted, created_ledger_index, created_transaction_index,
          last_ledger_index
        ) VALUES (
          ${permissionsProfile.profileId}, ${CREDENTIAL_TRANSACTION_HASH},
          ${CREDENTIAL_OBJECT_ID}, ${ISSUER}, ${SUBJECT}, ${SCHEMA_UID},
          'ABCD', false, ${ACTIVATION_LEDGER_INDEX}, 2, ${ACTIVATION_LEDGER_INDEX}
        )
      `
      await expect(
        indexerClient.sql`
          UPDATE credential_generations
          SET accepted = true,
              last_ledger_index = ${ACTIVATION_LEDGER_INDEX + 1},
              updated_at = CURRENT_TIMESTAMP
          WHERE profile_id = ${permissionsProfile.profileId}
            AND generation_id = ${CREDENTIAL_TRANSACTION_HASH}
        `,
      ).resolves.toBeDefined()
      for (const forbiddenUpdate of [
        indexerClient.sql`
          UPDATE credential_generations
          SET issuer = ${SUBJECT}
          WHERE profile_id = ${permissionsProfile.profileId}
        `,
        indexerClient.sql`
          UPDATE credential_generations
          SET uri_hex = 'DCBA'
          WHERE profile_id = ${permissionsProfile.profileId}
        `,
        indexerClient.sql`
          UPDATE credential_generations
          SET created_ledger_index = ${ACTIVATION_LEDGER_INDEX + 1}
          WHERE profile_id = ${permissionsProfile.profileId}
        `,
      ]) {
        await expectPermissionDenied(forbiddenUpdate)
      }

      await expectPermissionDenied(
        apiClient.sql`
          UPDATE network_profiles
          SET enabled = false
          WHERE profile_id = ${permissionsProfile.profileId}
        `,
      )
      await expectPermissionDenied(
        apiClient.sql`
          INSERT INTO indexer_incidents (profile_id, writer_epoch, error_code)
          VALUES (${permissionsProfile.profileId}, 999, 'FORBIDDEN_API_WRITE')
        `,
      )
      await expectPermissionDenied(
        indexerClient.sql`
          UPDATE indexer_incidents
          SET error_code = 'FORBIDDEN_INDEXER_UPDATE'
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
      await Promise.allSettled([indexerClient.close(), apiClient.close(), monitorClient.close()])
    }
  }, 120_000)

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
    await expect(
      haltIndexer(database.client.db, first, {}, 'STALE_WRITER_HALT', { now: takeoverAt }),
    ).rejects.toMatchObject({ code: 'INDEXER_LEASE_LOST' })
    expect(
      await database.client.db
        .select()
        .from(indexerIncidents)
        .where(eq(indexerIncidents.profileId, fencedProfile.profileId)),
    ).toEqual([])

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

  it('starts a renewed lease after a blocking row lock is acquired', async () => {
    const database = temporaryDatabases[0]
    if (database === undefined) throw new Error('First temporary database was not created')
    const blockedProfile = profile('blocked-lease-renewal')
    const repository = new PostgresIndexerRepository(database.client.db)
    await repository.initializeProfile(blockedProfile)
    const token = await repository.acquireLease(
      blockedProfile.profileId,
      'blocked-renewal-writer',
      300_000,
    )

    const blockingClient = createDatabaseClient(database.url)
    let markLocked: (() => void) | undefined
    const rowLocked = new Promise<void>((resolve) => {
      markLocked = resolve
    })
    try {
      const blocker = blockingClient.sql.begin(async (sql) => {
        await sql`
          SELECT profile_id
          FROM indexer_status
          WHERE profile_id = ${blockedProfile.profileId}
          FOR UPDATE
        `
        markLocked?.()
        await sql`SELECT pg_sleep(2)`
      })
      await rowLocked

      const renewalStartedAt = Date.now()
      const renewal = renewIndexerLease(database.client.db, token, {
        leaseDurationMs: 10_000,
      })
      await blocker
      const renewed = await renewal

      expect(Date.now() - renewalStartedAt).toBeGreaterThanOrEqual(1_800)
      expect(renewed.leaseExpiresAt.getTime() - Date.now()).toBeGreaterThan(9_000)
    } finally {
      await blockingClient.close()
    }
  }, 15_000)

  it('rolls back the halted status when the durable incident insert fails', async () => {
    const database = temporaryDatabases[0]
    if (database === undefined) throw new Error('First temporary database was not created')
    const atomicProfile = profile('atomic-halt')
    const repository = new PostgresIndexerRepository(database.client.db)
    await repository.initializeProfile(atomicProfile)
    const token = await repository.acquireLease(
      atomicProfile.profileId,
      'atomic-halt-writer',
      300_000,
    )

    await database.client.db.insert(indexerIncidents).values({
      profileId: atomicProfile.profileId,
      writerEpoch: token.epoch,
      errorCode: 'PREEXISTING_INCIDENT',
    })

    await expect(repository.haltIndexer(token, {}, 'SOURCE_DIVERGENCE')).rejects.toMatchObject({
      code: '23505',
    })

    const [status] = await database.client.db
      .select()
      .from(indexerStatuses)
      .where(eq(indexerStatuses.profileId, atomicProfile.profileId))
      .limit(1)
    expect(status).toMatchObject({
      state: 'starting',
      writerId: token.writerId,
      writerEpoch: token.epoch,
      errorCode: null,
    })
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

    await firstDatabase.client.db.insert(indexerIncidents).values({
      profileId: replayProfile.profileId,
      writerEpoch: 99,
      errorCode: 'DIGEST_EXCLUDED_HALT',
    })

    const [firstDigest, secondDigest] = await Promise.all([
      computeProjectionDigest(firstDatabase.client.db, replayProfile.profileId),
      computeProjectionDigest(secondDatabase.client.db, replayProfile.profileId),
    ])
    const [storedRegistration] = await firstDatabase.client.db
      .select({ memoJson: schemaEvents.memoJson })
      .from(schemaEvents)
      .where(eq(schemaEvents.profileId, replayProfile.profileId))
      .limit(1)

    expect(secondDigest).toEqual(firstDigest)
    expect(storedRegistration?.memoJson).toEqual(schemaMemoJson)
    expect(firstDigest.rowCounts).toEqual({
      ledgerCheckpoints: 2,
      schemaEvents: 1,
      schemas: 1,
      credentialEvents: 1,
      credentialGenerations: 1,
    })
  })

  it('replays one integrity-bound ledger bundle into identical complete projections', async () => {
    const firstDatabase = temporaryDatabases[0]
    const secondDatabase = temporaryDatabases[1]
    if (firstDatabase === undefined || secondDatabase === undefined) {
      throw new Error('Two temporary databases are required for fixture replay comparison')
    }
    const replayProfile: NetworkProfile = {
      ...profile('complete-fixture-replay'),
      requiredAmendment: 'B'.repeat(64),
    }
    const fixture = completeProjectionFixture(replayProfile)
    const profileFileBytes = encodeUtf8(canonicalize(replayProfile as unknown as JsonValue))
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'xcs-complete-replay-'))
    const bundleDirectory = join(temporaryRoot, 'bundle')

    try {
      const manifest = await captureLedgerFixtureBundle({
        outputDirectory: bundleDirectory,
        profile: replayProfile,
        profileFileBytes,
        source: new CompleteProjectionFixtureSource(replayProfile, fixture.ledgers),
        toLedgerIndex: ACTIVATION_LEDGER_INDEX + 3,
        primaryOperator: 'XRPL Commons fixture',
        secondaryOperator: 'Independent fixture operator',
        capturedAt: new Date('2026-08-26T00:00:00.000Z'),
      })
      const bundleDigest = ledgerFixtureBundleDigest(manifest)
      const [firstReplay, secondReplay] = await Promise.all([
        prepareFixtureReplay({
          directory: bundleDirectory,
          bundleDigest,
          profile: replayProfile,
          profileFileBytes,
        }),
        prepareFixtureReplay({
          directory: bundleDirectory,
          bundleDigest,
          profile: replayProfile,
          profileFileBytes,
        }),
      ])
      expect(secondReplay.replayTarget).toEqual(firstReplay.replayTarget)
      expect(firstReplay.replayTarget).toEqual({
        ledgerIndex: ACTIVATION_LEDGER_INDEX + 3,
        ledgerHash: ledgerHash(ACTIVATION_LEDGER_INDEX + 3),
      })

      const replayInto = async (
        database: TemporaryDatabase,
        prepared: typeof firstReplay,
        writerId: string,
      ) => {
        let caughtUpLedger: number | undefined
        const worker = new IndexerWorker({
          profile: replayProfile,
          source: prepared.source,
          repository: new PostgresIndexerRepository(database.client.db),
          replayTarget: prepared.replayTarget,
          pollIntervalMs: 250,
          leaseDurationMs: 10_000,
          batchSize: 4,
          writerId,
          observer: {
            caughtUp: (ledgerIndex) => {
              caughtUpLedger = ledgerIndex
            },
          },
        })
        await worker.start(new AbortController().signal)
        expect(caughtUpLedger).toBe(prepared.replayTarget.ledgerIndex)
        return computeProjectionDigest(database.client.db, replayProfile.profileId)
      }

      const [firstDigest, secondDigest] = await Promise.all([
        replayInto(firstDatabase, firstReplay, 'complete-fixture-a'),
        replayInto(secondDatabase, secondReplay, 'complete-fixture-b'),
      ])
      const [deletionEvents, generationRows, storedSchemaRows] = await Promise.all([
        firstDatabase.client.db
          .select({
            transactionIndex: credentialEvents.transactionIndex,
            deletionCause: credentialEvents.deletionCause,
            accepted: credentialEvents.accepted,
          })
          .from(credentialEvents)
          .where(
            and(
              eq(credentialEvents.profileId, replayProfile.profileId),
              eq(credentialEvents.eventType, 'deleted'),
            ),
          )
          .orderBy(asc(credentialEvents.transactionIndex)),
        firstDatabase.client.db
          .select({
            subject: credentialGenerations.subject,
            expiration: credentialGenerations.expiration,
            accepted: credentialGenerations.accepted,
            createdTransactionIndex: credentialGenerations.createdTransactionIndex,
            lastLedgerIndex: credentialGenerations.lastLedgerIndex,
            deletedLedgerIndex: credentialGenerations.deletedLedgerIndex,
            deletionCause: credentialGenerations.deletionCause,
          })
          .from(credentialGenerations)
          .where(eq(credentialGenerations.profileId, replayProfile.profileId))
          .orderBy(asc(credentialGenerations.createdTransactionIndex)),
        firstDatabase.client.db
          .select({ schemaUid: schemas.schemaUid })
          .from(schemas)
          .where(eq(schemas.profileId, replayProfile.profileId)),
      ])

      expect(secondDigest).toEqual(firstDigest)
      expect(firstDigest.digestHex).toBe(
        '19b2a150af329cad035f5bc934b3db772237fa52bcc76a411439001ab6b1bed0',
      )
      expect(firstDigest.rowCounts).toEqual({
        ledgerCheckpoints: 4,
        schemaEvents: 1,
        schemas: 1,
        credentialEvents: 13,
        credentialGenerations: 6,
      })
      expect(storedSchemaRows).toEqual([{ schemaUid: fixture.schemaUid }])
      expect(deletionEvents).toEqual(
        FIXTURE_DELETION_CASES.map((fixtureCase, transactionIndex) => ({
          transactionIndex,
          deletionCause: fixtureCase.cause,
          accepted: fixtureCase.accepted,
        })),
      )
      expect(generationRows).toEqual(
        FIXTURE_DELETION_CASES.map((fixtureCase, createdTransactionIndex) => ({
          subject: fixtureCase.subject,
          expiration: fixtureCase.expiration ?? null,
          accepted: fixtureCase.accepted,
          createdTransactionIndex,
          lastLedgerIndex: ACTIVATION_LEDGER_INDEX + 3,
          deletedLedgerIndex: ACTIVATION_LEDGER_INDEX + 3,
          deletionCause: fixtureCase.cause,
        })),
      )
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true })
    }
  }, 60_000)

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
