# Indexer runbook

## Before starting

1. Copy `.env.example` to `.env`, set PostgreSQL, and configure distinct
   `XCS_RPC_URL_PRIMARY`/`XCS_RPC_URL_SECONDARY` WSS endpoints operated independently.
   `XCS_INDEXER_DATABASE_URL` must authenticate as the least-privilege `xcs_indexer` role; keep
   `XCS_MIGRATOR_DATABASE_URL` confined to migration and provisioning commands.
2. Replace the example network profile with the audited profile for the current Testnet reset.
3. Confirm both `rippled` sources expose every validated ledger from the activation ledger. Clio is
   not yet a supported source for this alpha.
4. Apply migrations, run the quorum preflight, then start the API and indexer:

```sh
pnpm --filter @xcs-protocol/db db:migrate
pnpm --filter @xcs-protocol/db db:provision
pnpm --filter @xcs-protocol/indexer preflight
pnpm --filter @xcs-protocol/api start
pnpm --filter @xcs-protocol/indexer start
```

The idempotent provisioner reapplies the indexer's projection-only grants after migrations without
printing database URLs or passwords. The preflight checks network ID, contiguous retained history,
the amendment, activation ledger and registry blackhole policy on both sources. It prints no
endpoint or credential.

## Healthy state

Readiness requires matching normalized ledgers from both sources, a live fenced writer lease, the
configured amendment and activation hash, no ledger gap, and a fresh checkpoint whose index/hash
exactly matches the writer's agreed state and includes a transaction root.

Monitor checkpoint age, source RPC errors, invalid registrations, ingestion retries and projection failures. Payload retrieval is not part of indexing and cannot delay ledger progress.

## Recovery

- On process restart, resume from the persisted checkpoint and re-read that boundary ledger idempotently.
- On a gap, stop. Repair or switch to a complete-history source, verify the expected parent hash, then resume.
- On a projection bug, stop writes, deploy corrected deterministic code, truncate only rebuildable projections through an explicit maintenance procedure, and replay the append-only events.
- Never skip a missing ledger or replace an activation hash in place.

An old checkpoint whose `transaction_root` is null predates the integrity migration. It is never
served as authoritative and must be rebuilt into a fresh projection database.

## Rebuild and deterministic comparison

`replay` is intentionally create-only: it refuses any profile that already has checkpoints, events,
schemas, or Credential projections. Point it at a migrated, provisioned, empty database and supply
one immutable target boundary as both a ledger index and its 64-hex-character hash:

```sh
export XCS_REPLAY_TARGET_LEDGER_INDEX=123456
export XCS_REPLAY_TARGET_LEDGER_HASH=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
pnpm --filter @xcs-protocol/indexer replay
pnpm --filter @xcs-protocol/indexer projection:digest
```

Before projection advances, both configured sources must expose the target ledger and agree on its
normalized contents; its agreed hash must equal `XCS_REPLAY_TARGET_LEDGER_HASH`. An unavailable or
mismatched target fails closed. Once accepted, the target is fixed for the run: replay stops exactly
at `XCS_REPLAY_TARGET_LEDGER_INDEX` and releases its writer lease even when either source tip advances
during ingestion. A deliberately historical replay remains non-ready; it must not be presented as a
live effective-tip projection.

The digest covers immutable profile data, checkpoints, schema events/projections, and Credential
events/generations from a PostgreSQL repeatable-read snapshot. It excludes wall-clock timestamps,
writer status, pinning, and operational flags. Rebuild two independent empty databases against the
same target index and hash, then compare both the digest and row counts before accepting a profile
deployment. Comparing two runs that each selected their then-current moving tip is not reproducible
evidence.

## Rollback

Application containers can roll back to a compatible image. Database migrations are forward-fixed unless a tested down migration is explicitly supplied. On-ledger registrations cannot be removed; a normative error requires a new protocol profile/version.
