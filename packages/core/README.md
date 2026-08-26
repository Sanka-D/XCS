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

The package has not yet been published. Maintainers can validate the exact local tarballs without
network access by running `pnpm package:smoke` at the repository root. Passing
`--output-dir <directory>` preserves the three validated tarballs for a release workflow; the
default command removes its temporary artifacts.
