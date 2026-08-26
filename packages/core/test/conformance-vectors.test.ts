import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'

import {
  canonicalize,
  classifyCredentialPayload,
  computePayloadSha256Hex,
  computeSchemaUid,
  createHttpsPayloadUri,
  createIpfsRawPayloadUri,
  inspectPayloadUri,
  iso8601ToRippleTime,
  parseCredentialPayload,
  parseJsonStrict,
  projectCredentialLifecycle,
  resolveSchema,
  rippleTimeToIso8601,
  rippleTimeToUnixSeconds,
  unixSecondsToRippleTime,
  validateClaims,
  validateSchema,
  verifyPayloadIntegrity,
  type FieldDescriptor,
  type JsonValue,
  type PayloadRetrievalEvidence,
  type RegisteredSchema,
  type SchemaDefinition,
  type SchemaUidInput,
} from '../src/index.js'
import {
  CONFORMANCE_HANDLER_FILES,
  loadConformanceSuite,
  type ConformanceHandler,
} from './conformance-manifest.js'

interface VectorCase {
  id: string
  name: string
}

interface CanonicalizationVectors {
  cases: Array<
    VectorCase & {
      inputJson: string
      canonical: string
    }
  >
}

interface SchemaUidVectors {
  cases: Array<
    VectorCase &
      (
        | { valid: true; input: SchemaUidInput; canonicalPreimage: string; uid: string }
        | { valid: false; input: unknown; errorCode: string }
      )
  >
}

interface SchemaValidationVectors {
  cases: Array<
    VectorCase &
      ({ valid: true; inputJson: string } | { valid: false; errorCode: string; inputJson: string })
  >
}

interface SchemaResolutionVectors {
  cases: Array<
    VectorCase & {
      input: SchemaDefinition
      context: {
        networkId: number
        publisher: string
        ledgerIndex: number
        transactionIndex: number
      }
      catalog: RegisteredSchema[]
    } & (
        | {
            valid: true
            expected: {
              fields: Record<string, FieldDescriptor>
              lineage: string[]
            }
          }
        | { valid: false; errorCode: string }
      )
  >
}

interface RippleTimeVectors {
  cases: Array<
    VectorCase & {
      operation: 'unix-to-ripple' | 'ripple-to-unix' | 'iso-to-ripple' | 'ripple-to-iso'
      input: number | string
    } & ({ valid: true; expected: number | string } | { valid: false; errorCode: string })
  >
}

interface LifecycleStateVectors {
  cases: Array<
    VectorCase & {
      input: {
        objectExists: boolean
        accepted: boolean
        expiration: number | null
        closeTime: number
      }
      state: 'pending' | 'active' | 'expired' | 'deleted'
    }
  >
}

interface ClaimsVectors {
  schema: SchemaDefinition
  cases: Array<
    VectorCase &
      ({ valid: true; claims: unknown } | { valid: false; errorCode: string; claims: unknown })
  >
}

interface PayloadIntegrityVectors {
  cases: Array<
    VectorCase & {
      contentUtf8?: string
      contentRepeat?: { value: string; count: number }
      contentBase64?: string
      uri?: string
      status?: 'valid' | 'tampered'
      sha256?: string
      expectedSha256?: string
      actualSha256?: string
      fetchUrl?: string
      errorCode?: string
      derive?: boolean
    }
  >
}

interface PayloadValidationContext {
  issuer: string
  subject: string
  schemaUid: string
  schema: SchemaDefinition
}

interface PayloadRetrievalVectors {
  context: PayloadValidationContext
  cases: Array<
    VectorCase & {
      uri: string
      status: 'valid' | 'unavailable' | 'tampered' | 'invalid'
      byteLength?: number
      retrieval:
        | { status: 'unavailable' }
        | {
            status: 'retrieved'
            contentUtf8?: string
            contentSegments?: {
              prefixUtf8: string
              repeat: { value: string; count: number }
              suffixUtf8: string
            }
          }
    }
  >
}

