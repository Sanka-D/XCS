# Application data model — issue #25

This is the implemented database model and server-side helper boundary, not a released account or
private-hosting feature. [ADR 0004](adr/0004-role-based-application.md) records the accepted policy.
Optional authentication is implemented in #27; role-specific mutation and private-delivery APIs remain separate work.

## Ownership and authority

The ten `app_*` tables are defined under `packages/db/src/schema/app/` and exported from
`@xcs-protocol/db`. Migration `0003_application_model.sql` adds them; migrations 0000–0002 and the
projection definitions are unchanged. Drizzle generation includes both the existing projection
entry point and the separate application entry point.

An organization has one responsible human account, not a shared login. Issuer and verifier
applications are independent. Personal roles are `admin` and `recipient`; organization roles are
`issuer` and `verifier`. Application approval never proves the validity of a ledger transaction or
the truth of a claim.

Ledger references are `(profile_id, schema_uid)` and `(profile_id, generation_id)`. They deliberately
have no foreign key into the disposable ledger projection: rebuilding it must not destroy accounts,
invitations or sharing grants. Future issuance handlers must verify fresh ledger evidence, schema
publisher ownership and wallet control before recording metadata. Database references and hashes
alone are not cryptographic evidence. No mutable `accepted`/`revoked` lifecycle mirror is stored in
the application model; current state is read from validated ledger evidence. Invitations exist
before a credential generation, in their own table.

```mermaid
erDiagram
    app_users ||--o{ app_user_roles : holds
    app_users ||--o{ app_wallets : proves_control
    app_users ||--o{ app_organizations : responsible_for
    app_organizations ||--o{ app_organization_applications : applies
    app_organization_applications ||--o{ app_documents : documents
    app_organizations ||--o{ app_schema_metadata : owns
    app_schema_metadata ||--o{ app_invites : invites
    app_users o|--o{ app_invites : claims
    app_schema_metadata ||--o{ app_credential_metadata : describes
    app_users ||--o{ app_credential_metadata : recipient
    app_invites o|--o| app_credential_metadata : leads_to
    app_credential_metadata ||--o{ app_presentations : shared_as
    app_organizations o|--o{ app_presentations : designated_verifier
```

The diagram omits reviewer/uploader/creator references for readability. All foreign keys use
`ON DELETE RESTRICT`; no account deletion cascades into credential or ledger history.

## Data dictionary

`uuid` primary keys default to PostgreSQL `gen_random_uuid()`. All timestamps are `timestamptz`.
Columns are **not nullable** unless marked `?`. `now` denotes the database time default. Text hashes
are lowercase 64-character hexadecimal strings checked in SQL. Enum-like text columns have SQL
`CHECK` constraints, not just TypeScript annotations. Source and generated SQL contain exact names.

### `app_users`

| Columns                                 | Type / default | Meaning                                               |
| --------------------------------------- | -------------- | ----------------------------------------------------- |
| `id`                                    | uuid PK        | Stable human account identity                         |
| `identity_issuer?`, `identity_subject?` | text           | Identity-provider issuer and subject; unique together |
| `email?`                                | text           | Contact address; not the account identifier           |
| `email_verified_at?`                    | timestamp      | Independent email-verification evidence               |
| `display_name?`                         | text           | Recipient/personal display profile                    |
| `status`                                | text, `active` | `active`, `suspended`, `deleted`                      |
| `created_at`                            | timestamp, now | Account creation                                      |
| `deleted_at?`                           | timestamp      | Anonymized tombstone time                             |

Active/suspended accounts require nonempty issuer and subject, with no deletion timestamp. A deleted
account requires the deletion timestamp and null identity, email, email-verification and name fields.
Email verification requires an email. The unique `(identity_issuer, identity_subject)` index prevents
cross-provider subject collisions without making email a unique or trusted identity key.

### `app_user_roles`

| Columns           | Type / default              | Meaning                                     |
| ----------------- | --------------------------- | ------------------------------------------- |
| `user_id`, `role` | uuid FK, text; composite PK | Personal `admin` or `recipient` role        |
| `granted_by?`     | uuid FK → users             | Reviewer, nullable for initial provisioning |
| `granted_at`      | timestamp, now              | Grant time                                  |
| `revoked_at?`     | timestamp                   | Role withdrawn                              |

No personal admin role grants private-claim access. Role provisioning remains a future authenticated
administrative operation; inserting a row is not itself proof of authorization.

### `app_wallets`

