# ADR 0002: Public Testnet product and discovery boundaries

Status: Accepted

Date: 2026-08-25

## Context

XCS v0.1 is a frozen protocol profile for native XRPL Credentials. Product work may improve how
people discover schemas, prepare transactions and inspect ledger evidence, but it must not change
v0.1 schema validity, UID derivation, payload interpretation or lifecycle projection. Any such
normative change requires a later protocol version and a separately activated network profile.

The public product should be as approachable as EAS and EASScan without copying their protocol or
turning XRPL Commons into a credential authority. XRPL Credential metadata is public, but indexing
it into account-wide feeds would amplify subject activity beyond the exact lookup needed to verify a
shared credential. Public payload claims create an additional privacy boundary because they live
outside the ledger.

## Decision

The first public product is an XRPL Testnet beta with one web application organized into three
surfaces:

- **Explorer** discovers permissionless public schemas, aggregate network statistics and exact
  credential evidence;
- **Studio** registers schemas and performs low-volume, one-at-a-time issuance and lifecycle actions
  through an external wallet;
- **Developers** explains the protocol and exposes REST, SDK and CLI integration material.

EAS and EASScan are UX references only. XCS continues to use native XRPL Credentials and its frozen
v0.1 schema, payload and verification rules.

Discovery is deliberately hybrid:

- every valid schema registration is public and discoverable, regardless of publisher;
- aggregate statistics may count public ledger-derived records;
- a Credential is resolved exactly by a shared generation ID, transaction hash or complete
  issuer/subject/schema tuple;
- there is no public subject feed, account-wide Credential enumeration or search index over claims;
- any future browsable Credential catalog requires a separately designed, explicit opt-in signal;
  the existence of a public ledger object alone is not interpreted as that opt-in.

Commons remains neutral. The product displays addresses and the four independent verification
dimensions, but provides no issuer badge, ranking, reputation score or universal trust decision.
Schema registration remains permissionless; visibility does not mean endorsement.

For the beta, credential payloads are public HTTPS documents hosted by the issuer. The browser
fetches an exact payload only after displaying its host and obtaining consent, then checks its
integrity locally and sends the parsed object for schema verification. Commons does not store,
cache, enumerate or search payload claims.

The beta has no XCS user account, organization account or custodial signing service. Signing keys
remain in the issuer- or subject-controlled wallet behind the pinned XRPL Connect sign-only
boundary, and the browser journal remains local to the device. The factory covers Xaman, Crossmark,
GemWallet, WalletConnect, Ledger, Xyra, Otsu and MetaMask Snap, with Xaman and WalletConnect enabled
only when their public application identifiers are configured. XCS never delegates submission
through `signAndSubmit`: it verifies, persists and submits the signed transaction itself. Issuance is
unitary; batch issuance, teams, role-based access and hosted automation are outside the beta.

This surface does not promise that every wallet is compatible. WalletConnect discovery is useful
only when the selected wallet supports the XRPL Testnet namespace and native `Credential*`
transactions, and every enabled adapter still needs real Testnet certification.

The public integration contract is REST-first. GraphQL may be reconsidered only after real REST
usage demonstrates a need. The initial end-to-end pilot covers course participation/completion and
diploma-style credentials.

XRPL Commons operates the shared web application, dual-source indexer, read API and PostgreSQL
projection for convenience. PostgreSQL is a reconstructible cache of validated ledger history, not
protocol truth. Commons holds neither signing keys nor credential claims, and independent operators
may rebuild and compare the same projection.

## Consequences

- Public schema exploration can be rich without creating a centralized issuer directory.
- Exact Credential permalinks are shareable and independently verifiable, while subject-wide
  browsing remains unavailable.
- The Explorer cannot offer a global attestation feed identical to EASScan. This is an intentional
  privacy/product boundary, not an indexing limitation.
- Issuers must operate a CORS-compatible HTTPS payload host and retain the exact canonical bytes.
- The accountless beta avoids authentication and multi-tenant authorization state, but its local
  operation history does not automatically follow an issuer across browsers or devices.
- Xaman and WalletConnect application identifiers are public browser configuration, not signing
  secrets. Removing them or restricting the adapter factory is a wallet-only rollback with no
  protocol or database-schema migration.
- Permissionless schemas require clear non-endorsement messaging and abuse-resistant presentation;
  moderation must never rewrite protocol validity.
- Product and API additions remain non-normative and backward-compatible with frozen v0.1 data.

## Alternatives rejected for the beta

- cloning the EAS protocol or storing attestations in an EVM contract;
- a public feed or subject-address directory of every indexed Credential;
- Commons-hosted payload claims or default public IPFS pinning;
- Commons-issued trust badges or a canonical issuer ranking;
- custodial keys, XCS accounts, batch issuance or multi-tenant administration;
- GraphQL before a stable REST contract and measured consumer demand.