interface InheritedPayloadValidationContext extends PayloadValidationContext {
  resolution: {
    networkId: number
    publisher: string
    ledgerIndex: number
    transactionIndex: number
  }
  catalog: RegisteredSchema[]
}

interface PayloadValidationVectors {
  context: PayloadValidationContext
  inheritedContext: InheritedPayloadValidationContext
  cases: Array<
    VectorCase & {
      context?: 'inherited'
      catalog?: RegisteredSchema[]
      expectedClaims?: Record<string, JsonValue>
    } & (
        { valid: true; inputJson: string } | { valid: false; errorCode: string; inputJson: string }
      )
  >
}

function runCanonicalization(data: Record<string, unknown>): void {
  const vectors = data as unknown as CanonicalizationVectors
  describe('canonicalization conformance', () => {
    for (const vector of vectors.cases) {
      it(`${vector.id}: ${vector.name}`, () => {
        expect(canonicalize(parseJsonStrict(vector.inputJson))).toBe(vector.canonical)
      })
    }
  })
}

function runSchemaUid(data: Record<string, unknown>): void {
  const vectors = data as unknown as SchemaUidVectors
  describe('schema UID conformance', () => {
    for (const vector of vectors.cases) {
      it(`${vector.id}: ${vector.name}`, () => {
        if (!vector.valid) {
          expect(() => computeSchemaUid(vector.input as SchemaUidInput)).toThrowError(
            expect.objectContaining({ code: vector.errorCode }),
          )
          return
        }
        const canonicalPreimage = canonicalize({
          purpose: 'xcs.schema.uid',
          version: '0.1',
          networkId: vector.input.networkId,
          ledgerHash: vector.input.ledgerHash.toLowerCase(),
          ledgerIndex: vector.input.ledgerIndex,
          transactionIndex: vector.input.transactionIndex,
          publisher: vector.input.publisher,
          schema: validateSchema(vector.input.schema),
        } as unknown as JsonValue)

        expect(canonicalPreimage).toBe(vector.canonicalPreimage)
        expect(computeSchemaUid(vector.input)).toBe(vector.uid)
      })
    }
  })
}

function runSchemaValidation(data: Record<string, unknown>): void {
  const vectors = data as unknown as SchemaValidationVectors
  describe('schema validation conformance', () => {
    for (const vector of vectors.cases) {
      it(`${vector.id}: ${vector.name}`, () => {
        if (vector.valid) {
          expect(validateSchema(parseJsonStrict(vector.inputJson))).toBeDefined()
          return
        }
        expect(() => validateSchema(parseJsonStrict(vector.inputJson))).toThrowError(
          expect.objectContaining({ code: vector.errorCode }),
        )
      })
    }
  })
}

function runSchemaResolution(data: Record<string, unknown>): void {
  const vectors = data as unknown as SchemaResolutionVectors
  describe('schema resolution conformance', () => {
    for (const vector of vectors.cases) {
      it(`${vector.id}: ${vector.name}`, () => {
        const catalog = new Map(
          vector.catalog.map((registration) => [registration.uid, registration]),
        )
        expect(catalog.size).toBe(vector.catalog.length)
        const resolve = () =>
          resolveSchema(vector.input, {
            ...vector.context,
            getSchema: (uid) => catalog.get(uid),
          })

        if (!vector.valid) {
          expect(resolve).toThrowError(expect.objectContaining({ code: vector.errorCode }))
          return
        }

        const resolved = resolve()
        expect(resolved.definition).toEqual(validateSchema(vector.input))
        expect(resolved.fields).toEqual(vector.expected.fields)
        expect(resolved.lineage).toEqual(vector.expected.lineage)
      })
    }
  })
}

