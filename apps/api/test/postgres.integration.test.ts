import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

import {
  createDatabaseClient,
  migrateDatabase,
  provisionRuntimeDatabaseRoles,
  type DatabaseClient,
} from '@xcs-protocol/db'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { PostgresOperationalMetricsRepository } from '../src/operational-metrics-repository.js'

const rawAdminDatabaseUrl = process.env.XCS_TEST_DATABASE_URL?.trim()
const adminDatabaseUrl = rawAdminDatabaseUrl === '' ? undefined : rawAdminDatabaseUrl
const postgresTestsRequired = process.env.XCS_REQUIRE_POSTGRES_TESTS === '1'

if (postgresTestsRequired && adminDatabaseUrl === undefined) {
  throw new Error('XCS_TEST_DATABASE_URL is required by test:postgres')
}

const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../../packages/db/drizzle/', import.meta.url))
const TEMPORARY_DATABASE_PATTERN = /^xcs_api_it_[0-9a-f]{32}$/u
const PROFILE_ID = 'metrics-testnet'
const HASH = 'a'.repeat(64)
const INDEXER_DATABASE_PASSWORD = 'indexer-metrics-integration-password-01'
const API_DATABASE_PASSWORD = 'api-metrics-integration-password-000001'

let adminClient: DatabaseClient | undefined
let databaseClient: DatabaseClient | undefined
let runtimeApiClient: DatabaseClient | undefined
let temporaryDatabaseName: string | undefined
let temporaryDatabaseUrl: string | undefined
let runtimeRoleCleanupAllowed = false

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

function runtimeDatabaseUrl(baseUrl: string, role: string, password: string): string {
  const parsed = new URL(baseUrl)
  parsed.username = role
  parsed.password = password
  return parsed.toString()
}

const describePostgres = adminDatabaseUrl === undefined ? describe.skip : describe

