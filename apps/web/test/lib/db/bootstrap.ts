// Copied from packages/db/src/bootstrap.ts at 5ce8eaa; keep in sync by hand (see CONTRIBUTING.md).
// Diverges by design (migrations are applied from db/migrations, and provisioning is grants-only so no password travels through this module); source sha256:ef5dc1f95861fc8465a9d68e59e25f5a55eedab91a483b9d34ec89abf7346ca3.
import { fileURLToPath } from 'node:url'

import { migrate } from 'drizzle-orm/postgres-js/migrator'

import type { DatabaseClient } from '../../../server/lib/db/client.js'
import {
  provisionRuntimeDatabasePrivileges,
  type RuntimeDatabaseProvisioning,
} from './provision.js'

const BASELINE_FOLDER = fileURLToPath(new URL('../../../../../db/migrations', import.meta.url))

export {
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
  await migrate(client.db, { migrationsFolder: BASELINE_FOLDER })
}

export async function bootstrapDatabase(
  client: DatabaseClient,
  provisioning: RuntimeDatabaseProvisioning,
): Promise<void> {
  await initializeDatabase(client)
  await provisionRuntimeDatabasePrivileges(client, provisioning)
}
