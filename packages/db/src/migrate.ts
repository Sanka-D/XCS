import { migrate } from 'drizzle-orm/postgres-js/migrator'

import { createDatabaseClient } from './client.js'

const databaseUrl = process.env.XCS_DATABASE_URL ?? process.env.DATABASE_URL
if (databaseUrl === undefined) {
  throw new Error('XCS_DATABASE_URL is required to run migrations')
}

const client = createDatabaseClient(databaseUrl)

try {
  await migrate(client.db, { migrationsFolder: './drizzle' })
} finally {
  await client.close()
}
