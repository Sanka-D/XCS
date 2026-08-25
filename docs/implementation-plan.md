# XCS implementation plan

This plan takes XCS from the current Testnet alpha to a service that organizations can use to
register schemas and issue native XRPL Credentials without giving XCS custody of their signing
keys. It is outcome-driven: a milestone is complete only when its exit criteria are demonstrated.

## Product outcome

An organization must be able to complete this flow:

1. define and locally validate an XCS schema;
2. register it on the intended XRPL network through an externally controlled wallet or signer;
3. build a canonical, integrity-bound credential payload and publish it to an approved public
   location;
4. create the native Credential, let its subject accept it, and later revoke or remove it;
5. let an independent verifier reconstruct the same schema and lifecycle state from validated
   ledgers and report payload integrity separately from issuer trust.

The reference service remains non-custodial and reproducible. A self-hosted indexer processing the
same validated ledgers must reach the same protocol result as the shared service.

## Current implementation evidence

The repository now contains the strict dual-`rippled` preflight/quorum, a fenced PostgreSQL writer,
transaction-root checkpoints, fail-closed repeatable-read API guards, quorum-verified bounded
empty-database replay, least-privilege database roles, and a timestamp-free projection digest. The
browser submission RPC is configured separately from the two private indexer sources.
Unit/conformance suites cover the deterministic protocol, source normalization, worker, API, CLI
and browser flow; CI contains a PostgreSQL 18 job for the eight migration, role-permission, fencing,
and replay scenarios.

This does **not** close milestones 0–2: PR review/merge, a real blackholed Testnet profile, proof that
the two providers are independent, live PostgreSQL execution, real Crossmark/GemWallet transactions,
captured ledger fixtures, and two-entity pilot evidence remain external gates.

## Scope boundaries for v0.1

The following are deliberately not v0.1 promises:

- no global directory that declares which issuers are trustworthy;
- no storage of seeds, private keys, or HSM credentials in XCS;
- no private-credential or personal-data storage on public IPFS;
- no Mainnet launch before the Testnet, interoperability, operations, and security gates below;
- no in-place migration from the historical Nuxt MVP database;
- no account-wide public Credential enumeration endpoint.
- no HSM integration, batch issuance, private claims, multi-tenant administration, or Mainnet
  activation in the first controlled pilot.

## Milestone 0 — adopt the reference baseline

**Goal:** make one reviewed repository state the unambiguous implementation baseline.

Work:

- review and merge the replacement pull request with the database incompatibility explicitly
  acknowledged;
- decide the disposition of the historical implementation pull requests without deleting their
  branches or history;
- confirm ownership and licensing of the imported implementation and historical documents;
- enable required reviews, signed commits, protected `main`, and required CI checks;
- remove obsolete deployment secrets from repository and hosting settings after confirming that no
  active legacy deployment depends on them;
- convert each later milestone in this document into tracked issues with an owner and evidence link.

Exit criteria:

- `main` contains the monorepo baseline and its CI is green;
- reviewers have approved the breaking database and API replacement;
- the legacy database remains backed up and untouched for rollback;
- unresolved historical work is linked from, or explicitly superseded by, tracked decisions.

Rollback: revert the merge and run the former application only against its untouched legacy
database. Never point the former application at the new projection database.

## Milestone 1 — establish the immutable Testnet profile

**Goal:** replace all placeholder network data with an independently auditable Testnet activation.

Work:

- perform the dedicated registry-account blackhole ceremony in
  `config/networks/README.md`, retaining public transaction and ledger evidence;
- confirm that the required Credentials amendment is supported and enabled on the selected network;
- record the exact activation ledger index and hash after the ceremony;
- publish `config/networks/testnet.json` and its SHA-256 digest through at least two organization
  channels;
- provision a fresh PostgreSQL database and a validated-ledger source that retains the full range
  from activation;
- add a profile smoke check that validates the registry account flags, activation hash, amendment,
  network ID, and source history before indexing starts;
- require two independently operated ledger providers and compare every normalized ledger header,
  transaction root, transaction, and metadata object before projection;
- reject missing transaction arrays, metadata, hashes, duplicate transaction hashes, discontinuous
  transaction indexes, and provider disagreement instead of treating incomplete input as empty;
