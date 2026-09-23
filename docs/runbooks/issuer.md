# Issuer workspace

Issue #31 adds optional issuer onboarding, owned schemas, invitations, managed payloads and issuance
tracking. The public Studio and wallet compatibility rules remain available. Real OIDC registration,
external delivery and extension-wallet approvals are separate release checks.

## Provision and enable

Apply migration `0006_issuer_workspace` after auth 0004 and admin 0005, using the existing migration
runbook. Bootstrap with all existing enabled runtime passwords plus `XCS_ISSUER_DATABASE_PASSWORD`
or its `_FILE` equivalent. Omitting this password on a later bootstrap disables the issuer role.
The restricted `xcs_issuer` pool cannot approve applications, grant admins or modify the projection.

| Variable                             | Purpose                                                       |
| ------------------------------------ | ------------------------------------------------------------- |
| `XCS_ISSUER_ENABLED=1`               | Enable server routes after auth provisioning                  |
| `NUXT_PUBLIC_ISSUER_ENABLED=1`       | Show issuer navigation to signed-in accounts                  |
| `NUXT_ISSUER_DATABASE_URL` / `_FILE` | Private `xcs_issuer` connection                               |
| `XCS_ISSUER_DOCUMENT_DIRECTORY`      | Absolute private writable directory, shared with admin review |
| `XCS_ISSUER_INVITE_DAYS`             | Claim lifetime, default 7 days, bounded to 1–30               |
| `XCS_SMTP_HOST`, `XCS_SMTP_PORT`     | Existing local SMTP transport, e.g. Mailpit                   |
| `XCS_AUTH_ORIGIN`                    | Exact HTTPS origin for invitation and payload URLs            |

Never expose credentials in `NUXT_PUBLIC_*`. The navigation flag contains no secret. Payload URIs
must fit XRPL's 128-byte limit including the digest; use a short HTTPS origin.

For local validation, use the overlays in order:

```sh
docker compose -f docker-compose.yml -f docker-compose.secrets.yml -f docker-compose.auth.yml \
  -f docker-compose.admin.yml -f docker-compose.issuer.yml config --quiet
```

Supply `XCS_ISSUER_DATABASE_PASSWORD_FILE` and `NUXT_ISSUER_DATABASE_URL_FILE` alongside the auth/admin
secrets. The issuer overlay makes the review volume writable by web and connects it to internal
Mailpit. Provision that private directory for UID1000 first; never use a public/static directory.
Back up both documents and database metadata. The current SMTP adapter is for local controlled
validation; qualify a production provider before promising external delivery. This configuration
does not register an OIDC client or automatically modify the active deployment.

## Application and approval

`/issuer/apply` accepts organization information and bounded PDF/PNG/JPEG documents. Opaque filenames,
restrictive modes and recorded MIME/length/digest support the existing verified admin reader.
Organizations start pending. `/issuer/application` shows the actual status and decision reason.
Approval grants portal permission, not endorsement; ordinary signup cannot grant admin.

Approved users navigate schemas, recipients, credentials and settings. The server derives the
organization owner from the session and checks current approval on mutations. Schema association
requires an accepted indexed registration and a linked publisher wallet. The public and issuer
pages reuse the same signing components; URL parameters are never treated as authorization.

## Invitations and delivery

Invitations select an owned schema and one delivery mailbox. Their random bearer is in a URL
fragment, absent from HTTP requests and referrers. Only its hash persists; email construction keeps
the bearer in memory. The claim page removes the fragment and does not persist it in browser
storage. Signed-out users sign in and reopen their email link. Preview does not claim: the explicit
authenticated button performs the atomic claim.

Any authenticated holder may claim an unclaimed link. The delivery email is not identity evidence
and is never marked verified. Review the actual claimant and linked wallet before signing. The
minimal claim page links to account wallet settings; the full recipient inbox/presentation flow is
issue #32. Invite expiration limits claiming, not an already claimed recipient or unlimited sharing.

Resend requires confirmation, rotates the token and renews the deadline. Only unclaimed, unrevoked
invitations may be resent or revoked. An already-issued invitation cannot issue again. Email
delivery, claiming, wallet readiness and ledger acceptance are separate states.

SMTP attempts are recorded before sending. Lost acknowledgement/timeout produces `uncertain`,
never automatic retry. Interrupted `sending` records are shown as uncertain after their bound.
Issuance/revocation notifications target the actual claimant's current verified email, not an
unverified delivery contact. A missing verified address blocks notification without undoing the
ledger operation. Do not log SMTP bodies, fragments or payload bytes.

## Private payloads and recovery

Private is the initial choice. Review the public-field and full-authorized previews before signing.
Public disclosure cannot recall downloaded copies. On-chain addresses, schema, opaque URI and full
digest remain public in both modes.

Canonical payload bytes are in private PostgreSQL application storage, bounded to 1 MiB. Drafts are
visible only to the currently authorized preparing issuer. Recording checks the exact indexed
generation, profile, schema, issuer, subject, URI and digest. `/q/:locator` then returns full bytes
to authorized issuer/recipient accounts, or only selected public claims for an anonymous private
credential view. Filtered responses carry `x-xcs-claim-scope: public`; they do not verify the complete
payload digest. Responses are `private, no-store`.

Admin alone grants no access. Verifier presentation routes remain #33 and must also require current
approval and the recipient's matching designated grant. Public API/hosting roles cannot read the
private tables. Database operators and backups can contain full claims: this is not end-to-end
encryption. Preserve private backup and retention controls.

Signing retains existing profile/account/network/freshness checks. Recording follows validated
ledger evidence. Recovery stores only user-scoped operation references, transaction hashes and
visibility selectors, never claims or bearer tokens. Retry reconciles the original transaction
instead of signing another one. Acceptance, expiry, deletion cause and unavailable projection
states remain separate; a missing row is never presented as accepted.

The durable browser journal also locks each managed invitation across tabs, even when different
linked recipient wallets are selected. It retains the lock after ledger success while metadata
recording is pending. A new attempt is allowed only after proven transaction expiry or a validated
failure. This lock is scoped to one browser profile: use one device/profile per in-flight invitation.
Different devices can still race before metadata recording; database uniqueness prevents duplicate
metadata, but does not reserve an invitation across devices before on-ledger signing.

## Disable and retain

Disable both issuer flags to hide navigation and reject workspace routes. This also makes managed
payload routes unavailable, so a rollback must retain a compatible authorized reader at existing
on-chain URLs. Keep payloads, application records and migration history; use forward fixes.
Unreferenced drafts and orphaned uploads require administrative retention cleanup, never deletion
of a payload referenced by issued metadata during deployment.
