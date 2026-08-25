# Reference architecture

XCS separates deterministic protocol logic from I/O and signing.

```text
Wallet/HSM ──signs──> SDK / CLI / Nuxt playground
                         │ signed transaction
                         ▼
                  validated XRPL ledgers
                    │              │
             rippled source A  rippled source B
                    └──── normalized quorum ────┘
                                  │ full transaction + metadata
                                  ▼
                     fenced single-writer indexer (`xcs_indexer`)
                                  │ atomic event/checkpoint/status
                                  ▼
                         PostgreSQL projection <──SELECT── API (`xcs_api`)
                                                            │
                                               verifier / explorer / apps
```

## Boundaries

- `core` is deterministic and browser-safe. It does no network or database I/O.
- `sdk` understands XRPL transaction JSON and delegates signing through an interface.
- `indexer` is the only writer of schema and lifecycle projections. A PostgreSQL lease epoch fences
  stale replicas, and authoritative reads require the live writer's exact agreed checkpoint.
- `api` is read-only except for the optional, isolated Testnet pinning surface.
- `web` connects wallets in the browser and submits through the explicitly public
  `XCS_PUBLIC_RPC_URL`; `XCS_RPC_URL_PRIMARY` and `XCS_RPC_URL_SECONDARY` remain server-only and are
  never forwarded automatically into browser configuration. The public submission RPC is not a
  source of authoritative verification.
- `verifier-go` is intentionally independent and consumes the same language-neutral vectors.

The shared public service is convenient, not authoritative. A self-hosted indexer reconstructing the same validated ledgers must produce the same protocol result.

## Persistence

Raw XCS-relevant events are append-only. Current schema and Credential views are rebuildable
projections. A checkpoint stores network, ledger index/hash, parent, close time, transaction count,
and transaction root. Advancing the checkpoint, writing events, and publishing the agreed indexer
status occurs in one fenced SQL transaction. PostgreSQL is an interchangeable local read model, not
the source of protocol truth; XRPL validated ledgers remain the source.

The public API reads ledger-derived rows and their integrity evidence from one repeatable-read
snapshot. It fails with `503` if the writer lease expired, either source disagreed, the status and
checkpoint differ, transaction-root evidence is absent, or the checkpoint is stale.

The initial migration is create-only for a fresh XCS projection database. It is not compatible with
the database used by the historical `XRPL-Commons/xcs` MVP. Later migrations within this
architecture must preserve mixed-version reads and use expand/migrate/contract when changing
populated data.

PostgreSQL uses three fixed trust identities. `xcs_admin` owns schema changes and runs migrations
plus the post-migration provisioner; it is absent from runtime services. `xcs_indexer` receives only
projection `SELECT`/`INSERT`/`UPDATE`, while `xcs_api` receives projection `SELECT` and CRUD on the
isolated pinning tables. Neither runtime identity can create objects in `public`. Provisioning is
idempotent so every migration and password rotation can reassert the complete grant set without
logging connection URLs or passwords.

A maintenance replay has a content-addressed upper bound: the operator supplies a ledger index and
hash, both sources quorum-verify that ledger, and the worker never processes beyond it even if the
live tips advance. Consequently two rebuilds can compare deterministic digests for the same finite
ledger history instead of racing a moving network tip.

## Submission

Transaction builders return unsigned semantic JSON. The application autofills fees, sequence and `LastLedgerSequence`, previews the complete transaction, asks an external wallet to sign, persists the resulting hash/blob, submits it, and waits for a validated result. A provisional submission response is never treated as success.