- persist an indexer state (`starting`, `catching_up`, `ready`, or `halted`) and make authoritative API
  reads return `503` immediately while the indexer is halted or lacks quorum;
- apply the additive integrity migration to a fresh XCS database, then prove transaction rollback,
  restart, idempotency, and deterministic replay against real PostgreSQL.

Exit criteria:

- two reviewers independently reproduce the profile validation;
- the indexer starts at the activation boundary, reaches the Testnet tip, and remains ready;
- a clean rebuild produces identical schema UIDs, events, projections, and checkpoint hashes;
- changing any immutable profile field causes startup to fail closed.
- omitting or changing any ledger transaction or metadata field on either provider halts ingestion
  before the checkpoint advances;
- two fresh databases replayed from activation produce the same timestamp-free projection digest.

Rollback: discard the new projection database and profile deployment. A faulty or reset Testnet
profile is replaced by a new profile ID and activation boundary, never edited in place.

## Milestone 2 — prove the complete Testnet journey

**Goal:** demonstrate the real user journey with released wallets and validated ledger results.

Work:

- execute a wallet matrix for Crossmark and GemWallet covering schema registration,
  `CredentialCreate`, `CredentialAccept`, and both issuer- and subject-initiated deletion;
- cover rejection, wallet cancellation, account or network changes, lost submission acknowledgements,
  expiry, restart recovery, and duplicate submission attempts;
- verify that every UI preview exactly matches the signed blob and that every success shown to the
  user is `validated` with `tesSUCCESS`;
- capture redacted, non-sensitive ledger fixtures from those transactions for deterministic indexer
  regression tests;
- add PostgreSQL integration tests that apply the migration to an empty database, ingest fixtures,
  restart at checkpoints, and rebuild projections;
- add browser tests with a deterministic mock signer, while retaining the manual extension-wallet
  matrix as a release gate;
- publish issuer, subject, and verifier walkthroughs using disposable Testnet accounts only.

Exit criteria:

- two independent account pairs complete register → issue → accept → verify → delete;
- the TypeScript and Go verifiers agree on every captured payload and schema;
- recovery after browser, API, indexer, and database restarts is demonstrated;
- all automated checks run in CI and the manual wallet evidence records adapter and extension
  versions.

## Milestone 3 — freeze an interoperable v0.1 candidate

**Goal:** remove protocol ambiguity before inviting external implementations.

Work:

- expand language-neutral vectors for malformed JSON, Unicode, nested schemas, inheritance, UID
  boundaries, payload linkage, time boundaries, and lifecycle deletion metadata;
- add property and fuzz testing for strict JSON, JCS, schema resolution, payload parsing, and XRPL
  metadata extraction;
- replay the same ledger fixtures through clean TypeScript projections and compare their complete
  output, not only counts;
- submit or adopt the `xrpl.js` URI-length correction; keep the documented 128-byte interoperability
  guard until a released dependency is verified at the normative 256-byte boundary;
- obtain review from at least one implementer who did not write the TypeScript core and record all
  normative decisions in the ADR/specification;
- version the conformance vectors and define the compatibility policy for future protocol profiles.

Exit criteria:

- TypeScript and Go pass every v0.1 conformance vector with identical validity outcomes and stable
  error classes;
- no open issue can change historical schema validity, UID bytes, payload interpretation, or
  lifecycle projection without a new protocol version;
- an external implementation can derive a known UID and verify a known Credential from the published
  specification and vectors alone.

## Milestone 4 — make the service operable and defensible

**Goal:** run the shared reference service predictably without turning it into a trust authority.

Work:

- expose metrics for ledger lag, checkpoint hash, continuity failures, invalid registrations,
  submission outcomes, payload fetch failures, database saturation, rate limits, and disk usage;
- define availability and freshness objectives, alerts, dashboards, and an incident runbook;
- test backup restoration, full replay, provider failover, database outage, malformed-ledger input,
  and safe rollback in a staging environment;
- add container, dependency, license, secret, and software-bill-of-materials checks to release CI;
- sign release tags and container artifacts and record build provenance;
- deploy browser security headers and a strict Content Security Policy compatible with the selected
  wallets;
