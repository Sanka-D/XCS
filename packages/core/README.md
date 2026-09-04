# `@xcs-protocol/core`

The XCS domain model. This package validates schemas and credential payloads, derives schema UIDs,
checks payload integrity, and projects the native XRPL Credential lifecycle.

It deliberately contains no database, indexer, HTTP client, wallet integration, transaction
submission, or deployment configuration. Those belong in adapters around the core.

## Design

Core owns XCS rules only. Standard formats and cryptographic primitives are delegated to maintained
libraries:

- `@noble/hashes` for SHA-256 and hexadecimal encoding;
- `xrpl` for classic-address validation and Ripple-time conversion;
- `canonicalize` for RFC 8785 JSON serialization;
- `jsonc-parser` for syntax and duplicate-key validation;
- `multiformats` for CIDv1 and multihash handling;
- `@scure/base` for canonical base64url claims;
- `tr46` for the pinned IDNA behavior required by the protocol.

The public API includes the shared JSON, UTF-8, hexadecimal, and SHA-256 adapters used by the other
workspace packages. This keeps those security-sensitive boundaries in one place. Catalog transport
and API presentation models remain outside core.

## Schema flow

```ts
import { computeSchemaUid, encodeSchema, parseSchema } from '@xcs-protocol/core'

const schema = parseSchema({
  xcsVersion: '0.1',
  name: 'Course completion',
  description: 'Confirms that a learner completed a course.',
  fields: {
    courseId: { type: 'string' },
    passed: { type: 'bool' },
  },
})

// These exact bytes go into the schema-registration memo.
const memoBytes = encodeSchema(schema)

// Compute this only after the registration transaction is in a validated ledger.
const uid = computeSchemaUid({
  networkId: 1,
  ledgerHash: 'ab'.repeat(32),
  ledgerIndex: 100,
  transactionIndex: 2,
  publisher: 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh',
  schema,
})
```

## Credential flow

```ts
import {
  createHttpsPayloadUri,
  encodeCredentialPayload,
  verifyCredentialPayload,
} from '@xcs-protocol/core'

const context = {
  issuer: 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh',
  subject: 'rG1QQv2nh2gr7RCZ1P8YYcBUKCCN633jCn',
  schemaUid: uid,
  fields: schema.fields,
}

const encoded = encodeCredentialPayload({ courseId: 'xcs-101', passed: true }, context)
const uri = createHttpsPayloadUri('https://issuer.example/credentials/42.json', encoded.bytes)

const status = verifyCredentialPayload(
  { status: 'retrieved', content: encoded.bytes },
  uri,
  context,
)
// status: valid | unavailable | tampered | invalid
```

For inherited schemas, pass `resolveSchema(...).fields` in the credential context. Do not validate
claims against the child definition alone.

The package is alpha and has not been published. Its source of truth remains
[`spec/XCS-0001.md`](../../spec/XCS-0001.md).
