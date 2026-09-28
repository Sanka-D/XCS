// Not a vendored copy (retired source): application-local database implementation maintained with db/schema.
import {
  bootstrapDatabase,
  DatabaseBootstrapConfigurationError,
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
  // Never serialize an arbitrary thrown error: a driver error can carry the
  // connection string and therefore the administrator password. Configuration
  // and managed-role errors are built from fixed text and role names alone.
  if (
    error instanceof MissingRuntimeDatabaseRolesError ||
    error instanceof UnsafeRuntimeDatabaseRolesError ||
    error instanceof DatabaseBootstrapConfigurationError
  ) {
    const roles =
      error instanceof MissingRuntimeDatabaseRolesError ||
      error instanceof UnsafeRuntimeDatabaseRolesError
        ? { roles: error.roles }
        : {}
    process.stderr.write(
      `${JSON.stringify({
        ok: false,
        code: error.code,
        ...roles,
        message: error.message,
      })}\n`,
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
