# Reference architecture

XCS separates deterministic protocol logic from I/O and signing.

```text
Wallet/HSM ──signs──> SDK / CLI / Nuxt site
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

The shared public service is convenient, not authoritative. XRPL Commons operates the reference
web, indexer, API and PostgreSQL deployment for the Testnet beta, but a self-hosted indexer
reconstructing the same validated ledgers must produce the same protocol result.

## Private controlled-pilot exception

The pre-beta staging profile `commons-testnet-xcs-v0.1-controlled-pilot` is the sole exception to
the blackholed-registry deployment invariant. As recorded in
[`ADR 0003`](./adr/0003-disposable-controlled-testnet-registry.md), it requires the explicit
`controlled-testnet-pilot` registry policy plus the
`DISPOSABLE_PROFILE_AND_DATABASE` acknowledgement, Testnet network ID `1`, and a dedicated fresh
PostgreSQL projection. The exception changes operational trust only; it does not change any XCS
v0.1 parsing, UID, payload, registration or lifecycle result.

That staging deployment is private and non-promotable. Its registry controller may retain master,
regular-key, SignerList or delegate authority, although the account must remain able to receive a
one-drop Payment. The controller can therefore change account controls or impede future
registrations, so the profile cannot supply the neutrality evidence required of the public beta.

The pilot indexer compares a Commons-operated complete-history primary with Ripple's public Testnet
secondary. The browser submits through XRPL Labs' public Testnet endpoint. Endpoint URLs are not
profile fields: the two public services carry no XCS SLA, and the browser endpoint never
participates in authoritative reads or quorum. Before beta, Commons creates and audits a different
blackholed registry, publishes a new profile and activation boundary, and rebuilds into another
fresh database. No pilot registry, profile or projection is renamed or promoted.

## Product surface and discovery

The accountless Nuxt application is one site with three navigation surfaces: Explorer for public
schemas, aggregate statistics and exact Credential evidence; Studio for wallet-based schema and
unit-issuance workflows; and Developers for REST, SDK and CLI integration material. EAS and EASScan
inform interaction design only. XCS continues to use native XRPL Credentials and the frozen v0.1
protocol described in `spec/XCS-0001.md`.

Discovery is hybrid. Every valid permissionless schema is public and discoverable, but Credentials
are resolved only from exact shared coordinates: generation ID, transaction hash or the complete
issuer/subject/schema tuple. The reference service exposes no subject feed, account-wide Credential
enumeration or claims search. A future browsable Credential catalog would require an explicit,
separately specified opt-in signal. Aggregate counts contain no payload claims.

This boundary limits privacy amplification; it does not make public ledger identifiers private.
Schema visibility is not endorsement. The API and site expose the issuer address and independent
verification dimensions without Commons badges, rankings or universal trust decisions. See
[`ADR 0002`](./adr/0002-public-product-and-discovery.md).

The implemented REST discovery surface exposes aggregate checkpoint statistics, paginated schemas,
schema-only registration activity, exact generation timelines and exact XCS transaction
projections. Text and publisher searches return schemas only; a complete 256-bit hexadecimal value
may resolve an exact schema UID, Credential generation ID and transaction hash. These reads use the
same repeatable-read snapshot and fail-closed checkpoint guard as verification. None reads payload
claims or creates an issuer/subject Credential listing.

## Persistence

Raw XCS-relevant events are append-only. Current schema and Credential views are rebuildable
projections. A checkpoint stores network, ledger index/hash, parent, close time, transaction count,
and transaction root. Advancing the checkpoint, writing events, and publishing the agreed indexer
status occurs in one fenced SQL transaction. PostgreSQL is an interchangeable local read model, not
the source of protocol truth; XRPL validated ledgers remain the source.

The public API reads ledger-derived rows and their integrity evidence from one repeatable-read
snapshot. It fails with `503` if the writer lease expired, either source disagreed, the status and
checkpoint differ, transaction-root evidence is absent, or the checkpoint is stale.

An optional internal metrics reader uses its own read-only repeatable-read transaction and a secret
that is distinct from the Nuxt SSR identity. Its JSON snapshot combines rebuildable database gauges
with process-local API counters and labels their scope explicitly. It exposes no request identity or
payload content and is not protocol truth. Client-side wallet submissions, physical disk capacity,
API pool saturation, and past continuity incidents are outside this first snapshot because the API
does not reliably observe them.

The initial migration is create-only for a fresh XCS projection database. It is not compatible with
the database used by the historical `XRPL-Commons/xcs` MVP. Later migrations within this
architecture must preserve mixed-version reads and use expand/migrate/contract when changing
populated data.

Migration `0002_discovery_indexes.sql` follows that compatibility rule: it adds four indexes for
schema ordering/search/activity and lifecycle aggregates without changing a table, column,
constraint or row. Old binaries ignore the indexes. The deployment and lock considerations for a
populated database are documented in [`runbooks/deployment.md`](./runbooks/deployment.md).

PostgreSQL uses three fixed trust identities. `xcs_admin` owns schema changes and runs migrations
plus the post-migration provisioner; it is absent from runtime services. `xcs_indexer` receives only
projection `SELECT`/`INSERT`/`UPDATE`, while `xcs_api` receives projection `SELECT` and CRUD on the
isolated pinning tables. Neither runtime identity can create objects in `public`. Provisioning is
idempotent so every migration and password rotation can reassert the complete grant set without
logging connection URLs or passwords.

PostgreSQL contains ledger-derived schemas, lifecycle events, current projections, checkpoints and
optional demo-pinning administration rows. It contains no XRPL signing key and the Commons beta does
not ingest or persist credential claims. Public credential payloads remain exact canonical HTTPS
documents on issuer-controlled infrastructure.

A maintenance replay has a content-addressed upper bound: the operator supplies a ledger index and
hash, both sources quorum-verify that ledger, and the worker never processes beyond it even if the
live tips advance. Consequently two rebuilds can compare deterministic digests for the same finite
ledger history instead of racing a moving network tip.

## Submission

Transaction builders return unsigned semantic JSON. The application autofills fees, sequence and `LastLedgerSequence`, previews the complete transaction, asks an external wallet to sign, persists the resulting hash/blob, submits it, and waits for a validated result. A provisional submission response is never treated as success.

The hosted site requires `GET /v1/networks/:profile/readiness` immediately before invoking the
wallet and again after the wallet returns but before persisting or submitting the blob. That route
uses the same repeatable-read, DB-time lease, quorum, checkpoint-root and freshness checks as
authoritative reads. The diagnostic `/status` route and public submission RPC are never fallback
authority. This is a product safety boundary, not a normative dependency of core XCS or the generic
SDK. The API marks every readiness outcome `private, no-store`, the browser explicitly bypasses its
cache, and the deployment ingress must preserve the header and never cache or synthesize the route.

The Testnet beta performs one wallet operation at a time through Crossmark or GemWallet. It has no
XCS account, server session, batch issuer, team or multi-tenant authorization layer. Recovery state
and sanitized receipts stay in the browser's IndexedDB; clearing site data removes that local
history. Credential payloads are published by the issuer over HTTPS and verified immediately before
issuance. Commons never receives a signing seed or private key.
