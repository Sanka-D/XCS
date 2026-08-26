# XCS read API

The API exposes rebuildable, read-only XCS projections. Ledger-derived routes run in a read-only
repeatable-read snapshot and fail with `503` unless the indexer has a live writer lease, a fresh
checkpoint, and consistent dual-source evidence. Interactive OpenAPI documentation is served at
`/documentation`.

This REST API is the public integration contract for the accountless Testnet beta; GraphQL is not
part of the beta. XRPL Commons may operate a shared instance, but PostgreSQL remains a reconstructible
ledger projection rather than protocol truth. The API never accepts a signing seed or private key,
and it does not persist credential payload claims submitted for verification.

The server requires `XCS_INTERNAL_API_TOKEN` (32–256 URL-safe random characters). The private Nuxt
SSR hop presents this token with an opaque HMAC key deterministically derived from the visitor
network address; no browser-selected session identifier can mint or rotate a budget. The global
in-process limiter can then keep independent visitor budgets instead of treating the web container
as one client. The token is compared in constant time. Missing, malformed or incorrect internal
credentials fall back to the source-IP budget, and public browser calls always remain IP-limited.
Never expose this token in CORS configuration, browser runtime variables or logs.

When the public API is behind a reverse proxy, set `XCS_TRUSTED_PROXY_CIDRS` to the exact IP/CIDR of
that proxy only after configuring it to remove any client-supplied forwarding headers and write its
own canonical `X-Forwarded-For`. With the variable unset, Fastify deliberately ignores forwarded
addresses and rate-limits by the direct peer. Wildcards and named proxy presets are rejected.
Catch-all IPv4 or IPv6 `/0` ranges are also rejected; keep every allowed range as narrow as the
actual ingress network.

## Discovery boundary

All valid permissionless schemas and aggregate network statistics are public. Schema visibility is
not Commons endorsement, and the API returns no issuer badge, ranking or universal trust decision.
Credential reads remain exact: the caller supplies shared generation, transaction or complete
issuer/subject/schema coordinates. There is no subject feed, account-wide Credential enumeration or
claims search. A future browsable Credential catalog requires a separately designed explicit opt-in
signal. See [`ADR 0002`](../../docs/adr/0002-public-product-and-discovery.md).

The Commons-hosted instance must leave `XCS_TRUSTED_ISSUERS` and `XCS_UNTRUSTED_ISSUERS` empty, so
its `issuerTrust` result remains `unknown`. A self-hosted verifier may configure those lists as its
own local policy; that result is not a Commons or protocol-level assertion.

## Discovery routes

The implemented discovery reads are:

| Route                                                            | Public result                                                                                                    | Pagination and scope                                                                                               |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `GET /v1/networks/:network/stats`                                | Schema/publisher totals, Credential generation lifecycle counts and the authoritative checkpoint                 | Aggregate only; lifecycle state is evaluated at checkpoint close time                                              |
| `GET /v1/networks/:network/schemas`                              | Valid schema projections, optionally restricted by exact `publisher`                                             | Opaque `cursor`; `limit` defaults to 20 and is capped at 100                                                       |
| `GET /v1/networks/:network/search?q=...`                         | Schema text/publisher matches, or exact hash matches for a schema UID, generation ID and indexed XCS transaction | `q` must be trimmed, contain a letter/number and have 2–128 characters; `limit` defaults to 20 and is capped at 50 |
| `GET /v1/networks/:network/activity`                             | Accepted and rejected schema-registration events in reverse ledger order                                         | Schema registrations only; opaque `cursor`; `limit` defaults to 20 and is capped at 100                            |
| `GET /v1/networks/:network/credential-generations/:generationId` | One exact generation, its checkpoint-relative lifecycle state and validated event timeline                       | No subject or issuer listing                                                                                       |
| `GET /v1/networks/:network/transactions/:transactionHash`        | One exact indexed XCS transaction with an optional schema registration and Credential events                     | Credential events use a node-index cursor; `limit` defaults to 20 and is capped at 100                             |

Search deliberately changes behavior by input shape. A 64-digit hexadecimal value is treated only
as an exact UID/generation/transaction coordinate. A classic XRPL address returns schemas published
by that address, never Credentials where it is issuer or subject. Other text searches only schema
names and descriptions. Search is a bounded entry point: it returns `hasMore` but has no cursor; use
the schema list for paginated browsing. All routes above validate the same live checkpoint and
projection evidence as existing authoritative reads and return `503` rather than serve stale or
inconsistent data. They return ledger metadata only and never fetch or return payload claims.

Deploy these routes after applying the additive, index-only
`packages/db/drizzle/0002_discovery_indexes.sql` migration. Existing binaries remain compatible with
the added indexes; the rollout and populated-database lock considerations are documented in the
[deployment runbook](../../docs/runbooks/deployment.md#migration-0002-discovery-indexes).

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
