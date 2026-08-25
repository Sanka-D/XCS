import { createDatabaseClient } from './client.js'
import { provisionRuntimeDatabaseRoles } from './provision.js'

function requiredEnvironment(name: string): string {
  const value = process.env[name]
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${name} is required`)
  }
  return value
}

async function main(): Promise<void> {
  const databaseUrl =
    process.env.XCS_MIGRATOR_DATABASE_URL ??
    process.env.XCS_DATABASE_URL ??
    requiredEnvironment('DATABASE_URL')
  const client = createDatabaseClient(databaseUrl)

  try {
    await provisionRuntimeDatabaseRoles(client, {
      indexerPassword: requiredEnvironment('XCS_INDEXER_DATABASE_PASSWORD'),
      apiPassword: requiredEnvironment('XCS_API_DATABASE_PASSWORD'),
    })
    process.stdout.write(`${JSON.stringify({ ok: true, roles: ['xcs_indexer', 'xcs_api'] })}\n`)
  } finally {
    await client.close()
  }
}

try {
  await main()
} catch {
  // Do not serialize the thrown error: connection errors may contain a URL or password.
  process.stderr.write(`${JSON.stringify({ ok: false, code: 'DATABASE_PROVISION_FAILED' })}\n`)
  process.exitCode = 1
}
