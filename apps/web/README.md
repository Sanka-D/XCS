# XCS Testnet web app

The Nuxt application is the accountless, non-custodial Testnet site for XCS. It combines schema
exploration, Studio issuance/lifecycle workflows and developer education in one deployment. EAS and
EASScan are interaction-design references only; the site constructs native XRPL transactions under
the frozen XCS v0.1 protocol.

For every write, the application constructs and autofills an XRPL transaction, shows those exact
final fields to the user, then asks an external wallet to sign without submitting. The private key
or seed never enters the application. There is no XCS user or organization account, server session,
team administration or batch issuer in the Testnet beta; one wallet action is prepared at a time.

## Public discovery boundary

All valid permissionless schemas are public and discoverable. Credential verification is
deliberately exact: callers share a generation ID, transaction hash or the complete
issuer/subject/schema tuple. The site has no subject feed, account-wide Credential enumeration or
claims search, and it displays no Commons issuer badge or universal trust result. Aggregate
statistics contain only ledger-derived metadata. See
[`ADR 0002`](../../docs/adr/0002-public-product-and-discovery.md).

## Implemented site map

The current application organizes the existing workflows as follows:

- **Explorer:** `/` for aggregate checkpoint statistics and exact search, `/schemas` and
  `/schemas/:uid` for paginated schema discovery, `/activity` for schema registrations only,
  `/credentials/:generationId` and `/transactions/:hash` for exact evidence, and `/status` for the
  indexer/network view;
- **Studio:** `/studio` links the existing register, issue, accept, revoke, verify and local
  operation-recovery flows. Schema registration has a guided scalar-field editor, course-completion
  and diploma templates, plus the advanced JSON editor. Issuance can derive a guided claims form
  from a compatible resolved schema and retains the advanced JSON path;
- **Developers:** `/developers` links the live OpenAPI document and names the SDK/CLI packages;
  `/learn` remains the protocol walkthrough.

Explorer text search indexes schema names and descriptions only. An XRPL address finds schemas that
it published, while a complete 64-digit hexadecimal value performs exact schema UID, generation ID
and transaction-hash resolution. The activity page is not a Credential activity feed. Search
results and exact Credential/transaction pages emit `noindex` metadata so search engines are not
invited to turn shared coordinates into a secondary public directory.

## Wallet support

The alpha deliberately enables only `CrossmarkAdapter` and `GemWalletAdapter` from `xrpl-connect@0.8.2`. Xaman is disabled because this flow requires a complete `tx_blob` from a sign-only request before the application controls submission and recovery.

Crossmark and GemWallet currently return `hash: ""` from their sign-only adapters. The application derives the transaction hash from `tx_blob` with `xrpl.hashes.hashSignedTx`. If a future adapter returns a non-empty hash, it must exactly match the derived value or the operation is rejected before submission.

The adapters still require real browser-extension testing for each native Credential transaction type. Unit tests cover the application-side blob, hash, persistence, and validation invariants; they do not prove that a particular released wallet UI supports XLS-70 transactions.

## Deterministic browser gate

The required Playwright gate exercises schema registration and credential issuance in Chromium,
including the two distinct finality stages. Issuance first receives deliberately mismatched indexed
evidence, withholds XCS success, then proves that `/operations` can re-confirm the exact event
without signing or submitting again.

```bash
pnpm --filter @xcs-protocol/web exec playwright install chromium
pnpm test:e2e
```

Playwright starts its own Nuxt development server with `XCS_BROWSER_E2E=1`. In that process only,
the normal wallet and XRPL client are replaced by deterministic in-browser fakes. The fake signer
encodes a syntactic transaction blob with an intentionally unusable signature marker; it contains
no seed or private key. HTTP API and public payload responses are intercepted by the test before
navigation, so the suite never contacts Testnet, an issuer host, or an XCS deployment.

This harness is not a wallet compatibility test and must never be used for a deployed instance.
Private and public runtime switches must match exactly, and both the Nitro startup guard and client
plugin reject the mode outside a development bundle. `nuxt.config.ts` also rejects
`XCS_BROWSER_E2E=1` when `NODE_ENV=production`.

## Browser response security

The Node SSR deployment emits defensive browser headers and a nonce-based strict Content Security
Policy in `Content-Security-Policy-Report-Only`. The observed policy has no `unsafe-inline` or
`unsafe-eval`: Nuxt's server-rendered scripts and styles receive a fresh random nonce for every HTML
response. Production browser connections are limited to the same origin, HTTPS and WSS. Local
development additionally permits HTTP and WS for the separate development API and Vite HMR.

The CSP is intentionally report-only until released Crossmark and GemWallet versions pass the
manual Testnet matrix. Other headers, including clickjacking protection, MIME sniffing prevention,
referrer suppression, HSTS and a restrictive Permissions Policy, are enforced immediately. COEP is
disabled and COOP uses `same-origin-allow-popups` to avoid introducing an untested cross-origin
isolation or popup boundary into injected-wallet flows. The response does not configure a CSP report
collector: violation documents can contain exact Credential permalinks, so collection requires a
separate privacy and retention design.

