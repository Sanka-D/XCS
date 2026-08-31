import type { DatabaseClient } from './client.js'

export const XCS_INDEXER_DATABASE_ROLE = 'xcs_indexer' as const
export const XCS_API_DATABASE_ROLE = 'xcs_api' as const
export const XCS_MONITOR_DATABASE_ROLE = 'xcs_monitor' as const
export const XCS_PROVISION_CONTROL_ROLE = 'xcs_provision_control' as const
export const XCS_DATABASE_CLUSTER_SCOPE = 'dedicated' as const
export const XCS_INDEXER_DATABASE_CONNECTION_LIMIT = 12
export const XCS_API_DATABASE_CONNECTION_LIMIT = 12
export const XCS_MONITOR_DATABASE_CONNECTION_LIMIT = 3

const PASSWORD_PATTERN = /^[A-Za-z0-9_-]{32,256}$/u
const PROVISION_LOCK_CLASS_ID = 1_480_807_217
const PROVISION_LOCK_OBJECT_ID = 1
const EXPECTED_DATABASE_MIGRATIONS = [
  {
    hash: 'fc939b9441de32159f9458a0f46f211491de3feba1053865d20fb39411f3ae18',
    createdAt: 1_787_137_915_943,
  },
  {
    hash: '63b96448939a99e4e8e1da3225f7e77365fab613d07ea3b0e13fdbaf1bae8b26',
    createdAt: 1_787_583_095_929,
  },
  {
    hash: 'db25b39a56daace3970de97c838ebd0e6329b2be1eeffd15b25c468e81ac377c',
    createdAt: 1_787_677_420_371,
  },
  {
    hash: '171b2d01389d56ce7803862d9a4502d15a3f40bb7f36423b1e6130146cb7e646',
    createdAt: 1_787_763_893_542,
  },
  {
    hash: '8acc5d13254ed49505dc767e891406a8a479c7aa45718ae60df066f7f7828183',
    createdAt: 1_788_121_971_942,
  },
] as const
const EXPECTED_DATABASE_MIGRATION_COUNT = EXPECTED_DATABASE_MIGRATIONS.length
const EXPECTED_VALIDATED_PROJECTION_CONSTRAINT_COUNT = 16
const CONTROL_DATABASE_COMMENT_PREFIX = 'xcs:provision-control-database:'
const CONTROL_DATABASE_MARKER_SQL = `
  DO $xcs_control_database$
  DECLARE
    control_database_oid oid;
    control_database_comment text;
    membership record;
  BEGIN
    IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = session_user) THEN
      RAISE EXCEPTION USING
        ERRCODE = '42501',
        MESSAGE = 'XCS runtime role provisioning requires a PostgreSQL superuser';
    END IF;

    SELECT oid INTO STRICT control_database_oid
    FROM pg_database
    WHERE datname = current_database();

    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${XCS_PROVISION_CONTROL_ROLE}') THEN
      EXECUTE 'CREATE ROLE ${XCS_PROVISION_CONTROL_ROLE} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS';
      EXECUTE format(
        'COMMENT ON ROLE ${XCS_PROVISION_CONTROL_ROLE} IS %L',
        '${CONTROL_DATABASE_COMMENT_PREFIX}' || control_database_oid::text
      );
    END IF;

    SELECT shobj_description(role_object.oid, 'pg_authid')
    INTO control_database_comment
    FROM pg_roles role_object
    WHERE role_object.rolname = '${XCS_PROVISION_CONTROL_ROLE}';

    IF control_database_comment IS DISTINCT FROM
      '${CONTROL_DATABASE_COMMENT_PREFIX}' || control_database_oid::text
    THEN
      RAISE EXCEPTION USING
        ERRCODE = '42501',
        MESSAGE = 'XCS provisioning must run from the cluster control database';
    END IF;

    EXECUTE 'ALTER ROLE ${XCS_PROVISION_CONTROL_ROLE} WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 0';
    EXECUTE 'ALTER ROLE ${XCS_PROVISION_CONTROL_ROLE} RESET ALL';

    FOR membership IN
      SELECT
        granted_role.rolname AS granted_role,
        member_role.rolname AS member_role,
        grantor_role.rolname AS grantor_role
      FROM pg_auth_members auth_membership
      JOIN pg_roles granted_role ON granted_role.oid = auth_membership.roleid
      JOIN pg_roles member_role ON member_role.oid = auth_membership.member
      JOIN pg_roles grantor_role ON grantor_role.oid = auth_membership.grantor
      WHERE granted_role.rolname = '${XCS_PROVISION_CONTROL_ROLE}'
         OR member_role.rolname = '${XCS_PROVISION_CONTROL_ROLE}'
    LOOP
      EXECUTE format(
        'REVOKE %I FROM %I GRANTED BY %I CASCADE',
        membership.granted_role,
        membership.member_role,
        membership.grantor_role
      );
    END LOOP;

    IF EXISTS (
      SELECT 1
      FROM pg_shdepend dependency
      JOIN pg_roles referenced_role ON referenced_role.oid = dependency.refobjid
      WHERE dependency.refclassid = 'pg_authid'::regclass
        AND referenced_role.rolname = '${XCS_PROVISION_CONTROL_ROLE}'
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '42501',
        MESSAGE = 'XCS provision control role must not own objects, hold privileges or target policies';
    END IF;
  END
  $xcs_control_database$;
`
const RUNTIME_ROLE_QUARANTINE_SQL = `
  DO $xcs_quarantine$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'xcs_indexer') THEN
      EXECUTE 'CREATE ROLE xcs_indexer NOLOGIN';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'xcs_api') THEN
      EXECUTE 'CREATE ROLE xcs_api NOLOGIN';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'xcs_monitor') THEN
      EXECUTE 'CREATE ROLE xcs_monitor NOLOGIN';
    END IF;

    EXECUTE 'ALTER ROLE xcs_indexer WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT ${XCS_INDEXER_DATABASE_CONNECTION_LIMIT}';
    EXECUTE 'ALTER ROLE xcs_api WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT ${XCS_API_DATABASE_CONNECTION_LIMIT}';
    EXECUTE 'ALTER ROLE xcs_monitor WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT ${XCS_MONITOR_DATABASE_CONNECTION_LIMIT}';
    EXECUTE 'ALTER ROLE xcs_indexer RESET ALL';
    EXECUTE 'ALTER ROLE xcs_api RESET ALL';
    EXECUTE 'ALTER ROLE xcs_monitor RESET ALL';
  END
  $xcs_quarantine$;
`
const ADVISORY_LOCK_PRIVILEGE_PURGE_SQL = `
  DO $xcs_advisory_lock_privileges$
  DECLARE
    advisory_lock_function record;
    untrusted_role record;
  BEGIN
    FOR advisory_lock_function IN
      SELECT routine.oid::regprocedure::text AS signature
      FROM pg_proc routine
      JOIN pg_namespace namespace_object ON namespace_object.oid = routine.pronamespace
      WHERE namespace_object.nspname = 'pg_catalog'
        AND routine.proname IN (
          'pg_advisory_lock',
          'pg_advisory_lock_shared',
          'pg_advisory_unlock',
          'pg_advisory_unlock_all',
          'pg_advisory_unlock_shared',
          'pg_advisory_xact_lock',
          'pg_advisory_xact_lock_shared',
          'pg_try_advisory_lock',
          'pg_try_advisory_lock_shared',
          'pg_try_advisory_xact_lock',
          'pg_try_advisory_xact_lock_shared'
        )
    LOOP
      EXECUTE format(
        'REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC CASCADE',
        advisory_lock_function.signature
      );
      FOR untrusted_role IN
        SELECT rolname
        FROM pg_roles
        WHERE NOT rolsuper
      LOOP
        EXECUTE format(
          'REVOKE EXECUTE ON FUNCTION %s FROM %I CASCADE',
          advisory_lock_function.signature,
          untrusted_role.rolname
        );
      END LOOP;
    END LOOP;
  END
  $xcs_advisory_lock_privileges$;
`
const SIDE_EFFECT_FUNCTION_PRIVILEGE_PURGE_SQL = `
  DO $xcs_side_effect_function_privileges$
  DECLARE
    side_effect_function record;
    untrusted_role record;
  BEGIN
    FOR side_effect_function IN
      SELECT routine.oid::regprocedure::text AS signature
      FROM pg_proc routine
      JOIN pg_namespace namespace_object ON namespace_object.oid = routine.pronamespace
      WHERE namespace_object.nspname = 'pg_catalog'
        AND routine.proname IN ('pg_logical_emit_message', 'pg_notify')
    LOOP
      EXECUTE format(
        'REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC CASCADE',
        side_effect_function.signature
      );
      FOR untrusted_role IN
        SELECT rolname
        FROM pg_roles
        WHERE NOT rolsuper
      LOOP
        EXECUTE format(
          'REVOKE EXECUTE ON FUNCTION %s FROM %I CASCADE',
          side_effect_function.signature,
          untrusted_role.rolname
        );
      END LOOP;
    END LOOP;
  END
  $xcs_side_effect_function_privileges$;
`
const PUBLIC_COLUMN_PRIVILEGE_PURGE_SQL = `
  DO $xcs_public_column_privileges$
  DECLARE
    column_object record;
  BEGIN
    FOR column_object IN
      SELECT
        namespace_object.nspname AS schema_name,
        relation.relname AS relation_name,
        attribute_object.attname AS column_name
      FROM pg_attribute attribute_object
      JOIN pg_class relation ON relation.oid = attribute_object.attrelid
      JOIN pg_namespace namespace_object ON namespace_object.oid = relation.relnamespace
      CROSS JOIN LATERAL aclexplode(attribute_object.attacl) privilege
      WHERE attribute_object.attnum > 0
        AND NOT attribute_object.attisdropped
        AND privilege.grantee = 0
      GROUP BY namespace_object.nspname, relation.relname, attribute_object.attname
    LOOP
      EXECUTE format(
        'REVOKE ALL PRIVILEGES (%I) ON TABLE %I.%I FROM PUBLIC CASCADE',
        column_object.column_name,
        column_object.schema_name,
        column_object.relation_name
      );
    END LOOP;
  END
  $xcs_public_column_privileges$;
`
const SYSTEM_RELATION_PUBLIC_PRIVILEGE_NORMALIZATION_SQL = `
  DO $xcs_system_relation_public_privileges$
  DECLARE
    system_schema record;
    system_relation record;
    initial_column record;
    relation_kind text;
    public_acl_drifted boolean;
    public_privileges text;
  BEGIN
    FOR system_schema IN
      SELECT nspname
      FROM pg_namespace
      WHERE (
          nspname ~ '^pg_'
          AND nspname !~ '^pg_(?:toast_)?temp_'
        ) OR nspname = 'information_schema'
    LOOP
      EXECUTE format(
        'REVOKE CREATE ON SCHEMA %I FROM PUBLIC CASCADE',
        system_schema.nspname
      );
    END LOOP;

    FOR system_relation IN
      SELECT
        relation.oid,
        relation.relkind,
        relation.relowner,
        relation.relacl,
        namespace_object.nspname AS schema_name,
        relation.relname AS relation_name
      FROM pg_class relation
      JOIN pg_namespace namespace_object ON namespace_object.oid = relation.relnamespace
      WHERE (
          (
            namespace_object.nspname ~ '^pg_'
            AND namespace_object.nspname !~ '^pg_(?:toast_)?temp_'
          )
          OR namespace_object.nspname = 'information_schema'
        )
        AND relation.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
    LOOP
      relation_kind := CASE WHEN system_relation.relkind = 'S' THEN 'SEQUENCE' ELSE 'TABLE' END;
      WITH current_privileges AS (
        SELECT privilege.privilege_type, privilege.is_grantable
        FROM aclexplode(
          COALESCE(
            system_relation.relacl,
            acldefault(
              CASE
                WHEN system_relation.relkind = 'S' THEN 's'::"char"
                ELSE 'r'::"char"
              END,
              system_relation.relowner
            )
          )
        ) privilege
        WHERE privilege.grantee = 0
      ),
      baseline_privileges AS (
        SELECT privilege.privilege_type, privilege.is_grantable
        FROM aclexplode(
          COALESCE(
            (
              SELECT initial_privileges.initprivs
              FROM pg_init_privs initial_privileges
              WHERE initial_privileges.classoid = 'pg_class'::regclass
                AND initial_privileges.objoid = system_relation.oid
                AND initial_privileges.objsubid = 0
              ORDER BY initial_privileges.privtype
              LIMIT 1
            ),
            acldefault(
              CASE
                WHEN system_relation.relkind = 'S' THEN 's'::"char"
                ELSE 'r'::"char"
              END,
              system_relation.relowner
            )
          )
        ) privilege
        WHERE privilege.grantee = 0
      )
      SELECT EXISTS (
        (SELECT * FROM current_privileges EXCEPT SELECT * FROM baseline_privileges)
        UNION ALL
        (SELECT * FROM baseline_privileges EXCEPT SELECT * FROM current_privileges)
      )
      INTO public_acl_drifted;

      IF public_acl_drifted THEN
        EXECUTE format(
          'REVOKE ALL PRIVILEGES ON %s %I.%I FROM PUBLIC CASCADE',
          relation_kind,
          system_relation.schema_name,
          system_relation.relation_name
        );

        SELECT string_agg(
          DISTINCT privilege.privilege_type,
          ', ' ORDER BY privilege.privilege_type
        )
        INTO public_privileges
        FROM aclexplode(
          COALESCE(
            (
              SELECT initial_privileges.initprivs
              FROM pg_init_privs initial_privileges
              WHERE initial_privileges.classoid = 'pg_class'::regclass
                AND initial_privileges.objoid = system_relation.oid
                AND initial_privileges.objsubid = 0
              ORDER BY initial_privileges.privtype
              LIMIT 1
            ),
            acldefault(
              CASE
                WHEN system_relation.relkind = 'S' THEN 's'::"char"
                ELSE 'r'::"char"
              END,
              system_relation.relowner
            )
          )
        ) privilege
        WHERE privilege.grantee = 0;

        IF public_privileges IS NOT NULL THEN
          EXECUTE format(
            'GRANT %s ON %s %I.%I TO PUBLIC',
            public_privileges,
            relation_kind,
            system_relation.schema_name,
            system_relation.relation_name
          );
        END IF;
      END IF;

      FOR initial_column IN
        SELECT
          attribute_object.attname AS column_name,
          string_agg(
            DISTINCT privilege.privilege_type,
            ', ' ORDER BY privilege.privilege_type
          ) AS privileges
        FROM pg_init_privs initial_privileges
        JOIN pg_attribute attribute_object
          ON attribute_object.attrelid = initial_privileges.objoid
         AND attribute_object.attnum = initial_privileges.objsubid
        CROSS JOIN LATERAL aclexplode(initial_privileges.initprivs) privilege
        WHERE initial_privileges.classoid = 'pg_class'::regclass
          AND initial_privileges.objoid = system_relation.oid
          AND initial_privileges.objsubid > 0
          AND privilege.grantee = 0
        GROUP BY attribute_object.attname
      LOOP
        EXECUTE format(
          'GRANT %s (%I) ON TABLE %I.%I TO PUBLIC',
          initial_column.privileges,
          initial_column.column_name,
          system_relation.schema_name,
          system_relation.relation_name
        );
      END LOOP;
    END LOOP;
  END
  $xcs_system_relation_public_privileges$;
`
const SYSTEM_ROUTINE_PUBLIC_PRIVILEGE_NORMALIZATION_SQL = `
  DO $xcs_system_routine_public_privileges$
  DECLARE
    system_routine record;
    public_acl_drifted boolean;
    public_privileges text;
  BEGIN
    FOR system_routine IN
      SELECT
        routine.oid,
        routine.proowner,
        routine.proacl,
        routine.oid::regprocedure::text AS signature
      FROM pg_proc routine
      JOIN pg_namespace namespace_object ON namespace_object.oid = routine.pronamespace
      WHERE (
          (
            namespace_object.nspname ~ '^pg_'
            AND namespace_object.nspname !~ '^pg_(?:toast_)?temp_'
          )
          OR namespace_object.nspname = 'information_schema'
        )
    LOOP
      WITH current_privileges AS (
        SELECT privilege.privilege_type, privilege.is_grantable
        FROM aclexplode(
          COALESCE(
            system_routine.proacl,
            acldefault('f'::"char", system_routine.proowner)
          )
        ) privilege
        WHERE privilege.grantee = 0
      ),
      baseline_privileges AS (
        SELECT privilege.privilege_type, privilege.is_grantable
        FROM aclexplode(
          COALESCE(
            (
              SELECT initial_privileges.initprivs
              FROM pg_init_privs initial_privileges
              WHERE initial_privileges.classoid = 'pg_proc'::regclass
                AND initial_privileges.objoid = system_routine.oid
                AND initial_privileges.objsubid = 0
              ORDER BY initial_privileges.privtype
              LIMIT 1
            ),
            CASE
              WHEN system_routine.oid < 16384
                THEN acldefault('f'::"char", system_routine.proowner)
              ELSE NULL::aclitem[]
            END
          )
        ) privilege
        WHERE privilege.grantee = 0
      )
      SELECT EXISTS (
        (SELECT * FROM current_privileges EXCEPT SELECT * FROM baseline_privileges)
        UNION ALL
        (SELECT * FROM baseline_privileges EXCEPT SELECT * FROM current_privileges)
      )
      INTO public_acl_drifted;

      IF NOT public_acl_drifted THEN
        CONTINUE;
      END IF;

      EXECUTE format(
        'REVOKE EXECUTE ON ROUTINE %s FROM PUBLIC CASCADE',
        system_routine.signature
      );

      SELECT string_agg(DISTINCT privilege.privilege_type, ', ' ORDER BY privilege.privilege_type)
      INTO public_privileges
      FROM aclexplode(
        COALESCE(
          (
            SELECT initial_privileges.initprivs
            FROM pg_init_privs initial_privileges
            WHERE initial_privileges.classoid = 'pg_proc'::regclass
              AND initial_privileges.objoid = system_routine.oid
              AND initial_privileges.objsubid = 0
            ORDER BY initial_privileges.privtype
            LIMIT 1
          ),
          CASE
            -- OIDs below FirstNormalObjectId are pinned initdb routines. A
            -- later object placed in pg_catalog without pg_init_privs gets no
            -- PUBLIC fallback, so provisioning cannot bless a hostile routine.
            WHEN system_routine.oid < 16384
              THEN acldefault('f'::"char", system_routine.proowner)
            ELSE NULL::aclitem[]
          END
        )
      ) privilege
      WHERE privilege.grantee = 0;

      IF public_privileges IS NOT NULL THEN
        EXECUTE format(
          'GRANT %s ON ROUTINE %s TO PUBLIC',
          public_privileges,
          system_routine.signature
        );
      END IF;
    END LOOP;
  END
  $xcs_system_routine_public_privileges$;
`
const SYSTEM_TYPE_AND_LANGUAGE_PUBLIC_PRIVILEGE_NORMALIZATION_SQL = `
  DO $xcs_system_type_language_public_privileges$
  DECLARE
    system_type record;
    trusted_language record;
    object_kind text;
    public_acl_drifted boolean;
    public_privileges text;
  BEGIN
    -- Array and multirange ACLs are inherited from their element/range type
    -- and PostgreSQL rejects direct GRANT/REVOKE statements on them.
    FOR system_type IN
      SELECT
        type_object.oid,
        type_object.typowner,
        type_object.typacl,
        type_object.typtype,
        (
          namespace_object.nspname ~ '^pg_'
          OR namespace_object.nspname = 'information_schema'
        ) AS is_system_type,
        namespace_object.nspname AS schema_name,
        type_object.typname AS type_name
      FROM pg_type type_object
      JOIN pg_namespace namespace_object ON namespace_object.oid = type_object.typnamespace
      WHERE namespace_object.nspname !~ '^pg_(?:toast_)?temp_'
        AND type_object.typisdefined
        AND type_object.typcategory <> 'A'
        AND type_object.typtype <> 'm'
    LOOP
      object_kind := CASE WHEN system_type.typtype = 'd' THEN 'DOMAIN' ELSE 'TYPE' END;
      WITH current_privileges AS (
        SELECT privilege.privilege_type, privilege.is_grantable
        FROM aclexplode(
          COALESCE(
            system_type.typacl,
            acldefault('T'::"char", system_type.typowner)
          )
        ) privilege
        WHERE privilege.grantee = 0
      ),
      baseline_privileges AS (
        SELECT privilege.privilege_type, privilege.is_grantable
        FROM aclexplode(
          COALESCE(
            (
              SELECT initial_privileges.initprivs
              FROM pg_init_privs initial_privileges
              WHERE initial_privileges.classoid = 'pg_type'::regclass
                AND initial_privileges.objoid = system_type.oid
                AND initial_privileges.objsubid = 0
              ORDER BY initial_privileges.privtype
              LIMIT 1
            ),
            CASE
              WHEN system_type.is_system_type AND system_type.oid < 16384
                THEN acldefault('T'::"char", system_type.typowner)
              ELSE NULL::aclitem[]
            END
          )
        ) privilege
        WHERE privilege.grantee = 0
      )
      SELECT EXISTS (
        (SELECT * FROM current_privileges EXCEPT SELECT * FROM baseline_privileges)
        UNION ALL
        (SELECT * FROM baseline_privileges EXCEPT SELECT * FROM current_privileges)
      )
      INTO public_acl_drifted;

      IF NOT public_acl_drifted THEN
        CONTINUE;
      END IF;

      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON %s %I.%I FROM PUBLIC CASCADE',
        object_kind,
        system_type.schema_name,
        system_type.type_name
      );

      SELECT string_agg(DISTINCT privilege.privilege_type, ', ' ORDER BY privilege.privilege_type)
      INTO public_privileges
      FROM aclexplode(
        COALESCE(
          (
            SELECT initial_privileges.initprivs
            FROM pg_init_privs initial_privileges
            WHERE initial_privileges.classoid = 'pg_type'::regclass
              AND initial_privileges.objoid = system_type.oid
              AND initial_privileges.objsubid = 0
            ORDER BY initial_privileges.privtype
            LIMIT 1
          ),
          CASE
            WHEN system_type.is_system_type AND system_type.oid < 16384
              THEN acldefault('T'::"char", system_type.typowner)
            ELSE NULL::aclitem[]
          END
        )
      ) privilege
      WHERE privilege.grantee = 0;

      IF public_privileges IS NOT NULL THEN
        EXECUTE format(
          'GRANT %s ON %s %I.%I TO PUBLIC',
          public_privileges,
          object_kind,
          system_type.schema_name,
          system_type.type_name
        );
      END IF;
    END LOOP;

    -- GRANT/REVOKE is intentionally unavailable for untrusted languages;
    -- only their trusted counterparts can carry a PUBLIC ACL.
    FOR trusted_language IN
      SELECT
        language_object.oid,
        language_object.lanname,
        language_object.lanowner,
        language_object.lanacl
      FROM pg_language language_object
      WHERE language_object.lanpltrusted
    LOOP
      WITH current_privileges AS (
        SELECT privilege.privilege_type, privilege.is_grantable
        FROM aclexplode(
          COALESCE(
            trusted_language.lanacl,
            acldefault('l'::"char", trusted_language.lanowner)
          )
        ) privilege
        WHERE privilege.grantee = 0
      ),
      baseline_privileges AS (
        SELECT privilege.privilege_type, privilege.is_grantable
        FROM aclexplode(
          COALESCE(
            (
              SELECT initial_privileges.initprivs
              FROM pg_init_privs initial_privileges
              WHERE initial_privileges.classoid = 'pg_language'::regclass
                AND initial_privileges.objoid = trusted_language.oid
                AND initial_privileges.objsubid = 0
              ORDER BY initial_privileges.privtype
              LIMIT 1
            ),
            CASE
              WHEN trusted_language.oid < 16384
                THEN acldefault('l'::"char", trusted_language.lanowner)
              ELSE NULL::aclitem[]
            END
          )
        ) privilege
        WHERE privilege.grantee = 0
      )
      SELECT EXISTS (
        (SELECT * FROM current_privileges EXCEPT SELECT * FROM baseline_privileges)
        UNION ALL
        (SELECT * FROM baseline_privileges EXCEPT SELECT * FROM current_privileges)
      )
      INTO public_acl_drifted;

      IF NOT public_acl_drifted THEN
        CONTINUE;
      END IF;

      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON LANGUAGE %I FROM PUBLIC CASCADE',
        trusted_language.lanname
      );

      SELECT string_agg(DISTINCT privilege.privilege_type, ', ' ORDER BY privilege.privilege_type)
      INTO public_privileges
      FROM aclexplode(
        COALESCE(
          (
            SELECT initial_privileges.initprivs
            FROM pg_init_privs initial_privileges
            WHERE initial_privileges.classoid = 'pg_language'::regclass
              AND initial_privileges.objoid = trusted_language.oid
              AND initial_privileges.objsubid = 0
            ORDER BY initial_privileges.privtype
            LIMIT 1
          ),
          CASE
            WHEN trusted_language.oid < 16384
              THEN acldefault('l'::"char", trusted_language.lanowner)
            ELSE NULL::aclitem[]
          END
        )
      ) privilege
      WHERE privilege.grantee = 0;

      IF public_privileges IS NOT NULL THEN
        EXECUTE format(
          'GRANT %s ON LANGUAGE %I TO PUBLIC',
          public_privileges,
          trusted_language.lanname
        );
      END IF;
    END LOOP;
  END
  $xcs_system_type_language_public_privileges$;
`
const PUBLIC_EXTERNAL_OBJECT_PRIVILEGE_PURGE_SQL = `
  DO $xcs_public_external_object_privileges$
  DECLARE
    foreign_data_wrapper record;
    foreign_server record;
    large_object record;
  BEGIN
    FOR foreign_data_wrapper IN
      SELECT wrapper.fdwname
      FROM pg_foreign_data_wrapper wrapper
      WHERE EXISTS (
        SELECT 1 FROM aclexplode(wrapper.fdwacl) privilege WHERE privilege.grantee = 0
      )
    LOOP
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON FOREIGN DATA WRAPPER %I FROM PUBLIC CASCADE',
        foreign_data_wrapper.fdwname
      );
    END LOOP;

    FOR foreign_server IN
      SELECT server_object.srvname
      FROM pg_foreign_server server_object
      WHERE EXISTS (
        SELECT 1 FROM aclexplode(server_object.srvacl) privilege WHERE privilege.grantee = 0
      )
    LOOP
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON FOREIGN SERVER %I FROM PUBLIC CASCADE',
        foreign_server.srvname
      );
    END LOOP;

    FOR large_object IN
      SELECT large_object_metadata.oid
      FROM pg_largeobject_metadata large_object_metadata
      WHERE EXISTS (
        SELECT 1
        FROM aclexplode(large_object_metadata.lomacl) privilege
        WHERE privilege.grantee = 0
      )
    LOOP
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON LARGE OBJECT %s FROM PUBLIC CASCADE',
        large_object.oid
      );
    END LOOP;
  END
  $xcs_public_external_object_privileges$;
`
const PUBLIC_DEFAULT_PRIVILEGE_PURGE_SQL = `
  DO $xcs_public_default_privileges$
  DECLARE
    default_privilege record;
    object_plural text;
  BEGIN
    -- Reverse every explicit per-role PUBLIC default in this database. Global
    -- defaults for future objects created by the administrator are then pinned
    -- below, including the hard-wired PUBLIC defaults for routines and types.
    FOR default_privilege IN
      SELECT DISTINCT
        owner_role.rolname AS owner_name,
        default_acl.defaclobjtype AS object_type,
        default_acl.defaclnamespace AS namespace_oid,
        namespace_object.nspname AS schema_name
      FROM pg_default_acl default_acl
      JOIN pg_roles owner_role ON owner_role.oid = default_acl.defaclrole
      LEFT JOIN pg_namespace namespace_object
        ON namespace_object.oid = default_acl.defaclnamespace
      CROSS JOIN LATERAL aclexplode(default_acl.defaclacl) privilege
      WHERE privilege.grantee = 0
    LOOP
      object_plural := CASE default_privilege.object_type
        WHEN 'r' THEN 'TABLES'
        WHEN 'S' THEN 'SEQUENCES'
        WHEN 'f' THEN 'ROUTINES'
        WHEN 'T' THEN 'TYPES'
        WHEN 'n' THEN 'SCHEMAS'
        WHEN 'L' THEN 'LARGE OBJECTS'
        ELSE NULL
      END;
      IF object_plural IS NULL THEN
        RAISE EXCEPTION USING
          ERRCODE = '42501',
          MESSAGE = 'Unknown PostgreSQL default privilege object type';
      END IF;

      IF default_privilege.namespace_oid = 0 THEN
        EXECUTE format(
          'ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE ALL PRIVILEGES ON %s FROM PUBLIC CASCADE',
          default_privilege.owner_name,
          object_plural
        );
      ELSE
        IF default_privilege.object_type NOT IN ('r', 'S', 'f', 'T')
          OR default_privilege.schema_name IS NULL
        THEN
          RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Invalid per-schema PostgreSQL default privilege';
        END IF;
        EXECUTE format(
          'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I REVOKE ALL PRIVILEGES ON %s FROM PUBLIC CASCADE',
          default_privilege.owner_name,
          default_privilege.schema_name,
          object_plural
        );
      END IF;
    END LOOP;

    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC CASCADE',
      session_user
    );
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC CASCADE',
      session_user
    );
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE ALL PRIVILEGES ON ROUTINES FROM PUBLIC CASCADE',
      session_user
    );
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE ALL PRIVILEGES ON TYPES FROM PUBLIC CASCADE',
      session_user
    );
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE ALL PRIVILEGES ON SCHEMAS FROM PUBLIC CASCADE',
      session_user
    );
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE ALL PRIVILEGES ON LARGE OBJECTS FROM PUBLIC CASCADE',
      session_user
    );

    IF EXISTS (
      SELECT 1
      FROM pg_default_acl default_acl
      CROSS JOIN LATERAL aclexplode(default_acl.defaclacl) privilege
      WHERE privilege.grantee = 0
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '42501',
        MESSAGE = 'PUBLIC PostgreSQL default privileges remain after reconciliation';
    END IF;
  END
  $xcs_public_default_privileges$;
`
const MONITOR_PREDEFINED_ROLE_AUDIT_SQL = `
  DO $xcs_monitor_predefined_role_audit$
  BEGIN
    IF (
      SELECT count(*)
      FROM pg_roles
      WHERE rolname IN (
        'pg_monitor',
        'pg_read_all_settings',
        'pg_read_all_stats',
        'pg_stat_scan_tables'
      )
        AND NOT rolsuper
        AND NOT rolcreaterole
        AND NOT rolcreatedb
        AND NOT rolcanlogin
        AND NOT rolreplication
        AND NOT rolbypassrls
    ) <> 4 THEN
      RAISE EXCEPTION USING
        ERRCODE = '42501',
        MESSAGE = 'PostgreSQL predefined monitoring role attributes have drifted';
    END IF;

    IF (
      SELECT count(*)
      FROM pg_auth_members membership
      JOIN pg_roles granted_role ON granted_role.oid = membership.roleid
      JOIN pg_roles member_role ON member_role.oid = membership.member
      WHERE member_role.rolname IN (
        'pg_monitor',
        'pg_read_all_settings',
        'pg_read_all_stats',
        'pg_stat_scan_tables'
      )
        AND member_role.rolname = 'pg_monitor'
        AND granted_role.rolname IN (
          'pg_read_all_settings',
          'pg_read_all_stats',
          'pg_stat_scan_tables'
        )
        AND NOT membership.admin_option
        AND membership.inherit_option
        AND membership.set_option
    ) <> 3 OR EXISTS (
      SELECT 1
      FROM pg_auth_members membership
      JOIN pg_roles granted_role ON granted_role.oid = membership.roleid
      JOIN pg_roles member_role ON member_role.oid = membership.member
      WHERE member_role.rolname IN (
        'pg_monitor',
        'pg_read_all_settings',
        'pg_read_all_stats',
        'pg_stat_scan_tables'
      )
        AND NOT (
          member_role.rolname = 'pg_monitor'
          AND granted_role.rolname IN (
            'pg_read_all_settings',
            'pg_read_all_stats',
            'pg_stat_scan_tables'
          )
          AND NOT membership.admin_option
          AND membership.inherit_option
          AND membership.set_option
        )
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '42501',
        MESSAGE = 'PostgreSQL predefined monitoring role memberships have drifted';
    END IF;

    IF EXISTS (
      WITH protected_roles AS (
        SELECT oid
        FROM pg_roles
        WHERE rolname IN (
          'pg_monitor',
          'pg_read_all_settings',
          'pg_read_all_stats',
          'pg_stat_scan_tables'
        )
      ),
      current_privileges AS (
        SELECT
          'pg_class'::regclass::oid AS classoid,
          relation.oid AS objoid,
          0::integer AS objsubid,
          privilege.grantee,
          privilege.privilege_type,
          privilege.is_grantable
        FROM pg_class relation
        CROSS JOIN LATERAL aclexplode(relation.relacl) privilege
        WHERE privilege.grantee IN (SELECT oid FROM protected_roles)
        UNION ALL
        SELECT
          'pg_class'::regclass::oid,
          attribute_object.attrelid,
          attribute_object.attnum,
          privilege.grantee,
          privilege.privilege_type,
          privilege.is_grantable
        FROM pg_attribute attribute_object
        CROSS JOIN LATERAL aclexplode(attribute_object.attacl) privilege
        WHERE privilege.grantee IN (SELECT oid FROM protected_roles)
        UNION ALL
        SELECT
          'pg_proc'::regclass::oid,
          routine.oid,
          0::integer,
          privilege.grantee,
          privilege.privilege_type,
          privilege.is_grantable
        FROM pg_proc routine
        CROSS JOIN LATERAL aclexplode(routine.proacl) privilege
        WHERE privilege.grantee IN (SELECT oid FROM protected_roles)
      ),
      initial_privileges AS (
        SELECT
          initial_acl.classoid,
          initial_acl.objoid,
          initial_acl.objsubid,
          privilege.grantee,
          privilege.privilege_type,
          privilege.is_grantable
        FROM pg_init_privs initial_acl
        CROSS JOIN LATERAL aclexplode(initial_acl.initprivs) privilege
        WHERE initial_acl.classoid IN ('pg_class'::regclass, 'pg_proc'::regclass)
          AND privilege.grantee IN (SELECT oid FROM protected_roles)
      ),
      privilege_difference AS (
        (SELECT * FROM current_privileges EXCEPT SELECT * FROM initial_privileges)
        UNION ALL
        (SELECT * FROM initial_privileges EXCEPT SELECT * FROM current_privileges)
      )
      SELECT 1 FROM privilege_difference
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '42501',
        MESSAGE = 'PostgreSQL predefined monitoring role ACLs have drifted';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_shdepend dependency
      JOIN pg_roles referenced_role ON referenced_role.oid = dependency.refobjid
      WHERE dependency.refclassid = 'pg_authid'::regclass
        AND dependency.deptype = 'a'
        AND dependency.dbid IN (0, (SELECT oid FROM pg_database WHERE datname = current_database()))
        AND referenced_role.rolname IN (
          'pg_monitor',
          'pg_read_all_settings',
          'pg_read_all_stats',
          'pg_stat_scan_tables'
        )
        AND dependency.classid NOT IN ('pg_class'::regclass, 'pg_proc'::regclass)
        AND NOT EXISTS (
          SELECT 1
          FROM pg_init_privs initial_acl
          CROSS JOIN LATERAL aclexplode(initial_acl.initprivs) privilege
          WHERE initial_acl.classoid = dependency.classid
            AND initial_acl.objoid = dependency.objid
            AND initial_acl.objsubid = dependency.objsubid
            AND privilege.grantee = referenced_role.oid
        )
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '42501',
        MESSAGE = 'PostgreSQL predefined monitoring role privileges have drifted';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_shdepend dependency
      JOIN pg_roles referenced_role ON referenced_role.oid = dependency.refobjid
      WHERE dependency.refclassid = 'pg_authid'::regclass
        AND dependency.deptype IN ('o', 'r')
        AND referenced_role.rolname IN (
          'pg_monitor',
          'pg_read_all_settings',
          'pg_read_all_stats',
          'pg_stat_scan_tables'
        )
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '42501',
        MESSAGE = 'PostgreSQL predefined monitoring roles must not own objects or target policies';
    END IF;
  END
  $xcs_monitor_predefined_role_audit$;
`
const RUNTIME_ROLE_MEMBERSHIP_PURGE_SQL = `
  DO $xcs_membership_purge$
  DECLARE
    membership record;
  BEGIN
    FOR membership IN
      SELECT
        granted_role.rolname AS granted_role,
        member_role.rolname AS member_role,
        grantor_role.rolname AS grantor_role
      FROM pg_auth_members auth_membership
      JOIN pg_roles granted_role ON granted_role.oid = auth_membership.roleid
      JOIN pg_roles member_role ON member_role.oid = auth_membership.member
      JOIN pg_roles grantor_role ON grantor_role.oid = auth_membership.grantor
      WHERE member_role.rolname IN ('xcs_indexer', 'xcs_api', 'xcs_monitor')
    LOOP
      EXECUTE format(
        'REVOKE %I FROM %I GRANTED BY %I CASCADE',
        membership.granted_role,
        membership.member_role,
        membership.grantor_role
      );
    END LOOP;

    FOR membership IN
      SELECT
        granted_role.rolname AS granted_role,
        member_role.rolname AS member_role,
        grantor_role.rolname AS grantor_role
      FROM pg_auth_members auth_membership
      JOIN pg_roles granted_role ON granted_role.oid = auth_membership.roleid
      JOIN pg_roles member_role ON member_role.oid = auth_membership.member
      JOIN pg_roles grantor_role ON grantor_role.oid = auth_membership.grantor
      WHERE granted_role.rolname IN ('xcs_indexer', 'xcs_api', 'xcs_monitor')
    LOOP
      EXECUTE format(
        'REVOKE %I FROM %I GRANTED BY %I CASCADE',
        membership.granted_role,
        membership.member_role,
        membership.grantor_role
      );
    END LOOP;

    IF EXISTS (
      SELECT 1
      FROM pg_auth_members auth_membership
      JOIN pg_roles granted_role ON granted_role.oid = auth_membership.roleid
      JOIN pg_roles member_role ON member_role.oid = auth_membership.member
      WHERE granted_role.rolname IN ('xcs_indexer', 'xcs_api', 'xcs_monitor')
         OR member_role.rolname IN ('xcs_indexer', 'xcs_api', 'xcs_monitor')
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '42501',
        MESSAGE = 'XCS runtime role memberships remain after quarantine';
    END IF;
  END
  $xcs_membership_purge$;
`

