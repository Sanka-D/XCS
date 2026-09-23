# Testing

Run focused checks while editing:

```bash
pnpm --filter @xcs-protocol/core test
pnpm --filter @xcs-protocol/sdk test
pnpm --filter @xcs-protocol/cli test
pnpm --filter @xcs-protocol/indexer test
pnpm --filter @xcs-protocol/web test
```

Every package also provides `typecheck` and `build`. Before merging a cross-package change, run:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Integration tiers

1. Unit tests need no network or database. The database migration integration file is skipped
   without `XCS_TEST_DATABASE_URL`; `test:postgres` makes that variable mandatory.
2. PostgreSQL integration tests require an isolated PostgreSQL 18 admin URL in `XCS_TEST_DATABASE_URL`.
3. Browser tests use Playwright and deterministic fake ledger/wallet boundaries.
4. Real Testnet acceptance requires externally controlled funded wallets, a published network profile, two complete-history sources, and a running PostgreSQL projection.

Run the PostgreSQL suites with:

```bash
pnpm test:postgres
pnpm test:runtime
```

Run these commands sequentially on a disposable PostgreSQL cluster: the suites provision
cluster-wide runtime roles. `test:postgres` first exercises fresh/repeated migrations, legacy upgrade,
history mismatch, concurrency, rollback and restricted-role rejection, then indexer and API suites.
Its URL may point to an isolated PostgreSQL 18 outside Compose; never use a running pilot or production
cluster. `test:runtime` builds the production Nuxt server, starts it against
real restricted database connections, and checks SSR, readiness and signed payload publication.
Its ledger projection is synthetic and its signature is generated locally; it is not evidence
of a live Testnet transaction or an extension-wallet approval.

Install Chromium once and run browser flows with:

```bash
pnpm --filter @xcs-protocol/web exec playwright install chromium
pnpm test:e2e
```

Unit and browser mocks prove application transitions; they do not prove a specific wallet version supports XRPL Credentials. Record real wallet compatibility separately against Testnet.

## What tests must assert

- Core tests cover accepted values and rejection boundaries, not private helper implementations.
- SDK tests inspect the exact unsigned XRPL transaction and signed-blob submission checks.
- Indexer tests prove source agreement, ordering, idempotency, and fail-closed projection behavior.
- API suites under `apps/web/test/api/` prove snapshot consistency, bounded external fetches, and separate unavailable/tampered/invalid results through the native Nitro transport.
- Web tests prove user-visible workflow transitions and that signing remains in the wallet.

If a required environment is unavailable, report the exact skipped command and do not describe it as passing.

## Administrator portal (#30)

Use a disposable PostgreSQL cluster: provisioning changes cluster-wide runtime role credentials,
so database integration suites must run sequentially. Do not reuse the running #27 cluster.

```sh
pnpm --filter @xcs-protocol/web exec vitest run test/admin-config.test.ts test/admin-documents.test.ts test/admin-notifications.test.ts
# With XCS_TEST_DATABASE_URL configured privately:
pnpm --filter @xcs-protocol/web exec vitest run test/admin-postgres.integration.test.ts
# Also exercise actual SMTP receipt when local Mailpit is available:
XCS_TEST_MAILPIT_URL=http://127.0.0.1:8025 XCS_TEST_SMTP_PORT=1025 \
  pnpm --filter @xcs-protocol/web exec vitest run test/admin-postgres.integration.test.ts
# Real compiled Nitro, PostgreSQL sessions and browser; no mocked admin endpoints:
pnpm --filter '@xcs-protocol/web...' build
XCS_ADMIN_RUNTIME_TEST=1 pnpm --filter @xcs-protocol/web exec vitest run test/admin-postgres.integration.test.ts
# Deterministic UI failure states use intercepted API responses:
XCS_E2E_PORT=3130 pnpm --filter @xcs-protocol/web exec playwright test e2e/admin.spec.ts
```

The runtime browser test creates a short-lived synthetic TLS certificate and trusts only its
public-key fingerprint in the test Chromium process; no OS trust is changed. It inserts synthetic
sessions using the same PostgreSQL repository as authentication, exercises direct protected
navigation and a real persisted decision, and revokes the admin role. It does not perform a real
XRP Identity login. The mockup's human usability sessions remain unperformed.
