# `xcs` CLI

The CLI prints successful command results as JSON on stdout and structured errors as JSON on stderr.

It never accepts XRPL seeds or private keys. Transaction-building commands return unsigned JSON for a
wallet to sign. `xcs tx submit` accepts the resulting signed blob only through stdin or an explicitly
named file, keeping transaction blobs out of shell history.

Main command groups:

```text
xcs schema validate|register|uid
xcs credential issue|accept|delete|verify
xcs tx submit|status
```

Exit codes are `0` for success, `2` for invalid input, `3` for network/service failures, `4` for a
transaction that was not validated, and `5` when the on-ledger, schema, or payload dimension is not
protocol-valid. Issuer trust remains a separate report field and does not change the exit code. A
verification API whose indexer checkpoint is missing, stale, or implausibly in the future is treated
as unavailable and returns exit code `3`; the CLI never accepts such a report as valid.
