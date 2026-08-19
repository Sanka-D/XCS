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

1. Copy `.env.example` to `.env` and replace the local PostgreSQL password.
2. Complete and independently audit the registry blackhole ceremony described in
   `config/networks/README.md`.
3. Save the immutable result as `config/networks/testnet.json`. Do not edit that file after indexing
   starts; a Testnet reset requires a new profile ID and database history.
4. Set `XCS_PUBLIC_API_BASE_URL` and `XCS_ALLOWED_ORIGINS` to the browser-visible HTTPS origins when
   deploying behind a reverse proxy. The Compose web service uses `http://api:3001` separately for
   server-side rendering, so the public URL is never reused for container-to-container traffic.
5. Keep `XCS_BIND_ADDRESS=127.0.0.1` unless a firewall and authenticated administration boundary
   explicitly protect the exposed services.

Validate the rendered configuration, then build and start the stack:

```sh
docker compose config
docker compose up --build
```

The one-shot `migrate` service applies the create-only migration to the fresh XCS database before the
API and indexer start. The API is live at `/health/live`, but `/health/ready` stays unavailable until
at least one validated ledger checkpoint exists. `XCS_READINESS_MAX_LEDGER_AGE_SECONDS` controls both
readiness and the freshness guard on exact Credential state and `/v1/verify`; stale or implausibly
future checkpoints return `503` instead of an authoritative-looking result. OpenAPI documentation is
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
- `docker compose down` preserves named volumes. Removing volumes destroys the local projection and
  pin store and is intentionally not part of this runbook.
