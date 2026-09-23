# XCS Testnet web app

The Nuxt application is the accountless, non-custodial Testnet site for XCS. Its public navigation
keeps four entries—Explorer, Create, Verify and Docs—while preserving the schema, issuance,
lifecycle and developer workflows in one deployment. EAS and EASScan are interaction-design
references only; the site constructs native XRPL transactions under the frozen XCS v0.1 protocol.

## UI stack

The site is built on Nuxt UI 4 and Tailwind CSS 4. The XCS identity lives in
`app/assets/css/main.css` (theme tokens and Nuxt UI semantic variables) and `app/app.config.ts`
(component defaults). Repeated XCS patterns are the small kit in `app/components/` (`PageHeader`,
`StatusBox`, `StatusPill`, `MetadataList`, `VerificationGrid`, `JsonBlock`, `Pagination`,
`EmptyState`); pages compose Nuxt UI primitives with it and keep their workflow logic in
`composables/` and `utils/`.

For every write, the application constructs and autofills an XRPL transaction, shows those exact
final fields to the user, then asks an external wallet to sign without submitting. The private key
or seed never enters the application. There is no XCS user or organization account, server session,
team administration or batch issuer in the Testnet beta; one wallet action is prepared at a time.

Immediately before opening the wallet, the site requires a fresh, profile-bound readiness proof
from the authoritative indexer. It repeats that proof after the wallet returns and before retaining
or submitting the signed blob. A later retransmission from the local recovery journal requires a
new proof immediately before the XRPL side effect. A missing, timed-out, malformed, stale or
inconsistent proof fails closed; the site requests a non-cacheable response and never falls back to
the public submission RPC or the diagnostic status DTO.

## Public discovery boundary

All valid permissionless schemas are public and discoverable. Credential verification is
deliberately exact: callers share a generation ID, transaction hash or the complete
issuer/subject/schema tuple. The site has no subject feed, account-wide Credential enumeration or
claims search served by Commons, and it displays no Commons issuer badge or universal trust result.
The connected-wallet `/credentials` page is a local self-view: the browser reads raw Credential
objects directly from the configured public XRPL RPC, then reconciles each XCS-shaped tuple through
the existing exact API route. It does not fetch claims or add a Commons-served account-wide
Credential list. The RPC provider can observe the queried address and browser network metadata.
Aggregate statistics contain only ledger-derived metadata. See
[`ADR 0002`](../../docs/adr/0002-public-product-and-discovery.md).

The next-phase portal admission and private-claim access decisions are recorded in
[ADR 0004](../../docs/adr/0004-role-based-application.md). They are not implemented: the current
site remains accountless, and existing public payloads do not become private through this decision.

## Implemented site map

English is the default, unprefixed locale. French remains available under `/fr` from the language
selector.

The current application organizes the existing workflows as follows:

- **Landing and Explorer:** `/` presents the editorial Testnet landing page, aggregate checkpoint
  statistics and exact search. `/schemas` and `/schemas/:uid` provide paginated schema discovery,
  `/activity` shows schema registrations only, `/credentials/:generationId` and
  `/transactions/:hash` expose exact evidence, `/credentials` lists unaccepted credentials for the
  currently connected wallet through direct XRPL discovery, and `/status` shows the indexer/network
  view;
- **Create:** `/studio` is the single creation hub. It emphasizes schema registration and
  single-credential issuance, then links acceptance, revocation and local operation recovery.
  Schema registration has a guided scalar-field editor, course-completion and diploma templates,
  plus the advanced JSON editor. Issuance can derive a guided claims form from a compatible
  resolved schema and retains the advanced JSON path;
- **Verify:** `/verify` accepts a shared generation ID and opens its exact permalink, or exposes the
  complete issuer/subject/schema tuple as an advanced lookup. The permalink reports ledger state,
  schema validity, payload integrity and issuer trust separately;
- **Docs:** `/developers` loads the active runtime profile, executes the privacy-explicit
  exact-generation verification flow, derives REST/cURL, TypeScript and monorepo CLI examples from
  that evidence, documents the wallet `Signer` boundary and catalogs aggregate versus exact API
  routes; `/learn` remains the protocol walkthrough.

