# Self-hosted Testnet deployment

The Compose stack is an alpha deployment template. It binds every published port to loopback by
default and refuses to index with the placeholder network profile.

## Required preparation

### Replacing the legacy `XRPL-Commons/xcs` MVP

The migration in `packages/db/drizzle/0000_initial.sql` is the initial schema for the new XCS
indexer projection. It is **not** an in-place upgrade from the former root-level Nuxt/Drizzle MVP:
both schemas define `public.schemas` with incompatible keys and columns, and the legacy application
also owns a different `credentials` table. Never run the new migration against a PostgreSQL database
or Compose volume previously used by that application.

For a replacement deployment:

1. Stop writes to the legacy application and take a verified `pg_dump` backup of its database.
2. Keep that database and its volume untouched for rollback.
3. Deploy this implementation against a new, empty PostgreSQL database or volume.
4. Rebuild the on-chain projection from the audited XCS activation boundary with the indexer.
5. Treat any legacy off-chain credential export as a separate, reviewed data-migration project. This
   repository does not provide or claim a compatible backfill.

Rollback means restoring the former application against its untouched legacy database; do not point
an older application at the new projection schema.

### PostgreSQL 18 volume layout and recovery

The PostgreSQL 18 image keeps `PGDATA` in a versioned directory below `/var/lib/postgresql`. The
named Compose volume must therefore be mounted at `/var/lib/postgresql`, not at the pre-18 path
`/var/lib/postgresql/data`. With the old child mount, the live cluster may be stored in a separate
anonymous parent volume while the named volume is unused. Changing the mount without first locating
and backing up that cluster can make intact data appear to have disappeared.

Before recreating a PostgreSQL 18 container that ever used the old mount:

1. Stop application writes and record both the active data directory and mount destinations. The
   formatted inspection command prints mount names and paths only; it does not print container
   environment variables.

   ```sh
   docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SHOW data_directory"'
   docker inspect --format '{{range .Mounts}}{{println .Name .Destination}}{{end}}' "$(docker compose ps -q postgres)"
   ```

2. While the old container still runs, make and inspect a logical, data-only backup on the host.

   ```sh
   docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --data-only --no-owner --no-privileges' > xcs-before-pg18-volume.dump
   docker compose exec -T postgres pg_restore --list < xcs-before-pg18-volume.dump
   ```

3. Stop the stack. Do not run `docker compose down -v`, `docker volume rm`, or
   `docker volume prune`; keep every named and anonymous volume until restoration has been verified.

   ```sh
   docker compose stop web api indexer postgres
   ```

4. With the corrected parent mount, initialize PostgreSQL, apply the same XCS migrations, restore
   the data with the admin identity, then re-run role provisioning.

   ```sh
   docker compose up -d --wait postgres
   docker compose run --rm migrate
   docker compose exec -T postgres sh -c 'pg_restore --exit-on-error --single-transaction --data-only --no-owner --no-privileges -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < xcs-before-pg18-volume.dump
   docker compose run --rm provision
   ```

This logical restore procedure is only for the same XCS schema. It is not a migration from the
legacy MVP described above, and a raw PostgreSQL data directory must never be copied across major
versions. For projection-only data, a bounded ledger replay is an alternative; preserve optional
pinning rows separately because they are not reconstructable from XRPL.

### PostgreSQL identities and provisioning

The reference deployment separates schema ownership from runtime access:

| Identity      | Use                                                 | Database rights                                                        |
| ------------- | --------------------------------------------------- | ---------------------------------------------------------------------- |
| `xcs_admin`   | Compose bootstrap, migrations and role provisioning | Schema/DDL and role administration; never used by a runtime service    |
| `xcs_indexer` | Indexer and maintenance replay                      | `SELECT`, `INSERT`, and `UPDATE` on ledger projection tables only      |
| `xcs_api`     | Read API and optional Testnet pinning               | `SELECT` on projections; CRUD on `pin_challenges` and `demo_pins` only |

Both runtime roles are denied schema creation, and `CREATE` on `public` is revoked from `PUBLIC`.
Migration uses `XCS_MIGRATOR_DATABASE_URL`; the indexer uses `XCS_INDEXER_DATABASE_URL`; the API uses
`XCS_DATABASE_URL`. Give the three identities distinct, long URL-safe passwords. Do not expose the
admin URL to API or indexer containers.

After every migration, run the idempotent provisioner before starting runtime services:

```sh
pnpm --filter @xcs-protocol/db db:migrate
pnpm --filter @xcs-protocol/db db:provision
```

