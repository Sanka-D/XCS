#!/bin/sh
set -eu

fixture_directory="$(mktemp -d)"
cleanup() {
  rm -rf "$fixture_directory"
}
trap cleanup EXIT HUP INT TERM

special_password_file="$fixture_directory/special-password"
printf '%s' 'p@ss:/?#%with spaces' > "$special_password_file"

XCS_DATABASE_PASSWORD_FILE="$special_password_file" \
  XCS_DATABASE_URL_TARGET=NUXT_DATABASE_URL \
  XCS_DATABASE_USER=xcs_api \
  XCS_PAYLOAD_DATABASE_PASSWORD_FILE="$special_password_file" \
  sh docker/node-entrypoint.sh node -e '
    const expected = "p@ss:/?#%with spaces"
    const parsed = new URL(process.env.NUXT_DATABASE_URL)
    if (decodeURIComponent(parsed.password) !== expected) process.exit(1)
    if (process.env.XCS_DATABASE_PASSWORD !== undefined) process.exit(1)
    if (process.env.XCS_DATABASE_PASSWORD_FILE !== undefined) process.exit(1)
    const writer = new URL(process.env.NUXT_PAYLOAD_DATABASE_URL)
    if (writer.username !== "xcs_payload_writer") process.exit(1)
    if (decodeURIComponent(writer.password) !== expected) process.exit(1)
    if (process.env.XCS_PAYLOAD_DATABASE_PASSWORD !== undefined) process.exit(1)
    if (process.env.XCS_PAYLOAD_DATABASE_PASSWORD_FILE !== undefined) process.exit(1)
  '

database_url_file="$fixture_directory/database-url"
printf '%s' 'postgres://xcs_api:fixture-password@database.example/xcs?sslmode=verify-full' > "$database_url_file"
NUXT_DATABASE_URL_FILE="$database_url_file" \
  sh docker/node-entrypoint.sh node -e '
    const parsed = new URL(process.env.NUXT_DATABASE_URL)
    if (parsed.username !== "xcs_api") process.exit(1)
    if (parsed.searchParams.get("sslmode") !== "verify-full") process.exit(1)
    if (process.env.NUXT_DATABASE_URL_FILE !== undefined) process.exit(1)
    if (process.env.NUXT_PAYLOAD_DATABASE_URL !== undefined) process.exit(1)
  '

XCS_PAYLOAD_STORAGE_IP_HASH_SECRET_FILE="$special_password_file" \
  sh docker/node-entrypoint.sh node -e '
    if (process.env.XCS_PAYLOAD_STORAGE_IP_HASH_SECRET !== "p@ss:/?#%with spaces") process.exit(1)
    if (process.env.XCS_PAYLOAD_STORAGE_IP_HASH_SECRET_FILE !== undefined) process.exit(1)
  '

XCS_BOOTSTRAP_DATABASE_URL_FILE="$database_url_file" \
  sh docker/node-entrypoint.sh node -e '
    const parsed = new URL(process.env.XCS_BOOTSTRAP_DATABASE_URL)
    if (parsed.searchParams.get("sslmode") !== "verify-full") process.exit(1)
    if (process.env.XCS_BOOTSTRAP_DATABASE_URL_FILE !== undefined) process.exit(1)
  '

XCS_IDENTITY_CLIENT_ID_FILE="$special_password_file" \
  XCS_IDENTITY_CLIENT_SECRET_FILE="$special_password_file" \
  NUXT_APP_DATABASE_URL_FILE="$database_url_file" \
  XCS_APP_DATABASE_PASSWORD_FILE="$special_password_file" \
  XCS_ISSUER_DATABASE_PASSWORD_FILE="$special_password_file" \
  NUXT_ISSUER_DATABASE_URL_FILE="$database_url_file" \
  sh docker/node-entrypoint.sh node -e '
    if (!process.env.XCS_IDENTITY_CLIENT_ID || !process.env.XCS_IDENTITY_CLIENT_SECRET) process.exit(1)
    if (!process.env.XCS_APP_DATABASE_PASSWORD || !process.env.NUXT_APP_DATABASE_URL) process.exit(1)
    if (!process.env.XCS_ISSUER_DATABASE_PASSWORD || !process.env.NUXT_ISSUER_DATABASE_URL) process.exit(1)
    if (process.env.XCS_ISSUER_DATABASE_PASSWORD_FILE || process.env.NUXT_ISSUER_DATABASE_URL_FILE) process.exit(1)
    for (const name of ["XCS_IDENTITY_CLIENT_ID", "XCS_IDENTITY_CLIENT_SECRET", "XCS_APP_DATABASE_PASSWORD", "NUXT_APP_DATABASE_URL"]) {
      if (process.env[`${name}_FILE`] !== undefined) process.exit(1)
    }
  '

conflict_output=''
if conflict_output="$(
  XCS_DATABASE_PASSWORD=never-print-this-value \
    XCS_DATABASE_PASSWORD_FILE="$special_password_file" \
    sh docker/node-entrypoint.sh true 2>&1
)"; then
  printf '%s\n' 'entrypoint accepted conflicting direct/file secrets' >&2
  exit 1
fi
case "$conflict_output" in
  *never-print-this-value*)
    printf '%s\n' 'entrypoint leaked a secret value' >&2
    exit 1
    ;;
  *'XCS_DATABASE_PASSWORD and XCS_DATABASE_PASSWORD_FILE are mutually exclusive'*) ;;
  *)
    printf '%s\n' 'entrypoint returned an unexpected conflict diagnostic' >&2
    exit 1
    ;;
esac

multiline_file="$fixture_directory/multiline"
printf 'first-line\nsecond-line' > "$multiline_file"
multiline_output=''
if multiline_output="$(
  XCS_METRICS_TOKEN_FILE="$multiline_file" sh docker/node-entrypoint.sh true 2>&1
)"; then
  printf '%s\n' 'entrypoint accepted a multiline secret' >&2
  exit 1
fi
case "$multiline_output" in
  *first-line* | *second-line*)
    printf '%s\n' 'entrypoint leaked multiline secret contents' >&2
    exit 1
    ;;
  *'XCS_METRICS_TOKEN_FILE must contain one line'*) ;;
  *)
    printf '%s\n' 'entrypoint returned an unexpected multiline diagnostic' >&2
    exit 1
    ;;
esac

empty_value_file="$fixture_directory/empty-value"
printf '\n' > "$empty_value_file"
empty_value_output=''
if empty_value_output="$(
  XCS_METRICS_TOKEN_FILE="$empty_value_file" sh docker/node-entrypoint.sh true 2>&1
)"; then
  printf '%s\n' 'entrypoint accepted an effectively empty secret' >&2
  exit 1
fi
case "$empty_value_output" in
  *'XCS_METRICS_TOKEN_FILE must contain a non-empty value'*) ;;
  *)
    printf '%s\n' 'entrypoint returned an unexpected empty-value diagnostic' >&2
    exit 1
    ;;
esac

printf '%s\n' 'node entrypoint tests passed'
