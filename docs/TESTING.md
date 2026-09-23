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

1. Unit tests need no network or database.
2. PostgreSQL integration tests require an isolated PostgreSQL 18 admin URL in `XCS_TEST_DATABASE_URL`.
3. Browser tests use Playwright and deterministic fake ledger/wallet boundaries.
4. Real Testnet acceptance requires externally controlled funded wallets, a published network profile, two complete-history sources, and a running PostgreSQL projection.

Run the PostgreSQL suites with:

```bash
pnpm test:postgres
pnpm test:runtime
```

Run these commands sequentially on a disposable PostgreSQL cluster: the suites provision
cluster-wide runtime roles. `test:runtime` builds the production Nuxt server, starts it against
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
