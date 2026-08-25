# XCS Protocol

XCS is an open schema and verification layer for native [XRP Ledger Credentials](https://xrpl.org/docs/concepts/decentralized-storage/credentials). It defines how schemas are registered, how their identifiers are derived, how off-ledger JSON is bound to a Credential, and how an indexer reconstructs lifecycle state.

This repository contains the XCS v0.1 specification and its reference implementation. The historical input document remains available as [`XCS_draft0.pdf`](./XCS_draft0.pdf); [`spec/XCS-0001.md`](./spec/XCS-0001.md) is the normative source for implemented v0.1 behavior.

## Status

XCS v0.1 is alpha software intended for XRPL Testnet. The protocol, SDK, dual-source indexer,
read API, CLI, and issuer/subject playground are implemented, but the repository deliberately ships
without a live network profile. Do not use the example profile on Mainnet: its registry address and
activation ledger are invalid placeholders.

The implementation never needs an XRPL seed. Applications construct transactions, then delegate signing to a wallet or an injected signer controlled by the issuer or subject.

## Repository map

- `packages/core`: deterministic parsing, canonicalization, schemas, UIDs and payload verification.
- `packages/sdk`: XRPL transaction builders and reliable submission primitives.
- `packages/cli`: local, non-custodial command-line workflows.
- `packages/db`: PostgreSQL schema, migrations and least-privilege role provisioning for a
  rebuildable local projection.
- `apps/indexer`: validated-ledger ingestion and XCS projections.
- `apps/api`: read-only schema, credential and verification API.
- `apps/web`: Nuxt 4 Testnet playground.
- `verifier-go`: independent conformance verifier.
- `conformance`: language-neutral test vectors.

## Prerequisites

- Node.js 24 LTS or 26
- pnpm 10
- Go 1.26 for the independent verifier
- PostgreSQL 18 for API/indexer integration
- Docker Compose for the self-hosted stack

## Developer validation

```bash
pnpm install
pnpm verify
(cd verifier-go && go test ./...)
```

These commands validate the source tree; they do not start a usable indexer. A real Testnet network
profile, PostgreSQL 18, and two independently operated, complete-history `rippled` WSS endpoints
must be configured before the services can run. The API defaults to `http://localhost:3001` and the
Nuxt application to `http://localhost:3000`. The full Compose startup and optional demo-pinning
procedure is in [`docs/runbooks/deployment.md`](./docs/runbooks/deployment.md).

The reference deployment uses `xcs_admin` only for migrations and idempotent role provisioning,
`xcs_indexer` for projection DML, and `xcs_api` for projection reads plus optional pinning CRUD.
`XCS_PUBLIC_RPC_URL` is a separate browser-visible submission endpoint; never put either private
indexer quorum endpoint or its credentials in that variable.

PostgreSQL is not a credential authority and does not make Commons the custodian of issuer data. It
is the reference implementation's local query cache: any organization can self-host the stack,
replay the same validated ledgers, and compare a deterministic projection digest. Public payloads
remain on issuer-selected HTTPS/IPFS infrastructure; signing keys remain in issuer/subject wallets.

For the database and indexer workflow, see [`docs/runbooks/indexer.md`](./docs/runbooks/indexer.md). For commands and test tiers, see [`docs/TESTING.md`](./docs/TESTING.md).

The outcome-based path from this Testnet alpha to organizational issuance and a possible Mainnet
decision is tracked in [`docs/implementation-plan.md`](./docs/implementation-plan.md).

## Security and privacy

- Never place a seed, private key, signed private document, or production secret in this repository.
- XCS identifiers and native Credentials are public ledger data.
- The public reference API deliberately provides exact Credential lookup only; it does not enumerate all Credentials attached to an account.
- The Testnet payload service is for public, non-sensitive demonstrations only.

Report vulnerabilities according to [`SECURITY.md`](./SECURITY.md).
Release gates and dependency-specific constraints are tracked in [`docs/known-limitations.md`](./docs/known-limitations.md).

## License

Code and documentation in this repository are licensed under MIT unless a file says otherwise.
