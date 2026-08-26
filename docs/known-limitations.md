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
- Discovery migration `0002_discovery_indexes.sql` contains regular, additive `CREATE INDEX`
  statements. It preserves old application compatibility and needs no row backfill, but index
  creation can block writes on an already populated deployment and should run before the new routes
  are exposed.
- PostgreSQL is a self-hostable, rebuildable reference projection, not a Commons authority and not a
  protocol requirement for third-party implementations. A MongoDB adapter would need to reproduce
  atomic checkpoints, single-writer fencing, snapshots, constraints, and deterministic replay.
- XRPL Commons intends to host the shared Testnet indexer, read API and PostgreSQL projection. That
  projection remains a reconstructible cache and contains neither issuer/subject signing keys nor
  credential claims.
- The built-in API rate limiter is in-memory and suitable for the single-instance beta. Horizontal
  replicas require a shared edge/store limiter. Nuxt SSR derives one opaque budget per safely
  resolved network address; reverse-proxy CIDRs must be narrow and explicitly configured, while
  catch-all `/0` trust ranges are rejected.

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

The optional pinning API is disabled by default, limited to configured Testnet profiles, and not a
private storage service or part of the Commons-hosted beta product. Its PII field-name filter is only
a guardrail, not a classifier. There is no promise that public IPFS content disappears after the
local 90-day pin expires.

The browser acceptance pilot reads issuer-hosted HTTPS payloads directly only after consent. This
reveals IP address and timing to that host; local/IP-literal hostnames are rejected, but DNS rebinding
remains a browser-boundary risk. Private or sensitive claims are outside this pilot.
