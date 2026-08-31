# Alpha limitations and release gates

XCS v0.1 is implemented as a Testnet alpha whose next product target is a public Testnet beta, not a
Mainnet release. Its normative semantics are frozen; product work may add non-normative REST reads
and user interfaces, but changing protocol validity or derived bytes requires a later version and a
new activation profile. The following constraints are intentional and must remain visible to
integrators.

## Public product and discovery

- EAS and EASScan are UX references only. XCS uses native XRPL Credentials and does not reproduce
  the EAS contracts or attestation model.
- Schema registration is permissionless. Every valid schema is public and discoverable, but neither
  publication nor visibility is Commons endorsement.
- Credential discovery is hybrid: verification uses an exact generation ID, transaction hash or
  complete issuer/subject/schema tuple. The reference product has no public subject feed,
  account-wide Credential enumeration or claims search. Public ledger identifiers are still public;
  this boundary limits their aggregation rather than making them private.
- Explorer text and address search returns schemas only; Credential metadata is returned only when
  the caller supplies a complete generation ID, transaction hash or tuple. The public activity page
  lists schema registrations, not Credential events.
- Commons publishes no issuer badges, rankings or universal trust result. Issuer trust remains an
  application policy separate from ledger state, schema validity and payload integrity.
- The beta has no XCS user or organization account. Wallet operations and receipts are local to one
  browser, so clearing site data or moving devices loses that local history.
- Issuance is one Credential at a time through a supported wallet. Batch issuance, teams, RBAC,
  hosted automation and GraphQL are outside the beta scope.
- `@xcs-protocol/core`, `@xcs-protocol/sdk`, and `@xcs-protocol/cli` have reproducible tarball and
  isolated-consumer gates, but they are not registry-installable until XRPL Commons completes the
  one-time npm scope bootstrap. Developers guidance therefore remains explicitly monorepo-local.
  Subsequent releases are staged through OIDC and still require human 2FA approval.

## Network and deployment

- The repository contains no live network profile. The example registry and activation boundary are
  invalid placeholders; a separately audited Testnet profile is required.
- There is no in-place database migration from the former `XRPL-Commons/xcs` Nuxt MVP. Its
  `schemas` and `credentials` tables are incompatible with this indexer's projection. Preserve a
  backup and deploy this alpha against a fresh database; legacy off-chain data needs a separately
  designed export/transform/import process.
- The indexer requires two independently operated WSS `rippled` sources with complete validated-ledger
  history from activation. Clio is not supported by the current preflight response contract, a pruned
  source is insufficient, and distinct URLs do not by themselves prove operator independence.
- `XCS_PUBLIC_RPC_URL` is deliberately exposed to every browser and must contain no secret. It is a
  transaction-submission convenience, not a third quorum source and not authoritative verification
  evidence; the two indexer source variables remain private server configuration. The web runtime
  rejects embedded username/password values and non-TLS public endpoints (`ws://` is loopback-only),
  but operators must also keep opaque credentials out of the URL path and query string.
- PostgreSQL, Kubo, Docker, and real Testnet services are separate integration tiers; pure unit tests
  do not prove those deployments.
- CI replays one deterministic synthetic ledger bundle through two PostgreSQL projections and pins
  their complete digest, but this proves the harness rather than Testnet history. A reviewed public
  Testnet capture from two demonstrably independent providers remains release evidence.
- Discovery migration `0002_discovery_indexes.sql` contains regular, additive `CREATE INDEX`
  statements. It preserves old application compatibility and needs no row backfill, but index
  creation can block writes on an already populated deployment and should run before the new routes
  are exposed.
- PostgreSQL is a self-hostable, rebuildable reference projection, not a Commons authority and not a
  protocol requirement for third-party implementations. A MongoDB adapter would need to reproduce
  atomic checkpoints, single-writer fencing, snapshots, constraints, and deterministic replay.
- The reference provisioner is deliberately release-coupled and supports only a dedicated
  PostgreSQL 18 cluster with `max_prepared_transactions = 0`, the exact current migration shape and
  hash/timestamp identities, and all named projection constraints validated with their canonical
  definitions. It is not a shared-cluster bootstrapper or a generic forward-compatible migration
  tool, nor an anti-superuser attestation of every schema object: the superuser/migration owner and
  reviewed migration artifacts remain trusted. Runtime identities own no objects or DDL rights;
  runtime concurrency uses `SERIALIZABLE` transactions and fenced row locks, and no runtime role
  receives a raw PostgreSQL advisory-lock function. Provisioning forces SCRAM-SHA-256 verifiers,
  while transport security and explicit SCRAM `pg_hba.conf` policy remain operator responsibilities.
