// Copied from packages/db/src/provision.ts at 5ce8eaa; keep in sync by hand (see CONTRIBUTING.md).
// Diverges by design (provisioning is grants-only: the managed PostgreSQL service owns the runtime users and their passwords, so this copy neither creates roles nor sets passwords); source sha256:ad624bb5a8d9403dda699767be589440680ac21bb4e2a3d7cfd648fb592b0fb5.
import type { DatabaseClient } from './client.js'

export const XCS_INDEXER_DATABASE_ROLE = 'xcs_indexer' as const
export const XCS_API_DATABASE_ROLE = 'xcs_api' as const
export const XCS_MONITOR_DATABASE_ROLE = 'xcs_monitor' as const
export const XCS_DATABASE_CLUSTER_SCOPE = 'dedicated' as const

export const XCS_RUNTIME_DATABASE_ROLES = [
  XCS_INDEXER_DATABASE_ROLE,
  XCS_API_DATABASE_ROLE,
  XCS_MONITOR_DATABASE_ROLE,
] as const

export const XCS_INDEXER_DATABASE_CONNECTION_LIMIT = 12
export const XCS_API_DATABASE_CONNECTION_LIMIT = 12
export const XCS_MONITOR_DATABASE_CONNECTION_LIMIT = 3

const PROVISION_LOCK_CLASS_ID = 1_480_807_217
const PROVISION_LOCK_OBJECT_ID = 1

export interface RuntimeDatabaseProvisioning {
  clusterScope: typeof XCS_DATABASE_CLUSTER_SCOPE
}

export function parseDatabaseClusterScope(
  value: string | undefined,
): typeof XCS_DATABASE_CLUSTER_SCOPE {
  if (value !== XCS_DATABASE_CLUSTER_SCOPE) {
    throw new Error(
      `XCS_DATABASE_CLUSTER_SCOPE must be ${XCS_DATABASE_CLUSTER_SCOPE}; runtime roles are cluster-wide`,
    )
  }
  return XCS_DATABASE_CLUSTER_SCOPE
}

/** The managed database service creates the users and holds their passwords; this
 * step only assigns privileges, so a role it cannot find is an operator error.
 * It names the missing roles and carries no credential, so the CLI can print it. */
export class MissingRuntimeDatabaseRolesError extends Error {
  readonly code = 'DATABASE_ROLES_MISSING' as const
  readonly roles: readonly string[]

  constructor(missing: readonly string[]) {
    const names = missing.join(', ')
    super(
      `Database ${missing.length === 1 ? 'role' : 'roles'} ${names} ` +
        `${missing.length === 1 ? 'does' : 'do'} not exist. Database users are owned by the ` +
        'managed database service, not by this step: create ' +
        `${names} in the DigitalOcean control panel (Databases -> the cluster -> Users) or with ` +
        '`doctl databases user create`, then run the grants step again. This step never creates ' +
        'a role and never sets, resets or reads a role password.',
    )
    this.name = 'MissingRuntimeDatabaseRolesError'
    this.roles = missing
  }
}

const NORMALIZE_ROLE_MEMBERSHIPS_SQL = `
  DO $xcs_memberships$
  DECLARE
    membership record;
  BEGIN
    FOR membership IN
      SELECT granted_role.rolname AS granted_role, member_role.rolname AS member_role
      FROM pg_auth_members auth_membership
      JOIN pg_roles granted_role ON granted_role.oid = auth_membership.roleid
      JOIN pg_roles member_role ON member_role.oid = auth_membership.member
      WHERE granted_role.rolname IN ('xcs_indexer', 'xcs_api', 'xcs_monitor')
         OR member_role.rolname IN ('xcs_indexer', 'xcs_api', 'xcs_monitor')
    LOOP
      IF membership.granted_role = 'pg_monitor' AND membership.member_role = 'xcs_monitor' THEN
        CONTINUE;
      END IF;
      EXECUTE format('REVOKE %I FROM %I', membership.granted_role, membership.member_role);
    END LOOP;
  END
  $xcs_memberships$;
`

