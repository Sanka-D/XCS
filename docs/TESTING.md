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
2. Database integration tests require an empty PostgreSQL 18 database configured with `XCS_DATABASE_URL`.
3. Indexer fixture tests consume captured, non-sensitive ledger JSON.
4. Testnet E2E requires a real network profile and externally controlled funded wallets.
5. Browser E2E requires at least one wallet adapter proven to sign XLS-70 transactions.

Never use a production seed in tests. A Testnet reset invalidates the activation profile and requires a new fixture/profile rather than editing historical expected UIDs.