Every rendered HTML response, including Nuxt error documents, is `private, no-store` so an
intermediary cannot replay a response-bound nonce. Fingerprinted `/_nuxt/` assets remain public and
immutable.

`connect-src` necessarily permits arbitrary HTTPS destinations because the configured public API
and issuer-hosted payload origins are deployment or Credential data, while the public XRPL client
uses WSS. This means CSP cannot prevent HTTPS exfiltration after an already-authorized same-origin
script is compromised. Treat the deployed JavaScript bundle and origin as part of the signing trust
boundary. Before changing the policy from report-only to enforced, run every Playwright flow with no
CSP console violations and record real extension tests for connect, register, create, accept,
issuer/subject delete, cancellation, account/network changes, external payload CORS and the public
XRPL WSS endpoint.

## Network safety

Set:

```bash
NUXT_API_BASE_URL=http://api:3001
NUXT_API_INTERNAL_TOKEN=replace-with-the-private-api-token
NUXT_TRUSTED_PROXY_CIDRS=10.42.0.2/32
NUXT_PUBLIC_API_BASE_URL=https://xcs-api.example
NUXT_PUBLIC_RPC_URL=wss://s.altnet.rippletest.net:51233
NUXT_PUBLIC_PROFILE_ID=xrpl-testnet-xcs-v0.1
```

`NUXT_API_BASE_URL` is the server-side/SSR endpoint; in Compose it is `http://api:3001`.
`NUXT_API_INTERNAL_TOKEN` is private runtime configuration shared only with the API. Nuxt uses it
to authenticate an opaque HMAC rate-limit key deterministically derived from the visitor network
address on SSR requests, so visitors cannot mint or rotate arbitrary budgets. It must match
`XCS_INTERNAL_API_TOKEN`, contain 32–256 URL-safe random characters, and must never be placed under
`runtimeConfig.public` or a `NUXT_PUBLIC_*` variable. Forwarded addresses are ignored unless the
immediate peer matches `NUXT_TRUSTED_PROXY_CIDRS`; configure only the narrow CIDRs of ingress
proxies that overwrite client-supplied forwarding headers. With no trusted proxy, the direct socket
address is used, which is safe but may collapse visitors behind an undeclared proxy.
`NUXT_PUBLIC_API_BASE_URL` is exposed to the browser and must therefore be browser-reachable. The
profile is fetched from the XCS API, parsed by the SDK, and matched against the RPC server's reported
`network_id` before autofill and again before signing or recovery. This alpha rejects profiles other
than XRPL Testnet (`networkId: 1`). If `NUXT_PUBLIC_PROFILE_ID` is omitted, exactly one Testnet
profile must be returned by the API.

`NUXT_PUBLIC_RPC_URL` is serialized into browser-visible runtime configuration. A Nitro startup
guard and every wallet submission boundary reject embedded username/password values and require
`wss://` (`ws://` is accepted only for loopback development). They cannot determine whether an
opaque path or query parameter contains a provider token, so this setting must use a genuinely
public endpoint rather than either private indexer source.

## Pilot payload publication

The Commons beta issuance and acceptance flows support issuer-hosted public HTTPS payloads only.
Commons does not store, cache or search credential claims. The issuer payload host must
allow the web origin through CORS and return `application/json` (or a `+json` media type). Acceptance
first displays only indexed metadata, the URI and its host. The subject must explicitly consent
before the browser contacts that host. Consent stays in memory and is bound to the displayed
generation, exact URI and hostname; metadata is re-read and must still match before every payload
request. Issuer trust remains a separate decision: an explicitly `untrusted` issuer is blocked, a
`trusted` issuer needs no additional action, and the Commons-default `unknown` result requires a
second explicit subject acknowledgement bound in memory to the displayed issuer, generation and
trust status. Changing the wallet account, profile, link generation or trust status invalidates that
acknowledgement, which is checked again before the wallet is opened and is never journaled. Rejection
never fetches payload bytes. Local hostnames
(`localhost`, `.local`, `.internal`, `.lan`) and all IP literals are rejected before fetch.
This browser-only filter cannot pin DNS: a public hostname can still resolve or rebind to a private
address before the request. Deployments that accept untrusted issuers should therefore restrict
payload hosts to an application allowlist or add a resolver boundary with DNS/IP enforcement.

After consent, the browser performs a direct `no-store` fetch with a 10-second timeout, rejects
redirects or a changed final URL, limits the streamed body to 1 MiB, and verifies the exact RFC 8785
canonical bytes and URI digest. It sends the parsed payload object to `/v1/verify`; the API does not
resolve the URI, so its remote resolver may remain disabled. There is intentionally no server-side
fetch proxy, avoiding an SSRF trust boundary. IPFS remains part of the protocol and CLI, but is
outside the Commons-hosted browser beta.