function runRippleTime(data: Record<string, unknown>): void {
  const vectors = data as unknown as RippleTimeVectors
  const execute = (operation: RippleTimeVectors['cases'][number]['operation'], input: unknown) => {
    switch (operation) {
      case 'unix-to-ripple':
        return unixSecondsToRippleTime(input as number)
      case 'ripple-to-unix':
        return rippleTimeToUnixSeconds(input as number)
      case 'iso-to-ripple':
        return iso8601ToRippleTime(input as string)
      case 'ripple-to-iso':
        return rippleTimeToIso8601(input as number)
    }
  }

  describe('Ripple time conformance', () => {
    for (const vector of vectors.cases) {
      it(`${vector.id}: ${vector.name}`, () => {
        const convert = () => execute(vector.operation, vector.input)
        if (!vector.valid) {
          expect(convert).toThrowError(expect.objectContaining({ code: vector.errorCode }))
          return
        }
        expect(convert()).toBe(vector.expected)
      })
    }
  })
}

function runLifecycleState(data: Record<string, unknown>): void {
  const vectors = data as unknown as LifecycleStateVectors
  describe('Credential lifecycle conformance', () => {
    for (const vector of vectors.cases) {
      it(`${vector.id}: ${vector.name}`, () => {
        expect(projectCredentialLifecycle(vector.input)).toBe(vector.state)
      })
    }
  })
}

function runClaims(data: Record<string, unknown>): void {
  const vectors = data as unknown as ClaimsVectors
  const schema = validateSchema(vectors.schema)
  describe('claim validation conformance', () => {
    for (const vector of vectors.cases) {
      it(`${vector.id}: ${vector.name}`, () => {
        if (vector.valid) {
          expect(validateClaims(vector.claims, schema.fields)).toEqual(vector.claims)
          return
        }
        expect(() => validateClaims(vector.claims, schema.fields)).toThrowError(
          expect.objectContaining({ code: vector.errorCode }),
        )
      })
    }
  })
}

function runPayloadIntegrity(data: Record<string, unknown>): void {
  const vectors = data as unknown as PayloadIntegrityVectors
  describe('payload integrity conformance', () => {
    for (const vector of vectors.cases) {
      it(`${vector.id}: ${vector.name}`, () => {
        if (vector.contentBase64 !== undefined) {
          const content = new Uint8Array(Buffer.from(vector.contentBase64, 'base64'))
          expect(() =>
            parseCredentialPayload(content, {
              issuer: '',
              subject: '',
              schemaUid: '',
              schema: {
                xcsVersion: '0.1',
                name: 'Unused invalid UTF-8 context',
                description: 'Parsing fails before this standalone schema is consulted.',
                fields: { value: { type: 'string' } },
              },
            }),
          ).toThrowError(expect.objectContaining({ code: vector.errorCode }))
          return
        }
        const content =
          vector.contentRepeat === undefined
            ? (vector.contentUtf8 ?? '')
            : vector.contentRepeat.value.repeat(vector.contentRepeat.count)
        const uri = vector.uri ?? ''
        if (vector.errorCode !== undefined) {
          const verify = () =>
            vector.errorCode === 'PAYLOAD_URI_INVALID'
              ? inspectPayloadUri(uri)
              : verifyPayloadIntegrity(content, uri)
          expect(verify).toThrowError(expect.objectContaining({ code: vector.errorCode }))
          return
        }
        const status = vector.status ?? 'valid'
        const actualSha256 = vector.actualSha256 ?? vector.sha256
        const expectedSha256 = vector.expectedSha256 ?? vector.sha256
        expect(actualSha256).toBeDefined()
        expect(expectedSha256).toBeDefined()
        expect(computePayloadSha256Hex(content)).toBe(actualSha256)
        expect(verifyPayloadIntegrity(content, uri)).toMatchObject({
          status,
          expectedDigestHex: expectedSha256,
          actualDigestHex: actualSha256,
        })
        if (vector.fetchUrl !== undefined) {
          expect(inspectPayloadUri(uri)).toMatchObject({ kind: 'https', fetchUrl: vector.fetchUrl })
        }

        if (vector.derive === true && uri.startsWith('ipfs://')) {
          expect(createIpfsRawPayloadUri(content)).toBe(uri)
        } else if (vector.derive === true) {
          expect(createHttpsPayloadUri(uri.split('#', 1)[0] ?? '', content)).toBe(uri)
        }
      })
    }
  })
}