- Migration `0003_projection_integrity.sql` adds 16 PostgreSQL `CHECK` constraints for native XRPL
  uint32 bounds, non-negative event coordinates, event generation identity, and generation-ledger
  ordering. It installs them as `NOT VALID` with a 5-second lock timeout; `db:migrate` then validates
  each table in a separate post-commit transaction with a configurable statement timeout (30
  minutes by default). An upgrade can therefore fail because a lock is busy, a scan exceeds its
  configured maintenance window, or historical projection data is invalid. In the latter case
  `0003` remains applied and its checks protect new writes, but the affected table is not marked
  validated until operators rebuild or replay the ledger-derived projection and rerun `db:migrate`.
- Signed PostgreSQL `integer` coordinate columns, including transaction and node indexes, still
  represent at most `2147483647`, not the full abstract uint32 range. `0003` enforces their
  non-negative boundary but does not widen them; widening populated columns requires a separate,
  more locking migration.
- XRPL Commons intends to host the shared Testnet indexer, read API and PostgreSQL projection. That
  projection remains a reconstructible cache and contains neither issuer/subject signing keys nor
  credential claims.
- The built-in API rate limiter is in-memory and suitable for the single-instance beta. Horizontal
  replicas require a shared edge/store limiter. Nuxt SSR derives one opaque budget per safely
  resolved network address; reverse-proxy CIDRs must be narrow and explicitly configured, while
  catch-all `/0` trust ranges are rejected.
- Operational counters are also process-local and reset whenever an API replica restarts. The
  protected JSON snapshot exposes only the current durable indexer halt, not continuity incident
  history. It cannot observe browser-local XRPL submission outcomes, postgres.js pool queues, or
  physical PostgreSQL volume capacity; its database byte count is logical size only. Multi-replica
  aggregation, infrastructure exporters, retention, alerts and any client telemetry require later
  operational/privacy design.
- Browser signing readiness is a short, profile-bound point-in-time proof. It prevents the site from
  opening a wallet or submitting a returned blob against known stale or inconsistent state, but it
  cannot atomically bind a later XRPL transaction to that checkpoint. Exact post-validation indexer
  confirmation remains mandatory.
- Nitro emits the initial browser CSP in report-only mode. It records violations in local browser
  tooling but blocks nothing, so it is not yet an XSS or signed-blob exfiltration control. Enforcement
  remains gated on the real Crossmark and GemWallet matrix; the ingress must preserve one policy
  instead of appending its own.
- The policy's `connect-src https:` allowance is intentional: permissionless issuer-hosted payload
  domains cannot be known at deployment time. Host display, explicit consent, exact-generation
  revalidation and payload integrity checks remain the application boundary. Narrowing this to a
  Commons allowlist would change the accepted product model.
- CSP violation collection is disabled. There is no `report-uri`, Reporting API endpoint or
  third-party collector because reports can contain exact Credential URLs, issuer hosts and browsing
  context. Operators must use local DevTools during rollout unless a later privacy review approves a
  collector and retention policy.
- HSTS covers only the deployed host. It deliberately omits `includeSubDomains` and `preload`, so it
  does not assert HTTPS readiness for unrelated organizational subdomains.

## Wallets

- The Nuxt alpha exposes only Crossmark and GemWallet. Xaman is disabled because the currently
  published adapter does not provide a trustworthy sign-only flow with an explicit network.
- `xrpl-connect` 0.8.2 has no published TypeScript declarations and is not safe to import during SSR.
  The web app isolates it in a client-only plugin and carries a narrow local declaration until a
  corrected package is released.
- Crossmark and GemWallet intentionally return a signed blob with an empty hash. XCS derives and
  checks the hash, persists the blob locally before submission, and verifies that signing did not
  alter the preview. A manual Testnet matrix for CredentialCreate, CredentialAccept, and
  CredentialDelete is still a release gate.

## URI interoperability

The XRPL protocol permits 256 URI bytes. `xrpl.js` 5.0.0 incorrectly applies that limit to the
hexadecimal JSON string, making its effective limit 128 bytes. XCS builders retain the normative
256-byte rule, while the submission helpers fail early above 128 bytes. Prefer a raw IPFS CID or a
short HTTPS base URL until the upstream validator is fixed.

## Payload hosting and demo pinning

The Commons Testnet beta uses issuer-hosted HTTPS payloads. The issuer must retain the exact
canonical bytes, serve a JSON media type, enable CORS for the site, and keep the integrity-bound URL
available. Commons does not store or index payload claims.

The JSON media type is an interoperability recommendation for browsers, not normative verification
evidence. The optional server resolver classifies the observed, integrity-bound bytes even when
`Content-Type` is absent or different and does not trust `Content-Length` to prove the 1 MiB limit.

The optional pinning API is disabled by default, limited to configured Testnet profiles, and not a
private storage service or part of the Commons-hosted beta product. Its PII field-name filter is only
a guardrail, not a classifier. There is no promise that public IPFS content disappears after the
local 90-day pin expires.

The browser acceptance pilot reads issuer-hosted HTTPS payloads directly only after consent. This
reveals IP address and timing to that host; local/IP-literal hostnames are rejected, but DNS rebinding
remains a browser-boundary risk. Private or sensitive claims are outside this pilot.
