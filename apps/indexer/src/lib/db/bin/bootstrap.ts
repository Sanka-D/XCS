// Copied from packages/db/src/bin/bootstrap.ts at 5ce8eaa; keep in sync by hand (see CONTRIBUTING.md).
// Diverges by design (provisioning is grants-only, so no runtime password is read from the environment, and a missing role is reported by name); source sha256:d9142aa3fda17e3032510d9dd0405a01464b531e59ed59299d5823c06e2fa8fd.
import {
  bootstrapDatabase,
  MissingRuntimeDatabaseRolesError,
  parseDatabaseClusterScope,
} from '../bootstrap.js'
import { createDatabaseClient } from '../client.js'

function requiredEnvironment(name: string): string {
  const value = process.env[name]
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${name} is required`)
  }
  return value
}

async function main(): Promise<void> {
  const databaseUrl = requiredEnvironment('XCS_BOOTSTRAP_DATABASE_URL')
  const client = createDatabaseClient(databaseUrl)

  try {
    await bootstrapDatabase(client, {
      clusterScope: parseDatabaseClusterScope(process.env.XCS_DATABASE_CLUSTER_SCOPE),
    })
    process.stdout.write(
      `${JSON.stringify({ ok: true, roles: ['xcs_indexer', 'xcs_api', 'xcs_monitor'] })}\n`,
    )
  } finally {
    await client.close()
  }
}

try {
  await main()
} catch (error) {
  // Do not serialize an arbitrary thrown error: connection errors may contain a
  // URL or password. A missing-role error is the one exception -- it names only
  // roles and it is the operator's cue to create the users in DigitalOcean.
  if (error instanceof MissingRuntimeDatabaseRolesError) {
    process.stderr.write(
      `${JSON.stringify({ ok: false, code: error.code, roles: error.roles, message: error.message })}\n`,
    )
  } else {
    process.stderr.write(`${JSON.stringify({ ok: false, code: 'DATABASE_BOOTSTRAP_FAILED' })}\n`)
  }
  process.exitCode = 1
}
