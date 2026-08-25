# `xcs` CLI

The CLI prints successful command results as JSON on stdout and structured errors as JSON on stderr.

It never accepts XRPL seeds or private keys. Transaction-building commands return unsigned JSON for a
wallet to sign. `xcs tx submit` accepts the resulting signed blob only through stdin or an explicitly
named file, keeping transaction blobs out of shell history.

Main command groups:

```text
xcs schema validate|register|uid
xcs payload build|check
xcs credential issue|accept|delete|verify
xcs tx submit|status
```

`xcs payload build` validates public claims against a standalone registered schema, emits the exact
RFC 8785 canonical JSON bytes, and derives either an integrity-bound HTTPS URI or a raw CIDv1 IPFS
URI. Use `--output credential.json` to write those exact bytes without a trailing newline for
publication. `xcs payload check` rejects non-canonical bytes, schema mismatches, and URI digest mismatches.
Schemas using `extends` require a resolved catalog and are deliberately rejected by these initial
offline commands instead of being validated against incomplete fields.
`xcs schema register` includes `memoByteLength`, the exact serialized size of the complete XRPL Memo,
alongside the canonical schema and unsigned Payment so an operator can review the size before signing.

Exit codes are `0` for success, `2` for invalid input, `3` for network/service failures, `4` for a
transaction that was not validated, and `5` when the on-ledger, schema, or payload dimension is not
protocol-valid. Issuer trust remains a separate report field and does not change the exit code. A
verification API whose indexer checkpoint is missing, stale, or implausibly in the future is treated
as unavailable and returns exit code `3`; the CLI never accepts such a report as valid.
Verification POSTs reject redirects and are aborted after 10 seconds, so a payload body cannot be
forwarded to a different origin by an API redirect. Response headers and streamed bodies are both
enforced against a 1 MiB limit.
