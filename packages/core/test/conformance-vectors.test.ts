import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'

import {
  canonicalize,
  computePayloadSha256Hex,
  computeSchemaUid,
  createHttpsPayloadUri,
  createIpfsRawPayloadUri,
  inspectPayloadUri,
  parseCredentialPayload,
  parseJsonStrict,
  validateClaims,
  validateSchema,
  verifyPayloadIntegrity,
  type JsonValue,
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

interface ClaimsVectors {
  schema: SchemaDefinition
  cases: Array<
    VectorCase &
      ({ valid: true; claims: unknown } | { valid: false; errorCode: string; claims: unknown })
  >
}

interface PayloadIntegrityVectors {
  cases: Array<
    VectorCase &
      (
        | { contentUtf8: string; sha256: string; uri: string }
        | { contentUtf8: string; uri: string; errorCode: string }
        | { contentBase64: string; errorCode: string }
      )
  >
}

interface PayloadValidationVectors {
  context: {
    issuer: string
    subject: string
    schemaUid: string
    schema: SchemaDefinition
  }
  cases: Array<
    VectorCase &
      ({ valid: true; inputJson: string } | { valid: false; errorCode: string; inputJson: string })
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
        if ('contentBase64' in vector) {
          const content = new Uint8Array(Buffer.from(vector.contentBase64, 'base64'))
          expect(() =>
            parseCredentialPayload(content, {
              issuer: '',
              subject: '',
              schemaUid: '',
              schema: {},
            }),
          ).toThrowError(expect.objectContaining({ code: vector.errorCode }))
          return
        }
        if ('errorCode' in vector) {
          expect(() => inspectPayloadUri(vector.uri)).toThrowError(
            expect.objectContaining({ code: vector.errorCode }),
          )
          return
        }
        expect(computePayloadSha256Hex(vector.contentUtf8)).toBe(vector.sha256)
        expect(verifyPayloadIntegrity(vector.contentUtf8, vector.uri)).toMatchObject({
          status: 'valid',
          expectedDigestHex: vector.sha256,
          actualDigestHex: vector.sha256,
        })

        if (vector.uri.startsWith('ipfs://')) {
          expect(createIpfsRawPayloadUri(vector.contentUtf8)).toBe(vector.uri)
        } else {
          expect(createHttpsPayloadUri(vector.uri.split('#', 1)[0] ?? '', vector.contentUtf8)).toBe(
            vector.uri,
          )
        }
      })
    }
  })
}

function runPayloadValidation(data: Record<string, unknown>): void {
  const vectors = data as unknown as PayloadValidationVectors
  const schema = validateSchema(vectors.context.schema)
  const context = {
    issuer: vectors.context.issuer,
    subject: vectors.context.subject,
    schemaUid: vectors.context.schemaUid,
    schema: schema.fields,
  }
  describe('payload validation conformance', () => {
    for (const vector of vectors.cases) {
      it(`${vector.id}: ${vector.name}`, () => {
        if (vector.valid) {
          expect(parseCredentialPayload(vector.inputJson, context).claims).toEqual({
            programId: 'race-2026',
          })
          return
        }
        expect(() => parseCredentialPayload(vector.inputJson, context)).toThrowError(
          expect.objectContaining({ code: vector.errorCode }),
        )
      })
    }
  })
}

const handlers: Record<ConformanceHandler, (data: Record<string, unknown>) => void> = {
  canonicalization: runCanonicalization,
  'schema-validation': runSchemaValidation,
  'schema-uid': runSchemaUid,
  claims: runClaims,
  'payload-integrity': runPayloadIntegrity,
  'payload-validation': runPayloadValidation,
}

const suite = loadConformanceSuite()

describe('conformance manifest', () => {
  it('loads the frozen v0.1 revision and its complete handler inventory', () => {
    expect(suite.manifest).toMatchObject({
      formatVersion: 1,
      protocolVersion: '0.1',
      revision: 5,
    })
    expect(
      Object.fromEntries(suite.manifest.files.map(({ handler, file }) => [handler, file])),
    ).toEqual(CONFORMANCE_HANDLER_FILES)
  })
})

for (const file of suite.files) {
  handlers[file.handler](file.data)
}
