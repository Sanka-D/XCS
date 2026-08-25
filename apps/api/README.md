# XCS read API

The API exposes rebuildable, read-only XCS projections. Ledger-derived routes run in a read-only
repeatable-read snapshot and fail with `503` unless the indexer has a live writer lease, a fresh
checkpoint, and consistent dual-source evidence. Interactive OpenAPI documentation is served at
`/documentation`.

An organization can reconcile a schema registration transaction without receiving its full memo:

```text
GET /v1/networks/:network/schema-registrations/:transactionHash
```

The response contains `registration: null` until that transaction has been indexed. Accepted
registrations include the schema UID and the SHA-256 digest of the exact canonical registration-memo
JSON, before schema normalization; rejected registrations include only their protocol reason code.
`memoJson` is never exposed by this route.

Credential verification and demo pinning fail with `SCHEMA_PROJECTION_INVALID` and HTTP `503` when
an indexed schema definition, resolved field set, or inheritance lineage is inconsistent. They never
validate or pin a payload against a partial schema projection. Exact-schema, schema-list,
verification, and pinning reads load every claimed ancestor and its accepted registration event in
the same repeatable-read snapshot. The API recomputes every schema UID and every inherited field set
before trusting or exposing the stored projection.

Demo pinning additionally requires a live indexer writer lease and a fresh, matching dual-source
checkpoint. Freshness is evaluated with PostgreSQL time, and every schema-ancestor ledger must fall
between network activation and that checkpoint. Authority failures return the same stable indexer
`503` errors as verification and occur before the challenge is consumed, quota is reserved, or
content is written.

Credential event history and exact-transaction responses expose the event's `ledgerHash`,
`transactionIndex`, and resulting `accepted` flag in addition to the transaction and credential
tuple. Transaction hashes supplied in uppercase are accepted and returned as lowercase hexadecimal.
