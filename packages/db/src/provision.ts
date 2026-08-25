import type { DatabaseClient } from './client.js'

export const XCS_INDEXER_DATABASE_ROLE = 'xcs_indexer' as const
export const XCS_API_DATABASE_ROLE = 'xcs_api' as const

const PASSWORD_PATTERN = /^[A-Za-z0-9_-]{32,256}$/u

export interface RuntimeDatabasePasswords {
  indexerPassword: string
  apiPassword: string
}

function assertRuntimePassword(value: string, name: string): void {
  if (!PASSWORD_PATTERN.test(value)) {
    throw new Error(`${name} must be 32-256 URL-safe characters (A-Z, a-z, 0-9, _ or -)`)
  }
}

/**
 * Provisions the fixed, least-privilege runtime roles after schema migrations.
 *
 * Role names and grants are deliberately static. Passwords are sent as bound
 * parameters into transaction-local settings, so they never become part of a
 * client-side SQL string or application log message.
 */
export async function provisionRuntimeDatabaseRoles(
  client: DatabaseClient,
  passwords: RuntimeDatabasePasswords,
): Promise<void> {
  assertRuntimePassword(passwords.indexerPassword, 'XCS_INDEXER_DATABASE_PASSWORD')
  assertRuntimePassword(passwords.apiPassword, 'XCS_API_DATABASE_PASSWORD')
  if (passwords.indexerPassword === passwords.apiPassword) {
    throw new Error('XCS_INDEXER_DATABASE_PASSWORD and XCS_API_DATABASE_PASSWORD must be distinct')
  }

  await client.sql.begin(async (sql) => {
    await sql`SELECT pg_advisory_xact_lock(hashtextextended('xcs-runtime-role-provision', 0))`
    await sql`SELECT set_config(
      'xcs.bootstrap.indexer_password',
      ${passwords.indexerPassword},
      true
    )`
    await sql`SELECT set_config(
      'xcs.bootstrap.api_password',
      ${passwords.apiPassword},
      true
    )`

    await sql.unsafe(`
      DO $xcs_roles$
      DECLARE
        membership record;
        runtime_schema record;
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'xcs_indexer') THEN
          EXECUTE 'CREATE ROLE xcs_indexer LOGIN';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'xcs_api') THEN
          EXECUTE 'CREATE ROLE xcs_api LOGIN';
        END IF;

        IF EXISTS (
          SELECT 1
          FROM pg_database database_object
          JOIN pg_roles owner_role ON owner_role.oid = database_object.datdba
          WHERE database_object.datname = current_database()
            AND owner_role.rolname IN ('xcs_indexer', 'xcs_api')
          UNION ALL
          SELECT 1
          FROM pg_namespace schema_object
          JOIN pg_roles owner_role ON owner_role.oid = schema_object.nspowner
          WHERE owner_role.rolname IN ('xcs_indexer', 'xcs_api')
          UNION ALL
          SELECT 1
          FROM pg_class relation_object
          JOIN pg_roles owner_role ON owner_role.oid = relation_object.relowner
          WHERE owner_role.rolname IN ('xcs_indexer', 'xcs_api')
          UNION ALL
          SELECT 1
          FROM pg_proc routine_object
          JOIN pg_roles owner_role ON owner_role.oid = routine_object.proowner
          WHERE owner_role.rolname IN ('xcs_indexer', 'xcs_api')
          UNION ALL
          SELECT 1
          FROM pg_type type_object
          JOIN pg_roles owner_role ON owner_role.oid = type_object.typowner
          WHERE owner_role.rolname IN ('xcs_indexer', 'xcs_api')
        ) THEN
          RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'XCS runtime roles must not own database objects';
        END IF;

        FOR membership IN
          SELECT granted_role.rolname AS granted_role, member_role.rolname AS member_role
          FROM pg_auth_members auth_membership
          JOIN pg_roles granted_role ON granted_role.oid = auth_membership.roleid
          JOIN pg_roles member_role ON member_role.oid = auth_membership.member
          WHERE member_role.rolname IN ('xcs_indexer', 'xcs_api')
        LOOP
          EXECUTE format(
            'REVOKE %I FROM %I',
            membership.granted_role,
            membership.member_role
          );
        END LOOP;

        FOR membership IN
          SELECT granted_role.rolname AS granted_role, member_role.rolname AS member_role
          FROM pg_auth_members auth_membership
          JOIN pg_roles granted_role ON granted_role.oid = auth_membership.roleid
          JOIN pg_roles member_role ON member_role.oid = auth_membership.member
          WHERE granted_role.rolname IN ('xcs_indexer', 'xcs_api')
        LOOP
          EXECUTE format(
            'REVOKE %I FROM %I CASCADE',
            membership.granted_role,
            membership.member_role
          );
        END LOOP;

        EXECUTE 'ALTER ROLE xcs_indexer WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT -1 VALID UNTIL ''infinity''';
        EXECUTE 'ALTER ROLE xcs_api WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT -1 VALID UNTIL ''infinity''';
        EXECUTE 'ALTER ROLE xcs_indexer RESET ALL';
        EXECUTE 'ALTER ROLE xcs_api RESET ALL';

        FOR runtime_schema IN
          SELECT nspname
          FROM pg_namespace
          WHERE nspname !~ '^pg_'
            AND nspname <> 'information_schema'
        LOOP
          EXECUTE format(
            'REVOKE CREATE ON SCHEMA %I FROM PUBLIC',
            runtime_schema.nspname
          );
          EXECUTE format(
            'REVOKE ALL PRIVILEGES ON SCHEMA %I FROM xcs_indexer, xcs_api',
            runtime_schema.nspname
          );
        END LOOP;
        EXECUTE format(
          'ALTER ROLE xcs_indexer PASSWORD %L',
          current_setting('xcs.bootstrap.indexer_password')
        );
        EXECUTE format(
          'ALTER ROLE xcs_api PASSWORD %L',
          current_setting('xcs.bootstrap.api_password')
        );
      END
      $xcs_roles$;

      REVOKE CREATE ON SCHEMA public FROM PUBLIC;
      REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM PUBLIC;
      REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
      REVOKE ALL PRIVILEGES ON ALL ROUTINES IN SCHEMA public FROM PUBLIC;

      REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM xcs_indexer;
      REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM xcs_indexer;
      REVOKE ALL PRIVILEGES ON ALL ROUTINES IN SCHEMA public FROM xcs_indexer;
      REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM xcs_api;
      REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM xcs_api;
      REVOKE ALL PRIVILEGES ON ALL ROUTINES IN SCHEMA public FROM xcs_api;

      DO $xcs_database_grants$
      BEGIN
        EXECUTE format(
          'ALTER ROLE xcs_indexer IN DATABASE %I RESET ALL',
          current_database()
        );
        EXECUTE format(
          'ALTER ROLE xcs_api IN DATABASE %I RESET ALL',
          current_database()
        );
        EXECUTE format('REVOKE CONNECT, TEMPORARY ON DATABASE %I FROM PUBLIC', current_database());
        EXECUTE format(
          'REVOKE ALL PRIVILEGES ON DATABASE %I FROM xcs_indexer, xcs_api',
          current_database()
        );
        EXECUTE format('GRANT CONNECT ON DATABASE %I TO xcs_indexer, xcs_api', current_database());
      END
      $xcs_database_grants$;

      GRANT USAGE ON SCHEMA public TO xcs_indexer, xcs_api;

      GRANT SELECT, INSERT, UPDATE ON TABLE
        network_profiles,
        ledger_checkpoints,
        indexer_status,
        schema_events,
        schemas,
        credential_generations,
        credential_events
      TO xcs_indexer;

      GRANT SELECT ON TABLE
        network_profiles,
        ledger_checkpoints,
        indexer_status,
        schema_events,
        schemas,
        credential_generations,
        credential_events
      TO xcs_api;

      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
        pin_challenges,
        demo_pins
      TO xcs_api;
    `)
  })
}
