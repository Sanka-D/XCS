import type { DatabaseClient } from './client.js'

export const XCS_INDEXER_DATABASE_ROLE = 'xcs_indexer' as const
export const XCS_API_DATABASE_ROLE = 'xcs_api' as const
export const XCS_PAYLOAD_WRITER_DATABASE_ROLE = 'xcs_payload_writer' as const
export const XCS_MONITOR_DATABASE_ROLE = 'xcs_monitor' as const
export const XCS_APP_DATABASE_ROLE = 'xcs_app' as const
export const XCS_DATABASE_CLUSTER_SCOPE = 'dedicated' as const

export const XCS_INDEXER_DATABASE_CONNECTION_LIMIT = 12
export const XCS_API_DATABASE_CONNECTION_LIMIT = 12
export const XCS_PAYLOAD_WRITER_DATABASE_CONNECTION_LIMIT = 12
export const XCS_MONITOR_DATABASE_CONNECTION_LIMIT = 3
export const XCS_APP_DATABASE_CONNECTION_LIMIT = 12

const PASSWORD_PATTERN = /^[A-Za-z0-9_-]{32,256}$/u
const PROVISION_LOCK_CLASS_ID = 1_480_807_217
const PROVISION_LOCK_OBJECT_ID = 1

export interface RuntimeDatabasePasswords {
  clusterScope: typeof XCS_DATABASE_CLUSTER_SCOPE
  administratorPassword: string
  indexerPassword: string
  apiPassword: string
  payloadWriterPassword: string
  monitorPassword: string
  applicationPassword?: string
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

export function databasePasswordFromUrl(databaseUrl: string): string {
  let url: URL
  try {
    url = new URL(databaseUrl)
  } catch {
    throw new Error(
      'The selected administrator database URL must be a PostgreSQL URL with a password',
    )
  }

  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    url.username.length === 0 ||
    url.password.length === 0
  ) {
    throw new Error(
      'The selected administrator database URL must be a PostgreSQL URL with a password',
    )
  }
  return decodeURIComponent(url.password)
}

function assertPassword(value: string, name: string): void {
  if (!PASSWORD_PATTERN.test(value)) {
    throw new Error(`${name} must be 32-256 URL-safe characters (A-Z, a-z, 0-9, _ or -)`)
  }
}

export function assertRuntimeDatabasePasswords(passwords: RuntimeDatabasePasswords): void {
  parseDatabaseClusterScope(passwords.clusterScope)
  assertPassword(passwords.administratorPassword, 'administratorPassword')
  assertPassword(passwords.indexerPassword, 'indexerPassword')
  assertPassword(passwords.apiPassword, 'apiPassword')
  assertPassword(passwords.payloadWriterPassword, 'payloadWriterPassword')
  assertPassword(passwords.monitorPassword, 'monitorPassword')
  if (passwords.applicationPassword !== undefined) {
    assertPassword(passwords.applicationPassword, 'applicationPassword')
  }

  if (
    new Set([
      passwords.administratorPassword,
      passwords.indexerPassword,
      passwords.apiPassword,
      passwords.payloadWriterPassword,
      passwords.monitorPassword,
      ...(passwords.applicationPassword === undefined ? [] : [passwords.applicationPassword]),
    ]).size !== (passwords.applicationPassword === undefined ? 5 : 6)
  ) {
    throw new Error('administrator and runtime database passwords must be pairwise distinct')
  }
}

const CREATE_ROLES_SQL = `
  DO $xcs_roles$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'xcs_indexer') THEN
      CREATE ROLE xcs_indexer NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'xcs_api') THEN
      CREATE ROLE xcs_api NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'xcs_monitor') THEN
      CREATE ROLE xcs_monitor NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'xcs_payload_writer') THEN
      CREATE ROLE xcs_payload_writer NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'xcs_app') THEN
      CREATE ROLE xcs_app NOLOGIN;
    END IF;
  END
  $xcs_roles$;
`

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
      WHERE granted_role.rolname IN ('xcs_indexer', 'xcs_api', 'xcs_monitor', 'xcs_payload_writer', 'xcs_app')
         OR member_role.rolname IN ('xcs_indexer', 'xcs_api', 'xcs_monitor', 'xcs_payload_writer', 'xcs_app')
    LOOP
      IF membership.granted_role = 'pg_monitor' AND membership.member_role = 'xcs_monitor' THEN
        CONTINUE;
      END IF;
      EXECUTE format('REVOKE %I FROM %I', membership.granted_role, membership.member_role);
    END LOOP;
  END
  $xcs_memberships$;
