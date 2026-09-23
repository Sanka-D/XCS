# Architecture

XCS separates deterministic protocol rules from ledger I/O, storage, and signing.

```text
issuer/subject wallet -> unsigned transaction from SDK/web/CLI -> XRPL
                                                               |
                                           two rippled sources |
                                                               v
                                                          indexer
                                                               |
                                                    PostgreSQL projection
                                                               |
                                              Nuxt (site + /v1 API)
                                                               |
                                                       browser/verifier
```

## Ownership

- `core` parses and validates protocol values. It is browser-safe and performs no I/O.
- `sdk` builds and validates XRPL transaction JSON and submits signed blobs. It never owns keys.
- `cli` is a thin command layer over core and SDK.
- `indexer` is the projection writer. It advances only on validated ledger evidence agreed by its configured sources.
- `web` hosts the Nuxt workflows, wallet integration and native Nitro API handlers. The API reads projections and fails closed when evidence is stale or inconsistent. Optional server-side payload retrieval stays disabled by default. Browser-visible RPC configuration is separate from private indexer sources.
- Nuxt uses `xcs_api` for read-only projections and a separate `xcs_payload_writer` connection for optional public hosting/pinning; neither can write ledger projections. The indexer runs independently.
- `db` defines the rebuildable PostgreSQL model and is maintained separately.

## Trust boundaries

XRPL validated ledgers are authoritative for schema registrations and Credential lifecycle. Ledger-derived PostgreSQL projections are rebuildable; optional hosted payload bytes and quota records are not and require backups. HTTPS/IPFS payload bytes are untrusted until their URI digest, envelope coordinates, and schema claims all verify.

Commons may operate a convenient public indexer and API, but organizations can run the same open-source stack. Commons does not issue on their behalf, hold signing keys, or turn schema publication into endorsement.

## Verification result

Verification is dimensional rather than a single trust badge. The verifier checks:

- schema registration and UID;
- native Credential existence and lifecycle;
- URI integrity against exact payload bytes;
- issuer, subject, and schema linkage inside the payload;
- claims against the resolved schema.

An unavailable payload is distinct from a tampered payload. A cryptographically valid Credential does not prove that the issuer is trustworthy.

## Operational projection

The indexer is the only normal writer to protocol projections. Checkpoint, events, and status move atomically under a fenced writer lease. The API reads a consistent snapshot and returns `503` when the writer lease, source agreement, checkpoint, transaction-root evidence, or freshness requirements fail.

The controlled Testnet pilot is disposable. It must not be promoted to Mainnet or presented as a neutral permanent registry. See [ADR 0003](./adr/0003-disposable-controlled-testnet-registry.md).
An unavailable payload is distinct from a tampered payload. A cryptographically valid Credential does not prove that the issuer is trustworthy.
