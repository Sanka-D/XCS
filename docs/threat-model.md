# Threat model

## Assets and trust boundaries

XCS protects deterministic schema identifiers, ledger-derived lifecycle state, payload integrity and accurate presentation of issuer trust. XRPL signing keys remain outside the system and are the issuer or subject's responsibility.

Untrusted inputs include schema memos, all XRPL metadata, API path/query/body values, fetched HTTPS/IPFS bytes, wallet responses and deployment configuration.

## Implemented controls

| Threat                                 | Control                                                                                                  |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Ambiguous JSON or hash divergence      | Strict parser, duplicate-key rejection, I-JSON checks, JCS and cross-language vectors                    |
| Cross-language protocol drift          | Exhaustive manifest; shared schema, payload, Ripple-time and lifecycle vectors; independent Go runner    |
| Forged payload content                 | URI-bound SHA-256/CID verification plus envelope linkage                                                 |
| False issuer endorsement               | State, payload and trust reported separately                                                             |
| Seed/key disclosure                    | No seed API; injected wallet signer; redacted errors and logs                                            |
| Database runtime compromise            | Separate admin, projection-writer and API roles; no runtime DDL; idempotent secret-redacted provisioning |
| Private RPC credential disclosure      | Dedicated no-secret public browser RPC; both indexer quorum settings remain server-only                  |
| SSRF                                   | Fetch disabled by default; on-ledger URI only; HTTPS; DNS/IP checks; redirect, timeout and size limits   |
| History gaps or inconsistent providers | Two full-history sources; deep normalized comparison; transaction-root checkpoint; fail-closed status    |
| Stale/concurrent indexer writer        | PostgreSQL lease epoch, row lock and status/checkpoint update in the same transaction                    |
| Mixed or stale API read                | Read-only repeatable-read snapshot; DB-time lease check; exact status/checkpoint/root/freshness guard    |
| Wallet signing against stale state     | Non-cacheable profile readiness before wallet invocation and again before blob persistence/submission    |
| Duplicate/replayed ingestion           | Unique event keys and transactional, idempotent projections; deterministic replay digest                 |
| Operational metrics disclosure/abuse   | Disabled by default; dedicated constant-time bearer; no-store; monitoring-ingress restriction            |
| Moving-tip replay divergence           | Mandatory index/hash target, quorum verification and a fixed inclusive worker bound                      |
| Account privacy amplification          | Exact shared-coordinate lookup only; no subject feed, account-wide listing or claims search              |
| Public read exhaustion                 | Bounded queries; IP budgets; deterministic SSR HMAC keys; explicit narrow proxy trust                    |
| Public pin abuse                       | Testnet-only, wallet challenge, IP/address rate limit and payload quota                                  |
| Package substitution or workspace leak | Reproducible tarballs; closed inventory; isolated consumer smoke; signed tag; OIDC staging plus 2FA      |

## Browser policy rollout boundary

Nitro owns the canonical browser security headers, while the ingress may only pass them through or
overwrite an inherited value with the same reviewed value. It must never append an additional CSP:
browsers apply every received policy, so duplicates can combine into behavior that was not tested
with the wallet extensions. HSTS is limited to the current host and deliberately excludes
`includeSubDomains` and `preload` until the organization audits every affected subdomain.

The first CSP is `Content-Security-Policy-Report-Only`. This is an observation stage, not an
implemented mitigation: violations remain allowed and an injected same-origin script could still
read or relay a recoverable signed transaction blob. The policy can move to enforcement only after
real Crossmark and GemWallet matrices cover every supported Credential transaction and the
consented issuer-payload flow. Curl evidence must show one policy header, and browser DevTools must
show no unresolved application-owned violations, before and after promotion.

`connect-src https:` remains necessary because the permissionless model lets each issuer select its
public HTTPS payload host. A fixed Commons host allowlist would introduce a publication gate. The
broader connection directive is therefore paired with the application's exact-host display,
explicit consent, generation/URI revalidation, CORS boundary and payload digest verification; it is
not permission for background claim collection.

The rollout configures no CSP report collector. Reports may contain exact Credential paths, issuer
hosts, referrers or other browsing context, so local DevTools inspection is the privacy-preserving
default. Introducing `report-uri`, `report-to`, `Reporting-Endpoints` or a reporting vendor requires
a separate data-flow, retention and access review.

## Residual risks

- Wallet applications may not yet understand every Credential transaction type; only verified adapters are exposed.
- A valid domain proof or allowlist entry does not prove individual claims.
- Demo pinning blocks common PII-shaped field names but cannot recognize sensitive values under arbitrary schema fields.
- Public IPFS content cannot be reliably deleted after another node retrieves it.
- A blackholed registry prevents governance capture but cannot enforce anti-spam moderation.
- Two URLs do not prove independent infrastructure; correlated or colluding providers can still agree
  on false input. Provider ownership is an operational review requirement.
- Readiness is a point-in-time guard, not an XRPL transaction precondition. The indexer can degrade
  after the final browser check, so validated ledger and exact indexed business confirmation remain
  mandatory before the site reports XCS success. The ingress must preserve `private, no-store` and
  never cache or synthesize readiness responses.
- The browser pilot discloses the subject's IP and fetch timing to an issuer-controlled HTTPS payload
  host after explicit consent. Hostname filtering cannot fully eliminate DNS rebinding.
- The alpha has not received an independent security audit and is not approved for PII or Mainnet use.
- Until the real-wallet matrix has passed and the CSP is enforced, report-only diagnostics do not
  reduce the impact of an XSS or compromised same-origin dependency. Adding an edge policy without
  replacing the Nitro value can also break wallet or payload behavior through unintended policy
  intersection.
- Permissionless public schemas can contain misleading names or descriptions. Schema discovery is
  not Commons endorsement, and moderation must not reinterpret protocol validity.
- `noindex` metadata on exact Credential, transaction and search-result pages is an indexing hint,
  not an access control. Anyone who knows a public ledger coordinate can still query the exact API
  and redistribute the returned metadata.
- The reference API rate limiter is process-local. A multi-replica or high-volume deployment needs
  an additional shared limiter at a trusted edge. Incorrectly omitting an ingress proxy CIDR safely
  collapses its visitors into one budget; trusting an unnecessarily broad CIDR increases spoofing
  risk, so catch-all `/0` ranges are rejected.
