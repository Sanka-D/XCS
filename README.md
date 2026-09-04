# XCS Protocol

XCS is an open schema and verification layer for native [XRP Ledger Credentials](https://xrpl.org/docs/concepts/decentralized-storage/credentials). It defines how an issuer publishes a schema, binds canonical off-ledger JSON to a Credential, and lets anyone verify the resulting ledger evidence.

This repository is alpha software for XRPL Testnet. Do not use personal data or real funds.

## Packages

- `packages/core`: browser-safe schema, payload, URI, UID, lifecycle, and network-profile logic.
- `packages/sdk`: XRPL transaction builders, validation, and submission primitives.
- `packages/cli`: local schema, payload, Credential, verification, and submission commands.
- `packages/db`: PostgreSQL migrations and projection storage. This package is maintained separately.
- `apps/indexer`: validated-ledger ingestion and rebuildable projections.
- `apps/api`: read and verification API over the projection.
- `apps/web`: Nuxt Testnet explorer and issuer/subject workflows.

There is one protocol implementation: TypeScript core. Cryptography, canonicalization, address validation, time conversion, CID handling, and JSON tokenization use maintained dependencies instead of local implementations.

## Data flow

1. An issuer publishes a schema in an XRPL Payment memo.
2. The indexer reads validated ledgers and projects schemas and Credential lifecycle events into PostgreSQL.
3. The issuer creates canonical payload bytes and hosts those exact bytes at an HTTPS or IPFS URI bound to their SHA-256 digest.
4. The issuer signs `CredentialCreate` in its wallet. The subject may later sign `CredentialAccept`.
5. A verifier loads ledger evidence from the API, fetches the payload, checks its digest and schema, and reports each verification dimension separately.

XRPL validated ledgers are the source of truth. PostgreSQL is a disposable query projection, not a credential authority or issuer data store. Signing keys stay in wallets.

## Development

Requirements: Node.js 24 or 26, pnpm 10, and PostgreSQL 18 for database integration tests.

```bash
pnpm install
pnpm verify
```

The API defaults to `http://localhost:3001` and the web app to `http://localhost:3000`. Running the complete stack requires a network profile, PostgreSQL, and two complete-history `rippled` WebSocket sources. See [deployment](./docs/runbooks/deployment.md) and [indexer operations](./docs/runbooks/indexer.md).

For a browser-only Testnet demo, `XCS_LOCAL_PAYLOAD_STORE=1` enables a temporary local payload store. It is not public hosting and cannot be used for durable verification.

## Security and privacy

- Never commit seeds, private keys, `.env` files, production secrets, or personal payloads.
- Schemas and native Credentials are public ledger data.
- The reference API supports exact Credential lookup; it does not expose account-wide subject feeds.
- Public schema publication is permissionless and is not Commons endorsement.

See [the specification](./spec/XCS-0001.md), [architecture](./docs/architecture.md), and [testing](./docs/TESTING.md).

## License

MIT
