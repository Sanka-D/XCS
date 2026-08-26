import { createDatabaseClient } from './client.js'
import { migrateDatabase, parseMigrationStatementTimeoutMs } from './migrations.js'

const databaseUrl =
  process.env.XCS_MIGRATOR_DATABASE_URL ?? process.env.XCS_DATABASE_URL ?? process.env.DATABASE_URL
if (databaseUrl === undefined) {
  throw new Error('XCS_MIGRATOR_DATABASE_URL is required to run migrations')
}

const client = createDatabaseClient(databaseUrl)
const validationStatementTimeoutMs = parseMigrationStatementTimeoutMs(
  process.env.XCS_MIGRATION_STATEMENT_TIMEOUT_MS,
)

try {
  await migrateDatabase(client, {
    migrationsFolder: './drizzle',
    validationStatementTimeoutMs,
  })
} finally {
  await client.close()
}
