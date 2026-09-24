# Recipient and verifier workspaces

These optional workspaces implement issues #32 and #33 under [ADR 0005](../adr/0005-role-based-application.md).
Enable the existing authentication and issuer services, with their separate restricted database
connections. No additional recipient/verifier pool or environment variable is required. Public Studio
and public verification remain accountless; portal approval does not establish issuer trust.

## Upgrade and recovery

Run the indexer's existing database migration/provisioning procedure before deploying the new web
image. Migration `0007_recipient_verifier` adds `app_verifier_history`; migrations 0000–0006 remain
unchanged. Reprovision `xcs_issuer` grants for presentation creation/revocation, metadata history and
readiness evidence. The projection reader, auth and admin roles gain no private-payload access.
See [application database](../database-app.md) and the [issuer runbook](issuer.md).

Rollback deploys the previous compatible web image and leaves the additive table and records intact.
Do not drop history or rewrite migration history. Payloads and application records require backups;
replaying XRPL cannot reconstruct off-chain claims or sharing grants.

## Recipient journey

1. Open the invitation, sign in and explicitly claim it. Link the intended Testnet wallet in Account.
2. Open `/recipient` for invitations, issued credentials and issuance/revocation notifications.
3. Review the exact credential. Private content requires explicit consent and an authenticated
   same-origin read. Local canonical-byte/digest/schema checks precede wallet approval; the server
   rechecks ownership, linked wallet, generation and current indexed state. Reject/remove reads no
   payload. Ledger confirmation is reconciled by exact transaction hash without another signature.
4. Create a public link, or select a currently approved verifier organization for a full link.
   Copy the link or its locally generated QR code; raw tokens are returned only at creation.
5. Revoke a grant from that credential's presentation list. All active grants remain visible, up to
   200 per credential. Revoke an existing grant before creating another at the limit.

Notifications reflect indexed events, including revocations outside the portal. Email delivery
continues through the existing issuer issuance/revocation flow; an external ledger event does not
start a new mail service. Workspace lists are bounded to 200 and credential event lists to 100.
The unfiltered presentations API is a bounded recent view; the credential-specific list prioritizes
all active grants ahead of revoked history.

## Presentation and verifier journey

`/presentations#token` (also `/fr/presentations`) removes the fragment from the address bar. Reading
requires an explicit POST; merely navigating does not disclose claims. Login can carry the token in
a Secure, HttpOnly, SameSite=Lax cookie for ten minutes. The cookie is consumed after authentication;
the grant itself has no automatic expiration. Raw tokens are hashed in PostgreSQL and excluded from
history, CSV, console warnings, browser persistent storage and server URL paths/queries.

`/verifier/apply` submits an organization application through the existing document-review process.
An approved organization can open its designated full presentations and inspect `/verifier` history.
Reopening a history entry rechecks its grant, actor, organization and current approval. History and
CSV contain metadata and the four verification dimensions, never claims or tokens. CSV text cells
are protected against spreadsheet formula evaluation.

Private credentials' public views contain only issuer-selected public fields. A wrong audience or
anonymous viewer of a full link receives that public subset and an authorization hint. Already-public
credentials retain their public claims. Unknown/revoked tokens return the same unavailable response.
An administrator has no special private-view permission. Suspension blocks subsequent full access.

The four dimensions remain separate: credential state, payload integrity, schema validity and issuer
trust. Configured trust policy and readiness freshness apply; approval is not trust. A public
projection cannot verify the complete payload digest and reports `not_checked` after successful
internal validation. Detected corruption still reports failure. Claims remain in browser memory;
private claims never travel through `/v1/verify`, receipt exports or the wallet recovery journal.

Revocation cannot recall copies already viewed. This is server authorization, not end-to-end
encryption: infrastructure operators and database backups remain within the trust boundary.

## Validation boundaries

See [testing](../TESTING.md) for unit, restricted-role PostgreSQL, browser and compiled HTTPS tests.
Synthetic sessions, applications and indexed evidence exercise these boundaries without live wallet
signatures or external mail. Real Identity client registration, external-wallet/mobile return flows,
mail delivery and representative user sessions still need operator qualification.
