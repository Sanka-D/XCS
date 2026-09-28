import { describe, expect, it, vi } from 'vitest'

import {
  bootstrapDatabase,
  databasePasswordFromUrl,
  parseDatabaseClusterScope,
  preflightRuntimeDatabaseProvisioning,
  provisionRuntimeDatabaseRoles,
} from '../../src/lib/db/bootstrap.js'

import type { DatabaseClient } from '../../src/lib/db/client.js'

function client(): DatabaseClient {
  return {
    db: {} as DatabaseClient['db'],
    sql: {
      begin: vi.fn(),
    } as unknown as DatabaseClient['sql'],
    close: vi.fn(),
  }
}

function preflightClient(
  options: {
    provisioner?: Partial<{
      roleName: string
      isSuperuser: boolean
      canCreateRole: boolean
      canCreateDatabaseObjects: boolean
      canCreatePublicObjects: boolean
      serverVersion: number
      selfGrant: string
    }>
    runtimeRoles?: Array<Record<string, unknown>>
    memberships?: Array<Record<string, unknown>>
  } = {},
): { database: DatabaseClient; statements: string[] } {
  const statements: string[] = []
  const sql = vi.fn(async (strings: TemplateStringsArray) => {
    const statement = strings.join('?')
    statements.push(statement)
    if (statement.includes("current_setting('server_version_num')")) {
      return [
        {
          roleName: 'doadmin',
          isSuperuser: false,
          canCreateRole: true,
          canCreateDatabaseObjects: true,
          canCreatePublicObjects: true,
          serverVersion: 180_000,
          selfGrant: '',
          ...options.provisioner,
        },
      ]
    }
    if (statement.includes('FROM pg_auth_members')) return options.memberships ?? []
    if (statement.includes('FROM pg_roles')) return options.runtimeRoles ?? []
    throw new Error(`Unexpected SQL in test: ${statement}`)
  })
  return {
    database: {
      db: {} as DatabaseClient['db'],
      sql: sql as unknown as DatabaseClient['sql'],
      close: vi.fn(),
    },
    statements,
  }
}

