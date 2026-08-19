# Reference architecture

XCS separates deterministic protocol logic from I/O and signing.

```text
Wallet/HSM ──signs──> SDK / CLI / Nuxt playground
                         │ signed transaction
                         ▼
                  validated XRPL ledgers
                         │
                every transaction metadata
                         ▼
Indexer ──append events──> PostgreSQL <──read-only── API
                                                │
                                   verifier / explorer / apps
```

## Boundaries

- `core` is deterministic and browser-safe. It does no network or database I/O.
- `sdk` understands XRPL transaction JSON and delegates signing through an interface.
- `indexer` is the only writer of schema and lifecycle projections.
- `api` is read-only except for the optional, isolated Testnet pinning surface.
- `web` connects wallets in the browser; server rendering never imports browser wallet providers.
- `verifier-go` is intentionally independent and consumes the same language-neutral vectors.

The shared public service is convenient, not authoritative. A self-hosted indexer reconstructing the same validated ledgers must produce the same protocol result.

## Persistence

Raw XCS-relevant events are append-only. Current schema and Credential views are rebuildable projections. A checkpoint stores network, ledger index and ledger hash. Advancing the checkpoint and writing events occurs in one SQL transaction.

The initial migration is create-only for a fresh XCS projection database. It is not compatible with
the database used by the historical `XRPL-Commons/xcs` MVP. Later migrations within this
architecture must preserve mixed-version reads and use expand/migrate/contract when changing
populated data.

## Submission

Transaction builders return unsigned semantic JSON. The application autofills fees, sequence and `LastLedgerSequence`, previews the complete transaction, asks an external wallet to sign, persists the resulting hash/blob, submits it, and waits for a validated result. A provisional submission response is never treated as success.