`

const NORMALIZE_ROLE_ATTRIBUTES_SQL = `
  ALTER ROLE xcs_indexer WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT ${XCS_INDEXER_DATABASE_CONNECTION_LIMIT} VALID UNTIL 'infinity';
  ALTER ROLE xcs_api WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT ${XCS_API_DATABASE_CONNECTION_LIMIT} VALID UNTIL 'infinity';
  ALTER ROLE xcs_payload_writer WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT ${XCS_PAYLOAD_WRITER_DATABASE_CONNECTION_LIMIT} VALID UNTIL 'infinity';
  ALTER ROLE xcs_monitor WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT ${XCS_MONITOR_DATABASE_CONNECTION_LIMIT} VALID UNTIL 'infinity';
  ALTER ROLE xcs_app WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT ${XCS_APP_DATABASE_CONNECTION_LIMIT} VALID UNTIL 'infinity' PASSWORD NULL;
  ALTER ROLE xcs_indexer RESET ALL;
  ALTER ROLE xcs_api RESET ALL;
  ALTER ROLE xcs_payload_writer RESET ALL;
  ALTER ROLE xcs_monitor RESET ALL;
  ALTER ROLE xcs_app RESET ALL;
  ALTER ROLE xcs_indexer SET statement_timeout = '5min';
  ALTER ROLE xcs_indexer SET lock_timeout = '30s';
  ALTER ROLE xcs_indexer SET idle_in_transaction_session_timeout = '30s';
  ALTER ROLE xcs_api SET statement_timeout = '30s';
  ALTER ROLE xcs_api SET lock_timeout = '15s';
  ALTER ROLE xcs_api SET idle_in_transaction_session_timeout = '30s';
  ALTER ROLE xcs_payload_writer SET statement_timeout = '30s';
  ALTER ROLE xcs_payload_writer SET lock_timeout = '15s';
  ALTER ROLE xcs_payload_writer SET idle_in_transaction_session_timeout = '30s';
  ALTER ROLE xcs_monitor SET statement_timeout = '30s';
  ALTER ROLE xcs_monitor SET lock_timeout = '10s';
  ALTER ROLE xcs_monitor SET idle_in_transaction_session_timeout = '30s';
  ALTER ROLE xcs_app SET statement_timeout = '30s';
  ALTER ROLE xcs_app SET lock_timeout = '15s';
  ALTER ROLE xcs_app SET idle_in_transaction_session_timeout = '30s';
`

const SET_ROLE_PASSWORDS_SQL = `
  DO $xcs_passwords$
  BEGIN
    EXECUTE format(
      'ALTER ROLE xcs_indexer PASSWORD %L',
      current_setting('xcs.indexer_password')
    );
    EXECUTE format(
      'ALTER ROLE xcs_api PASSWORD %L',
      current_setting('xcs.api_password')
    );
    EXECUTE format(
      'ALTER ROLE xcs_payload_writer PASSWORD %L',
      current_setting('xcs.payload_writer_password')
    );
    EXECUTE format(
      'ALTER ROLE xcs_monitor PASSWORD %L',
      current_setting('xcs.monitor_password')
    );
  END
  $xcs_passwords$;
`

const REVOKE_CURRENT_DATABASE_ACCESS_SQL = `
  REVOKE ALL PRIVILEGES ON SCHEMA public FROM PUBLIC, xcs_indexer, xcs_api, xcs_monitor, xcs_payload_writer, xcs_app;
  REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM PUBLIC, xcs_indexer, xcs_api, xcs_monitor, xcs_payload_writer, xcs_app;
  REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, xcs_indexer, xcs_api, xcs_monitor, xcs_payload_writer, xcs_app;
  REVOKE ALL PRIVILEGES ON ALL ROUTINES IN SCHEMA public FROM PUBLIC, xcs_indexer, xcs_api, xcs_monitor, xcs_payload_writer, xcs_app;
  REVOKE CREATE ON SCHEMA public FROM PUBLIC;
  DO $xcs_database_grants$
  BEGIN
    EXECUTE format('REVOKE ALL PRIVILEGES ON DATABASE %I FROM PUBLIC, xcs_indexer, xcs_api, xcs_monitor, xcs_payload_writer, xcs_app', current_database());
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO xcs_indexer, xcs_api, xcs_monitor, xcs_payload_writer', current_database());
  END
  $xcs_database_grants$;
