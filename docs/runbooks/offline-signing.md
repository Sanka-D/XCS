# Offline transaction preparation and signing

This runbook covers the non-custodial CLI boundary for an operator whose wallet, HSM or separate
signing process cannot be embedded in XCS. The CLI never accepts a seed or private key. It prepares
public transaction fields, validates the signed result and submits only after fresh authoritative
checks.

## Preconditions

- Use the exact reviewed JSON network-profile file. Do not reformat or replace it between
  preparation and submission: the prepared artifact binds its UTF-8 bytes by SHA-256.
- Use an XCS API whose readiness endpoint is backed by the authoritative indexer for that profile.
- Preparation needs a `rippled` endpoint retaining the profile's activation ledger. The submission
  endpoint may be a separate public WSS endpoint on the same network.
- Keep the signed blob private until it is deliberately submitted. It contains an executable
  authorization even though the resulting transaction becomes public on XRPL.

API URLs require HTTPS. Loopback HTTP is accepted for a locally hosted stack. Embedded URL
credentials, redirects, invalid UTF-8 and responses above 1 MiB are rejected. XRPL endpoints require
WSS outside explicit loopback hosts; loopback development may use WS. Input JSON is decoded as
strict UTF-8. A leading BOM remains visible and is rejected by the strict JSON parser, so the profile
digest can never refer to silently transformed bytes.

## 1. Build the unsigned transaction

Use `schema register`, `credential issue`, `credential accept` or `credential delete` and redirect
its JSON output to a file. Builder output may contain review metadata in addition to `transaction`;
`tx prepare` extracts only that unsigned transaction.
The example assumes the four public values below were obtained from the selected profile, schema
registration and payload-publication workflow.

```sh
xcs credential issue \
  --issuer "$XCS_ISSUER_ADDRESS" \
  --subject "$XCS_SUBJECT_ADDRESS" \
  --schema "$XCS_SCHEMA_UID" \
  --uri "$XCS_PAYLOAD_URI" \
  > unsigned.json
```

## 2. Prepare and review the exact envelope

```sh
xcs tx prepare unsigned.json \
  --server wss://history.example \
  --profile profile.json \
  --api https://xcs.example \
  --output prepared.json
```

This command first applies the profile-bound semantic validator. A registration must be the exact
profile registry `Payment` for its configured amount with one canonical XCS schema Memo; a Credential
operation must be a valid native `CredentialCreate`, `CredentialAccept` or `CredentialDelete`
carrying an XCS schema UID and its operation-specific fields. For every `Credential*` operation,
preparation also downloads `GET /v1/networks/:network/schemas/:uid/catalog`, strictly validates its
profile, checkpoint, registration UIDs and complete relation graph, and requires preparation
readiness to cover the catalog checkpoint.

The command then checks the profile network ID, required amendment and immutable activation ledger
and requires a fresh, profile-bound readiness checkpoint. Before autofill, it adds exactly one
`xcs:prepared` Memo. Its digest commits to the profile ID, SHA-256 of the exact profile bytes and the
checkpoint. Autofill then fixes `Fee`, `Sequence` and `LastLedgerSequence`, so the signer protects the
context and final transaction together. The resulting `xcs-prepared-transaction/1` file contains:

- the profile ID and SHA-256 of the exact profile file;
- the authoritative ledger index, hash, close time and transaction root;
- the complete autofilled unsigned transaction, including the `xcs:prepared` Memo;
- a canonical SHA-256 of that transaction.

Review the complete `transaction` object, especially account, operation, destination/subject,
schema identifier, URI, fee and ledger expiry. Sign that exact object in the external signer. Do not
copy fields from the original `unsigned.json`, because its sequence, fee and expiry were not final.

## 3. Validate and submit the signed blob

Write only the hexadecimal signed transaction blob to a protected file or pipe it on stdin. Do not
put it directly in a shell argument.

```sh
xcs tx submit \
  --server wss://submit.example \
  --profile profile.json \
  --prepared prepared.json \
  --api https://xcs.example \
  --file signed.tx \
  --journal operation.jsonl
```

Before the first XRPL submission side effect, the CLI:

1. re-hashes the exact profile file, validates the profile-bound transaction semantics and validates
   the prepared envelope and signed context Memo;
2. decodes the blob, requires a cryptographically valid XRPL single-signature and permits only its
   signature fields as additions; multisigning is outside this alpha flow;
3. checks the submission server's network and required amendment;
4. obtains a final non-cacheable readiness response and rejects a profile mismatch or any checkpoint
   regression;
5. only after final readiness, reads `ledger_current` and rejects an invalid response or expired
   `LastLedgerSequence`.

It then submits, reconciles by transaction hash and requires a validated `tesSUCCESS` result for exit
code `0`. The optional JSONL journal contains only sanitized recovery metadata; it never records the
blob, full transaction, claims, seed or private key.

## Recovery and failures

An ambiguous acknowledgement does not prove failure. Record the hash and expiry printed by the CLI,
then query without resubmitting:

```sh
xcs tx status \
  --server wss://submit.example \
  --profile profile.json \
  --hash '<transaction hash>' \
  --last-ledger-sequence '<prepared expiry>'
```

Exit code `2` means the local artifact or input is invalid, `3` means the API/network evidence was
unavailable, `4` means the transaction was not successfully validated or expired, and `5` is a
credential verification failure. Never bypass a failed profile, readiness, mutation or expiry gate
by falling back to the raw submission mode. Re-prepare a fresh envelope instead.
