# Indexer runbook

## Before starting

1. Copy `.env.example` to `.env` and set PostgreSQL and XRPL endpoints.
2. Replace the example network profile with the audited profile for the current Testnet reset.
3. Confirm the configured source exposes every validated ledger from the activation ledger.
4. Apply migrations with the database package command.
5. Start the API, then the indexer.

## Healthy state

Readiness requires the configured amendment, matching activation hash, no detected ledger gap, a reachable database and an indexer checkpoint near the validated network tip.

Monitor checkpoint age, source RPC errors, invalid registrations, ingestion retries and projection failures. Payload retrieval is not part of indexing and cannot delay ledger progress.

## Recovery

- On process restart, resume from the persisted checkpoint and re-read that boundary ledger idempotently.
- On a gap, stop. Repair or switch to a complete-history source, verify the expected parent hash, then resume.
- On a projection bug, stop writes, deploy corrected deterministic code, truncate only rebuildable projections through an explicit maintenance procedure, and replay the append-only events.
- Never skip a missing ledger or replace an activation hash in place.

## Rollback

Application containers can roll back to a compatible image. Database migrations are forward-fixed unless a tested down migration is explicitly supplied. On-ledger registrations cannot be removed; a normative error requires a new protocol profile/version.