Provisioning creates missing runtime roles, reapplies their exact grants and rotates their supplied
passwords. It reports role names or a stable failure code, never URLs or password values. The Compose
dependency chain performs `migrate` then `provision` automatically.

### Deployment configuration

1. Copy `.env.example` to `.env` and replace all three local PostgreSQL passwords.
2. Complete and independently audit the registry blackhole ceremony described in
   `config/networks/README.md`.
3. Save the immutable result as `config/networks/testnet.json`. Do not edit that file after indexing
   starts; a Testnet reset requires a new profile ID and database history.
4. Set `XCS_PUBLIC_API_BASE_URL` and `XCS_ALLOWED_ORIGINS` to the browser-visible HTTPS origins when
   deploying behind a reverse proxy. The Compose web service uses `http://api:3001` separately for
   server-side rendering, so the public URL is never reused for container-to-container traffic.
5. Keep `XCS_BIND_ADDRESS=127.0.0.1` unless a firewall and authenticated administration boundary
   explicitly protect the exposed services.
6. Set `XCS_RPC_URL_PRIMARY` and `XCS_RPC_URL_SECONDARY` to distinct WSS endpoints from independently
   operated, complete-history `rippled` providers. Distinct URLs alone are not evidence of independent
   operation; record the operators in the deployment review. Plain `ws://` is accepted only on a
   loopback address for local development.
7. Set `XCS_PUBLIC_RPC_URL` to a browser-reachable public WSS endpoint without embedded credentials.
   This endpoint is visible in client JavaScript and is used for wallet submission only. Never put a
   private or credential-bearing indexer endpoint in this variable: the server-only quorum
   configuration is the indexer's source of authoritative ledger evidence. Reusing the same URL is
   acceptable only when that endpoint is genuinely public and contains no secret; it remains a
   separate, non-authoritative browser setting. The web server rejects userinfo and non-TLS public
   endpoints at startup (`ws://` is loopback-only), but it cannot determine whether an opaque path or
   query parameter is a provider secret.
8. Keep `XCS_INDEXER_LEASE_DURATION_MS` between 10 seconds and 5 minutes and at least three times the
   polling interval. Run `pnpm --filter @xcs-protocol/indexer preflight` before enabling the service.

Validate the rendered configuration, then build and start the stack:

```sh
docker compose config --quiet
docker compose up --build
```

Use `config --quiet` because the fully rendered Compose configuration contains interpolated
passwords and RPC URLs. The one-shot `migrate` service applies migrations with `xcs_admin`, then the
one-shot `provision` service establishes runtime grants before the API and indexer start. The API is
live at `/health/live`, but `/health/ready` stays unavailable until the dual-source indexer owns a
live lease and its status exactly matches a transaction-root-bearing checkpoint at the effective
tip. `XCS_READINESS_MAX_LEDGER_AGE_SECONDS` controls readiness and all authoritative ledger-derived
routes; stale, inconsistent, or implausibly future evidence returns `503`. OpenAPI documentation is
served at `/documentation`.

## Optional Testnet demo pinning

Pinning is disabled by default. It is only intended for public, non-sensitive Testnet examples. To
enable it, set all of the following:

```dotenv
XCS_DEMO_PINNING_ENABLED=true
XCS_PINNING_NETWORKS=<exact-profile-id>
XCS_PINNING_IP_HASH_SECRET=<at-least-32-random-bytes>
XCS_IPFS_API_URL=http://ipfs:5001
```

Then include the isolated Kubo service:

```sh
docker compose --profile demo-pinning up --build
```

If server-side verification should read from that local node, also set
`XCS_PAYLOAD_FETCH_ENABLED=true` and `XCS_IPFS_GATEWAY_URL=http://ipfs:8080`. The wallet challenge,
per-wallet/IP quotas, 64 KiB demo limit, 90-day retention, and cleanup job reduce abuse; they cannot
detect all personal data. Never pin PII, secrets, or production credentials.

## Operations and rollback

- Back up PostgreSQL and the exact network profile together. Kubo blocks are reconstructable only
  while their source payload still exists.
- Monitor checkpoint age, rejected registrations, ledger continuity failures, pin-store failures,
  and disk usage.
- Roll back application images only to a version compatible with the applied schema. Database
  changes are forward-fixed; do not manually skip a migration or ledger.
- Re-run `provision` after a migration or runtime-password rotation. Keep `xcs_admin` credentials out
  of runtime containers and logs.
- `docker compose down` preserves named volumes. Removing volumes destroys the local projection and
  pin store and is intentionally not part of this runbook.