export interface RuntimeDatabasePasswords {
  clusterScope: typeof XCS_DATABASE_CLUSTER_SCOPE
  administratorPassword: string
  indexerPassword: string
  apiPassword: string
  monitorPassword: string
}

export function parseDatabaseClusterScope(
  value: string | undefined,
): typeof XCS_DATABASE_CLUSTER_SCOPE {
  if (value !== XCS_DATABASE_CLUSTER_SCOPE) {
    throw new Error(
      `XCS_DATABASE_CLUSTER_SCOPE must be ${XCS_DATABASE_CLUSTER_SCOPE}; runtime roles are cluster-wide`,
    )
  }
  return value
}

export function databasePasswordFromUrl(databaseUrl: string): string {
  let parsed: URL
  try {
    parsed = new URL(databaseUrl)
  } catch {
    throw new Error('The selected administrator database URL must be a valid PostgreSQL URL')
  }

  if (
    (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') ||
    parsed.username.length === 0 ||
    parsed.password.length === 0
  ) {
    throw new Error('The selected administrator database URL must embed administrator credentials')
  }

  try {
    return decodeURIComponent(parsed.password)
  } catch {
    throw new Error('The selected administrator database URL contains invalid credentials')
  }
}

function assertRuntimePassword(value: string, name: string): void {
  if (!PASSWORD_PATTERN.test(value)) {
    throw new Error(`${name} must be 32-256 URL-safe characters (A-Z, a-z, 0-9, _ or -)`)
  }
}

async function terminateNonAdministratorBackends(
  client: DatabaseClient,
  phase: 'before' | 'after',
): Promise<void> {
  const deadline = Date.now() + 5_000
  while (true) {
    // Signaling is intentionally non-blocking per PID; the bounded cluster-wide
    // post-check below is authoritative and treats an already-exited PID as gone.
    await client.sql`
      SELECT pg_terminate_backend(activity.pid)
      FROM pg_stat_activity activity
      JOIN pg_roles role_object ON role_object.oid = activity.usesysid
      WHERE activity.pid <> pg_backend_pid()
        AND NOT role_object.rolsuper
    `
    const [remaining] = await client.sql<Array<{ count: number }>>`
      SELECT count(*)::integer AS count
      FROM pg_stat_activity activity
      JOIN pg_roles role_object ON role_object.oid = activity.usesysid
      WHERE activity.pid <> pg_backend_pid()
        AND NOT role_object.rolsuper
    `
    if (remaining?.count === 0) return
    if (Date.now() >= deadline) {
      throw new Error(`Non-administrator database sessions remain ${phase} provisioning`)
    }
    await client.sql`SELECT pg_sleep(0.05)`
  }
}

async function runReservedSqlTransaction<T>(
  sql: DatabaseClient['sql'],
  operation: (transactionSql: DatabaseClient['sql']) => Promise<T>,
): Promise<T> {
  // postgres.js reserve() pins one connection but its runtime object does not
  // expose begin(), despite the published TypeScript type inheriting it. Use
  // explicit transaction control so the advisory lock and every mutation stay
  // on that same reserved backend.
  await sql`BEGIN`
  try {
    const result = await operation(sql)
    await sql`COMMIT`
    return result
  } catch (error) {
    try {
      await sql`ROLLBACK`
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        'XCS provisioning failed and its reserved transaction could not be rolled back',
      )
    }
    throw error
  }
}

