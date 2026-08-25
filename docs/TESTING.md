# Testing

## Local checks

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

The independent verifier is checked separately:

```bash
cd verifier-go
go test ./...
```

## Integration tiers

1. Pure unit and conformance tests require no network.
2. Database integration tests require an isolated PostgreSQL 18 server and an admin URL configured
   with `XCS_TEST_DATABASE_URL`; the suite creates and removes its own random databases.
3. Indexer fixture tests consume captured, non-sensitive ledger JSON.
4. Testnet E2E requires a real network profile and externally controlled funded wallets.
5. Browser E2E requires at least one wallet adapter proven to sign XLS-70 transactions.

Never use a production seed in tests. A Testnet reset invalidates the activation profile and requires a new fixture/profile rather than editing historical expected UIDs.

The destructive PostgreSQL integration suite receives an **admin database URL**, creates random
databases named `xcs_it_<uuid>` and the fixed `xcs_indexer`/`xcs_api` roles, then removes those exact
objects after the run. It refuses to run the provisioning case if either role already exists. Use
only a disposable CI/test cluster; never point this suite at a shared or production PostgreSQL
instance.

```sh
XCS_TEST_DATABASE_URL=postgres://postgres:password@127.0.0.1:5432/postgres pnpm test:postgres
```

It requires PostgreSQL 18 and proves migrations `0000` then `0001`, NULL-safe constraints,
lease takeover/fencing, rollback, restart/idempotence, transaction-root persistence, and equal
timestamp-free digests across two replays. It also provisions the fixed runtime roles in the
isolated cluster and proves their positive and denied permissions, then proves that two replays with
different source tips stop at the same quorum-verified index/hash boundary. The unit suite separately
proves that a tip advancing during replay cannot move that boundary. Normal `pnpm test` skips these
eight cases when the admin URL is absent; CI runs them as a required separate job.