The standalone `/verify` flow follows the same boundary. It first reads and displays indexed
credential metadata without contacting the issuer. Only after the verifier consents to the exact
displayed host does the browser fetch the payload with credentials omitted, CORS enabled and
redirects disabled, then POST the parsed object to the API. Verification never requests API-side URI
resolution. A link generation constraint is checked before the host fetch and again before the
result is accepted.

The exact `/credentials/:generationId` permalink applies the same boundary while also showing the
schema and bounded lifecycle timeline. Its server-rendered response loads only indexed generation,
schema and four-dimensional metadata. Public claims remain absent until the visitor consents to the
displayed host; the browser then re-reads the profile, exact generation, tuple and URI before its
single issuer-host fetch, verifies the locally parsed payload through `/v1/verify`, and renders fields
in resolved-schema order. Claims remain in memory and are never journaled, cached or included in
receipt exports. A replaced generation remains readable, but cannot reuse the current tuple
generation's verification report or enable payload loading. A deleted generation that is still the
current generation for its tuple may still be checked after consent; its deleted lifecycle state
remains visible alongside the payload evidence.

## Durable submission journal

Signed transaction blobs are stored in the origin's IndexedDB database `xcs-wallet-journal` before
the first submit call, but only after the SDK has validated the wallet hash/blob and proved that the
signed fields exactly equal the reviewed transaction. SDK journal stages are retained with the hash,
`LastLedgerSequence`, profile, XRPL result and the minimum business context needed to reconcile the
operation. Schema registration stores publisher, canonical schema digest and exact memo size.
Issuance stores the tuple, public URI, payload digest and optional expiration. Tuple-only actions
store the exact reviewed generation ID. The `/operations` page first checks transaction status by
hash; only a still-unvalidated transaction may be resubmitted, after checking that its generation is
still current. The blob is
removed from the local record as soon as the operation becomes `validated`, `expired`, or `failed`.
A transaction has two separately displayed outcomes: XRPL must first report `validated: true` and
`TransactionResult: tesSUCCESS`, then the authoritative indexer must expose its exact schema
registration or Credential event. The journal and v0.2 receipt keep the latter as
`businessConfirmation: pending|confirmed|rejected|mismatch|timeout`, with ledger hash/index,
transaction index, UID/generation or protocol rejection reason where applicable. An XRPL-valid
transaction is never represented as XCS-confirmed when it lacks a positive validated ledger index,
when indexing times out, or when the indexed event reports a different transaction hash or ledger
index. A timeout is recoverable by rechecking the indexer only; it never causes a rebroadcast.

Before opening the wallet, IndexedDB atomically reserves a business key across tabs: profile,
publisher and schema digest for registration; profile and credential tuple for issuance; profile,
tuple and generation for every lifecycle action, independently of the selected action. A second
recoverable operation with the same key is rejected. Ownership is checked atomically again after the
wallet returns the signed blob and before submission. Only a `prepared` draft that has neither hash
nor signed blob may be abandoned to release its key.

Native `CredentialAccept` and `CredentialDelete` transactions contain only issuer, subject and
credential type; they cannot cryptographically bind an XCS generation ID. An issuer could therefore
delete and recreate the same tuple after the final generation check but before ledger execution. The
post-validation event check detects that race and withholds application success, but cannot prevent
the native transaction from affecting the replacement object. This remains a protocol-level race
until XRPL provides a generation-bound precondition.

The journal contains no seed or private key. A signed blob can nevertheless be relayed until its sequence or `LastLedgerSequence` makes it unusable, so the application must maintain a strict Content Security Policy and treat same-origin script execution as a trust boundary. Clearing browser site data removes the local recovery journal.

Terminal journal entries delete the recoverable signed blob. Receipt export reconstructs a strict
v0.2 allowlist of public business coordinates, transaction hash, validated XRPL result and indexed
proof fields; it does not export signed blobs, claims, payload contents or free-form error messages.
Records written by the v0.1 alpha remain readable, but an incomplete legacy context cannot be
treated as XCS-confirmed without new exact evidence.
Receipts are sanitized local records, not signatures from Commons or independent trust anchors; a
verifier must still resolve the referenced transaction against an authoritative XCS indexer.

For any complete operation already validated with `tesSUCCESS`, `/operations` can re-check a
`pending`, `timeout` or `mismatch` business confirmation. Schema registration uses the exact
`GET /v1/networks/:network/schema-registrations/:transactionHash` proof and requires its publisher
and canonical digest before accepting the returned UID. Credential issuance and lifecycle actions
use `GET /v1/networks/:network/credentials/:issuer/:subject/:schemaUid/events/:transactionHash` and
verify tuple, hash, event type and generation. A confirmed issuance produces an acceptance link
bound to profile, issuer, schema and generation (the subject still comes from the connected wallet),
plus a full verification link. Reconfirmation never reads a signed blob, connects to XRPL or
rebroadcasts the transaction.
