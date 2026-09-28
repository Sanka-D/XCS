-- Local development only. Mounted read-only into the Compose `postgres` service
-- at /docker-entrypoint-initdb.d and run once, when the data directory is first
-- initialised. It is never applied to a deployed database.
--
-- In a deployment the three runtime users are created by the managed database
-- service (DigitalOcean's control panel, `doctl` or its API), which generates
-- and stores their passwords. The `db-bootstrap` step is grants-only: it never
-- creates a role and never sets a password, so the local Compose cluster has to
-- supply the roles itself.
--
-- The passwords below are fixed, published literals that say so in their own
-- text. They are NOT secrets, they must never be used anywhere but this local
-- stack, and docker-compose.yml hardcodes the very same literals in the
-- connection URLs it composes.

CREATE ROLE xcs_indexer LOGIN PASSWORD 'local-development-only-not-a-secret-indexer';
CREATE ROLE xcs_api LOGIN PASSWORD 'local-development-only-not-a-secret-api';
CREATE ROLE xcs_monitor LOGIN PASSWORD 'local-development-only-not-a-secret-monitor';