Explorer text search indexes schema names and descriptions only. An XRPL address finds schemas that
it published, while a complete 64-digit hexadecimal value performs exact schema UID, generation ID
and transaction-hash resolution. The activity page is not a Credential activity feed. Search
results and exact Credential/transaction pages emit `noindex` metadata so search engines are not
invited to turn shared coordinates into a secondary public directory.

## Wallet support

The chooser shows the pending wallet name while approval and network confirmation are outstanding.
Connection errors stay at the top of the scrollable chooser. If the wallet reports another
network, select XRP Ledger Testnet and retry; an existing app permission in the extension does not
by itself establish the site's current session. Reloading the page requires connecting again
because automatic reconnection is disabled.
A connection must finish within 90 seconds; **Cancel connection** invalidates the attempt immediately,
so a late extension response cannot reconnect it. Once approved, the header shows the wallet name,
address, network and an explicit **Disconnect** action. Rejection and timeout errors remain visible.
The open chooser updates when Crossmark emits its real provider-detection event; it does not require
closing and reopening the menu. Account refresh before preparation/signing has a 10-second deadline.
A timeout invalidates the session immediately, even if extension teardown hangs; late replies cannot
restore the old account.

The rc.2 Crossmark adapter does not forward session-change events. XCS listens to the official
Crossmark SDK's `signout`, `user-change` and `network-change` events. Signout clears the connection;
user/network notifications trigger an authoritative account refresh. Duplicate initialization
notifications retain the approved session when its account and network are unchanged. Changed or
unverifiable sessions are disconnected with an explanation. Pending sign-in events and other wallets
are left alone. This does not replace the account/network and signature checks at submission.

`pnpm exec playwright test --config playwright.crossmark.config.ts` checks the full production
connection path against `https://localhost:3443` (override with `XCS_WALLET_TEST_URL`). The test uses
an isolated browser with a fixture of Crossmark's extension messages, including response envelopes
and duplicate initialization notifications; it does not replace SDK methods or modify the deployed
site. Set `XCS_BROWSER_EXECUTABLE` to Brave's executable when using the macOS-trusted local CA.
Actual wallet approval still requires a manual extension test.

The web app pins `xrpl-connect@1.0.0-rc.2` and
`@xrpl-commons/xrpl-connect-vue@1.0.0-rc.2`. The official Vue plugin owns the application-scoped
`WalletManager` and reactive account state. XCS uses its documented headless `connect()` API from a
small CSP-compatible chooser: the packaged `<WalletConnector>` loads Google Fonts and inline styles,
which do not satisfy XCS's current browser policy. XCS does not subclass wallet adapters.
One versioned pnpm patch fixes the rc.2 ESM Crossmark adapter used by this application:
it validates the network returned with the fresh SignIn approval instead of discarding it
and reading Crossmark's separately hydrated background replica. Older responses that omit
the network still require the live query. A present but incomplete network is rejected;
Mainnet never becomes Testnet. Account refresh and pre-signature checks validate the documented
SDK session network, updated by approval and network-change events. The raw background getter
is stale in Crossmark 0.2.19; it is not used as a second network gate. Missing/malformed session
data still fails closed, without falling back to the adapter's previous network. See
[`patches/README.md`](../../patches/README.md) for scope and removal criteria.
It registers Xaman, Crossmark, GemWallet, WalletConnect, Ledger, Xyra, Otsu and MetaMask Snap. Xaman is added only when `NUXT_PUBLIC_XAMAN_API_KEY` is set, and
WalletConnect only when `NUXT_PUBLIC_WALLET_CONNECT_PROJECT_ID` is set. Both values identify a
public application to its wallet provider; they are browser-visible identifiers, not secrets.

For local testing, keep Otsu and Crossmark in separate browser profiles. The inspected Otsu
unpacked extension locks `window.xrpl` and `window.crossmark`; Crossmark 0.2.19 also writes
those globals. Co-installation can prevent Crossmark's provider from initializing. This is
an extension collision, not something the application should hide by faking availability.

