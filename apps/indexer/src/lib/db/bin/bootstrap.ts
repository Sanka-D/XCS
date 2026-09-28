// Not a vendored copy (retired source): application-local database implementation maintained with db/schema.
import {
  bootstrapDatabase,
  MissingRuntimeDatabaseRolesError,
  parseDatabaseClusterScope,
  UnsafeRuntimeDatabaseRolesError,
  XCS_RUNTIME_DATABASE_ROLES,
} from '../bootstrap.js'
import { createDatabaseClient } from '../client.js'
import { requiredEnvironment } from './environment.js'

async function main(): Promise<void> {
  const databaseUrl = requiredEnvironment('XCS_BOOTSTRAP_DATABASE_URL')
  const client = createDatabaseClient(databaseUrl, {
    onNotice: () => undefined,
  })

  try {
    await bootstrapDatabase(client, {
      clusterScope: parseDatabaseClusterScope(process.env.XCS_DATABASE_CLUSTER_SCOPE),
    })
    process.stdout.write(`${JSON.stringify({ ok: true, roles: XCS_RUNTIME_DATABASE_ROLES })}\n`)
  } finally {
    await client.close()
  }
}

try {
  await main()
} catch (error) {
  // Arbitrary database errors may contain a URL or password. Managed-role contract
  // errors name only DigitalOcean users and are safe and actionable for the operator.
  if (
    error instanceof MissingRuntimeDatabaseRolesError ||
    error instanceof UnsafeRuntimeDatabaseRolesError
  ) {
    process.stderr.write(
      `${JSON.stringify({
        ok: false,
        code: error.code,
        roles: error.roles,
        message: error.message,
      })}\n`,
    )
  } else {
    process.stderr.write(`${JSON.stringify({ ok: false, code: 'DATABASE_BOOTSTRAP_FAILED' })}\n`)
  }
  process.exitCode = 1
}