| Columns       | Type / default         | Meaning                                  |
| ------------- | ---------------------- | ---------------------------------------- |
| `id`          | uuid PK                | Link identity                            |
| `user_id`     | uuid FK → users        | Account that proved control              |
| `network_id`  | bigint, safe JS number | XRPL uint32 network identifier           |
| `address`     | text                   | Classic XRPL address                     |
| `verified_at` | timestamp              | Successful signed-challenge verification |
| `revoked_at?` | timestamp              | Link no longer usable                    |

Unique `(network_id, address)` prevents a wallet being linked to multiple accounts on the same
network; `user_id` is indexed. Network range, address shape and timestamp ordering are checked.
The authentication implementation must verify the signature, nonce and network; this table does not
perform signature verification or store a private key, seed or reusable challenge secret. There is
no automatic wallet reassignment or organization wallet-control transfer.

### `app_organizations`

| Columns               | Type / default  | Meaning                                         |
| --------------------- | --------------- | ----------------------------------------------- |
| `id`                  | uuid PK         | Stable issuer/verifier organization identity    |
| `responsible_user_id` | uuid FK → users | Single responsible account; indexed             |
| `name`                | nonblank text   | Display name, never an authorization identifier |
| `status`              | text, `active`  | `active`, `suspended`, `closed`                 |
| `created_at`          | timestamp, now  | Creation                                        |

One account may be referenced by several organizations; each organization has exactly one responsible
account. Team membership and responsibility-transfer workflows are not implemented.

### `app_organization_applications`

| Columns                                                             | Type / default              | Meaning                                        |
| ------------------------------------------------------------------- | --------------------------- | ---------------------------------------------- |
| `organization_id`, `role`                                           | uuid FK, text; composite PK | `issuer` or `verifier` application             |
| `status`                                                            | text, `pending`             | `pending`, `approved`, `rejected`, `suspended` |
| `website?`, `contact?`, `jurisdiction?`, `description?`, `purpose?` | text                        | Deletable application profile details          |
| `submitted_at`                                                      | timestamp, now              | Submission time                                |
| `reviewed_by?`                                                      | uuid FK → users             | Reviewing administrator                        |
| `reviewed_at?`                                                      | timestamp                   | Decision time                                  |
| `review_reason?`                                                    | text                        | Required and nonblank for rejection/suspension |

Pending applications have no decision fields. Other statuses require reviewer/time, not preceding
submission. Queue index: `(status, submitted_at)`. The admin API must check reviewer authority and
provide audit history when implemented; the row stores the current decision, not a full audit log.
Profile fields can be cleared without inventing a new identity or discarding approval references.

### `app_documents`

| Columns                               | Type / default                          | Meaning                                                     |
| ------------------------------------- | --------------------------------------- | ----------------------------------------------------------- |
| `id`                                  | uuid PK                                 | Review document identity                                    |
| `organization_id`, `application_role` | uuid, text; composite FK → applications | Owning application; indexed together                        |
| `storage_key`                         | nonblank text, unique                   | Private object-storage reference, not a public download URL |
| `mime_type`                           | text                                    | Declared media type; upload handler must validate content   |
| `byte_length`                         | positive integer                        | Size                                                        |
| `sha256`                              | text hash                               | Content digest                                              |
| `uploaded_by`                         | uuid FK → users                         | Uploader                                                    |
| `review_status`                       | text, `pending`                         | `pending`, `approved`, `rejected`                           |
| `created_at`                          | timestamp, now                          | Upload metadata creation                                    |

Bytes live in private object storage, never in this table. Deleting a row does not remove its object;
the future deletion workflow must coordinate both and handle storage failures.

### `app_schema_metadata`

| Columns                         | Type / default                         | Meaning                            |
| ------------------------------- | -------------------------------------- | ---------------------------------- |
| `profile_id`, `schema_uid`      | nonempty text, text hash; composite PK | Exact ledger schema reference      |
| `organization_id`               | uuid FK → organizations                | Application owner; indexed         |
| `display_name?`, `category?`    | text                                   | Presentation metadata              |
| `registration_transaction_hash` | text hash                              | Reference to registration evidence |
| `created_at`                    | timestamp, now                         | Metadata creation                  |

Unique `(profile_id, schema_uid, organization_id)` supports ownership-consistent invitation and
credential foreign keys. Only registered-schema metadata belongs here: no fake UID for drafts and no
separate mutable `published` flag overriding ledger evidence.

### `app_invites`