`

// Table-level REVOKE does not remove column grants. Normalize these even when auth
// is disabled so prior application releases cannot retain additional privileges.
const REVOKE_APPLICATION_COLUMNS_SQL = `
  DO $xcs_app_columns$
  DECLARE relation record;
  BEGIN
    FOR relation IN
      SELECT table_name, string_agg(format('%I', column_name), ', ' ORDER BY ordinal_position) AS columns
      FROM information_schema.columns WHERE table_schema = 'public' GROUP BY table_name
    LOOP
      EXECUTE format('REVOKE SELECT (%2$s), INSERT (%2$s), UPDATE (%2$s), REFERENCES (%2$s) ON TABLE public.%1$I FROM xcs_app', relation.table_name, relation.columns);
    END LOOP;
  END
  $xcs_app_columns$;
`

const GRANT_APPLICATION_ACCESS_SQL = `
  GRANT USAGE ON SCHEMA public TO xcs_app;
  DO $xcs_app_connect$
  BEGIN
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO xcs_app', current_database());
    EXECUTE format('ALTER ROLE xcs_app PASSWORD %L', current_setting('xcs.application_password'));
  END
  $xcs_app_connect$;
  GRANT SELECT ON TABLE app_users, app_user_roles, app_wallets TO xcs_app;
  GRANT SELECT (id, responsible_user_id, name, status) ON TABLE app_organizations TO xcs_app;
  GRANT SELECT (organization_id, role, status) ON TABLE app_organization_applications TO xcs_app;
  GRANT INSERT (identity_issuer, identity_subject, email, email_verified_at, display_name) ON TABLE app_users TO xcs_app;
  GRANT UPDATE (email, email_verified_at, display_name) ON TABLE app_users TO xcs_app;
  GRANT INSERT (user_id) ON TABLE app_user_roles TO xcs_app;
  GRANT INSERT (user_id, network_id, address, verified_at) ON TABLE app_wallets TO xcs_app;
  GRANT UPDATE (verified_at, revoked_at) ON TABLE app_wallets TO xcs_app;
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE app_sessions, app_auth_transactions, app_wallet_challenges TO xcs_app;
  ALTER ROLE xcs_app LOGIN;
`

const GRANT_RUNTIME_ACCESS_SQL = `
  GRANT USAGE ON SCHEMA public TO xcs_indexer, xcs_api, xcs_payload_writer;
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
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE pin_challenges, demo_pins TO xcs_payload_writer;
  GRANT SELECT, INSERT ON TABLE hosted_payloads, hosted_payload_publications TO xcs_payload_writer;
`

export async function provisionRuntimeDatabaseRoles(
  client: DatabaseClient,
  passwords: RuntimeDatabasePasswords,
): Promise<void> {
  assertRuntimeDatabasePasswords(passwords)

  await client.sql.begin(async (sql) => {
    await sql`SELECT pg_advisory_xact_lock(${PROVISION_LOCK_CLASS_ID}, ${PROVISION_LOCK_OBJECT_ID})`
    await sql.unsafe(CREATE_ROLES_SQL)
    await sql.unsafe(NORMALIZE_ROLE_MEMBERSHIPS_SQL)
    await sql.unsafe(NORMALIZE_ROLE_ATTRIBUTES_SQL)
    await sql`SELECT set_config('password_encryption', 'scram-sha-256', true)`
    await sql`SELECT set_config('xcs.indexer_password', ${passwords.indexerPassword}, true)`
    await sql`SELECT set_config('xcs.api_password', ${passwords.apiPassword}, true)`
    await sql`SELECT set_config('xcs.payload_writer_password', ${passwords.payloadWriterPassword}, true)`
    await sql`SELECT set_config('xcs.monitor_password', ${passwords.monitorPassword}, true)`
    await sql.unsafe(SET_ROLE_PASSWORDS_SQL)
    await sql.unsafe(REVOKE_CURRENT_DATABASE_ACCESS_SQL)
    await sql.unsafe(REVOKE_APPLICATION_COLUMNS_SQL)
    await sql.unsafe(GRANT_RUNTIME_ACCESS_SQL)
    if (passwords.applicationPassword !== undefined) {
      await sql`SELECT set_config('xcs.application_password', ${passwords.applicationPassword}, true)`
      await sql.unsafe(GRANT_APPLICATION_ACCESS_SQL)
    }
    await sql.unsafe(
      'ALTER ROLE xcs_indexer LOGIN; ALTER ROLE xcs_api LOGIN; ALTER ROLE xcs_monitor LOGIN; ALTER ROLE xcs_payload_writer LOGIN;',
    )
  })
}