- perform an internal threat-model and defensive design review, and close release-blocking findings
  before exposing the pilot; this review does not replace the final post-freeze audit in milestone 6;
- document data retention, public-payload constraints, abuse handling, and incident contacts.

Exit criteria:

- an operator restores the service from backups and validated ledgers within the agreed recovery
  objectives;
- stale, discontinuous, or inconsistent ledger data never produces an authoritative active/valid
  response;
- the threat model, audit report, operational dashboards, alerts, and incident procedures are
  reviewed and linked from the release record;
- production services hold no XRPL signing secret.

## Milestone 5 — deliver the organizational issuer workflow

**Goal:** let pilot entities issue repeatably without adapting protocol internals themselves.

Work:

- add a schema-authoring workflow that validates locally, previews canonical bytes and memo size, and
  records the resulting registration operation;
- build the controlled pilot on the SDK `Signer` boundary using the explicitly tested Crossmark and
  GemWallet browser adapters for low-volume, unit issuance;
- add deterministic payload generation, organization-hosted HTTPS publication, optional public IPFS
  publication, and a mandatory proof that the published bytes match the URI before issuance;
- support idempotent resumption and sanitized local receipts for each unit operation;
- add organization-local audit exports containing schema, operation, ledger, hash, actor, and outcome
  metadata, but never seeds or private claim data by default;
- add subject acceptance links and clear pending/active/expired/deleted lifecycle guidance;
- run pilots with at least two entities using different signer and payload-hosting setups.

Offline/HSM signing, batch issuance, multi-operator administration, and multi-tenant hosting are
post-pilot work. Adding any of these changes the signing or authorization surface and requires a new
threat-model review before release.

Exit criteria:

- a new issuer follows published documentation without repository maintainer intervention;
- retrying any interrupted operation cannot create an untracked duplicate or report a provisional
  result as final;
- signing keys remain within the issuer-controlled wallet, offline signer, or HSM boundary;
- pilot feedback is resolved or explicitly deferred before a stable release.

## Milestone 6 — final audit and Mainnet go/no-go

**Goal:** decide whether a separately activated Mainnet profile is justified.

Required gates:

- the v0.1 candidate is frozen and independently implemented;
- real-wallet Testnet matrices and issuer pilots are complete;
- an independent defensive security audit covers the exact frozen commit, container digests, signer
  adapters, indexer quorum, payload resolver, and authorization surfaces shipped after milestone 5;
- security review findings are closed and operational recovery drills pass; any material code or
  configuration change after the audit triggers a documented delta review or re-audit;
- privacy, legal, support, abuse, and issuer-trust presentation have organization approval;
- dependency and wallet versions supporting native Credentials are pinned and monitored;
- a separate Mainnet registry ceremony, profile, database, and activation plan have two-person review;
- rollback and incident authority are named before activation.

Mainnet UIDs and state must be reconstructed under the new Mainnet profile. Testnet registry data,
activation values, projections, payload assumptions, and identifiers are never promoted or copied as
Mainnet truth.

## Execution order and ownership

Milestones 0 and 1 are sequential. Within a milestone, independent workstreams can proceed in
parallel, but their exit criteria are shared gates.

| Workstream           | Primary responsibility                                                     |
| -------------------- | -------------------------------------------------------------------------- |
| Protocol             | specification, profiles, conformance vectors, versioning decisions         |
| Data and operations  | database, indexer, API, deployment, replay, monitoring, backups            |
| Issuance experience  | SDK, CLI, web, wallet contracts, issuer and subject workflows              |
| Security and privacy | threat model, review, release controls, public-payload and trust messaging |
| Program leadership   | owners, pilot entities, evidence, release gates, Mainnet decision          |

The critical path is:

```text
baseline adopted
  → immutable Testnet profile
  → real wallet and ledger journey
  → interoperable v0.1 candidate
  → operational readiness and pre-pilot review
  → issuer pilots
  → final frozen-artifact audit
  → Mainnet go/no-go
```

No milestone is closed from code completion alone. The issue closing it must link the exact test,
ledger, deployment, review, or pilot evidence that satisfies every exit criterion.
