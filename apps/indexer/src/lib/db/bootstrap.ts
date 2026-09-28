// Not a vendored copy (retired source): application-local database implementation maintained with db/schema.
import type { DatabaseClient } from './client.js'
import { migrateDatabase, migrateDatabaseInTransaction } from './migrations.js'
import {
  assertRuntimeDatabasePasswords,
  preflightRuntimeDatabaseProvisioning,
  provisionRuntimeDatabaseRolesInTransaction,
  type RuntimeDatabasePasswords,
} from './provision.js'

export {
  databasePasswordFromUrl,
  parseDatabaseClusterScope,
  preflightRuntimeDatabaseProvisioning,
  provisionRuntimeDatabaseRoles,
  XCS_API_DATABASE_CONNECTION_LIMIT,
  XCS_API_DATABASE_ROLE,
  XCS_APP_DATABASE_CONNECTION_LIMIT,
  XCS_APP_DATABASE_ROLE,
  XCS_ADMIN_APP_DATABASE_ROLE,
  XCS_NOTIFIER_DATABASE_ROLE,
  XCS_ISSUER_DATABASE_ROLE,
  XCS_PAYLOAD_WRITER_DATABASE_CONNECTION_LIMIT,
  XCS_PAYLOAD_WRITER_DATABASE_ROLE,
  XCS_DATABASE_CLUSTER_SCOPE,
  XCS_INDEXER_DATABASE_CONNECTION_LIMIT,
  XCS_INDEXER_DATABASE_ROLE,
  XCS_MONITOR_DATABASE_CONNECTION_LIMIT,
  XCS_MONITOR_DATABASE_ROLE,
  type RuntimeDatabasePasswords,
} from './provision.js'

export async function initializeDatabase(client: DatabaseClient): Promise<void> {
  await migrateDatabase(client)
}

export async function bootstrapDatabase(
  client: DatabaseClient,
  passwords: RuntimeDatabasePasswords,
): Promise<void> {
  assertRuntimeDatabasePasswords(passwords)
  await client.sql.begin(async (transaction) => {
    // Validate the managed-service role contract before the first migration. Keeping
    // migration and role provisioning in this transaction prevents a half-bootstrap.
    await preflightRuntimeDatabaseProvisioning({ sql: transaction })
    await migrateDatabaseInTransaction(transaction)
    await provisionRuntimeDatabaseRolesInTransaction(transaction, passwords)
  })
}
