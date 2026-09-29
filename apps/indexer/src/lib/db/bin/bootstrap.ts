// Copied from packages/db/src/bin/bootstrap.ts at 61fb809; keep in sync by hand (see CONTRIBUTING.md).
// Diverges by design (provisioning is grants-only, so no runtime password is read from the environment, and a missing role is reported by name); source sha256:d9142aa3fda17e3032510d9dd0405a01464b531e59ed59299d5823c06e2fa8fd.
import {
  bootstrapDatabase,
  DatabaseBootstrapConfigurationError,
  MissingRuntimeDatabaseRolesError,
  parseDatabaseClusterScope,
} from '../bootstrap.js'
import { createDatabaseClient } from '../client.js'

function requiredEnvironment(name: string): string {
  const value = process.env[name]
  if (value === undefined || value.trim().length === 0) {
    throw new DatabaseBootstrapConfigurationError(
      `${name} is required. Set it in the same command that runs this step: a bare ` +
        'shell assignment on its own line is a shell variable, not an environment ' +
        'variable, and this process never sees it.',
    )
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
  // Never serialize an arbitrary thrown error: a driver error can carry the
  // connection string and therefore the administrator password. Two kinds are
  // built from fixed text and names alone, so their message is safe to print,
  // and for anything else only the driver's own short codes are emitted --
  // enough to tell a refused connection from a failed login or a missing
  // relation, and none of them contain a credential.
  if (
    error instanceof MissingRuntimeDatabaseRolesError ||
    error instanceof DatabaseBootstrapConfigurationError
  ) {
    const roles = error instanceof MissingRuntimeDatabaseRolesError ? { roles: error.roles } : {}
    process.stderr.write(
      `${JSON.stringify({ ok: false, code: error.code, ...roles, message: error.message })}\n`,
    )
  } else {
    // Drivers and migration helpers wrap the original failure, so walk the
    // cause chain for the first entry that carries codes. Only these short
    // fields are read; no message from the chain is ever emitted.
    const codesOf = (value: unknown): Record<string, unknown> => {
      for (let current = value, depth = 0; current !== undefined && depth < 8; depth += 1) {
        const node = current as {
          code?: unknown
          errno?: unknown
          syscall?: unknown
          severity?: unknown
          cause?: unknown
        }
        if (typeof node.code === 'string' || typeof node.severity === 'string') return node
        current = node.cause
      }
      return {}
    }
    const detail = codesOf(error)
    process.stderr.write(
      `${JSON.stringify({
        ok: false,
        code: 'DATABASE_BOOTSTRAP_FAILED',
        driverCode: typeof detail.code === 'string' ? detail.code : undefined,
        errno: typeof detail.errno === 'number' ? detail.errno : undefined,
        syscall: typeof detail.syscall === 'string' ? detail.syscall : undefined,
        severity: typeof detail.severity === 'string' ? detail.severity : undefined,
        hint: 'The message is withheld because it can contain the connection string. Reproduce with `psql "$XCS_BOOTSTRAP_DATABASE_URL" -c \'select 1\'` for the full text.',
      })}\n`,
    )
  }
  process.exitCode = 1
}
