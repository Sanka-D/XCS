# `@xcs-protocol/core`

Deterministic, browser-safe primitives for XCS v0.1: strict JSON parsing, RFC 8785
canonicalization, schema validation and resolution, schema UID derivation, payload integrity and
XRPL time conversions.

```ts
import { canonicalize, validateSchema, type JsonValue } from '@xcs-protocol/core'

const schema = validateSchema({
  xcsVersion: '0.1',
  name: 'Course completion',
  description: 'Attests that a subject completed a course',
  fields: { courseId: { type: 'string' } },
})

const canonical = canonicalize(schema as unknown as JsonValue)
```

This alpha package contains no wallet or network client. It does not accept XRPL seeds or private
keys. Protocol semantics are defined by the repository's `spec/XCS-0001.md` and language-neutral
conformance vectors.

Payload claim validation accepts either a complete standalone `SchemaDefinition` or a
`ResolvedSchema`. A definition containing `extends` must be resolved with `resolveSchema` before it
is used as payload context; passing an unresolved child fails with `SCHEMA_PARENT_NOT_FOUND`. Raw
field maps are intentionally not accepted because they cannot prove that inherited required claims
were included.

`projectCredentialLifecycle` centralizes pending/active/expired/deleted projection. Its expiration
and validated-ledger close-time inputs are Ripple-epoch uint32 seconds. The exported conversion
helpers use the same strict whole-second ISO-8601 contract as the shared conformance vectors.

HTTPS payload URI inspection uses the pinned `tr46` 4.1.1 tables for the protocol's Unicode 15.0.0
non-transitional UTS #46 profile before the platform URL parser. This keeps authority validity stable
across Node/browser Unicode upgrades and aligned with the independent Go verifier. The inspector
also enforces the protocol's canonical path/query subset and returns the same normalized retrieval
URL in both implementations.

`classifyCredentialPayload` is the network-free end-to-end payload decision. Callers pass either
retrieved bytes or an explicit unavailable result plus the native URI and resolved payload context;
the result keeps `valid`, `unavailable`, `tampered`, and `invalid` distinct. It validates the URI
before accepting unavailability and enforces the exact 1 MiB boundary from observed bytes.

The package has not yet been published. Maintainers can validate the exact local tarballs without
network access by running `pnpm package:smoke` at the repository root. Passing
`--output-dir <directory>` preserves the three validated tarballs for a release workflow; the
default command removes its temporary artifacts.