Public deployment is additionally blocked on third-party license review. The RC bundle contains
WalletConnect code under the WalletConnect Community License, and its GemWallet dependency requires
GemWallet's permission for public or beta use. Commons must record those approvals and ship the
required notices before enabling a public build. Returning to `0.8.2` or deleting the declared
dependencies would only hide the same bundled code from the license scanner; it is not a compliant
workaround. The upstream adapter packages are not yet published separately, so there is currently no
npm-supported way to retain all eight adapters while excluding only those two integrations.

`autoConnect` is disabled: an explicit selection in the XCS chooser is the only connection trigger,
so a cached Xaman session is never presented as a fresh user action. Xaman may replace
`LastLedgerSequence` during signing; XCS omits that volatile field from the Xaman request, then
cryptographically checks the complete returned blob and permits only the SDK's explicit
`LastLedgerSequence` refresh rule. The initial wallet network, active XCS profile and configured
XRPL RPC are all required to resolve to Testnet before submission. XCS does not use Xaman's later
optional `ping()` metadata as a second network gate.

Otsu stores dApp permissions by origin and otherwise resolves a later `connect()` from the stored
address without presenting the wallet approval again. Before an explicit Otsu selection, XCS calls
the adapter's public `disconnect()` method to revoke that stale origin permission, then delegates the
new connection to XRPL Connect. This keeps the selected account bound to a fresh user-approved Otsu
session instead of silently reusing an older address. Otsu's extension service worker can retain the
public account while its signing key is locked. XRPL Connect rc.2 currently mislabels the resulting
Otsu `Account not found` failure as an uninstalled wallet. XCS rechecks the adapter's public
availability, reports the signing-account failure accurately and closes that unusable session. The
user must unlock Otsu and explicitly reconnect before retrying; XCS never accesses wallet keys or
repeats a rejected signing request automatically.

XCS filters this surface to adapters that expose `sign()` and never calls `signAndSubmit`. A wallet
may return a `tx_blob` or signed `tx_json`; the application normalizes the artifact, derives and
checks its hash, verifies the XRPL signature and optional `signerAddress`, and proves that no
reviewed transaction field changed. Only then does it persist the signed blob and submit it through
the configured public RPC itself. A missing, malformed or contradictory wallet artifact is rejected
before persistence or relay.

Wallet capability is transaction-specific. GemWallet 3.8.x embeds an XRPL validator from before
native XLS-70 Credentials: it can sign the `Payment` used for schema registration but rejects
`CredentialCreate`, `CredentialAccept` and `CredentialDelete` before signing. For these three types,
XCS offers an explicit raw-signing path. The full reviewed transaction remains visible, and a new
acknowledgement is required for every attempt: GemWallet displays a hex message, not decoded fields.
This is a transaction authorization, not a login signature. XCS uses `GemWalletAPI.signMessage(hex,
true)`, exported by XRPL Connect, because rc.2's generic message adapter discards the hex flag.
`xrpl.js` validates and serializes the exact prepared transaction, binds its public key to the
connected Testnet account, assembles the returned signature and verifies it through the same SDK
boundary before journaling or submission. No keys enter XCS, no automatic fallback follows a
rejection, and schema Payments still use the normal adapter. Raw signing currently supports master
keys only; delegated regular keys and multisigning are rejected rather than guessed.
See [the real GemWallet Testnet qualification](../../docs/runbooks/gemwallet-raw-signing.md) for
validated create/accept/delete transactions, popup limitations and local rollback.
Xaman has native Credential handling in its current
source and is the preferred candidate when its public application identifier is configured, but it
still requires the real-wallet Testnet gate below. Unknown adapters remain visible as unvalidated;
if one emits the exact legacy `Invalid field TransactionType` error, XCS converts it to the same
actionable diagnostic without masking unrelated wallet failures.

