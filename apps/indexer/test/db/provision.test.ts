import { describe, expect, it, vi } from 'vitest'

import {
  MissingRuntimeDatabaseRolesError,
  UnsafeRuntimeDatabaseRolesError,
  parseDatabaseClusterScope,
  provisionRuntimeDatabasePrivileges,
} from '../../src/lib/db/bootstrap.js'

import type { DatabaseClient } from '../../src/lib/db/client.js'

const ADMINISTRATOR = 'cluster_admin'

function client(): DatabaseClient {
  return {
    db: {} as DatabaseClient['db'],
    sql: {
      begin: vi.fn(),
    } as unknown as DatabaseClient['sql'],
    close: vi.fn(),
  }
}

interface FakeRoleAttributes {
  roleName: string
  canLogin?: boolean
  isSuperuser?: boolean
  canCreateDatabase?: boolean
  canCreateRole?: boolean
  canReplicate?: boolean
  canBypassRls?: boolean
}

interface FakeMembership {
  grantedRole: string
  memberRole: string
}

/** A `sql` stand-in: the tagged template answers the advisory lock and the
 * `current_user` lookup, and `unsafe` answers the role-attribute and
 * role-membership reads and records every statement it is asked to apply. */
function clientWithRoles(
  existingRoles: readonly (string | FakeRoleAttributes)[],
  memberships: readonly FakeMembership[] = [],
  refuse: (statement: string) => boolean = () => false,
): DatabaseClient {
  const roles = existingRoles.map((role) => (typeof role === 'string' ? { roleName: role } : role))
  const answer = (text: string): unknown[] => {
    if (text.includes('rolcanlogin')) {
      return roles.map((role) => ({
        roleName: role.roleName,
        canLogin: role.canLogin ?? true,
        isSuperuser: role.isSuperuser ?? false,
        canCreateDatabase: role.canCreateDatabase ?? false,
        canCreateRole: role.canCreateRole ?? false,
        canReplicate: role.canReplicate ?? false,
        canBypassRls: role.canBypassRls ?? false,
        connectionLimit: -1,
        configuration: null,
      }))
    }
    if (text.includes('pg_auth_members')) return [...memberships]
    if (text.includes('current_user')) return [{ administrator: ADMINISTRATOR }]
    return []
  }
  const sql = Object.assign(
    (strings: TemplateStringsArray, ..._values: unknown[]) =>
      Promise.resolve(answer(strings.join('?'))),
    {
      unsafe: vi.fn((text: string) =>
        refuse(text)
          ? Promise.reject(new Error('permission denied to alter role'))
          : Promise.resolve(answer(text)),
      ),
      savepoint: vi.fn((handler: (inner: unknown) => Promise<void>) => handler(sql)),
      begin: vi.fn((handler: (inner: unknown) => Promise<unknown>) => handler(sql)),
    },
  )
  return {
    db: {} as DatabaseClient['db'],
    sql: sql as unknown as DatabaseClient['sql'],
    close: vi.fn(),
  }
}

