# Independent Go verifier

This module is an independent offline implementation of the XCS v0.1 deterministic
rules. It uses the pinned Go-maintained `golang.org/x/net/idna` package for the
normative Unicode 15.0.0 WHATWG/UTS #46 host profile selected by Go 1.26. It does
not import or execute the TypeScript implementation.

The module checks `idna.UnicodeVersion` at runtime and in tests. A Go toolchain
that selects different IDNA tables fails closed instead of silently changing URI
validity; run this verifier with the repository-pinned Go 1.26 toolchain.

Run its shared conformance suite:

```sh
GOCACHE=/tmp/xcs-go-cache go test ./...
```

Build the CLI:

```sh
go build -o xcs-verify ./cmd/xcs-verify
```

Commands:

```text
xcs-verify uid UID_INPUT.json
xcs-verify schema SCHEMA.json
xcs-verify claims SCHEMA.json CLAIMS.json
xcs-verify payload SCHEMA.json PAYLOAD.json URI ISSUER SUBJECT SCHEMA_UID
```

Every command writes one JSON result. Protocol errors are written to stderr with
a stable `code`, `path`, and `message`, then the process exits non-zero.

The Go library can resolve inheritance and supersession through `ResolveSchema`.
Callers supply a `SchemaResolutionContext` whose `GetSchema` callback reads a
complete, network-bound catalog of prior `RegisteredSchema` values. The returned
`ResolvedSchema` contains the normalized definition, merged fields, and ordered
parent lineage. The caller must bind the context coordinates and network to the
schema registration being verified; the catalog is expected to contain only
registrations whose UIDs were checked when they were indexed.

`ParseCredentialPayload` accepts the same catalog through the optional
`PayloadContext.ResolutionContext`, so library consumers can validate inherited
claims. Omitting it preserves the offline fail-closed behavior.

The CLI deliberately exposes no catalog-loading option. Its `claims` and
`payload` commands therefore require a locally complete schema; if an input
schema contains `extends`, they fail closed with `SCHEMA_PARENT_NOT_FOUND` rather
than validating only the child fields.

Library consumers can use `UnixSecondsToRippleTime`, `RippleTimeToUnixSeconds`,
`ISO8601ToRippleTime`, and `RippleTimeToISO8601` for the v0.1 uint32 whole-second time contract.
`ProjectCredentialLifecycle` projects pending, active, expired, or deleted from the same inputs and
precedence as the TypeScript core. These functions remain library APIs; the CLI commands above are
unchanged.

`ClassifyCredentialPayload` is the independent network-free counterpart for the full payload
decision. A caller supplies `PayloadRetrievalEvidence` containing retrieved bytes or an explicit
unavailable outcome, the native URI, and a complete `PayloadContext`; the result preserves
`valid`, `unavailable`, `tampered`, and `invalid` as separate statuses. The shared revision 9 vectors
exercise the same contract in Go and TypeScript.
