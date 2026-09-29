// Copied from packages/db/src/bootstrap.ts at 61fb809; keep in sync by hand (see CONTRIBUTING.md).
// Diverges by design (migrations moved from packages/db/drizzle to db/migrations, with the XCS_MIGRATIONS_DIR override the container image sets, and provisioning is grants-only so no password travels through this module); source sha256:ef5dc1f95861fc8465a9d68e59e25f5a55eedab91a483b9d34ec89abf7346ca3.
import { fileURLToPath } from 'node:url'

import { migrate } from 'drizzle-orm/postgres-js/migrator'

import type { DatabaseClient } from './client.js'
import {
  provisionRuntimeDatabasePrivileges,
  type RuntimeDatabaseProvisioning,
} from './provision.js'

const DEFAULT_MIGRATIONS_FOLDER = fileURLToPath(
  new URL('../../../../../db/migrations', import.meta.url),
)

export function migrationsFolder(): string {
  const override = process.env.XCS_MIGRATIONS_DIR?.trim()
  return override === undefined || override.length === 0 ? DEFAULT_MIGRATIONS_FOLDER : override
}

export {
  DatabaseBootstrapConfigurationError,
  MissingRuntimeDatabaseRolesError,
  parseDatabaseClusterScope,
  provisionRuntimeDatabasePrivileges,
  XCS_API_DATABASE_CONNECTION_LIMIT,
  XCS_API_DATABASE_ROLE,
  XCS_DATABASE_CLUSTER_SCOPE,
  XCS_INDEXER_DATABASE_CONNECTION_LIMIT,
  XCS_INDEXER_DATABASE_ROLE,
  XCS_MONITOR_DATABASE_CONNECTION_LIMIT,
  XCS_MONITOR_DATABASE_ROLE,
  XCS_RUNTIME_DATABASE_ROLES,
  type RuntimeDatabaseProvisioning,
} from './provision.js'

export async function initializeDatabase(client: DatabaseClient): Promise<void> {
  await migrate(client.db, { migrationsFolder: migrationsFolder() })
}

export async function bootstrapDatabase(
  client: DatabaseClient,
  provisioning: RuntimeDatabaseProvisioning,
): Promise<void> {
  await initializeDatabase(client)
  await provisionRuntimeDatabasePrivileges(client, provisioning)
}