async function validatedProjectionConstraintDefinitionCount(
  client: DatabaseClient,
): Promise<number> {
  return runReservedSqlTransaction(client.sql, async (sql) => {
    // PostgreSQL deparses both the installed and expected CHECK expressions.
    // Building the expected side in pg_temp avoids duplicating version-sensitive
    // pg_node_tree output while leaving no persistent object behind.
    await sql`
      CREATE TEMP TABLE ledger_checkpoints (
        ledger_index bigint,
        close_time bigint
      ) ON COMMIT DROP
    `
    await sql`
      ALTER TABLE pg_temp.ledger_checkpoints
        ADD CONSTRAINT ledger_checkpoints_index_uint32
          CHECK (ledger_index BETWEEN 0 AND 4294967295),
        ADD CONSTRAINT ledger_checkpoints_close_time_uint32
          CHECK (close_time BETWEEN 0 AND 4294967295)
    `
    await sql`
      CREATE TEMP TABLE schema_events (
        ledger_index bigint
      ) ON COMMIT DROP
    `
    await sql`
      ALTER TABLE pg_temp.schema_events
        ADD CONSTRAINT schema_events_ledger_index_uint32
          CHECK (ledger_index BETWEEN 0 AND 4294967295)
    `
    await sql`
      CREATE TEMP TABLE schemas (
        ledger_index bigint,
        transaction_index integer
      ) ON COMMIT DROP
    `
    await sql`
      ALTER TABLE pg_temp.schemas
        ADD CONSTRAINT schemas_ledger_index_uint32
          CHECK (ledger_index BETWEEN 0 AND 4294967295),
        ADD CONSTRAINT schemas_transaction_index
          CHECK (transaction_index >= 0)
    `
    await sql`
      CREATE TEMP TABLE credential_generations (
        expiration bigint,
        created_ledger_index bigint,
        created_transaction_index integer,
        last_ledger_index bigint,
        deleted_ledger_index bigint
      ) ON COMMIT DROP
    `
    await sql`
      ALTER TABLE pg_temp.credential_generations
        ADD CONSTRAINT credential_generations_expiration_uint32
          CHECK (expiration IS NULL OR expiration BETWEEN 0 AND 4294967295),
        ADD CONSTRAINT credential_generations_created_ledger_uint32
          CHECK (created_ledger_index BETWEEN 0 AND 4294967295),
        ADD CONSTRAINT credential_generations_created_transaction_index
          CHECK (created_transaction_index >= 0),
        ADD CONSTRAINT credential_generations_last_ledger_uint32
          CHECK (last_ledger_index BETWEEN 0 AND 4294967295),
        ADD CONSTRAINT credential_generations_deleted_ledger_uint32
          CHECK (deleted_ledger_index IS NULL OR deleted_ledger_index BETWEEN 0 AND 4294967295),
        ADD CONSTRAINT credential_generations_ledger_order
          CHECK (
            last_ledger_index >= created_ledger_index
            AND (deleted_ledger_index IS NULL OR deleted_ledger_index = last_ledger_index)
          )
    `
    await sql`
      CREATE TEMP TABLE credential_events (
        generation_id text,
        node_index integer,
        ledger_index bigint,
        transaction_index integer,
        expiration bigint
      ) ON COMMIT DROP
    `
    await sql`
      ALTER TABLE pg_temp.credential_events
        ADD CONSTRAINT credential_events_generation_id
          CHECK (generation_id IS NOT NULL),
        ADD CONSTRAINT credential_events_node_index
          CHECK (node_index >= 0),
        ADD CONSTRAINT credential_events_ledger_index_uint32
          CHECK (ledger_index BETWEEN 0 AND 4294967295),
        ADD CONSTRAINT credential_events_transaction_index
          CHECK (transaction_index >= 0),
        ADD CONSTRAINT credential_events_expiration_uint32
          CHECK (expiration IS NULL OR expiration BETWEEN 0 AND 4294967295)
    `

    const [definitionState] = await sql<Array<{ matchingConstraints: number }>>`
      WITH expected_constraints(table_name, constraint_name) AS (
        VALUES
          ('ledger_checkpoints', 'ledger_checkpoints_index_uint32'),
          ('ledger_checkpoints', 'ledger_checkpoints_close_time_uint32'),
          ('schema_events', 'schema_events_ledger_index_uint32'),
          ('schemas', 'schemas_ledger_index_uint32'),
          ('schemas', 'schemas_transaction_index'),
          ('credential_generations', 'credential_generations_expiration_uint32'),
          ('credential_generations', 'credential_generations_created_ledger_uint32'),
          ('credential_generations', 'credential_generations_created_transaction_index'),
          ('credential_generations', 'credential_generations_last_ledger_uint32'),
          ('credential_generations', 'credential_generations_deleted_ledger_uint32'),
          ('credential_generations', 'credential_generations_ledger_order'),
          ('credential_events', 'credential_events_generation_id'),
          ('credential_events', 'credential_events_node_index'),
          ('credential_events', 'credential_events_ledger_index_uint32'),
          ('credential_events', 'credential_events_transaction_index'),
          ('credential_events', 'credential_events_expiration_uint32')
      )
      SELECT count(*)::integer AS "matchingConstraints"
      FROM expected_constraints expected_name
      JOIN pg_class expected_relation
        ON expected_relation.relname = expected_name.table_name
       AND expected_relation.relnamespace = pg_my_temp_schema()
      JOIN pg_constraint expected_constraint
        ON expected_constraint.conrelid = expected_relation.oid
       AND expected_constraint.conname = expected_name.constraint_name
       AND expected_constraint.contype = 'c'
      JOIN pg_namespace actual_namespace ON actual_namespace.nspname = 'public'
      JOIN pg_class actual_relation
        ON actual_relation.relnamespace = actual_namespace.oid
       AND actual_relation.relname = expected_name.table_name
      JOIN pg_constraint actual_constraint
        ON actual_constraint.conrelid = actual_relation.oid
       AND actual_constraint.conname = expected_name.constraint_name
       AND actual_constraint.contype = 'c'
       AND actual_constraint.convalidated
      WHERE pg_get_expr(actual_constraint.conbin, actual_constraint.conrelid, false)
          = pg_get_expr(expected_constraint.conbin, expected_constraint.conrelid, false)
    `
    return definitionState?.matchingConstraints ?? 0
  })
}