function runPayloadValidation(data: Record<string, unknown>): void {
  const vectors = data as unknown as PayloadValidationVectors
  describe('payload validation conformance', () => {
    for (const vector of vectors.cases) {
      it(`${vector.id}: ${vector.name}`, () => {
        const parse = () => {
          if (vector.context !== 'inherited') {
            return parseCredentialPayload(vector.inputJson, {
              ...vectors.context,
              schema: validateSchema(vectors.context.schema),
            })
          }
          const inherited = vectors.inheritedContext
          const entries = vector.catalog ?? inherited.catalog
          const catalog = new Map(entries.map((registration) => [registration.uid, registration]))
          const schema = resolveSchema(inherited.schema, {
            ...inherited.resolution,
            getSchema: (uid) => catalog.get(uid),
          })
          return parseCredentialPayload(vector.inputJson, {
            issuer: inherited.issuer,
            subject: inherited.subject,
            schemaUid: inherited.schemaUid,
            schema,
          })
        }
        if (vector.valid) {
          expect(parse().claims).toEqual(vector.expectedClaims)
          return
        }
        expect(parse).toThrowError(expect.objectContaining({ code: vector.errorCode }))
      })
    }
  })
}

function runPayloadRetrieval(data: Record<string, unknown>): void {
  const vectors = data as unknown as PayloadRetrievalVectors
  const context = { ...vectors.context, schema: validateSchema(vectors.context.schema) }
  describe('payload retrieval classification conformance', () => {
    for (const vector of vectors.cases) {
      it(`${vector.id}: ${vector.name}`, () => {
        let retrieval: PayloadRetrievalEvidence
        if (vector.retrieval.status === 'unavailable') {
          retrieval = vector.retrieval
        } else {
          const hasInlineContent = vector.retrieval.contentUtf8 !== undefined
          const segments = vector.retrieval.contentSegments
          if (hasInlineContent === (segments !== undefined)) {
            throw new Error('retrieved evidence must carry exactly one content representation')
          }
          if (
            segments !== undefined &&
            (!Number.isSafeInteger(segments.repeat.count) || segments.repeat.count < 0)
          ) {
            throw new Error('content repeat count must be a non-negative safe integer')
          }
          const content =
            segments === undefined
              ? vector.retrieval.contentUtf8!
              : `${segments.prefixUtf8}${segments.repeat.value.repeat(segments.repeat.count)}${segments.suffixUtf8}`
          if (vector.byteLength !== undefined) {
            expect(Buffer.byteLength(content, 'utf8')).toBe(vector.byteLength)
          }
          retrieval = { status: 'retrieved', content }
        }
        expect(classifyCredentialPayload(retrieval, vector.uri, context)).toBe(vector.status)
      })
    }
  })
}

const handlers: Record<ConformanceHandler, (data: Record<string, unknown>) => void> = {
  canonicalization: runCanonicalization,
  'schema-validation': runSchemaValidation,
  'schema-resolution': runSchemaResolution,
  'ripple-time': runRippleTime,
  'lifecycle-state': runLifecycleState,
  'schema-uid': runSchemaUid,
  claims: runClaims,
  'payload-integrity': runPayloadIntegrity,
  'payload-retrieval': runPayloadRetrieval,
  'payload-validation': runPayloadValidation,
}

const suite = loadConformanceSuite()

describe('conformance manifest', () => {
  it('loads the frozen v0.1 revision and its complete handler inventory', () => {
    expect(suite.manifest).toMatchObject({
      formatVersion: 1,
      protocolVersion: '0.1',
      revision: 9,
    })
    expect(
      Object.fromEntries(suite.manifest.files.map(({ handler, file }) => [handler, file])),
    ).toEqual(CONFORMANCE_HANDLER_FILES)
  })
})

for (const file of suite.files) {
  handlers[file.handler](file.data)
}