| Columns                                       | Type / default                                        | Meaning                                                     |
| --------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------- |
| `id`                                          | uuid PK                                               | Invitation identity                                         |
| `organization_id`, `profile_id`, `schema_uid` | uuid, text, text hash; composite FK → schema metadata | Issuer-owned schema                                         |
| `delivery_email?`                             | text                                                  | Removable delivery contact, not proof of claimant identity  |
| `token_hash?`                                 | text hash, unique                                     | Hash of bearer token; may be cleared after claim/revocation |
| `created_by`                                  | uuid FK → users                                       | Creating account                                            |
| `created_at`                                  | timestamp, now                                        | Creation time                                               |
| `expires_at`                                  | timestamp, **no default**                             | Caller must supply invitation expiry, after creation        |
| `claimed_by?`, `claimed_at?`                  | uuid FK → users, timestamp                            | Both absent or both present; claim must predate expiry      |
| `revoked_at?`                                 | timestamp                                             | Claim disabled                                              |

An unclaimed, unrevoked invitation requires a token hash. Indexes: `(organization_id, created_at)` and
`claimed_by`. Unique `(id, organization_id, profile_id, schema_uid, claimed_by)` allows a credential
to reference only the actual claimant for the exact invitation and schema. A link is claimable once,
with no matching-email requirement. Delivery contact is not disclosed by the claim helper.

`claimInvitation(db, { token, userId })` uses one conditional UPDATE against an active account,
unclaimed/unrevoked token hash and database-clock expiry. Concurrent claimants cannot both win.
Invalid/unavailable claims return null; an authenticated POST handler must provide `userId` from the
session and enforce CSRF/rate limits. Opening a link must never invoke the mutation. The helper does
not link a wallet, verify email, sign, issue or accept a credential.

### `app_credential_metadata`

| Columns                                              | Type / default                | Meaning                                                             |
| ---------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------- |
| `profile_id`, `generation_id`                        | text, text hash; composite PK | Exact credential generation                                         |
| `schema_uid`, `issuer_organization_id`               | text hash, uuid               | Composite FK with profile → issuer-owned schema                     |
| `recipient_user_id`                                  | uuid FK → users               | Owning recipient                                                    |
| `invite_id?`                                         | uuid, unique                  | Optional composite FK to matching invitation claimant/schema/issuer |
| `issuer_address`, `subject_address`                  | text                          | Issuance-time XRPL identities                                       |
| `visibility`                                         | text, **no default**          | Explicit `public` or `private`                                      |
| `public_fields`                                      | JSONB string array, `[]`      | Claim-relative JSON pointers allowed publicly                       |
| `payload_storage_key?`                               | nonblank text                 | Object reference; nullable for deletion/unavailability              |
| `payload_digest`                                     | text hash                     | Commitment to canonical payload bytes                               |
| `creation_transaction_hash`, `creation_ledger_index` | text hash, bigint uint32 > 0  | Creation evidence reference                                         |
| `created_at`                                         | timestamp, now                | Metadata creation                                                   |

Unique `(profile_id, generation_id, recipient_user_id)` binds presentations to the actual recipient.
Indexes cover `(recipient_user_id, created_at)` and `(issuer_organization_id, created_at)`. SQL checks
visibility, public-field array/string shape, addresses, hashes and ledger range. No private claim
bytes or authoritative lifecycle state are duplicated here. No visibility default is chosen on
behalf of the parallel UX discussion.

### `app_presentations`

| Columns                                            | Type / default                                            | Meaning                           |
| -------------------------------------------------- | --------------------------------------------------------- | --------------------------------- |
| `id`                                               | uuid PK                                                   | Sharing authorization             |
| `profile_id`, `generation_id`, `recipient_user_id` | text, text hash, uuid; composite FK → credential metadata | Owner-authorized exact generation |
| `verifier_organization_id?`                        | uuid FK → organizations                                   | Mandatory for `full` scope        |
| `scope`                                            | text                                                      | `public` or `full`                |
| `token_hash`                                       | text hash, unique                                         | Link token hash                   |
| `created_at`                                       | timestamp, now                                            | Creation time                     |
| `revoked_at?`                                      | timestamp                                                 | Revocation, not before creation   |

Indexes: `(recipient_user_id, created_at)`, `verifier_organization_id`. There is deliberately no expiry,
consumption timestamp or per-issuer allowlist. Public-scope presentations do not require a verifier;
full private access always does. Invite expiry, session expiry and credential expiry are independent.

## Server-side visibility boundary