async function assertControlDatabaseReady(client: DatabaseClient): Promise<void> {
  const [databaseShape] = await client.sql<
    Array<{
      serverVersion: number
      maxPreparedTransactions: number
      migrationJournalPresent: boolean
      requiredColumns: number
      validatedProjectionConstraints: number
    }>
  >`
    SELECT
      current_setting('server_version_num')::integer AS "serverVersion",
      current_setting('max_prepared_transactions')::integer AS "maxPreparedTransactions",
      to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS "migrationJournalPresent",
      (
        SELECT count(*)::integer
        FROM information_schema.columns column_object
        WHERE (column_object.table_schema, column_object.table_name, column_object.column_name) IN (
          ('public', 'network_profiles', 'profile_id'),
          ('public', 'ledger_checkpoints', 'transaction_root'),
          ('public', 'indexer_status', 'writer_epoch'),
          ('public', 'indexer_incidents', 'writer_epoch'),
          ('public', 'schemas', 'resolved_definition'),
          ('public', 'credential_generations', 'deletion_cause'),
          ('public', 'pin_challenges', 'challenge_id'),
          ('public', 'demo_pins', 'pin_id')
        )
      ) AS "requiredColumns",
      (
        SELECT count(*)::integer
        FROM pg_constraint constraint_object
        JOIN pg_class relation ON relation.oid = constraint_object.conrelid
        JOIN pg_namespace namespace_object ON namespace_object.oid = relation.relnamespace
        WHERE constraint_object.convalidated
          AND (
            namespace_object.nspname,
            relation.relname,
            constraint_object.conname
          ) IN (
            ('public', 'ledger_checkpoints', 'ledger_checkpoints_index_uint32'),
            ('public', 'ledger_checkpoints', 'ledger_checkpoints_close_time_uint32'),
            ('public', 'schema_events', 'schema_events_ledger_index_uint32'),
            ('public', 'schemas', 'schemas_ledger_index_uint32'),
            ('public', 'schemas', 'schemas_transaction_index'),
            ('public', 'credential_generations', 'credential_generations_expiration_uint32'),
            ('public', 'credential_generations', 'credential_generations_created_ledger_uint32'),
            ('public', 'credential_generations', 'credential_generations_created_transaction_index'),
            ('public', 'credential_generations', 'credential_generations_last_ledger_uint32'),
            ('public', 'credential_generations', 'credential_generations_deleted_ledger_uint32'),
            ('public', 'credential_generations', 'credential_generations_ledger_order'),
            ('public', 'credential_events', 'credential_events_generation_id'),
            ('public', 'credential_events', 'credential_events_node_index'),
            ('public', 'credential_events', 'credential_events_ledger_index_uint32'),
            ('public', 'credential_events', 'credential_events_transaction_index'),
            ('public', 'credential_events', 'credential_events_expiration_uint32')
          )
      ) AS "validatedProjectionConstraints"
  `
  if (
    databaseShape === undefined ||
    databaseShape.serverVersion < 180_000 ||
    databaseShape.serverVersion >= 190_000 ||
    databaseShape.maxPreparedTransactions !== 0 ||
    !databaseShape.migrationJournalPresent ||
    databaseShape.requiredColumns !== 8 ||
    databaseShape.validatedProjectionConstraints !== EXPECTED_VALIDATED_PROJECTION_CONSTRAINT_COUNT
  ) {
    throw new Error('XCS provisioning requires a fully migrated PostgreSQL 18 control database')
  }

  const [migrationState] = await client.sql<
    Array<{ migrationCount: number; migrationHistoryMatches: boolean }>
  >`
    WITH expected_migrations(hash, created_at) AS (
      VALUES
        (${EXPECTED_DATABASE_MIGRATIONS[0].hash}, ${EXPECTED_DATABASE_MIGRATIONS[0].createdAt}::bigint),
        (${EXPECTED_DATABASE_MIGRATIONS[1].hash}, ${EXPECTED_DATABASE_MIGRATIONS[1].createdAt}::bigint),
        (${EXPECTED_DATABASE_MIGRATIONS[2].hash}, ${EXPECTED_DATABASE_MIGRATIONS[2].createdAt}::bigint),
        (${EXPECTED_DATABASE_MIGRATIONS[3].hash}, ${EXPECTED_DATABASE_MIGRATIONS[3].createdAt}::bigint),
        (${EXPECTED_DATABASE_MIGRATIONS[4].hash}, ${EXPECTED_DATABASE_MIGRATIONS[4].createdAt}::bigint)
    )
    SELECT
      (SELECT count(*)::integer FROM drizzle.__drizzle_migrations) AS "migrationCount",
      NOT EXISTS (
        (
          SELECT expected_migration.hash, expected_migration.created_at
          FROM expected_migrations expected_migration
          EXCEPT ALL
          SELECT installed_migration.hash, installed_migration.created_at
          FROM drizzle.__drizzle_migrations installed_migration
        )
        UNION ALL
        (
          SELECT installed_migration.hash, installed_migration.created_at
          FROM drizzle.__drizzle_migrations installed_migration
          EXCEPT ALL
          SELECT expected_migration.hash, expected_migration.created_at
          FROM expected_migrations expected_migration
        )
      ) AS "migrationHistoryMatches"
  `
  if (
    migrationState?.migrationCount !== EXPECTED_DATABASE_MIGRATION_COUNT ||
    !migrationState.migrationHistoryMatches
  ) {
    throw new Error(
      `XCS provisioning requires the exact ${EXPECTED_DATABASE_MIGRATION_COUNT}-migration database history`,
    )
  }

  if (
    (await validatedProjectionConstraintDefinitionCount(client)) !==
    EXPECTED_VALIDATED_PROJECTION_CONSTRAINT_COUNT
  ) {
    throw new Error('XCS provisioning requires exact validated projection constraints')
  }
}

