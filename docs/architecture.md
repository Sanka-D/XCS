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
                                                         API -> web/verifier
```

## Ownership

- `core` parses and validates protocol values. It is browser-safe and performs no I/O.
- `sdk` builds and validates XRPL transaction JSON and submits signed blobs. It never owns keys.
- `cli` is a thin command layer over core and SDK.
- `indexer` is the projection writer. It advances only on validated ledger evidence agreed by its configured sources.
- `api` reads the projection and fetches off-ledger payloads for verification. It fails closed when projection evidence is stale or inconsistent.
- `web` presents the workflows and connects user wallets. Browser-visible RPC configuration is separate from private indexer sources.
- `db` defines the rebuildable PostgreSQL model and is maintained separately.

## Trust boundaries

XRPL validated ledgers are authoritative for schema registrations and Credential lifecycle. PostgreSQL is replaceable cache state. HTTPS/IPFS payload bytes are untrusted until their URI digest, envelope coordinates, and schema claims all verify.

Commons may operate a convenient public indexer and API, but organizations can run the same open-source stack. Commons does not issue on their behalf, hold signing keys, or turn schema publication into endorsement.

## Verification result

Verification is dimensional rather than a single trust badge. The verifier checks:

- schema registration and UID;
- native Credential existence and lifecycle;
- URI integrity against exact payload bytes;
- issuer, subject, and schema linkage inside the payload;
- claims against the resolved schema.

An unavailable payload is distinct from a tampered payload. A cryptographically valid Credential does not prove that the issuer is trustworthy.