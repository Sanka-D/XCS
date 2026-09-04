# Implementation plan

## Current baseline

- Core uses maintained protocol dependencies and exposes a small deterministic API.
- SDK and CLI consume that API and do not own signing keys.
- Indexer and API use local I/O adapters around core instead of importing implementation helpers.
- Web supports schema creation, Credential issuance/acceptance/deletion, exact verification, and wallet adapters.
- PostgreSQL remains a rebuildable projection and is being maintained separately.

## Next milestones

1. Merge the database package work and rerun PostgreSQL integration tests.
2. Publish a reviewed disposable Testnet network profile and start both complete-history ledger sources.
3. Run the complete schema -> issue -> accept -> verify -> delete flow with real supported wallets.
4. Record transaction hashes, payload availability, indexer checkpoints, and verification output as Testnet acceptance evidence.
5. Remove pilot-only payload storage from public deployment and configure real issuer-controlled HTTPS/IPFS hosting.
6. Add production observability and recovery drills before calling the service beta.

## Exit criteria for Testnet beta

- all workspace and PostgreSQL integration checks pass;
- the indexer can rebuild from the activation ledger and produce the same projection digest;
- API verification fails closed during source disagreement or stale indexing;
- at least one issuer wallet and one subject wallet complete native Credential transactions on Testnet;
- no service receives or stores wallet seeds;
- public documentation matches the deployed endpoints and limitations.

Mainnet is explicitly out of scope until the Testnet beta has durable operational evidence and a separately reviewed network profile.