/** Only the statements provisioning applies, not the reads it answers with. */
function appliedStatements(database: DatabaseClient): string {
  return (database.sql.unsafe as unknown as { mock: { calls: [string][] } }).mock.calls
    .map(([statement]) => statement)
    .filter((statement) => !/^\s*SELECT/iu.test(statement))
    .join('\n')
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

      // Nothing was applied: the run stops before any grant.
      expect(appliedStatements(database)).toBe('')
    },
  )

  it.each([
    [{ roleName: 'xcs_api', canLogin: false }, 'xcs_api cannot log in'],
    [{ roleName: 'xcs_api', isSuperuser: true }, 'xcs_api is a superuser'],
    [{ roleName: 'xcs_api', canCreateDatabase: true }, 'xcs_api can create databases'],
    [{ roleName: 'xcs_api', canCreateRole: true }, 'xcs_api can create roles'],
    [{ roleName: 'xcs_api', canReplicate: true }, 'xcs_api can replicate'],
    [{ roleName: 'xcs_api', canBypassRls: true }, 'xcs_api can bypass row-level security'],
  ])('refuses an unsafe role attribute by name instead of altering it', async (role, expected) => {
    const database = clientWithRoles(['xcs_indexer', role, 'xcs_monitor'])

    await expect(
      provisionRuntimeDatabasePrivileges(database, { clusterScope: 'dedicated' }),
    ).rejects.toBeInstanceOf(UnsafeRuntimeDatabaseRolesError)
    await expect(
      provisionRuntimeDatabasePrivileges(database, { clusterScope: 'dedicated' }),
    ).rejects.toThrow(expected)
    expect(appliedStatements(database)).toBe('')
  })

  it('accepts the cluster administrator as a member of every runtime role', async () => {
    const database = clientWithRoles(
      ['xcs_indexer', 'xcs_api', 'xcs_monitor'],
      [
        { grantedRole: 'pg_monitor', memberRole: 'xcs_monitor' },
        { grantedRole: 'xcs_indexer', memberRole: ADMINISTRATOR },
        { grantedRole: 'xcs_api', memberRole: ADMINISTRATOR },
        { grantedRole: 'xcs_monitor', memberRole: ADMINISTRATOR },
      ],
    )

    await expect(
      provisionRuntimeDatabasePrivileges(database, { clusterScope: 'dedicated' }),
    ).resolves.toEqual({ administrator: ADMINISTRATOR, unappliedResourceControls: [] })
    expect(appliedStatements(database)).not.toMatch(/REVOKE\s+xcs_\w+\s+FROM/iu)
  })

  it.each([
    [{ grantedRole: 'xcs_api', memberRole: 'xcs_indexer' }, 'xcs_indexer is a member of xcs_api'],
    [{ grantedRole: 'pg_monitor', memberRole: 'xcs_api' }, 'xcs_api is a member of pg_monitor'],
    [
      { grantedRole: 'xcs_api', memberRole: 'someone_else' },
      'someone_else is a member of xcs_api but is not the cluster administrator',
    ],
  ])('refuses a membership the managed service did not need', async (membership, expected) => {
    const database = clientWithRoles(['xcs_indexer', 'xcs_api', 'xcs_monitor'], [membership])

    await expect(
      provisionRuntimeDatabasePrivileges(database, { clusterScope: 'dedicated' }),
    ).rejects.toThrow(expected)
    expect(appliedStatements(database)).toBe('')
  })

  it('never creates a role, sets a password, revokes login or alters a security attribute', async () => {
    const database = clientWithRoles(['xcs_indexer', 'xcs_api', 'xcs_monitor'])

    await expect(
      provisionRuntimeDatabasePrivileges(database, { clusterScope: 'dedicated' }),
    ).resolves.toEqual({ administrator: ADMINISTRATOR, unappliedResourceControls: [] })

    const applied = appliedStatements(database)
    expect(applied).not.toMatch(/CREATE ROLE/iu)
    expect(applied).not.toMatch(/PASSWORD/iu)
    expect(applied).not.toMatch(/NOLOGIN/iu)
    expect(applied).not.toMatch(/VALID UNTIL/iu)
    // Role attributes are verified, never altered: these are the ones a managed
    // cluster's administrator has no privilege to change.
    for (const attribute of ['SUPERUSER', 'CREATEDB', 'CREATEROLE', 'REPLICATION', 'BYPASSRLS']) {
      expect(applied).not.toContain(attribute)
    }
    expect(applied).not.toMatch(/RESET ALL/iu)
    expect(applied).toContain('GRANT pg_monitor TO xcs_monitor')
    // Resource controls are still applied, one statement each.
    for (const role of ['xcs_indexer', 'xcs_api', 'xcs_monitor']) {
      expect(applied).toContain(`ALTER ROLE ${role} WITH CONNECTION LIMIT`)
      expect(applied).toContain(`ALTER ROLE ${role} SET statement_timeout`)
      expect(applied).toContain(`ALTER ROLE ${role} SET lock_timeout`)
      expect(applied).toContain(`ALTER ROLE ${role} SET idle_in_transaction_session_timeout`)
    }
  })

  it('reports a resource control the cluster refused and that is not in effect', async () => {
    const database = clientWithRoles(['xcs_indexer', 'xcs_api', 'xcs_monitor'], [], (statement) =>
      statement.startsWith('ALTER ROLE xcs_api SET lock_timeout'),
    )

    const report = await provisionRuntimeDatabasePrivileges(database, {
      clusterScope: 'dedicated',
    })
    expect(report.unappliedResourceControls).toEqual([
      { role: 'xcs_api', control: 'lock_timeout', intended: '15s', actual: 'unset' },
    ])
    // The grants were still applied: a missing timeout must not cost them.
    expect(appliedStatements(database)).toContain('GRANT pg_monitor TO xcs_monitor')
  })
})