This adapter list does not promise compatibility with every wallet. WalletConnect broadens the
discovery surface, but each candidate wallet must support the XRPL Testnet namespace and native
`Credential*` transaction types. Real extension, hardware-device, popup and QR/deep-link tests for
every enabled adapter remain a release gate; unit tests prove the application-side normalization,
signature, persistence and submission invariants, not a released wallet UI.

## Deterministic browser gate

The required Playwright gate exercises schema registration and credential issuance in Chromium,
including the two distinct finality stages. Issuance first receives deliberately mismatched indexed
evidence, withholds XCS success, then proves that `/operations` can re-confirm the exact event
without signing or submitting again. The same deterministic journey accepts the pending Credential,
removes the resulting active generation through the subject wallet, opens its exact deleted
permalink and exports the sanitized `subject_removed` receipt. A separate case proves that rejecting
an unaccepted pending generation contacts neither the payload host nor `/v1/verify`. Two negative
cases prove that unavailable readiness prevents the wallet call and that readiness disappearing
while the wallet is open prevents XRPL submission while retaining the already validated signature
for a later retry. Recovery cases seed a syntactically valid signed operation in IndexedDB, reload
the application, and prove both that a ready indexer allows validation without a second wallet
signature and that an unavailable indexer prevents retransmission while preserving the blob for a
later retry. A corrupted recovery record is
also rejected before status reconciliation, readiness or submission without deleting its blob. The
suite also exercises the Developers quickstart against the deterministic exact-generation API,
checks that local-payload verification never sets `resolvePayload`, and proves that a replaced
generation fails before a payload can be submitted. Its loopback-only storage case creates an
IPFS-addressed payload in one browser, fails closed when those bytes disappear, completes issuer
creation and subject acceptance, then verifies the same digest from that browser. A separate case
proves that an external IPFS CID absent from local storage is never described as browser-local.

```bash
pnpm --filter @xcs-protocol/web exec playwright install chromium
pnpm test:e2e
```

Playwright starts its own Nuxt development server with `XCS_BROWSER_E2E=1`. In that process only,
the normal wallet and XRPL client are replaced by deterministic in-browser fakes. The fake signer
encodes a syntactic transaction blob with an intentionally unusable signature marker; it contains
no seed or private key. Pilot HTTP and public-payload responses are intercepted by the test, while
the Developers flow uses guarded local-only Nitro fixtures. The suite never contacts Testnet, an
issuer host or an XCS deployment.

## Developers quickstart privacy boundary

The `/developers` runnable flow starts from a deliberately shared `generationId`. It reads that
exact generation, then its exact schema, then asks `/v1/verify` for metadata with
`resolvePayload: false`. Because verification operates on the tuple's current generation, the page
requires the report's `generationId` to match the shared generation before showing the local payload
step. It repeats the exact reads and that generation guard immediately before verification and
checks it again on the final report, so a deleted-and-recreated tuple fails closed.

The payload field accepts the exact RFC 8785 canonical JSON bytes. The browser validates the schema
and integrity-bound URI locally first. Choosing the four-dimension API check then sends the parsed
public claims to the API in the `payload` property while omitting `resolvePayload`; the API receives
those claims for this request but does not persist them or fetch the URI. Integrators that do not
want the verifier process to receive claims can instead run `xcs payload check` locally for a
standalone schema and retain the metadata-only API report, whose payload dimension necessarily
remains `not_checked`. A generation without a payload URI is also kept metadata-only: the page does
not offer a payload form or generate URI-dependent examples for it.

SDK and CLI examples are explicitly monorepo-alpha examples. The packages are not assumed to be
available from a public registry. CLI commands build the workspace package and invoke
`node dist/bin.js`; transaction examples return unsigned fields and cross an external wallet
`Signer` interface, never a seed/private-key API.

The REST/cURL example parses `credential.json` with `jq`, so its API report validates the
recanonicalized object rather than proving that the source file was already byte-for-byte canonical.
The runnable page and TypeScript example perform that local byte/integrity check. The CLI does so
only for standalone schemas; for a schema with `extends`, the generated CLI block explains that the
alpha command has no resolved catalog and omits the unsupported local check.