`getCredentialAccess(db, { profileId, generationId, viewerUserId, presentationToken? })` reads the
credential, current account/organization state, sharing grant and verifier approval in one SQL
statement. `viewerUserId` must come from verified server authentication, never from a public body.

| Caller                                                                                                                                         | Public credential | Private credential |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------------------ |
| Anonymous, unrelated account, admin role alone                                                                                                 | All claims        | Public fields only |
| Active recipient                                                                                                                               | All claims        | All claims         |
| Active account responsible for the active issuer organization                                                                                  | All claims        | All claims         |
| Active account responsible for the designated, active and currently approved verifier, with a non-revoked full grant for this exact generation | All claims        | All claims         |
| Approved verifier without its grant, wrong audience, suspended verifier, or revoked/public-scope grant                                         | All claims        | Public fields only |

No credential metadata means null, not access. Approval and grant revocation are rechecked per call;
do not cache this result as a durable permission or evaluate it only at sign-in. A caller may have
several relationships: an owner does not lose their ownership access because an unrelated grant
is invalid. This helper is not a presentation-link resolver: future routes must separately reject
invalid/revoked links and verify current ledger state. Neither an access result nor stored metadata
means the credential itself is valid or accepted.

`filterCredentialClaims(claims, access)` copies only the allowed claims. Do not spread the original
private payload envelope into a public DTO. Object-field paths use RFC 6901, relative to `claims`:
`/course/title`, with `~0` and `~1` escapes. Missing paths disclose nothing. Arrays are atomic: an
explicit `/modules` shares the whole array; `/modules/0/name` is not supported and discloses nothing.
Selecting an object explicitly shares its subtree; the future UI must preview that fact. Invalid,
overlong, overly deep or prototype-sensitive selectors fail closed. The empty root pointer cannot
mean “all private claims.” No cryptographic selective-disclosure proof is implied by a filtered view.

`validatePublicFields` must run when saving public selectors. The filter validates them again before
public output; SQL also rejects non-array/non-string shapes. Limits: 256 selectors, 1024 characters
per pointer, 32 path segments. Unknown access scopes throw rather than returning the full payload.

Tokens use Node's standard `randomBytes(32)` and SHA-256, with no custom cryptography. Raw bearer
tokens belong only in the delivery/link response, never database columns, logs or analytics. Private
object storage, authenticated delivery, request limits and CSRF remain future endpoint requirements;
these helpers alone do not implement those protections.

## PII, deletion and deployment

Identity subjects, names, email/contact fields, profile details, document references/content, wallet
links and invitation ownership can identify people. Treat them as application PII even if some
wallet addresses are already public. Grant and review history are also sensitive relationship data.
Public ledger records cannot be erased; an internal tombstone is not a promise of anonymizing XRPL.

The model supports clearing account PII into a disabled tombstone, clearing application profile
fields, removing review-document metadata, clearing invitation delivery contacts and removing
payload references without cascading deletion into issuance history. Future deletion processing
must revoke affected grants/wallet links, remove object bytes where permitted, and coordinate
backups. Restrictive FKs require deliberate handling of references; deleting a parent is not a
shortcut. The lifetime of residual identifiers and backups, operational purge schedules and legally
required retention are **not decided or implemented by this issue**. Do not claim complete account
erasure merely because fields can be nulled.

The forward migration grants no new runtime privileges. Existing projection readers/indexer and
public-payload writers must not be reused as unrestricted application writers. Issue #27 now provisions an optional, restricted `xcs_app` role and server-only connection for authentication;
see the [authentication runbook](runbooks/authentication.md). Nothing here
enables production private hosting or converts a public payload into a private one.

## Verification

Unit tests: `test/app-visibility.test.ts`. Actual SQL, migration upgrade/fresh creation, invitation
concurrency, access decisions and constraints: `test/app-model.integration.test.ts`.

```sh
pnpm --filter @xcs-protocol/db typecheck
pnpm --filter @xcs-protocol/db test
# Use a disposable PostgreSQL cluster, never the active Testnet database.
XCS_TEST_DATABASE_URL=postgres://USER:PASSWORD@127.0.0.1:PORT/postgres pnpm --filter @xcs-protocol/db test:postgres
pnpm --filter @xcs-protocol/db build
pnpm --filter @xcs-protocol/db db:generate
```

Generation after the checked-in artifacts must produce no new migration. Independent maintainer
review, endpoint authorization tests and real identity/wallet flows remain subsequent gates.
