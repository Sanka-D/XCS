# Testing

There are three independently checked units: the root workspace (`packages/*`) and the two
standalone applications, each with its own lockfile and `node_modules`.

Install once:

```bash
pnpm install        # packages/core, packages/sdk, packages/cli
pnpm install:apps   # apps/web and apps/indexer, each with --ignore-workspace
```

`--ignore-workspace` is mandatory on any per-app command that resolves dependencies — `install`,
`audit`, `licenses list`. Without it pnpm silently operates on the root workspace and still exits 0.
Commands that only run a script (`pnpm --dir apps/web test`) do not need it.

Run focused checks while editing:

```bash
pnpm --filter @xcs-protocol/core test
pnpm --filter @xcs-protocol/sdk test
pnpm --filter @xcs-protocol/cli test
pnpm --dir apps/web test
pnpm --dir apps/indexer test
```

`--filter` reaches the three workspace packages only; the applications are not workspace members and
are addressed with `--dir`.

Each unit also provides `lint`, `typecheck`, `build` and a combined `verify`. Before merging a change
that crosses more than one of them, run the root aggregate:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

or, equivalently, `pnpm verify`. To verify one application on its own:

```bash
pnpm --dir apps/web verify
pnpm --dir apps/indexer verify
```

## Integration tiers

1. Unit tests need no network or database.
2. PostgreSQL integration tests require an isolated PostgreSQL 18 admin URL in `XCS_TEST_DATABASE_URL`.
3. Browser tests use Playwright and deterministic fake ledger/wallet boundaries.
4. Real Testnet acceptance requires externally controlled funded wallets, a published network profile, two complete-history sources, and a running PostgreSQL projection.

Run the PostgreSQL suites with:

```bash
pnpm test:postgres                    # both applications
pnpm --dir apps/indexer test:postgres
pnpm --dir apps/web test:postgres
```

Install Chromium once and run browser flows with:

```bash
pnpm --dir apps/web exec playwright install chromium
pnpm test:e2e
```

`pnpm test:e2e` builds the web app and then runs both Playwright configurations. To run them
separately from the application directory:

```bash
pnpm --dir apps/web test:e2e
pnpm --dir apps/web test:e2e:security
```

Unit and browser mocks prove application transitions; they do not prove a specific wallet version supports XRPL Credentials. Record real wallet compatibility separately against Testnet.

## Migrations

`db/schema/` and `db/migrations/` are shared source compiled by both applications. After editing the
schema, regenerate the migration with the indexer's tooling and commit the result; CI regenerates it
and fails on any diff:

```bash
pnpm --dir apps/indexer db:generate
```

## What tests must assert

- Core tests cover accepted values and rejection boundaries, not private helper implementations.
- SDK tests inspect the exact unsigned XRPL transaction and signed-blob submission checks.
- Indexer tests prove source agreement, ordering, idempotency, and fail-closed projection behavior.
- Web server tests prove snapshot consistency, bounded external fetches, and separate
  unavailable/tampered/invalid results for the `/v1` handlers.
- Web application tests prove user-visible workflow transitions and that signing remains in the wallet.

Because neither application imports `packages/core` or `packages/sdk`, a green package suite proves
nothing about the applications' copies of that code. A protocol change must be mirrored and the
affected application's suite rerun in the same pull request; see [`CONTRIBUTING.md`](../CONTRIBUTING.md).

If a required environment is unavailable, report the exact skipped command and do not describe it as passing.

## Authentication

`pnpm --dir apps/web test:e2e:auth` runs the isolated OIDC browser flow on port 3127.
It verifies sign-in, reload, denied issuer access, wallet link/unlink, logout and FR/EN copy.
`pnpm test:postgres` also covers auth schema/grants and repository behavior through `xcs_app`.
See [authentication boundaries and real-provider limitations](runbooks/authentication.md).

## Administrator portal (#30)

Use a disposable PostgreSQL cluster: provisioning changes cluster-wide runtime role credentials,
so database integration suites must run sequentially. Do not reuse the running #27 cluster.

```sh
pnpm --dir apps/web exec vitest run test/admin-config.test.ts test/admin-documents.test.ts test/admin-notifications.test.ts
# With XCS_TEST_DATABASE_URL configured privately:
pnpm --dir apps/web exec vitest run test/admin-postgres.integration.test.ts
# Also exercise actual SMTP receipt when local Mailpit is available:
XCS_TEST_MAILPIT_URL=http://127.0.0.1:8025 XCS_TEST_SMTP_PORT=1025 \
  pnpm --dir apps/web exec vitest run test/admin-postgres.integration.test.ts
# Real compiled Nitro, PostgreSQL sessions and browser; no mocked admin endpoints:
pnpm --dir apps/web build
XCS_ADMIN_RUNTIME_TEST=1 pnpm --dir apps/web exec vitest run test/admin-postgres.integration.test.ts
# Deterministic UI failure states use intercepted API responses:
XCS_E2E_PORT=3130 pnpm --dir apps/web exec playwright test e2e/admin.spec.ts
```

The runtime browser test creates a short-lived synthetic TLS certificate and trusts only its
public-key fingerprint in the test Chromium process; no OS trust is changed. It inserts synthetic
sessions using the same PostgreSQL repository as authentication, exercises direct protected
navigation and a real persisted decision, and revokes the admin role. It does not perform a real
XRP Identity login. The mockup's human usability sessions remain unperformed.

## Issuer workspace (#31)

`XCS_E2E_PORT=3131 pnpm --dir apps/web exec playwright test e2e/issuer.spec.ts`
checks onboarding, own-schema/invitation interfaces, FR/EN copy, denial states and fragment handling
with API fixtures. `test/issuer-postgres.integration.test.ts` exercises actual restricted grants,
claim concurrency, exact-generation recording and full/filtered payload responses. Storage, mail,
input validation and engine recovery have focused unit suites. Run PostgreSQL suites sequentially
on a disposable cluster. These checks do not prove live Identity login, real wallet consent or
external email delivery. See [issuer deployment and privacy boundaries](runbooks/issuer.md).

After building, the optional runtime suite uses real compiled Nitro, restricted PostgreSQL roles,
Chromium HTTPS and local Mailpit. Set `XCS_TEST_DATABASE_URL` to an isolated disposable cluster and
start Mailpit on the chosen ports, then run:

```sh
XCS_ISSUER_RUNTIME_TEST=1 XCS_ISSUER_RUNTIME_SMTP_PORT=5531 \
  XCS_ISSUER_RUNTIME_MAILPIT_ORIGIN=http://127.0.0.1:8031 \
  pnpm --dir apps/web exec vitest run test/issuer-runtime.integration.test.ts
```

This exercises application upload, invitation delivery and claim, and private payload disclosure
without intercepting issuer endpoints. Approval, sessions and indexed ledger evidence are synthetic
fixtures; no external mailbox, real Identity client or wallet signature is required.

The default browser suite also runs `issuer-journal.spec.ts`: two real Chromium tabs contend for
one invitation in native IndexedDB, then reload/recover it. To run only this test without a Nuxt
server, use `pnpm --dir apps/web exec playwright test --config playwright.issuer-journal.config.ts`.