describe('runtime database role provisioning', () => {
  it('accepts a non-superuser managed PostgreSQL provisioner on a fresh database', async () => {
    const { database } = preflightClient()
    await expect(preflightRuntimeDatabaseProvisioning(database)).resolves.toBeUndefined()
  })

  it('rejects dangerous existing runtime role attributes without attempting to normalize them', async () => {
    const { database } = preflightClient({
      runtimeRoles: [
        {
          roleName: 'xcs_indexer',
          isSuperuser: false,
          canCreateDatabase: false,
          canCreateRole: false,
          canReplicate: true,
          canBypassRls: false,
        },
      ],
    })
    await expect(preflightRuntimeDatabaseProvisioning(database)).rejects.toThrow(
      'DATABASE_RUNTIME_ROLE_UNSAFE',
    )
  })

  it('requires the non-inheritable admin delegation for an existing managed role', async () => {
    const role = {
      roleName: 'xcs_indexer',
      isSuperuser: false,
      canCreateDatabase: false,
      canCreateRole: false,
      canReplicate: false,
      canBypassRls: false,
    }
    const withoutDelegation = preflightClient({ runtimeRoles: [role] })
    await expect(preflightRuntimeDatabaseProvisioning(withoutDelegation.database)).rejects.toThrow(
      'DATABASE_PROVISIONER_ROLE_ADMIN_REQUIRED',
    )

    const withDelegation = preflightClient({
      runtimeRoles: [role],
      memberships: [
        {
          grantedRole: 'xcs_indexer',
          memberRole: 'doadmin',
          adminOption: true,
          inheritOption: false,
          setOption: false,
        },
      ],
    })
    await expect(
      preflightRuntimeDatabaseProvisioning(withDelegation.database),
    ).resolves.toBeUndefined()
  })

  it('fails closed on an unexpected runtime role membership', async () => {
    const { database } = preflightClient({
      memberships: [
        {
          grantedRole: 'pg_write_all_data',
          memberRole: 'xcs_indexer',
          adminOption: false,
          inheritOption: true,
          setOption: true,
        },
      ],
    })
    await expect(preflightRuntimeDatabaseProvisioning(database)).rejects.toThrow(
      'DATABASE_RUNTIME_ROLE_MEMBERSHIP_UNSAFE',
    )
  })

  it('runs the managed PostgreSQL preflight before migration DDL', async () => {
    const statements: string[] = []
    const transaction = vi.fn(async (strings: TemplateStringsArray) => {
      const statement = strings.join('?')
      statements.push(statement)
      if (statement.includes("current_setting('server_version_num')")) {
        return [
          {
            roleName: 'restricted-bootstrap',
            isSuperuser: false,
            canCreateRole: false,
            canCreateDatabaseObjects: true,
            canCreatePublicObjects: true,
            serverVersion: 180_000,
            selfGrant: '',
          },
        ]
      }
      throw new Error(`Unexpected SQL in test: ${statement}`)
    })
    const database = {
      db: {} as DatabaseClient['db'],
      sql: {
        begin: vi.fn(async (callback: (sql: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
        ),
      } as unknown as DatabaseClient['sql'],
      close: vi.fn(),
    }

    await expect(
      bootstrapDatabase(database, {
        clusterScope: 'dedicated',
        administratorPassword: 'd'.repeat(32),
        indexerPassword: 'i'.repeat(32),
        apiPassword: 'a'.repeat(32),
        payloadWriterPassword: 'p'.repeat(32),
        monitorPassword: 'm'.repeat(32),
      }),
    ).rejects.toThrow('DATABASE_PROVISIONER_CREATE_ROLE_REQUIRED')
    expect(statements).toHaveLength(1)
    expect(
      statements.some((statement) => /\bCREATE\s+(?:SCHEMA|TABLE|ROLE)\b/u.test(statement)),
    ).toBe(false)
  })

  it.each(['short', 'd'.repeat(32), 'i'.repeat(32)])(
    'rejects invalid or reused optional application passwords',
    async (applicationPassword) => {
      const database = client()
      await expect(
        provisionRuntimeDatabaseRoles(database, {
          clusterScope: 'dedicated',
          administratorPassword: 'd'.repeat(32),
          indexerPassword: 'i'.repeat(32),
          apiPassword: 'a'.repeat(32),
          payloadWriterPassword: 'p'.repeat(32),
          monitorPassword: 'm'.repeat(32),
          applicationPassword,
        }),
      ).rejects.toThrow()
      expect(database.sql.begin).not.toHaveBeenCalled()
    },
  )
  it('rejects invalid bootstrap configuration before reserving a connection or applying DDL', async () => {
    const database = client()
    await expect(
      bootstrapDatabase(database, {
        clusterScope: 'dedicated',
        administratorPassword: 'd'.repeat(32),
        indexerPassword: 'd'.repeat(32),
        apiPassword: 'a'.repeat(32),
        payloadWriterPassword: 'p'.repeat(32),
        monitorPassword: 'm'.repeat(32),
      }),
    ).rejects.toThrow('pairwise distinct')
    expect(database.sql.begin).not.toHaveBeenCalled()
  })
  it('requires an explicit dedicated-cluster acknowledgement', async () => {
    expect(parseDatabaseClusterScope('dedicated')).toBe('dedicated')
    expect(() => parseDatabaseClusterScope(undefined)).toThrow('must be dedicated')
    expect(() => parseDatabaseClusterScope('shared')).toThrow('must be dedicated')

    const database = client()
    await expect(
      provisionRuntimeDatabaseRoles(database, {
        clusterScope: 'shared' as 'dedicated',
        administratorPassword: 'd'.repeat(32),
        indexerPassword: 'i'.repeat(32),
        apiPassword: 'a'.repeat(32),
        payloadWriterPassword: 'p'.repeat(32),
        monitorPassword: 'm'.repeat(32),
      }),
    ).rejects.toThrow('must be dedicated')
    expect(database.sql.begin).not.toHaveBeenCalled()
  })

  it('derives the administrator password from the database URL actually selected', () => {
    expect(
      databasePasswordFromUrl(
        'postgresql://xcs_admin:administrator%40password%2Fwith%25encoding@postgres:5432/xcs',
      ),
    ).toBe('administrator@password/with%encoding')
  })

  it.each([
    'not-a-url',
    'https://xcs_admin:administrator-password@example.test/xcs',
    'postgresql://xcs_admin@postgres:5432/xcs',
    'postgresql://:administrator-password@postgres:5432/xcs',
  ])('rejects an unusable administrator database URL without exposing it: %s', (databaseUrl) => {
    expect(() => databasePasswordFromUrl(databaseUrl)).toThrow(
      /^The selected administrator database URL/u,
    )
  })

  it.each([
    ['', 'valid', 'valid', 'valid'],
    ['valid', 'too-short', 'valid', 'valid'],
    ['valid', 'valid', 'contains/slash', 'valid'],
    ['valid', 'valid', 'valid', 'too-short'],
  ])(
    'rejects unsafe runtime passwords before opening a transaction',
    async (indexer, api, monitor, payloadWriter) => {
      const database = client()

      await expect(
        provisionRuntimeDatabaseRoles(database, {
          clusterScope: 'dedicated',
          administratorPassword: 'd'.repeat(32),
          indexerPassword: indexer === 'valid' ? 'i'.repeat(32) : indexer,
          apiPassword: api === 'valid' ? 'a'.repeat(32) : api,
          payloadWriterPassword: payloadWriter === 'valid' ? 'p'.repeat(32) : payloadWriter,
          monitorPassword: monitor === 'valid' ? 'm'.repeat(32) : monitor,
        }),
      ).rejects.toThrow('32-256 URL-safe characters')
      expect(database.sql.begin).not.toHaveBeenCalled()
    },
  )

  it.each([
    'too-short',
    'a'.repeat(257),
    'administrator-password-with-slash/',
    'administrateur-password-éééééééé',
  ])('rejects an unsafe administrator password before opening a transaction', async (password) => {
    const database = client()

    await expect(
      provisionRuntimeDatabaseRoles(database, {
        clusterScope: 'dedicated',
        administratorPassword: password,
        indexerPassword: 'i'.repeat(32),
        apiPassword: 'a'.repeat(32),
        payloadWriterPassword: 'p'.repeat(32),
        monitorPassword: 'm'.repeat(32),
      }),
    ).rejects.toThrow('32-256 URL-safe characters')
    expect(database.sql.begin).not.toHaveBeenCalled()
  })

  it('requires distinct runtime passwords', async () => {
    const database = client()
    const password = 'same-runtime-password-000000000000'

    await expect(
      provisionRuntimeDatabaseRoles(database, {
        clusterScope: 'dedicated',
        administratorPassword: 'administrator-password-000000000000',
        indexerPassword: password,
        apiPassword: password,
        payloadWriterPassword: 'p'.repeat(32),
        monitorPassword: 'monitor-runtime-password-00000000000',
      }),
    ).rejects.toThrow('pairwise distinct')
    expect(database.sql.begin).not.toHaveBeenCalled()
  })

  it.each(['indexer', 'api', 'monitor', 'payloadWriter'] as const)(
    'rejects an administrator password reused by %s',
    async (role) => {
      const database = client()
      const administratorPassword = 'administrator-password-000000000000'
      const runtimePasswords = {
        indexerPassword: 'indexer-runtime-password-00000000000',
        apiPassword: 'api-runtime-password-000000000000000',
        payloadWriterPassword: 'p'.repeat(32),
        monitorPassword: 'monitor-runtime-password-00000000000',
      }
      runtimePasswords[`${role}Password`] = administratorPassword

      await expect(
        provisionRuntimeDatabaseRoles(database, {
          clusterScope: 'dedicated',
          administratorPassword,
          ...runtimePasswords,
        }),
      ).rejects.toThrow('pairwise distinct')
      expect(database.sql.begin).not.toHaveBeenCalled()
    },
  )
})
