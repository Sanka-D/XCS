import { migrate } from 'drizzle-orm/postgres-js/migrator'

import type { DatabaseClient } from './client.js'

export const PROJECTION_INTEGRITY_MIGRATION_ERROR =
  'XCS_PROJECTION_INTEGRITY_MIGRATION_FAILED' as const
export const DEFAULT_MIGRATION_STATEMENT_TIMEOUT_MS = 30 * 60 * 1_000

const MAX_POSTGRES_TIMEOUT_MS = 2_147_483_647

interface ConstraintGroup {
  tableName: string
  constraintNames: readonly string[]
  validationSql: string
}

const PROJECTION_INTEGRITY_CONSTRAINT_GROUPS = [
  {
    tableName: 'ledger_checkpoints',
    constraintNames: ['ledger_checkpoints_index_uint32', 'ledger_checkpoints_close_time_uint32'],
    validationSql: `ALTER TABLE public."ledger_checkpoints"
      VALIDATE CONSTRAINT "ledger_checkpoints_index_uint32",
      VALIDATE CONSTRAINT "ledger_checkpoints_close_time_uint32"`,
  },
  {
    tableName: 'schema_events',
    constraintNames: ['schema_events_ledger_index_uint32'],
    validationSql: `ALTER TABLE public."schema_events"
      VALIDATE CONSTRAINT "schema_events_ledger_index_uint32"`,
  },
  {
    tableName: 'schemas',
    constraintNames: ['schemas_ledger_index_uint32', 'schemas_transaction_index'],
    validationSql: `ALTER TABLE public."schemas"
      VALIDATE CONSTRAINT "schemas_ledger_index_uint32",
      VALIDATE CONSTRAINT "schemas_transaction_index"`,
  },
  {
    tableName: 'credential_generations',
    constraintNames: [
      'credential_generations_expiration_uint32',
      'credential_generations_created_ledger_uint32',
      'credential_generations_created_transaction_index',
      'credential_generations_last_ledger_uint32',
      'credential_generations_deleted_ledger_uint32',
      'credential_generations_ledger_order',
    ],
    validationSql: `ALTER TABLE public."credential_generations"
      VALIDATE CONSTRAINT "credential_generations_expiration_uint32",
      VALIDATE CONSTRAINT "credential_generations_created_ledger_uint32",
      VALIDATE CONSTRAINT "credential_generations_created_transaction_index",
      VALIDATE CONSTRAINT "credential_generations_last_ledger_uint32",
      VALIDATE CONSTRAINT "credential_generations_deleted_ledger_uint32",
      VALIDATE CONSTRAINT "credential_generations_ledger_order"`,
  },
  {
    tableName: 'credential_events',
    constraintNames: [
      'credential_events_generation_id',
      'credential_events_node_index',
      'credential_events_ledger_index_uint32',
      'credential_events_transaction_index',
      'credential_events_expiration_uint32',
    ],
    validationSql: `ALTER TABLE public."credential_events"
      VALIDATE CONSTRAINT "credential_events_generation_id",
      VALIDATE CONSTRAINT "credential_events_node_index",
      VALIDATE CONSTRAINT "credential_events_ledger_index_uint32",
      VALIDATE CONSTRAINT "credential_events_transaction_index",
      VALIDATE CONSTRAINT "credential_events_expiration_uint32"`,
  },
] as const satisfies readonly ConstraintGroup[]

interface ConstraintState {
  tableName: string
  constraintName: string
  validated: boolean
}

export interface DatabaseMigrationOptions {
  migrationsFolder: string
  validationStatementTimeoutMs?: number
}

interface ProjectionIntegrityValidationOptions {
  statementTimeoutMs?: number
}

function validateStatementTimeoutMs(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > MAX_POSTGRES_TIMEOUT_MS) {
    throw new Error(
      `Migration statement timeout must be an integer between 0 and ${MAX_POSTGRES_TIMEOUT_MS} milliseconds`,
    )
  }
  return value
}

export function parseMigrationStatementTimeoutMs(value: string | undefined): number {
  if (value === undefined) return DEFAULT_MIGRATION_STATEMENT_TIMEOUT_MS
  const normalized = value.trim()
  if (!/^(?:0|[1-9][0-9]*)$/u.test(normalized)) {
    throw new Error('XCS_MIGRATION_STATEMENT_TIMEOUT_MS must be a non-negative integer')
  }
  return validateStatementTimeoutMs(Number(normalized))
}

function databaseErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  return typeof error.code === 'string' ? error.code : undefined
}

export class ProjectionIntegrityMigrationError extends Error {
  readonly code = PROJECTION_INTEGRITY_MIGRATION_ERROR
  readonly databaseCode: string | undefined
  readonly tableName: string

  constructor(tableName: string, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'ProjectionIntegrityMigrationError'
    this.tableName = tableName
    this.databaseCode = databaseErrorCode(cause)
  }
}

async function readConstraintStates(client: DatabaseClient): Promise<ConstraintState[]> {
  return client.sql<ConstraintState[]>`
    SELECT
      relation.relname AS "tableName",
      constraint_object.conname AS "constraintName",
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
}

/**
 * Validates additive projection constraints after Drizzle commits migration 0003.
 *
 * Each table is handled in its own transaction so a long validation never
 * retains migration-wide locks. Successful groups stay validated when a later
 * group finds corrupt historical projection data, making the operation safe to
 * retry after the projection has been rebuilt from the ledger.
 */
export async function validateProjectionIntegrityConstraints(
  client: DatabaseClient,
  options: ProjectionIntegrityValidationOptions = {},
): Promise<void> {
  const statementTimeoutMs = validateStatementTimeoutMs(
    options.statementTimeoutMs ?? DEFAULT_MIGRATION_STATEMENT_TIMEOUT_MS,
  )
  const statementTimeout = `${statementTimeoutMs}ms`
  const states = await readConstraintStates(client)
  const stateByKey = new Map(
    states.map((state) => [`${state.tableName}.${state.constraintName}`, state] as const),
  )

  for (const group of PROJECTION_INTEGRITY_CONSTRAINT_GROUPS) {
    const groupStates = group.constraintNames.map((constraintName) =>
      stateByKey.get(`${group.tableName}.${constraintName}`),
    )
    const missingConstraint = group.constraintNames.find(
      (_constraintName, index) => groupStates[index] === undefined,
    )
    if (missingConstraint !== undefined) {
      throw new ProjectionIntegrityMigrationError(
        group.tableName,
        `Projection integrity constraint ${missingConstraint} is missing after database migrations`,
      )
    }
    if (groupStates.every((state) => state?.validated === true)) continue

    try {
      await client.sql.begin(async (sql) => {
        await sql`SELECT set_config('lock_timeout', '5s', true)`
        await sql`SELECT set_config('statement_timeout', ${statementTimeout}, true)`
        // This statement is a compile-time constant made only of quoted XCS
        // identifiers; no external input reaches sql.unsafe.
        await sql.unsafe(group.validationSql)
      })
    } catch (error) {
      const code = databaseErrorCode(error)
      const guidance =
        code === '23514'
          ? 'Historical projection data violates this constraint; rebuild the affected projection from the ledger, then rerun the migration command.'
          : code === '55P03'
            ? 'The validation lock could not be acquired within 5 seconds; rerun the migration command when database write traffic is lower.'
            : code === '57014'
              ? `Constraint validation was canceled or exceeded its configured timeout. Inspect the database cause and retry; increase validationStatementTimeoutMs (XCS_MIGRATION_STATEMENT_TIMEOUT_MS for the CLI) only if the ${statementTimeoutMs} ms budget expired.`
              : 'Constraint validation failed; fix the database error, then rerun the migration command.'
      throw new ProjectionIntegrityMigrationError(
        group.tableName,
        `Could not validate projection integrity constraints on ${group.tableName}. ${guidance}`,
        error,
      )
    }
  }
}

export async function migrateDatabase(
  client: DatabaseClient,
  options: DatabaseMigrationOptions,
): Promise<void> {
  const statementTimeoutMs = validateStatementTimeoutMs(
    options.validationStatementTimeoutMs ?? DEFAULT_MIGRATION_STATEMENT_TIMEOUT_MS,
  )
  await migrate(client.db, { migrationsFolder: options.migrationsFolder })
  await validateProjectionIntegrityConstraints(client, { statementTimeoutMs })
}