This harness is not a wallet compatibility test and must never be used for a deployed instance.
Private and public runtime switches must match exactly, and both the Nitro startup guard and client
plugin reject the mode outside a development bundle. `nuxt.config.ts` also rejects
`XCS_BROWSER_E2E=1` when `NODE_ENV=production`.

## Schema text fields

Schema names (1–64 UTF-8 bytes) and descriptions (1–256 UTF-8 bytes) are required
single-line protocol fields. The guided editor uses single-line inputs with byte
counters and field-specific validation messages. Accents and emoji can use several
bytes; the UI does not truncate or replace the submitted text. JSON mode uses the
same protocol checks and identifies the failing field instead of discarding its
error path.

## Hosted HTTPS payloads

Set `NUXT_PUBLIC_PAYLOAD_BASE_URL` to the API's exact public HTTPS payload origin and
`XCS_LOCAL_PAYLOAD_STORE=0`. Hosted issuance requires explicit public-storage consent.
Canonical payloads larger than **64 KiB of UTF-8 bytes** are rejected before preparation and again
before signing, matching the hosted API limit. External issuer-managed storage keeps its own limit.
The page builds the immutable URI, signs and submits `CredentialCreate`, waits for
ledger/indexer confirmation, then publishes the canonical bytes with the validated
signed blob. It checks the publication receipt and reads the HTTPS bytes back.
Before signing, a credential-specific HEAD request checks that the public host is
reachable. A 404 is expected before first publication; network/CORS failures or
server errors block signing. This does not prove future availability or successful
publication. Sharing/acceptance links appear only after exact-byte publication
verification succeeds, never just because the ledger transaction was validated.
Issuer-managed external HTTPS hosting still requires publication before signing.

The consented public payload is saved in a per-job browser recovery queue before opening the wallet.
The validated signature is persisted before submission and linked to the operation journal. This
link also recovers an interrupted second storage write. Storage/quota failures block submission;
pending copies are never silently evicted. Up to 20 pending copies are retained until successful
publication or explicit removal. Do not clear browser data while recovery is needed.

After a reload, **Issue** and **Operations** show pending publications. **Retry payload publication**
only uploads the same payload and signed transaction; it never signs or submits another credential.
The API still requires validated, indexed evidence. If submission timed out, reconcile the original
operation in Operations, then retry publication. Recovery is removed only after the receipt and
HTTPS bytes verify; terminal journal signatures are then purged. Damaged records are isolated and
can be explicitly removed without blocking valid jobs. An interrupted wallet approval with no
recorded signature requires checking the wallet/Operations first, not blindly issuing again.
Download the payload copy before removing an unfinished recovery record. Recovery is local to this
browser profile and origin, not a backup across devices; it uses no test payload-serving fallback.

Do not use a rotating tunnel domain for durable credentials: the URI on XRPL cannot
follow a domain change. A tunnel can prove a disposable Testnet flow, but production
requires a fixed domain and persistent, backed-up storage.

## Local browser payload store

For manual Testnet flows without an issuer-controlled HTTPS host, start the development site with:

```bash
XCS_LOCAL_PAYLOAD_STORE=1 pnpm --filter @xcs-protocol/web dev
```

On a loopback origin only, the issuance page then offers **Local test storage (this browser)**. It
stores the exact canonical payload in same-origin `localStorage`, derives the normative raw
SHA-256 `ipfs://` CID, reads the bytes back before the wallet opens, and lets acceptance or
verification pages in that same browser resolve the payload after explicit consent. The active API
profile still has to be XRPL Testnet.

This is a local demonstration aid, not hosting. Entries expire after 24 hours and are limited to 64
KiB and 20 active payloads. The issuer must acknowledge that the payload contains no personal,
secret or production data before person-shaped field identifiers such as `prenom` are accepted; the
acknowledgement is persisted with that local record so later same-browser reads remain possible.
This is not value classification and does not make real personal data safe. A purge button deletes
every local demo entry, but it cannot delete the corresponding Testnet Credential from XRPL.
Another browser, device, CLI or public verifier cannot resolve these locally stored bytes. The
feature is disabled by default, rejects non-loopback browser origins, and makes Nuxt fail startup
when enabled in a production build.

