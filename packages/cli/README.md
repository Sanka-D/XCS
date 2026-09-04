# `xcs` CLI

The CLI builds XCS artifacts and submits already signed XRPL transactions. Successful results are
JSON on stdout; errors are structured JSON on stderr.

It never accepts a seed or private key. Transaction-building commands return unsigned JSON for a
wallet or HSM to sign. `xcs tx submit` accepts a signed blob through stdin or an explicitly named
file so it does not need to appear in shell history.

## Commands

```text
xcs schema validate|register|uid
xcs payload build|check
xcs credential issue|accept|delete
xcs verify
xcs tx submit|status
```

`schema register` builds the exact registry `Payment` and reports the canonical schema and complete
XRPL memo size. `schema uid` derives a UID only from explicit validated-ledger coordinates.

`payload build` validates claims against a standalone schema, emits canonical JSON bytes, and
creates either an integrity-bound HTTPS URI or a raw CIDv1 IPFS URI. Use `--output credential.json`
to write the exact bytes for publication. `payload check` verifies those bytes, their URI digest,
credential tuple, and schema fields.

Schemas using `extends` must be resolved by the application or API before using the CLI payload
commands. The CLI intentionally does not define a second schema-catalog artifact format.

`credential issue`, `credential accept`, and `credential delete` build native XRPL transaction JSON.
`verify` calls the XCS API and exits with a non-zero status unless the on-ledger credential, schema,
and payload are all valid.

`tx submit` validates the configured network before relaying a signed blob and waits for a validated
result. Use `--journal` to append sanitized recovery metadata. `tx status` reconciles a known hash.

Remote API and rippled endpoints require TLS; explicit loopback development endpoints may use HTTP
or WS. API requests reject redirects, time out after 10 seconds, and cap responses at 1 MiB.

Exit codes:

- `0`: success;
- `2`: invalid input;
- `3`: network or service failure;
- `4`: transaction not validated successfully;
- `5`: credential verification failed.
