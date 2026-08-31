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
  XCS_DATABASE_URL_TARGET=XCS_DATABASE_URL \
  XCS_DATABASE_USER=xcs_api \
  sh docker/node-entrypoint.sh node -e '
    const expected = "p@ss:/?#%with spaces"
    const parsed = new URL(process.env.XCS_DATABASE_URL)
    if (decodeURIComponent(parsed.password) !== expected) process.exit(1)
    if (process.env.XCS_DATABASE_PASSWORD !== undefined) process.exit(1)
    if (process.env.XCS_DATABASE_PASSWORD_FILE !== undefined) process.exit(1)
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
