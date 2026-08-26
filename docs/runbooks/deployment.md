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

### Migration 0002: discovery indexes

`0002_discovery_indexes.sql` is additive. It creates four indexes over existing projection rows and
does not add tables, columns, constraints or backfilled application data:

- `schema_events_activity_idx` supports the reverse-chronological schema-registration activity page;
- `schemas_order_idx` supports stable schema pagination;
- `schemas_search_idx` is a PostgreSQL GIN expression index for schema name and description search;
- `credential_generations_stats_idx` supports aggregate lifecycle counts.

Existing API and indexer versions ignore these indexes, so an application rollback does not require
a database rollback. On an existing populated database, regular `CREATE INDEX` can block concurrent
writes while each index is built; schedule the migration before exposing the discovery routes and
monitor the indexer's writer lease and lag. Run `db:migrate`, then the standard `db:provision`, then
deploy the API and web application. A fresh install receives the same migration through the normal
sequence. If the application must be rolled back, retain the indexes and forward-fix any database
issue instead of dropping them during the incident.

### Deployment configuration

1. Copy `.env.example` to `.env`, replace all three local PostgreSQL passwords, and generate a
   distinct `XCS_INTERNAL_API_TOKEN` with at least 32 URL-safe random characters. Compose passes it
   privately to the API and Nuxt SSR process; never reuse a database/RPC secret or expose it through
   a `NUXT_PUBLIC_*` variable. It authenticates only the deterministic, network-derived SSR
   rate-limit key—the public API remains unauthenticated and direct browser calls remain IP-limited.
2. Complete and independently audit the registry blackhole ceremony described in
   `config/networks/README.md`.
3. Save the immutable result as `config/networks/testnet.json`. Do not edit that file after indexing
   starts; a Testnet reset requires a new profile ID and database history.
4. Set `XCS_PUBLIC_API_BASE_URL` and `XCS_ALLOWED_ORIGINS` to the browser-visible HTTPS origins when
   deploying behind a reverse proxy. The Compose web service uses `http://api:3001` separately for
   server-side rendering, so the public URL is never reused for container-to-container traffic.
   Configure the proxy to discard incoming forwarding headers and write its own canonical client
   address, then set `XCS_TRUSTED_PROXY_CIDRS` to that proxy's exact, narrow IP/CIDR. Compose applies
   this list to the API and Nuxt SSR resolver. Leave it empty for direct exposure; never use a
   wildcard, a catch-all `/0`, or trust arbitrary `X-Forwarded-For` values. An undeclared proxy is
   safe but collapses its visitors into the proxy's shared rate-limit budget.
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

For the Commons-hosted Testnet beta, also enforce the product boundary from
[`ADR 0002`](../adr/0002-public-product-and-discovery.md):

- leave `XCS_TRUSTED_ISSUERS` and `XCS_UNTRUSTED_ISSUERS` empty so Commons publishes no trust badge
  or issuer allowlist decision;
- keep `XCS_PAYLOAD_FETCH_ENABLED=false`; the browser retrieves issuer-hosted HTTPS payloads only
  after consent and sends parsed content for validation without API-side resolution;
- keep `XCS_DEMO_PINNING_ENABLED=false`; the issuer, not Commons, operates the public HTTPS payload
  host;
- do not add a subject feed, account-wide Credential export or claims ingestion to the deployment.

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

### Browser security-header rollout

Nitro is the source of truth for the web application's browser security headers. The initial
deployment emits the CSP as `Content-Security-Policy-Report-Only`; it must not emit an enforced
`Content-Security-Policy` until the released Crossmark and GemWallet versions have passed the real
browser matrix below. Report-only violations are diagnostic and do not block script execution,
wallet communication or payload requests.

The TLS response also emits `Strict-Transport-Security` for the current host without
`includeSubDomains` or `preload`. Do not add either directive until every affected organizational
subdomain is inventoried and a separate rollout and recovery decision has been reviewed.

The ingress or CDN must not append a second CSP to Nitro's response. Configure it to overwrite any
inherited security-policy value with the reviewed XCS value, or to pass Nitro's value through
unchanged, so the browser receives exactly one report-only policy during observation and exactly one
enforced policy after promotion. Multiple CSP fields are all applied by browsers and can intersect
into an untested, unexpectedly restrictive policy. Apply the same single-value rule to HSTS.

Nitro marks every rendered HTML response, including error documents, as `Cache-Control: private,
no-store`. Configure the ingress and CDN to bypass their HTML cache and preserve this value: caching
would reuse a response-bound nonce across clients. Fingerprinted `/_nuxt/` assets must retain their
`public, max-age=31536000, immutable` policy.

The policy intentionally permits `https:` in `connect-src`. Credential payload hosts are selected
permissionlessly by issuers and cannot be enumerated in a Commons deployment allowlist without
changing the product model. This directive does not trigger a fetch: the application must still
display the exact host, obtain consent, re-read the exact generation, and validate the
integrity-bound response. Keep the separately configured public XRPL WebSocket origin permitted for
wallet submission.

Do not configure `report-uri`, `report-to`, `Reporting-Endpoints` or a third-party CSP reporting
service during this rollout. Violation reports can disclose exact Credential URLs, issuer hosts and
browsing context. Operators inspect violations locally in browser DevTools; adding collection,
retention or forwarding requires a separate privacy and threat-model review.

For every candidate web image, first confirm the headers on the public HTTPS origin and on a
representative localized route:

```sh
curl --fail --silent --show-error --dump-header - --output /dev/null https://xcs.example/
curl --fail --silent --show-error --dump-header - --output /dev/null https://xcs.example/studio
```

Verify in the output that there is exactly one `Content-Security-Policy-Report-Only`, no
`Content-Security-Policy`, and one `Strict-Transport-Security` value without `includeSubDomains` or
`preload`. Both HTML responses must also contain `Cache-Control: private, no-store`; a sampled
fingerprinted `/_nuxt/` asset must remain `public, max-age=31536000, immutable`. Then use a clean
Chromium profile with DevTools open:

1. Load Explorer, Studio, Developers and an exact Credential permalink; record every CSP violation
   from the Console and the document's response headers from the Network panel.
2. With the released Crossmark version, exercise connect, cancellation, schema registration,
   `CredentialCreate`, `CredentialAccept` and `CredentialDelete` without relaxing the policy.
3. Repeat the same matrix with the released GemWallet version.
4. After explicit payload-host consent, load an issuer-hosted HTTPS payload with CORS and confirm
   that its integrity verification succeeds. Confirm that no payload request occurs before consent.

Classify and fix every application-owned violation. Record the browser, extension, adapter, web
image and policy versions with the evidence. Extension-origin messages that cannot be attributed or
reproduced are not a reason to add a broad source expression.

Only after both real-wallet matrices pass may the reviewed deployment replace the single
`Content-Security-Policy-Report-Only` field with the same policy under
`Content-Security-Policy`. Re-run both `curl` checks and the DevTools matrix against the enforced
candidate before promotion. Roll back to the prior image, which restores report-only mode, if a
wallet or consented payload flow regresses; do not work around an incident by appending a second or
weaker policy at the edge.

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