interface ProvisionLockHolder {
  pid: number
  isSuperuser: boolean
}

async function provisionLockHolders(client: DatabaseClient): Promise<ProvisionLockHolder[]> {
  return client.sql<ProvisionLockHolder[]>`
    SELECT
      activity.pid,
      role_object.rolsuper AS "isSuperuser"
    FROM pg_locks lock_object
    JOIN pg_stat_activity activity ON activity.pid = lock_object.pid
    JOIN pg_roles role_object ON role_object.oid = activity.usesysid
    WHERE lock_object.locktype = 'advisory'
      AND lock_object.database = (SELECT oid FROM pg_database WHERE datname = current_database())
      AND lock_object.classid = ${PROVISION_LOCK_CLASS_ID}::oid
      AND lock_object.objid = ${PROVISION_LOCK_OBJECT_ID}::oid
      AND lock_object.objsubid = 2
      AND lock_object.granted
  `
}

async function tryAcquireProvisionLock(client: DatabaseClient): Promise<boolean> {
  const [provisionLock] = await client.sql<Array<{ acquired: boolean }>>`
    -- The two-integer advisory namespace is reserved for provisioning. Runtime
    -- roles do not receive any raw advisory-lock function.
    SELECT pg_try_advisory_lock(
      ${PROVISION_LOCK_CLASS_ID},
      ${PROVISION_LOCK_OBJECT_ID}
    ) AS acquired
  `
  return provisionLock?.acquired === true
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
  parseDatabaseClusterScope(passwords.clusterScope)
  assertRuntimePassword(passwords.administratorPassword, 'administrator database password')
  assertRuntimePassword(passwords.indexerPassword, 'XCS_INDEXER_DATABASE_PASSWORD')
  assertRuntimePassword(passwords.apiPassword, 'XCS_API_DATABASE_PASSWORD')
  assertRuntimePassword(passwords.monitorPassword, 'XCS_MONITOR_DATABASE_PASSWORD')
  const distinctPasswords = new Set([
    passwords.administratorPassword,
    passwords.indexerPassword,
    passwords.apiPassword,
    passwords.monitorPassword,
  ])
  if (distinctPasswords.size !== 4) {
    throw new Error('XCS administrator and runtime database passwords must be pairwise distinct')
  }

  const reservedSql = await client.sql.reserve()
  const reservedClient: DatabaseClient = { ...client, sql: reservedSql }
  let provisionLockAcquired = false
  try {
    // Do not let a typo in the admin URL permanently bind an empty or stale
    // database as this cluster's control plane.
    await assertControlDatabaseReady(reservedClient)

    // Advisory locks are scoped to one database. The cluster-wide marker makes
    // the first successfully provisioned database the only valid control plane
    // for every later rotation.
    await runReservedSqlTransaction(reservedSql, async (sql) => {
      await sql.unsafe(CONTROL_DATABASE_MARKER_SQL)
    })

    provisionLockAcquired = await tryAcquireProvisionLock(reservedClient)
    if (!provisionLockAcquired) {
      const holders = await provisionLockHolders(reservedClient)
      if (holders.length === 0 || holders.some((holder) => holder.isSuperuser)) {
        throw new Error('Could not acquire the XCS runtime role provision lock')
      }

      // A non-superuser can hold the reserved key only because of historical
      // privilege drift. Remove every route to raw advisory locks before
      // terminating it, so it cannot reconnect and reacquire the key.
      await runReservedSqlTransaction(reservedSql, async (sql) => {
        await sql.unsafe(RUNTIME_ROLE_QUARANTINE_SQL)
        await sql.unsafe(RUNTIME_ROLE_MEMBERSHIP_PURGE_SQL)
        await sql.unsafe(ADVISORY_LOCK_PRIVILEGE_PURGE_SQL)
      })
      await terminateNonAdministratorBackends(reservedClient, 'before')
      provisionLockAcquired = await tryAcquireProvisionLock(reservedClient)
      if (!provisionLockAcquired) {
        throw new Error('Could not acquire the XCS runtime role provision lock after quarantine')
      }
    }

    await runReservedSqlTransaction(reservedSql, async (sql) => {
      await sql.unsafe(RUNTIME_ROLE_QUARANTINE_SQL)
      await sql.unsafe(RUNTIME_ROLE_MEMBERSHIP_PURGE_SQL)
      await sql.unsafe(ADVISORY_LOCK_PRIVILEGE_PURGE_SQL)
    })
    await terminateNonAdministratorBackends(reservedClient, 'after')

    await runReservedSqlTransaction(reservedSql, async (sql) => {
      await sql`SELECT set_config('password_encryption', 'scram-sha-256', true)`
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
      await sql`SELECT set_config(
      'xcs.bootstrap.monitor_password',
      ${passwords.monitorPassword},
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
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'xcs_monitor') THEN
          EXECUTE 'CREATE ROLE xcs_monitor LOGIN';
        END IF;

        -- Roles are NOLOGIN and every non-admin backend has been terminated,
        -- so this final membership purge cannot be bypassed by a stale runtime
        -- session retaining SET ROLE or ADMIN OPTION state.
        FOR membership IN
          SELECT
            granted_role.rolname AS granted_role,
            member_role.rolname AS member_role,
            grantor_role.rolname AS grantor_role
          FROM pg_auth_members auth_membership
          JOIN pg_roles granted_role ON granted_role.oid = auth_membership.roleid
          JOIN pg_roles member_role ON member_role.oid = auth_membership.member
          JOIN pg_roles grantor_role ON grantor_role.oid = auth_membership.grantor
          WHERE member_role.rolname IN ('xcs_indexer', 'xcs_api', 'xcs_monitor')
        LOOP
          EXECUTE format(
            'REVOKE %I FROM %I GRANTED BY %I CASCADE',
            membership.granted_role,
            membership.member_role,
            membership.grantor_role
          );
        END LOOP;

        FOR membership IN
          SELECT
            granted_role.rolname AS granted_role,
            member_role.rolname AS member_role,
            grantor_role.rolname AS grantor_role
          FROM pg_auth_members auth_membership
          JOIN pg_roles granted_role ON granted_role.oid = auth_membership.roleid
          JOIN pg_roles member_role ON member_role.oid = auth_membership.member
          JOIN pg_roles grantor_role ON grantor_role.oid = auth_membership.grantor
          WHERE granted_role.rolname IN ('xcs_indexer', 'xcs_api', 'xcs_monitor')
        LOOP
          EXECUTE format(
            'REVOKE %I FROM %I GRANTED BY %I CASCADE',
            membership.granted_role,
            membership.member_role,
            membership.grantor_role
          );
        END LOOP;

        IF EXISTS (
          SELECT 1
          FROM pg_auth_members auth_membership
          JOIN pg_roles granted_role ON granted_role.oid = auth_membership.roleid
          JOIN pg_roles member_role ON member_role.oid = auth_membership.member
          WHERE granted_role.rolname IN ('xcs_indexer', 'xcs_api', 'xcs_monitor')
             OR member_role.rolname IN ('xcs_indexer', 'xcs_api', 'xcs_monitor')
        ) THEN
          RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'XCS runtime role memberships remain after quarantine';
        END IF;

        IF EXISTS (
          SELECT 1
          FROM pg_shdepend ownership_dependency
          JOIN pg_roles owner_role ON owner_role.oid = ownership_dependency.refobjid
          WHERE ownership_dependency.refclassid = 'pg_authid'::regclass
            AND ownership_dependency.deptype = 'o'
            -- A role owns its pg_default_acl row by construction. DROP OWNED
            -- below removes it; every other owned object is a fail-closed drift.
            AND ownership_dependency.classid <> 'pg_default_acl'::regclass
            AND owner_role.rolname IN ('xcs_indexer', 'xcs_api', 'xcs_monitor')
        ) THEN
          RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'XCS runtime roles must not own database objects';
        END IF;

        -- PostgreSQL 18 DROP OWNED is the exhaustive ACL primitive: after the
        -- ownership guard it can safely remove table/column, schema, routine,
        -- type, language, FDW/server, Large Object, default, database,
        -- tablespace and parameter privileges, including delegated grants.
        EXECUTE 'DROP OWNED BY xcs_indexer, xcs_api, xcs_monitor CASCADE';

        IF EXISTS (
          SELECT 1
          FROM pg_shdepend dependency
          JOIN pg_roles referenced_role ON referenced_role.oid = dependency.refobjid
          WHERE dependency.refclassid = 'pg_authid'::regclass
            AND dependency.deptype IN ('o', 'a', 'i', 'r')
            AND referenced_role.rolname IN ('xcs_indexer', 'xcs_api', 'xcs_monitor')
        ) THEN
          RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'XCS runtime role dependencies remain outside the control database';
        END IF;

        -- LOGIN remains disabled until every ACL/password change has committed
        -- and the last stale backend has been terminated.
        EXECUTE 'ALTER ROLE xcs_indexer WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT ${XCS_INDEXER_DATABASE_CONNECTION_LIMIT} VALID UNTIL ''infinity''';
        EXECUTE 'ALTER ROLE xcs_api WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT ${XCS_API_DATABASE_CONNECTION_LIMIT} VALID UNTIL ''infinity''';
        -- xcs_monitor inherits only the predefined pg_monitor capability
        -- granted below; it receives no application schema privileges.
        EXECUTE 'ALTER ROLE xcs_monitor WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT ${XCS_MONITOR_DATABASE_CONNECTION_LIMIT} VALID UNTIL ''infinity''';
        EXECUTE 'ALTER ROLE xcs_indexer RESET ALL';
        EXECUTE 'ALTER ROLE xcs_api RESET ALL';
        EXECUTE 'ALTER ROLE xcs_monitor RESET ALL';

        FOR runtime_schema IN
          SELECT nspname
          FROM pg_namespace
          WHERE nspname !~ '^pg_'
            AND nspname <> 'information_schema'
        LOOP
          EXECUTE format(
            'REVOKE ALL PRIVILEGES ON SCHEMA %I FROM PUBLIC, xcs_indexer, xcs_api, xcs_monitor',
            runtime_schema.nspname
          );
          EXECUTE format(
            'REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA %I FROM PUBLIC, xcs_indexer, xcs_api, xcs_monitor',
            runtime_schema.nspname
          );
          EXECUTE format(
            'REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA %I FROM PUBLIC, xcs_indexer, xcs_api, xcs_monitor',
            runtime_schema.nspname
          );
          EXECUTE format(
            'REVOKE ALL PRIVILEGES ON ALL ROUTINES IN SCHEMA %I FROM PUBLIC, xcs_indexer, xcs_api, xcs_monitor',
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
        EXECUTE format(
          'ALTER ROLE xcs_monitor PASSWORD %L',
          current_setting('xcs.bootstrap.monitor_password')
        );

        IF (
          SELECT count(*)
          FROM pg_authid role_object
          WHERE role_object.rolname IN ('xcs_indexer', 'xcs_api', 'xcs_monitor')
            AND role_object.rolpassword LIKE 'SCRAM-SHA-256$%'
        ) <> 3 THEN
          RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'XCS runtime role passwords must use SCRAM-SHA-256 verifiers';
        END IF;

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
      REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM xcs_monitor;
      REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM xcs_monitor;
      REVOKE ALL PRIVILEGES ON ALL ROUTINES IN SCHEMA public FROM xcs_monitor;

      -- Table-level REVOKE does not clear separately granted column ACLs.
      -- Remove every explicit PUBLIC column grant in the control database, and normalize
      -- the password-bearing catalog whose built-in default is no PUBLIC ACL.
      ${PUBLIC_COLUMN_PRIVILEGE_PURGE_SQL}
      ${SYSTEM_RELATION_PUBLIC_PRIVILEGE_NORMALIZATION_SQL}
      REVOKE ALL PRIVILEGES ON TABLE pg_catalog.pg_authid FROM PUBLIC CASCADE;
      ${SYSTEM_ROUTINE_PUBLIC_PRIVILEGE_NORMALIZATION_SQL}
      ${SYSTEM_TYPE_AND_LANGUAGE_PUBLIC_PRIVILEGE_NORMALIZATION_SQL}
      ${PUBLIC_EXTERNAL_OBJECT_PRIVILEGE_PURGE_SQL}

      -- PostgreSQL grants EXECUTE on functions to PUBLIC by default. Runtime
      -- roles do not use Large Objects, so remove every server-side LO entry
      -- point, including creation and write primitives that could fill disk.
      DO $xcs_large_object_functions$
      DECLARE
        large_object_function record;
      BEGIN
        FOR large_object_function IN
          SELECT routine.oid::regprocedure::text AS signature
          FROM pg_proc routine
          JOIN pg_namespace namespace_object ON namespace_object.oid = routine.pronamespace
          WHERE namespace_object.nspname = 'pg_catalog'
            AND routine.proname IN (
              'lo_close',
              'lo_creat',
              'lo_create',
              'lo_export',
              'lo_from_bytea',
              'lo_get',
              'lo_import',
              'lo_lseek',
              'lo_lseek64',
              'lo_open',
              'lo_put',
              'lo_tell',
              'lo_tell64',
              'lo_truncate',
              'lo_truncate64',
              'lo_unlink',
              'loread',
              'lowrite'
            )
        LOOP
          EXECUTE format(
            'REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, xcs_indexer, xcs_api, xcs_monitor',
            large_object_function.signature
          );
        END LOOP;
      END
      $xcs_large_object_functions$;

      ${ADVISORY_LOCK_PRIVILEGE_PURGE_SQL}
      ${SIDE_EFFECT_FUNCTION_PRIVILEGE_PURGE_SQL}

      DO $xcs_public_shared_privileges$
      DECLARE
        parameter_object record;
        tablespace_object record;
      BEGIN
        FOR parameter_object IN SELECT parname FROM pg_parameter_acl
        LOOP
          EXECUTE format(
            'REVOKE ALL PRIVILEGES ON PARAMETER %I FROM PUBLIC CASCADE',
            parameter_object.parname
          );
        END LOOP;
        FOR tablespace_object IN SELECT spcname FROM pg_tablespace
        LOOP
          EXECUTE format(
            'REVOKE ALL PRIVILEGES ON TABLESPACE %I FROM PUBLIC CASCADE',
            tablespace_object.spcname
          );
        END LOOP;
      END
      $xcs_public_shared_privileges$;

      ${PUBLIC_DEFAULT_PRIVILEGE_PURGE_SQL}

      DO $xcs_database_grants$
      DECLARE
        runtime_database record;
        untrusted_role record;
      BEGIN
        EXECUTE format(
          'ALTER ROLE xcs_indexer IN DATABASE %I RESET ALL',
          current_database()
        );
        EXECUTE format(
          'ALTER ROLE xcs_api IN DATABASE %I RESET ALL',
          current_database()
        );
        EXECUTE format(
          'ALTER ROLE xcs_monitor IN DATABASE %I RESET ALL',
          current_database()
        );
        -- Runtime LOGIN roles are cluster-wide. This provisioner is therefore
        -- restricted to a dedicated XCS cluster and closes every existing
        -- database before granting access back to the current projection DB.
        FOR runtime_database IN SELECT datname FROM pg_database
        LOOP
          EXECUTE format(
            'ALTER ROLE xcs_indexer IN DATABASE %I RESET ALL',
            runtime_database.datname
          );
          EXECUTE format(
            'ALTER ROLE xcs_api IN DATABASE %I RESET ALL',
            runtime_database.datname
          );
          EXECUTE format(
            'ALTER ROLE xcs_monitor IN DATABASE %I RESET ALL',
            runtime_database.datname
          );
          EXECUTE format(
            'REVOKE ALL PRIVILEGES ON DATABASE %I FROM PUBLIC CASCADE',
            runtime_database.datname
          );
          FOR untrusted_role IN
            SELECT rolname
            FROM pg_roles
            WHERE NOT rolsuper
          LOOP
            EXECUTE format(
              'REVOKE ALL PRIVILEGES ON DATABASE %I FROM %I CASCADE',
              runtime_database.datname,
              untrusted_role.rolname
            );
          END LOOP;
        END LOOP;
        EXECUTE format(
          'GRANT CONNECT ON DATABASE %I TO xcs_indexer, xcs_api, xcs_monitor',
          current_database()
        );
      END
      $xcs_database_grants$;

      ALTER ROLE xcs_indexer SET statement_timeout = '5min';
      ALTER ROLE xcs_indexer SET lock_timeout = '30s';
      ALTER ROLE xcs_indexer SET idle_in_transaction_session_timeout = '30s';
      ALTER ROLE xcs_api SET statement_timeout = '30s';
      ALTER ROLE xcs_api SET lock_timeout = '15s';
      ALTER ROLE xcs_api SET idle_in_transaction_session_timeout = '30s';
      ALTER ROLE xcs_monitor SET statement_timeout = '30s';
      ALTER ROLE xcs_monitor SET lock_timeout = '10s';
      ALTER ROLE xcs_monitor SET idle_in_transaction_session_timeout = '30s';

      ${MONITOR_PREDEFINED_ROLE_AUDIT_SQL}

      GRANT USAGE ON SCHEMA public TO xcs_indexer, xcs_api;
      GRANT pg_monitor TO xcs_monitor WITH INHERIT TRUE, SET FALSE;

      GRANT SELECT, INSERT ON TABLE
        network_profiles,
        ledger_checkpoints,
        schema_events,
        schemas,
        credential_events
      TO xcs_indexer;

      GRANT SELECT, INSERT ON TABLE
        indexer_status,
        credential_generations
      TO xcs_indexer;

      GRANT UPDATE (
        state,
        primary_source_tip,
        secondary_source_tip,
        last_agreed_ledger_index,
        last_agreed_ledger_hash,
        error_code,
        writer_id,
        writer_epoch,
        lease_expires_at,
        updated_at
      ) ON TABLE indexer_status TO xcs_indexer;

      GRANT UPDATE (
        accepted,
        last_ledger_index,
        deleted_ledger_index,
        deletion_cause,
        updated_at
      ) ON TABLE credential_generations TO xcs_indexer;

      GRANT SELECT, INSERT ON TABLE
        indexer_incidents
      TO xcs_indexer;

      GRANT SELECT ON TABLE
        network_profiles,
        ledger_checkpoints,
        indexer_status,
        indexer_incidents,
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

    // Passwords and ACLs are committed while every runtime remains NOLOGIN.
    // Remove any backend that retained a formerly delegated current_role, then
    // enable only the three reconciled roles in the final atomic step.
    await terminateNonAdministratorBackends(reservedClient, 'after')
    await runReservedSqlTransaction(reservedSql, async (sql) => {
      await sql.unsafe(`
        ALTER ROLE xcs_indexer LOGIN;
        ALTER ROLE xcs_api LOGIN;
        ALTER ROLE xcs_monitor LOGIN;
      `)
    })
  } finally {
    try {
      if (provisionLockAcquired) {
        await reservedSql`
          SELECT pg_advisory_unlock(
            ${PROVISION_LOCK_CLASS_ID},
            ${PROVISION_LOCK_OBJECT_ID}
          )
        `
      }
    } finally {
      reservedSql.release()
    }
  }
}
