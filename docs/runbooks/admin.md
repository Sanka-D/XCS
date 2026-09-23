# Local administration

Issue #30 adds applications, application review, verifier management and decision history in English
and French. It uses the PostgreSQL sessions, server role checks and CSRF protection from #27. Deploy
both changes together; there is no separate administrator login or automatic role assignment from
email or identity-provider claims.

This setup uses private local documents and Mailpit. It does not qualify the feature for production,
implement issuer/verifier application forms (#31/#33), or store private credentials. Mockup user
acceptance tests and a real XRP Identity login must be reported separately from automated tests.

## Prepare the database and secrets

Apply the journaled migrations through `0005` after authentication migration `0004`. Existing
migrations must remain unchanged. Run the normal database bootstrap with its existing credentials
and these additional passwords before starting administration:

| Private variable                 | Purpose                                                |
| -------------------------------- | ------------------------------------------------------ |
| `XCS_ADMIN_DATABASE_PASSWORD`    | Bootstrap password for restricted role `xcs_admin_app` |
| `XCS_NOTIFIER_DATABASE_PASSWORD` | Bootstrap password for restricted role `xcs_notifier`  |
| `NUXT_ADMIN_DATABASE_URL`        | Web administrative connection as `xcs_admin_app`       |
| `XCS_NOTIFIER_DATABASE_URL`      | Worker connection as `xcs_notifier`                    |
| `XCS_ADMIN_DOCUMENT_KEY`         | Random signing key of at least 32 UTF-8 bytes          |
| `XCS_ADMIN_DOCUMENT_DIRECTORY`   | Absolute private document directory                    |

The secret variables support an alternative `_FILE` variable. Supply one source only, with a
single-line value in a readable regular file. Never put them in `NUXT_PUBLIC_*`, commit secret files,
or reuse the PostgreSQL operator role `xcs_admin` as a runtime account. The notifier cannot modify
applications, decisions or account roles; the administrative connection has no private-claim access.

Use the secret-file preparation and permissions in [deployment](deployment.md). Files mounted into
Node containers must be readable by their unprivileged `node` user; Compose file-backed secrets do
not automatically fix host file ownership. Keep source worktrees, secrets and synthetic files in
durable private directories, outside the OS temporary directory.

## Start the local stack

Use the exact overlay order below, and populate the `_FILE` variables required by each overlay:

```sh
export COMPOSE_FILE=docker-compose.yml:docker-compose.secrets.yml:docker-compose.auth.yml:docker-compose.admin.yml
export COMPOSE_PROJECT_NAME=xcs-admin-local
docker compose --profile maintenance --profile monitoring --profile demo-pinning config --quiet
docker compose build db-bootstrap web
```

The auth overlay requires the exact HTTPS `XCS_AUTH_ORIGIN` and registered OIDC client secrets. Serve
that origin through the established local HTTPS ingress. Verify its certificate in the actual
browser before testing sessions or wallet providers; do not disable certificate verification.

Initialize the new named document and Mailpit volumes once. These operator containers only prepare
volume ownership; the application and Mailpit run unprivileged with dropped capabilities:

```sh
docker compose run --rm --no-deps --user 0 --cap-add CHOWN \
  --entrypoint sh mailpit -c 'chmod 0700 /data && chown 1000:1000 /data'
docker compose run --rm --no-deps --user 0 --cap-add CHOWN \
  --volume "${COMPOSE_PROJECT_NAME}_xcs-admin-documents:/var/lib/xcs-review" \
  --entrypoint sh admin-notifier \
  -c 'chmod 0700 /var/lib/xcs-review && chown 1000:1000 /var/lib/xcs-review'
docker compose up -d postgres
docker compose run --rm db-bootstrap
docker compose up -d web mailpit admin-notifier
```

Bootstrap migrates before granting the restricted roles. The web service mounts
`xcs-admin-documents` read-only at `/var/lib/xcs-review`; neither public assets nor hosted public
payload storage receive these files. The notifier uses the web image's compiled
`dist/admin/admin-notifier.js`, without access to the document volume or OIDC secrets.

Open Mailpit at `http://127.0.0.1:8025` (or `XCS_MAILPIT_PORT`). Its SMTP listener is internal only,
its UI binding is hardcoded to loopback, and neither Mailpit nor the notifier joins the external
`edge` network. Mailpit also uses a dedicated `admin-mail-ui` bridge so Docker can publish the
loopback UI port; the notifier uses only the internal database and mail networks. No SMTP relay is configured. Mailpit messages persist in `xcs-admin-mailpit`; automatic
message-count deletion is disabled so ambiguous deliveries can be investigated. Monitor disk use
and remove resolved synthetic messages deliberately. See [Mailpit's Docker documentation](https://mailpit.axllent.org/docs/install/docker/).

## Initialize the first administrator

The intended person must already have an active account created by the shared login flow. Obtain
their exact OIDC issuer and subject from the trusted account record. An email address is not an
identity key. Provide the operator database connection and audit label privately:

```sh
export XCS_ADMIN_IDENTITY_ISSUER='https://account.xrpl.in'
export XCS_ADMIN_IDENTITY_SUBJECT='existing-oidc-subject'
export XCS_ADMIN_BOOTSTRAP_OPERATOR='local-operator'
pnpm --filter @xcs-protocol/db admin:bootstrap
```

`XCS_BOOTSTRAP_DATABASE_URL` must already be configured for this operator command. It grants the
first administrator explicitly and records the operation durably. Repeating it for the same
account is idempotent; it is not a general administrator-management mechanism. Nothing runs this
command automatically at login. The four screens do not provide account or administrator management.

## Populate synthetic review data

Use a separate local database whose name begins `xcs_admin_demo`, migrated and bootstrapped with the
same role boundaries. The fixture command accepts loopback or the Docker `postgres` hostname only.
Configure `XCS_ADMIN_FIXTURE_DATABASE_URL` with an operator connection to that disposable database,
and `XCS_ADMIN_DOCUMENT_DIRECTORY` with an absolute durable private directory, then run:

```sh
pnpm --filter @xcs-protocol/web admin:fixtures
```

Point all application pools to that same demo database for fixture validation. Never point the
fixture connection at the normal application database. For Compose validation, copy the generated
synthetic documents into `xcs-admin-documents` through a one-shot operator container, then retain the
web mount as read-only. Files inside the volume must be owned by UID 1000 and readable by that
user (for example mode `0640`); ensure a copy does not preserve inaccessible host ownership. The fixture
directory's file bytes and database metadata must travel together.

For the fixture script's `synthetic-*.png` files, with the host document directory configured above:

```sh
docker compose run --rm --no-deps --user 0 --cap-add CHOWN --cap-add DAC_OVERRIDE \
  --volume "${XCS_ADMIN_DOCUMENT_DIRECTORY}:/fixtures:ro" \
  --volume "${COMPOSE_PROJECT_NAME}_xcs-admin-documents:/var/lib/xcs-review" \
  --entrypoint sh admin-notifier -c \
  'for file in /fixtures/synthetic-*.png; do
     test -f "$file" || exit 1
     target="/var/lib/xcs-review/${file##*/}"
     test ! -e "$target" || exit 1
     cp "$file" "$target" || exit 1
     chmod 0640 "$target" || exit 1
     chown 1000:1000 "$target" || exit 1
   done'
```

The copy refuses to overwrite existing documents. Its temporary root container uses `CHOWN` to set
file ownership and `DAC_OVERRIDE` to enter the private source and target directories. It exits after
copying; the running web container keeps all capabilities dropped and sees the volume read-only.

Each document metadata record identifies one opaque basename, its MIME type, byte length and
SHA-256 digest. The reader accepts PDF, PNG and JPEG only, checks file signatures and integrity, and
limits each file to 20 MiB. Traversal, symlinks, missing files and altered content produce explicit
errors. Links expire after five minutes and are bound to the requesting administrator session;
download rechecks the active role and disables caching. Rotating the signing key invalidates existing
links. The document volume is private even though the filenames themselves are opaque.

## Decisions and email recovery

A candidature is identified by organization and role. Pending applications can be approved or
rejected; an approved verifier can be suspended and reinstated. Rejection and suspension require
a reason. The application update, before/after audit record and one logical notification are committed
atomically. Revision conflicts expose the decision already recorded; repeating the same idempotency
key does not create another decision. Approval is administrative and requires no XRPL transaction
or running indexer. Linked wallets belong to the responsible person and do not prove organization
identity.

The worker claims one pending notification per transaction, rechecks the current verified email
against its stored recipient, and persists an attempt before SMTP. It emits a bilingual message
without documents, wallet data, private claims or internal moderation reasons. Missing, unverified,
changed or unavailable recipients produce `blocked`; the decision remains effective. SMTP failures
also leave the decision intact.

To process a single pending notification locally with the worker's private variables configured:

```sh
pnpm --filter @xcs-protocol/web admin:notify --once
```

In Compose, the equivalent is:

```sh
docker compose run --rm --no-deps admin-notifier node dist/admin/admin-notifier.js --once
```

Only `pending` entries are processed automatically. `failed` and `blocked` entries can be retried
independently from the administration interface after fixing Mailpit or the responsible person's
verified email. Retry revalidates the recipient and reuses the existing logical notification; it
never records another access decision. `sent` entries cannot be retried.

An interrupted `sending` attempt becomes `uncertain` after five minutes. SMTP timeouts or resets may
also be uncertain: the server might have accepted the message before the acknowledgement was lost.
The worker has a 60-second overall deadline and never automatically resends an uncertain message.
The SMTP command label alone cannot prove non-delivery; Nodemailer can report `CONN` after DATA.

For an uncertain entry, stop automatic processing of that entry (it is already excluded), inspect
Mailpit for the stable Message-ID `admin-decision-<decision UUID>@xcs.test`, and retain evidence of the
result. Presence proves local capture; absence alone does not prove non-delivery if messages or the
Mailpit database were removed. An operator must explicitly resolve the delivery state using the
operator database connection after investigation. Do not change the access decision, delete the
notification, or blindly reset its status to pending. There is no automatic uncertain-retry API and
no claim of exactly-once SMTP delivery.

[ADR 0004](../adr/0004-role-based-application.md) continues to apply: there is no issuer allowlist and
an administrative role does not grant access to private claims.

## Verification and rollback

Run the focused admin unit/integration tests and the repository's type, lint and build checks.
PostgreSQL verification must cover transitions, atomic audit/outbox writes, concurrent revisions,
idempotency and restricted roles. Exercise Mailpit receipt, outage/retry and ambiguous delivery;
browser checks must cover both languages, direct navigation, revoked admin access, session expiry,
CSRF rejection, missing documents and errors. Recheck public discovery and existing wallet behavior.
Report which checks actually ran; synthetic OIDC tests are not a real XRP Identity connection or
mockup user acceptance testing.

For an application rollback, stop `admin-notifier`, disable `XCS_ADMIN_ENABLED` or remove the admin
overlay, and deploy the compatible previous web image. Keep migration `0005`, decisions, audit rows,
notification records and both named volumes. Do not run `docker compose down --volumes` as rollback.
Before re-enabling, verify migrations, minimum grants, document integrity and pending/uncertain
notification states. An indexer outage does not prevent reading the stored decision history.