describePostgres('PostgreSQL 18 operational metrics integration', () => {
  beforeAll(async () => {
    if (adminDatabaseUrl === undefined) return
    adminClient = createDatabaseClient(adminDatabaseUrl)
    const [version] = await adminClient.sql<{ serverVersion: number }[]>`
      SELECT current_setting('server_version_num')::integer AS "serverVersion"
    `
    if (
      version === undefined ||
      version.serverVersion < 180_000 ||
      version.serverVersion >= 190_000
    ) {
      throw new Error('PostgreSQL integration tests require PostgreSQL 18')
    }

    temporaryDatabaseName = `xcs_api_it_${randomUUID().replaceAll('-', '')}`
    if (!TEMPORARY_DATABASE_PATTERN.test(temporaryDatabaseName)) {
      throw new Error('Generated PostgreSQL test database name is invalid')
    }
    await adminClient.sql`
      CREATE DATABASE ${adminClient.sql(temporaryDatabaseName)} TEMPLATE template0 ENCODING 'UTF8'
    `
    temporaryDatabaseUrl = databaseUrl(adminDatabaseUrl, temporaryDatabaseName)
    databaseClient = createDatabaseClient(temporaryDatabaseUrl)
    await migrateDatabase(databaseClient, { migrationsFolder: MIGRATIONS_FOLDER })

    const preexistingRoles = await adminClient.sql<{ roleName: string }[]>`
      SELECT rolname AS "roleName"
      FROM pg_roles
      WHERE rolname IN ('xcs_indexer', 'xcs_api')
    `
    if (preexistingRoles.length > 0) {
      throw new Error(
        'PostgreSQL integration tests require a disposable cluster without xcs runtime roles',
      )
    }
    runtimeRoleCleanupAllowed = true
    await provisionRuntimeDatabaseRoles(databaseClient, {
      indexerPassword: INDEXER_DATABASE_PASSWORD,
      apiPassword: API_DATABASE_PASSWORD,
    })
    runtimeApiClient = createDatabaseClient(
      runtimeDatabaseUrl(temporaryDatabaseUrl, 'xcs_api', API_DATABASE_PASSWORD),
    )
  }, 30_000)

  afterAll(async () => {
    const cleanupErrors: unknown[] = []
    if (runtimeApiClient !== undefined) {
      try {
        await runtimeApiClient.close()
      } catch (error) {
        cleanupErrors.push(error)
      } finally {
        runtimeApiClient = undefined
      }
    }
    if (databaseClient !== undefined) {
      try {
        await databaseClient.close()
      } catch (error) {
        cleanupErrors.push(error)
      } finally {
        databaseClient = undefined
      }
    }
    if (adminClient !== undefined) {
      try {
        if (
          temporaryDatabaseName !== undefined &&
          TEMPORARY_DATABASE_PATTERN.test(temporaryDatabaseName)
        ) {
          await adminClient.sql`
            DROP DATABASE IF EXISTS ${adminClient.sql(temporaryDatabaseName)} WITH (FORCE)
          `
        }
      } catch (error) {
        cleanupErrors.push(error)
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
      throw new AggregateError(cleanupErrors, 'Failed to clean API PostgreSQL integration database')
    }
  })

  it('reads exact durable metrics with the least-privilege xcs_api role', async () => {
    if (databaseClient === undefined || runtimeApiClient === undefined) {
      throw new Error('PostgreSQL test database is not initialized')
    }
    await databaseClient.sql`
      INSERT INTO network_profiles (
        profile_id, xcs_version, network_id, required_amendment,
        registry_address, registration_amount_drops,
        activation_ledger_index, activation_ledger_hash, enabled
      ) VALUES (
        ${PROFILE_ID}, '0.1', 1, ${'b'.repeat(64)},
        'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh', 1, 100, ${HASH}, true
      )
    `
    await databaseClient.sql`
      INSERT INTO ledger_checkpoints (
        profile_id, ledger_index, ledger_hash, parent_hash, close_time,
        transaction_count, transaction_root
      ) VALUES (${PROFILE_ID}, 100, ${HASH}, ${'c'.repeat(64)}, 800000000, 2, ${'d'.repeat(64)})
    `
    await databaseClient.sql`
      INSERT INTO indexer_status (
        profile_id, state, primary_source_tip, secondary_source_tip,
        last_agreed_ledger_index, last_agreed_ledger_hash,
        error_code, writer_epoch
      ) VALUES (
        ${PROFILE_ID}, 'halted', 103, 102, 100, ${HASH},
        'LEDGER_PARENT_MISMATCH', 1
      )
    `
    await databaseClient.sql`
      INSERT INTO schema_events (
        profile_id, transaction_hash, ledger_index, ledger_hash, transaction_index,
        publisher, status, reason_code, schema_uid, memo_json
      ) VALUES
        (
          ${PROFILE_ID}, ${'e'.repeat(64)}, 100, ${HASH}, 0,
          'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh', 'accepted', null,
          ${'f'.repeat(64)}, '{}'::jsonb
        ),
        (
          ${PROFILE_ID}, ${'1'.repeat(64)}, 100, ${HASH}, 1,
          'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh', 'rejected',
          'REGISTRATION_INVALID', null, null
        )
    `

    const snapshot = await new PostgresOperationalMetricsRepository(
      runtimeApiClient.db,
    ).getSnapshot()

    expect(snapshot.observedAt).toBeInstanceOf(Date)
    expect(snapshot.database.usedConnections).toBeGreaterThan(0)
    expect(snapshot.database.maxConnections).toBeGreaterThan(0)
    expect(snapshot.database.sizeBytes).toBeGreaterThan(0)
    expect(snapshot.profiles).toEqual([
      {
        profileId: PROFILE_ID,
        status: {
          state: 'halted',
          primarySourceTip: 103,
          secondarySourceTip: 102,
          lastAgreedLedgerIndex: 100,
          lastAgreedLedgerHash: HASH,
          errorCode: 'LEDGER_PARENT_MISMATCH',
          updatedAt: expect.any(Date),
        },
        checkpoint: { ledgerIndex: 100, ledgerHash: HASH, closeTime: 800_000_000 },
        acceptedRegistrations: 1,
        rejectedRegistrations: 1,
      },
    ])
  })
})
