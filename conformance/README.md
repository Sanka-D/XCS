# XCS conformance vectors

`v0.1/` contains language-neutral JSON fixtures for the normative, deterministic
parts of XCS. Implementations must consume the values as data; they must not call
or embed another implementation. `v0.1/manifest.json` is the exhaustive inventory
of vector files and the handler that must consume each one. A runner must fail on
an unknown manifest or protocol version, an unknown file or handler, a missing
declared file, or an undeclared JSON file.

- `canonicalization.json`: strict JSON parsing and RFC 8785 output.
- `schema-validation.json`: valid schemas and the boundary between malformed JSON
  (`JSON_INVALID`) and structurally invalid schema definitions (`SCHEMA_INVALID`).
- `schema-resolution.json`: deterministic parent catalogs, resolved field unions,
  root-to-parent lineage, inheritance limits and stable relation failure codes.
- `ripple-time.json`: Ripple/Unix/ISO conversion, canonical formatting and uint32 boundaries.
- `lifecycle-state.json`: pending, active, expired and deleted projection precedence.
- `schema-uid.json`: complete UID preimages, SHA-256 results and invalid wrapper inputs.
- `claims.json`: valid and invalid typed claims, including the required object root.
- `payload-integrity.json`: HTTPS digests, raw CIDv1 values, the pinned Unicode 15 UTS #46 host
  profile, port/IP authority parsing, canonical path/query retrieval URLs, tampering, exact
  payload/URI limits and invalid payload byte encoding.
- `payload-retrieval.json`: the shared `valid`, `unavailable`, `tampered`, and `invalid`
  classification after retrieval, including URI precedence and the exact 1 MiB boundary.
- `payload-validation.json`: canonical payload envelopes, resolved inherited claims and stable
  claim-shape error codes.

The TypeScript core and the standalone Go verifier both load the manifest and
execute every declared vector in their test suites. Case `id` values are stable,
non-empty and globally unique within the version directory; `name` is only a
human-readable diagnostic label.

Validity outcomes, stable `errorCode` values and expected derived values (for
example canonical bytes, UIDs, hashes and URIs) in these vectors are normative.
Error messages, paths and implementation-specific details are diagnostic unless
a future vector explicitly makes one part of its expected output.

Once a protocol vector directory is frozen, changing a validity outcome, stable
error code or expected derived bytes requires a new protocol version and a new
directory. Corrections that do not change normative semantics, such as wording or
metadata fixes, increment the manifest `revision` instead.

`payload-integrity.json` uses `contentRepeat` only to keep exact 1 MiB boundary cases compact. A
runner expands the UTF-8 `value` exactly `count` times before byte-size and digest checks.
`payload-retrieval.json` uses `contentSegments` for the same reason: runners concatenate the exact
UTF-8 prefix, repeated value and suffix before classification. Its cases isolate each failure cause;
they do not define a precedence for content that is simultaneously malformed and digest-mismatched.
`payload-validation.json` supplies a network-bound parent catalog for inherited cases; runners must
resolve that schema first and must fail closed when the catalog is incomplete. Passing only a
child's local field map is not conforming.

Schema normalization is part of the wire contract: an explicit
`"optional": false` is equivalent to the default and is omitted before JCS and
UID computation. Implementations must never hash the unnormalized input object.
