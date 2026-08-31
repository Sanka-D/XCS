# `xcs` CLI

The CLI prints successful command results as JSON on stdout and structured errors as JSON on stderr.

This alpha package has not yet been published. Maintainers can validate the exact local tarballs
without network access by running `pnpm package:smoke` at the repository root. Passing
`--output-dir <directory>` preserves the three validated tarballs for a release workflow; the
default command removes its temporary artifacts.

It never accepts XRPL seeds or private keys. Transaction-building commands return unsigned JSON for a
wallet to sign. `xcs tx submit` accepts the resulting signed blob only through stdin or an explicitly
named file, keeping transaction blobs out of shell history.

Main command groups:

```text
xcs schema validate|register|uid|catalog
xcs payload build|check
xcs credential issue|accept|delete|verify
xcs tx prepare|submit|status
```

`xcs payload build` validates public claims against a standalone registered schema, emits the exact
RFC 8785 canonical JSON bytes, and derives either an integrity-bound HTTPS URI or a raw CIDv1 IPFS
URI. Use `--output credential.json` to write those exact bytes without a trailing newline for
publication. `xcs payload check` rejects non-canonical bytes, schema mismatches, and URI digest mismatches.
Schemas using `extends` require a complete catalog. Download one with `xcs schema catalog --api ...
--network ... --schema ... --output catalog.json`, then pass `--catalog catalog.json` instead of
`--schema-file` to `payload build` or `payload check`. The CLI validates the embedded profile,
checkpoint, registration coordinates, every recomputed UID and the complete relation graph before
using inherited fields. Catalog closures are bounded to 256 unique schemas and a larger response is
rejected rather than truncated. A standalone schema continues to use `--schema-file`; the two flags
are mutually exclusive.

That command reports `validationScope: "internal-consistency"` and
`xrplRegistrationVerified: false`: a catalog contains no XRPL inclusion proof. The CLI trusts the
configured authoritative API for its ledger projection; an independent verifier must obtain a
trusted checkpoint/source or verify the validated ledger transaction and metadata separately.

The API route used by that command is
`GET /v1/networks/:network/schemas/:uid/catalog`. `tx prepare` also calls it automatically for every
`CredentialCreate`, `CredentialAccept` and `CredentialDelete`, including a standalone target, so a
syntactically valid but unknown schema UID cannot be prepared. A schema-registration `Payment` does
not need an existing catalog.

`xcs schema register` includes `memoByteLength`, the exact serialized size of the complete XRPL Memo,
alongside the canonical schema and unsigned Payment so an operator can review the size before signing.

The offline-signing flow is:

```sh
xcs tx prepare unsigned.json \
  --server wss://history.example \
  --profile profile.json \
  --api https://xcs.example \
  --output prepared.json

# Review prepared.json, sign its exact transaction in the wallet/HSM, then:
xcs tx submit \
  --server wss://submit.example \
  --profile profile.json \
  --prepared prepared.json \
  --api https://xcs.example \
  --file signed.tx
```

Preparation first applies the profile-bound semantic validator: only the exact registry Payment or
native XCS `Credential*` operations are accepted. It strictly validates the catalog required by a
Credential operation, verifies the profile's immutable activation ledger and obtains non-cacheable
authoritative readiness. Before autofill, it adds one `xcs:prepared` Memo whose digest commits to the
profile ID, SHA-256 of the exact profile-file bytes and readiness checkpoint. Autofill then fixes
`Fee`, `Sequence` and `LastLedgerSequence`; the signer protects all of those fields and the context
Memo.

Prepared submission requires a cryptographically valid XRPL single-signature, rejects multisigned
blobs in this alpha, and rejects a changed profile, tampered envelope or any wallet-modified
non-signature field. Immediately before relay it obtains final authoritative readiness and only then
reads `ledger_current` to reject an expired ledger window. The legacy raw `tx submit` path remains
available for callers that already enforce equivalent profile, catalog and readiness controls, but
it still requires a valid single-signature.

`--server` requires WSS outside explicit loopback hosts; loopback development may use WS. JSON files
and API responses are decoded as strict UTF-8. A leading UTF-8 BOM is preserved and therefore
rejected by strict JSON parsing instead of being silently removed before a profile digest is
computed.

Exit codes are `0` for success, `2` for invalid input, `3` for network/service failures, `4` for a
transaction that was not validated, and `5` when the on-ledger, schema, or payload dimension is not
protocol-valid. Issuer trust remains a separate report field and does not change the exit code. A
verification API whose indexer checkpoint is missing, stale, or implausibly in the future is treated
as unavailable and returns exit code `3`; the CLI never accepts such a report as valid.
Verification POSTs reject redirects and are aborted after 10 seconds, so a payload body cannot be
forwarded to a different origin by an API redirect. Response headers and streamed bodies are both
enforced against a 1 MiB limit for ordinary API calls. Schema-catalog downloads use a separate
8 MiB cap: this covers a compact bundle at all v0.1 schema/catalog maxima while retaining a finite
transport bound. API URLs require HTTPS, except for explicit loopback HTTP, and may not embed
credentials. Successful verification reports are parsed against the exact v0.1 runtime shape
before exit status is decided.
