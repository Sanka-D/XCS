import { describe, expect, it, vi } from 'vitest'

import {
  MissingRuntimeDatabaseRolesError,
  parseDatabaseClusterScope,
  provisionRuntimeDatabasePrivileges,
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

/** A `sql` tagged template whose first statement (the advisory lock) resolves
 * empty and whose second (the role lookup) reports `existingRoles`. */
function clientWithRoles(existingRoles: readonly string[]): DatabaseClient {
  const statements: string[] = []
  const sql = Object.assign(
    (strings: TemplateStringsArray, ..._values: unknown[]) => {
      const text = strings.join('?')
      statements.push(text)
      return Promise.resolve(
        text.includes('pg_roles') ? existingRoles.map((roleName) => ({ roleName })) : [],
      )
    },
    {
      unsafe: vi.fn(() => Promise.resolve([])),
      begin: vi.fn((handler: (inner: unknown) => Promise<void>) => handler(sql)),
    },
  )
  return {
    db: {} as DatabaseClient['db'],
    sql: sql as unknown as DatabaseClient['sql'],
    close: vi.fn(),
    statements,
  } as unknown as DatabaseClient & { statements: string[] }
}

describe('runtime database privilege provisioning', () => {
  it('requires an explicit dedicated-cluster acknowledgement', async () => {
    expect(parseDatabaseClusterScope('dedicated')).toBe('dedicated')
    expect(() => parseDatabaseClusterScope(undefined)).toThrow('must be dedicated')
    expect(() => parseDatabaseClusterScope('shared')).toThrow('must be dedicated')

    const database = client()
    await expect(
      provisionRuntimeDatabasePrivileges(database, {
        clusterScope: 'shared' as 'dedicated',
      }),
    ).rejects.toThrow('must be dedicated')
    expect(database.sql.begin).not.toHaveBeenCalled()
  })

  it.each([
    [[], 'xcs_indexer, xcs_api, xcs_monitor'],
    [['xcs_indexer', 'xcs_monitor'], 'xcs_api'],
    [['xcs_indexer', 'xcs_api'], 'xcs_monitor'],
  ])(
    'fails by name when the managed database service has not created every role',
    async (existingRoles, expectedNames) => {
      const database = clientWithRoles(existingRoles)

      await expect(
        provisionRuntimeDatabasePrivileges(database, { clusterScope: 'dedicated' }),
      ).rejects.toThrow(MissingRuntimeDatabaseRolesError)
      await expect(
        provisionRuntimeDatabasePrivileges(database, { clusterScope: 'dedicated' }),
      ).rejects.toThrow(expectedNames)
      await expect(
        provisionRuntimeDatabasePrivileges(database, { clusterScope: 'dedicated' }),
      ).rejects.toThrow('doctl databases user create')

      // Nothing was applied: the run stops before any grant or ALTER ROLE.
      expect(database.sql.unsafe).not.toHaveBeenCalled()
    },
  )

  it('never creates a role, sets a password or revokes login', async () => {
    const database = clientWithRoles(['xcs_indexer', 'xcs_api', 'xcs_monitor'])

    await expect(
      provisionRuntimeDatabasePrivileges(database, { clusterScope: 'dedicated' }),
    ).resolves.toBeUndefined()

    const applied = (database.sql.unsafe as unknown as { mock: { calls: [string][] } }).mock.calls
      .map(([statement]) => statement)
      .join('\n')
    expect(applied).not.toMatch(/CREATE ROLE/iu)
    expect(applied).not.toMatch(/PASSWORD/iu)
    expect(applied).not.toMatch(/NOLOGIN/iu)
    expect(applied).not.toMatch(/VALID UNTIL/iu)
    for (const role of ['xcs_indexer', 'xcs_api', 'xcs_monitor']) {
      expect(applied).toContain(`ALTER ROLE ${role} WITH LOGIN`)
    }
    expect(applied).toContain('GRANT pg_monitor TO xcs_monitor')
    expect(applied).toContain('statement_timeout')
  })
})