## Browser response security

The Node SSR deployment emits defensive browser headers and a nonce-based strict Content Security
Policy in `Content-Security-Policy-Report-Only`. The observed policy has no `unsafe-inline` or
`unsafe-eval`: Nuxt's server-rendered scripts and styles receive a fresh random nonce for every HTML
response. Production browser connections are limited to the same origin, HTTPS and WSS. Local
development additionally permits HTTP and WS for the separate development API and Vite HMR.

The CSP is intentionally report-only until every enabled XRPL Connect adapter passes the manual
Testnet matrix. WalletConnect modal styles/images must also be observed and qualified before
enforcement. Other headers, including clickjacking protection, MIME sniffing prevention, referrer
suppression, HSTS and a restrictive Permissions Policy, are enforced immediately. That policy
allows same-origin `hid` and `usb` access for the user-initiated Ledger flow while denying those
features to cross-origin content. COEP is disabled and COOP uses `same-origin-allow-popups` to avoid
introducing an untested cross-origin isolation or popup boundary into injected-wallet flows. The
response does not configure a CSP report collector: violation documents can contain exact
Credential permalinks, so collection requires a separate privacy and retention design.

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
NUXT_DATABASE_URL=postgres://xcs_api:<password>@<managed-postgres>/xcs?sslmode=verify-full
# Required only for optional publication/pinning; a distinct restricted role.
NUXT_PAYLOAD_DATABASE_URL=postgres://xcs_payload_writer:<password>@<managed-postgres>/xcs?sslmode=verify-full
XCS_TRUSTED_PROXY_CIDRS=10.42.0.2/32
NUXT_PUBLIC_API_BASE_URL=
NUXT_PUBLIC_RPC_URL=wss://s.altnet.rippletest.net:51233
NUXT_PUBLIC_PROFILE_ID=xrpl-testnet-xcs-v0.1
NUXT_PUBLIC_XAMAN_API_KEY=optional-public-xaman-application-id
NUXT_PUBLIC_WALLET_CONNECT_PROJECT_ID=optional-public-reown-project-id
```

`NUXT_DATABASE_URL` and `NUXT_PAYLOAD_DATABASE_URL` are private server-only connections. The first
uses the read-only `xcs_api` role; the second permits only hosting/pinning table writes. Never use
an administrator or indexer URL for either pool. See [API surfaces](../../docs/api-surfaces.md).

Nuxt serves `/v1/*` directly. SSR invokes the same handlers locally; there is no internal API
token or private HTTP hop. Empty `NUXT_PUBLIC_API_BASE_URL` uses the site origin. A configured
public API origin must be browser-reachable and route to the same reviewed Nuxt deployment.
Forwarded addresses are ignored unless the immediate peer matches `XCS_TRUSTED_PROXY_CIDRS`;
configure only narrow ingress CIDRs whose proxies replace client-supplied forwarding headers.
With no trusted proxy the socket address is used, which safely shares the budget behind an
undeclared proxy. The profile is fetched from the XCS API, parsed by the SDK, and matched against the RPC server's reported
`network_id` before autofill and again before signing or recovery. This alpha rejects profiles other
than XRPL Testnet (`networkId: 1`). If `NUXT_PUBLIC_PROFILE_ID` is omitted, exactly one Testnet
profile must be returned by the API.

`NUXT_PUBLIC_XAMAN_API_KEY` and `NUXT_PUBLIC_WALLET_CONNECT_PROJECT_ID` are optional public
application identifiers. Omitting either variable removes only that adapter; it does not prevent the
other six adapters from loading. Do not put a Xaman secret, WalletConnect relay secret, wallet key or
other credential in either value. In Compose, set the corresponding operator variables
`XCS_PUBLIC_XAMAN_API_KEY` and `XCS_PUBLIC_WALLET_CONNECT_PROJECT_ID`.

Each independently hosted XCS deployment needs its own Xaman public application key and registered
origin. The Commons key is not a universal credential for arbitrary self-hosted domains. Follow
Xaman's [browser SDK setup](https://docs.xaman.dev/environments/browser-web3); API secrets remain
server-side and are not used by this browser integration.

`XCS_LOCAL_PAYLOAD_STORE` is a source-time development gate rather than a deployment setting. Do
not pass it through Compose or expose it as a general Commons storage option.

When the configured API profile selector ends in `-controlled-pilot`, the network status page labels
its registry as controlled. The primary navigation no longer carries persistent environment banners;
profile/API mismatches still fail through the normal active-profile checks.

`NUXT_PUBLIC_RPC_URL` is serialized into browser-visible runtime configuration. A Nitro startup
guard and every wallet submission boundary reject embedded username/password values and require
`wss://` (`ws://` is accepted only for loopback development). They cannot determine whether an
opaque path or query parameter contains a provider token, so this setting must use a genuinely
public endpoint rather than either private indexer source.

## Pilot payload publication

The deployed Commons beta issuance and acceptance flows support public HTTPS payloads,
whether issuer-hosted or published through the configured hosted service. The loopback
development aid documented above is intentionally not deployable. The payload host must
allow the web origin through CORS and return `application/json` (or a `+json` media type). Acceptance
first displays the issuer, recipient, schema name and status. URI, hashes and ledger
diagnostics are collapsed under **Technical details**. Checking **Load and verify these
details** grants consent and immediately starts verification, with loading/error feedback
and a retry action; it never opens the wallet. For an unknown issuer, the acknowledgement
becomes available after the content loads. Checking it prepares the transaction and shows
**Accept in wallet** next to the review; only clicking that button requests a signature.
Raw transaction fields remain available in a collapsed preview. The subject must explicitly
consent before the browser contacts the displayed host. Consent stays in memory and is bound to the displayed
generation, exact URI and hostname; metadata is re-read and must still match before every payload
request. Issuer trust remains a separate decision: an explicitly `untrusted` issuer is blocked, a
`trusted` issuer needs no additional action, and the Commons-default `unknown` result requires a
second explicit subject acknowledgement bound in memory to the displayed issuer, generation and
trust status. Changing the wallet account, profile, link generation or trust status invalidates that
acknowledgement, which is checked again before the wallet is opened and is never journaled. Rejection
and subject removal read only the authoritative exact tuple: they never fetch payload bytes or ask
`/v1/verify` for payload/trust dimensions. They re-read the profile, tuple, generation, state and
normative `accepted` flag after the wallet returns, before persisting or submitting the signed blob.
An unaccepted Credential can be accepted only while `pending` and rejected while `pending` or
`expired`; an accepted Credential can be removed while `active` or `expired`. Local hostnames
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

The standalone `/verify` page opens `/credentials/:generationId` directly when the verifier has a
shared generation ID. Its advanced tuple flow follows the same privacy boundary: it first reads and
displays indexed credential metadata without contacting the issuer. Only after the verifier consents
to the exact displayed host does the browser fetch the payload with credentials omitted, CORS
enabled and redirects disabled, then POST the parsed object to the API. Verification never requests
API-side URI resolution. A link generation constraint is checked before the host fetch and again
before the result is accepted.

The exact `/credentials/:generationId` permalink applies the same boundary while also showing the
schema and bounded lifecycle timeline. Its server-rendered response loads only indexed generation,
schema and four-dimensional metadata. Public claims remain absent until the visitor consents to the
displayed host; the browser then re-reads the profile, exact generation, tuple and URI before its
single issuer-host fetch, verifies the locally parsed payload through `/v1/verify`, and renders fields
in resolved-schema order. Claims remain in memory and are never journaled, cached or included in
receipt exports. A replaced generation remains readable, but cannot reuse the current tuple
generation's verification report, enable payload loading or expose a lifecycle-action button. A
current unaccepted `pending` permalink links to accept/reject; an unaccepted `expired` permalink
links to reject; and a current accepted `active` or `expired` permalink links to subject removal.
Deleted generations expose no lifecycle CTA. A deleted generation that is still the current
generation for its tuple may still be checked after consent; its deleted lifecycle state remains
visible alongside the payload evidence.

## Durable submission journal

Wallet `tx_blob` and signed `tx_json` responses are first normalized to one verified signed blob.
That blob is stored in the origin's IndexedDB database `xcs-wallet-journal` before the first submit
call, but only after the SDK has validated its hash and signature and proved that the signed fields
exactly equal the reviewed transaction. SDK journal stages are retained with the hash,
`LastLedgerSequence`, profile, XRPL result and the minimum business context needed to reconcile the
operation. Schema registration stores publisher, canonical schema digest and exact memo size.
Issuance stores the tuple, public URI, payload digest and optional expiration. Tuple-only actions
store the exact reviewed generation ID. The `/operations` page first checks transaction status by
hash, but only after decoding the blob and matching its derived hash, `LastLedgerSequence`, account,
transaction type and any explicit `NetworkID` against the journal. Only a still-unvalidated
transaction may be resubmitted, after checking that its generation is still current. The blob is
removed from the local record as soon as the operation becomes `validated`, `expired`, or `failed`.
A transaction has two separately displayed outcomes: XRPL must first report `validated: true` and
`TransactionResult: tesSUCCESS`, then the authoritative indexer must expose its exact schema
registration or Credential event. The journal and v0.2 receipt keep the latter as
`businessConfirmation: pending|confirmed|rejected|mismatch|timeout`, with ledger hash/index,
transaction index, UID/generation, deletion cause or protocol rejection reason where applicable.
`credential-remove` remains receipt version `0.2`: the allowlisted export shape is unchanged and
this alpha adds only a lifecycle-action enum value before public package release. An XRPL-valid
transaction is never represented as XCS-confirmed when it lacks a positive validated ledger index,
when indexing times out, or when the indexed event reports a different transaction hash or ledger
index. A timeout is recoverable by rechecking the indexer only; it never causes a rebroadcast.

Before opening the wallet, IndexedDB atomically reserves a business key across tabs: profile,
publisher and schema digest for registration; profile and credential tuple for issuance; profile,
tuple and generation for every lifecycle action, independently of the selected action. A second
recoverable operation with the same key is rejected. Ownership is checked atomically again after the
wallet returns the signed blob and before submission. Only a `prepared` draft that has neither hash
nor signed blob may be abandoned to release its key.

The profile-bound readiness endpoint is checked just before the wallet call and again after the
wallet response. Once the SDK has validated the wallet artifact, the application immediately
persists it before running volatile profile, readiness and generation guards. If a final guard fails,
the operation remains `signed` and is not submitted. Recovery first reconciles the stored hash
without creating an XRPL side effect. If it is still unvalidated, retransmission requires a new
readiness proof and a second ownership check on the business lock. It never asks the wallet to sign
again.

RPC teardown and history-refresh failures do not replace the transaction result or leave
the UI busy. Unknown transaction hashes remain recoverable; the SDK no longer records
terminal expiry from the open ledger number alone. Proving final absence requires a
complete validated submission window, which the current journal does not retain.

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
verify tuple, hash, ledger coordinates, event type, generation, accepted flag and deletion cause.
Subject removal requires `deleted` plus `subject_removed`; for a self-issued Credential the
protocol-required projected cause is `issuer_revoked`. Rejection requires `subject_rejected` for a
distinct issuer/subject tuple. A confirmed issuance produces an acceptance link
bound to profile, issuer, schema and generation (the subject still comes from the connected wallet),
plus a profile-bound permalink to the exact immutable generation. Confirmed acceptance, rejection,
removal and issuer revocation return to that same generation page so its updated indexed lifecycle
can be reviewed. A generation-bound subject action resolves that generation before the tuple lookup
and rejects a connected wallet that is not its subject, instead of surfacing a misleading tuple 404.
Reconfirmation never reads a signed blob, connects to XRPL or rebroadcasts the transaction.
