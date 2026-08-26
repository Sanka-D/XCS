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
go test -race ./...
go vet ./...
go build ./...
```

The deterministic browser gate requires Chromium once, then runs without Testnet, PostgreSQL or
wallet keys:

```bash
pnpm --filter @xcs-protocol/web exec playwright install chromium
pnpm test:e2e
```

## Integration tiers

1. Pure unit and conformance tests require no network.
2. Database integration tests require an isolated PostgreSQL 18 server and an admin URL configured
   with `XCS_TEST_DATABASE_URL`; the suite creates and removes its own random databases.
3. Indexer fixture tests consume captured public-ledger bundles produced only after exact agreement
   between both configured `rippled` sources.
4. Testnet E2E requires a real network profile and externally controlled funded wallets.
5. The deterministic Playwright browser gate uses explicitly development-only issuer and subject
   wallets plus a fake XRPL client. It proves exact application transitions and indexed business
   evidence, including the subject's payload consent and separate trust-neutral acknowledgement;
   real Crossmark/GemWallet XLS-70 signing remains a separate manual Testnet gate.

Never use a production seed in tests. A Testnet reset invalidates the activation profile and
requires a new fixture/profile rather than editing historical expected UIDs.

The destructive PostgreSQL integration suite receives an **admin database URL**, creates random
databases named `xcs_it_<uuid>` and the fixed `xcs_indexer`/`xcs_api` roles, then removes those exact
objects after the run. It refuses to run the provisioning case if either role already exists. Use
only a disposable CI/test cluster; never point this suite at a shared or production PostgreSQL
instance.

```sh
XCS_TEST_DATABASE_URL=postgres://postgres:password@127.0.0.1:5432/postgres pnpm test:postgres
```

It requires PostgreSQL 18 and proves migrations `0000` through `0002`, including the discovery
indexes, NULL-safe constraints,
lease takeover/fencing, rollback, restart/idempotence, transaction-root persistence, and equal
timestamp-free digests across two replays. It also provisions the fixed runtime roles in the
isolated cluster and proves their positive and denied permissions, then proves that two replays with
different source tips stop at the same quorum-verified index/hash boundary. The unit suite separately
proves that a tip advancing during replay cannot move that boundary. Normal `pnpm test` skips these
eight cases when the admin URL is absent; CI runs them as a required separate job.

## Captured ledger bundles

Capture begins at the immutable profile activation ledger and stops at an explicit target. The tool
stores normalized ledger headers and every public transaction/metadata object in that range, plus
public operator labels. It omits RPC URLs and local credentials, but the on-ledger evidence can
contain Memos, URIs, public keys, signatures and personal identifiers. Treat the complete bundle as
public data, review it before publication, and never put secrets or sensitive claims on XRPL.

```sh
export XCS_FIXTURE_TARGET_LEDGER_INDEX=123456
export XCS_FIXTURE_OUTPUT=./fixtures/testnet-pilot
export XCS_FIXTURE_PRIMARY_OPERATOR='XRPL Commons'
export XCS_FIXTURE_SECONDARY_OPERATOR='Independent Operator'
pnpm --filter @xcs-protocol/indexer fixture:capture
```

Validate a bundle offline against the exact profile file and its byte-level digest:

```sh
export XCS_FIXTURE_BUNDLE=./fixtures/testnet-pilot
export XCS_FIXTURE_BUNDLE_SHA256='<bundleDigest printed by fixture:capture>'
pnpm --filter @xcs-protocol/indexer fixture:validate
```

The same artifact can drive the normal replay worker and an empty PostgreSQL projection without
either live RPC URL. Set `XCS_REPLAY_FIXTURE_BUNDLE` and
`XCS_REPLAY_FIXTURE_BUNDLE_SHA256`, then run the documented `replay` command; its immutable target is
the last ledger committed by the bundle.

The manifest format is `xcs-ledger-bundle/1`. Each ledger is exact canonical JSON compressed as a
separate gzip member and protected by compressed and uncompressed SHA-256 digests stored in
canonical, compressed index chunks. The compact manifest binds the ordered chunks, so capture is not
limited by one monolithic list. Validation also requires the externally recorded SHA-256 of the
exact canonical `manifest.json` bytes; this root digest transitively binds the profile, range,
indexes and every ledger file. The directory inventory is strict, and any extra file, symlink or
missing ledger is rejected. Manifest, index, compressed-ledger and decompressed-ledger sizes are
bounded independently to limit hostile artifact memory use. Operator labels are audit metadata, not
proof of operational independence; release evidence must identify and review both operators
separately.