// LOGIN is asserted, never revoked: the managed service created these users as
// login users and a half-finished run must not lock them out of their own
// cluster. VALID UNTIL is deliberately left alone -- it is password metadata,
// which belongs to whoever issues the password.
const NORMALIZE_ROLE_ATTRIBUTES_SQL = `
  ALTER ROLE xcs_indexer WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT ${XCS_INDEXER_DATABASE_CONNECTION_LIMIT};
  ALTER ROLE xcs_api WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT ${XCS_API_DATABASE_CONNECTION_LIMIT};
  ALTER ROLE xcs_monitor WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT ${XCS_MONITOR_DATABASE_CONNECTION_LIMIT};
  ALTER ROLE xcs_indexer RESET ALL;
  ALTER ROLE xcs_api RESET ALL;
  ALTER ROLE xcs_monitor RESET ALL;
  ALTER ROLE xcs_indexer SET statement_timeout = '5min';
  ALTER ROLE xcs_indexer SET lock_timeout = '30s';
  ALTER ROLE xcs_indexer SET idle_in_transaction_session_timeout = '30s';
  ALTER ROLE xcs_api SET statement_timeout = '30s';
  ALTER ROLE xcs_api SET lock_timeout = '15s';
  ALTER ROLE xcs_api SET idle_in_transaction_session_timeout = '30s';
  ALTER ROLE xcs_monitor SET statement_timeout = '30s';
  ALTER ROLE xcs_monitor SET lock_timeout = '10s';
  ALTER ROLE xcs_monitor SET idle_in_transaction_session_timeout = '30s';
`

const REVOKE_CURRENT_DATABASE_ACCESS_SQL = `
  REVOKE ALL PRIVILEGES ON SCHEMA public FROM PUBLIC, xcs_indexer, xcs_api, xcs_monitor;
  REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM PUBLIC, xcs_indexer, xcs_api, xcs_monitor;
  REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, xcs_indexer, xcs_api, xcs_monitor;
  REVOKE ALL PRIVILEGES ON ALL ROUTINES IN SCHEMA public FROM PUBLIC, xcs_indexer, xcs_api, xcs_monitor;
  REVOKE CREATE ON SCHEMA public FROM PUBLIC;
  DO $xcs_database_grants$
  BEGIN
    EXECUTE format('REVOKE ALL PRIVILEGES ON DATABASE %I FROM PUBLIC, xcs_indexer, xcs_api, xcs_monitor', current_database());
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO xcs_indexer, xcs_api, xcs_monitor', current_database());
  END
  $xcs_database_grants$;
`

const GRANT_RUNTIME_ACCESS_SQL = `
  GRANT USAGE ON SCHEMA public TO xcs_indexer, xcs_api;
  GRANT pg_monitor TO xcs_monitor WITH INHERIT TRUE, SET FALSE;

  GRANT SELECT, INSERT ON TABLE
    network_profiles, ledger_checkpoints, schema_events, schemas, credential_events
  TO xcs_indexer;
  GRANT SELECT, INSERT ON TABLE indexer_status, credential_generations TO xcs_indexer;
  GRANT UPDATE (
    state, primary_source_tip, secondary_source_tip, last_agreed_ledger_index,
    last_agreed_ledger_hash, error_code, writer_id, writer_epoch, lease_expires_at, updated_at
  ) ON TABLE indexer_status TO xcs_indexer;
  GRANT UPDATE (
    accepted, last_ledger_index, deleted_ledger_index, deletion_cause, updated_at
  ) ON TABLE credential_generations TO xcs_indexer;
  GRANT SELECT, INSERT ON TABLE indexer_incidents TO xcs_indexer;

  GRANT SELECT ON TABLE
    network_profiles, ledger_checkpoints, indexer_status, indexer_incidents,
    schema_events, schemas, credential_generations, credential_events
  TO xcs_api;
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE pin_challenges, demo_pins TO xcs_api;
`

export async function provisionRuntimeDatabasePrivileges(
  client: DatabaseClient,
  provisioning: RuntimeDatabaseProvisioning,
): Promise<void> {
  parseDatabaseClusterScope(provisioning.clusterScope)

  await client.sql.begin(async (sql) => {
    await sql`SELECT pg_advisory_xact_lock(${PROVISION_LOCK_CLASS_ID}, ${PROVISION_LOCK_OBJECT_ID})`

    const present = await sql<{ roleName: string }[]>`
      SELECT rolname AS "roleName"
      FROM pg_roles
      WHERE rolname IN (${XCS_INDEXER_DATABASE_ROLE}, ${XCS_API_DATABASE_ROLE}, ${XCS_MONITOR_DATABASE_ROLE})
    `
    const found = new Set(present.map((row) => row.roleName))
    const missing = XCS_RUNTIME_DATABASE_ROLES.filter((role) => !found.has(role))
    if (missing.length > 0) {
      throw new MissingRuntimeDatabaseRolesError(missing)
    }

    await sql.unsafe(NORMALIZE_ROLE_MEMBERSHIPS_SQL)
    await sql.unsafe(NORMALIZE_ROLE_ATTRIBUTES_SQL)
    await sql.unsafe(REVOKE_CURRENT_DATABASE_ACCESS_SQL)
    await sql.unsafe(GRANT_RUNTIME_ACCESS_SQL)
  })
}
