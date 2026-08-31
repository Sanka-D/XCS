import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'

import {
  assertSchemaCatalogClosureWithinLimit,
  canonicalize,
  classifyCredentialPayload,
  computePayloadSha256Hex,
  computeSchemaUid,
  createHttpsPayloadUri,
  createIpfsRawPayloadUri,
  inspectPayloadUri,
  MAX_SCHEMA_CATALOG_ENTRIES,
  parseSchemaCatalogBundle,
  iso8601ToRippleTime,
  parseCredentialPayload,
  parseJsonStrict,
  projectCredentialLifecycle,
  resolveSchema,
  rippleTimeToIso8601,
  rippleTimeToUnixSeconds,
  unixSecondsToRippleTime,
  validateClaims,
  validateNetworkProfile,
  validateSchema,
  verifyPayloadIntegrity,
  type FieldDescriptor,
  type JsonValue,
  type NetworkProfile,
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

interface SchemaCatalogVectors {
  limit: number
  cases: Array<
    VectorCase &
      (
        | {
            topology: 'linear-supersedes' | 'shared-supersedes'
            ancestorCount?: number
            sharedAncestorCount?: number
            expectedUniqueEntries: number
          }
        | {
            numericField:
              'checkpoint.ledgerIndex' | 'schema.ledgerIndex' | 'schema.transactionIndex'
            original: number
            token: string
          }
      ) &
      ({ valid: true } | { valid: false; errorCode: string })
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

interface NetworkProfileVectors {
  cases: Array<
    VectorCase &
      ({ input: unknown; inputJson?: never } | { input?: never; inputJson: string }) &
      ({ valid: true; expected: NetworkProfile } | { valid: false; errorCode: string })
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

function conformanceCatalogDefinition(supersedes?: string): SchemaDefinition {
  return {
    xcsVersion: '0.1',
    name: 'Conformance catalog entry',
    description: 'A deterministic generated entry for the schema catalog closure limit vectors.',
    ...(supersedes === undefined ? {} : { supersedes }),
    fields: { value: { type: 'string' } },
  }
}

function conformanceCatalogChain(count: number): {
  catalog: Map<string, Pick<RegisteredSchema, 'definition'>>
  tip: string
} {
  const catalog = new Map<string, Pick<RegisteredSchema, 'definition'>>()
  let tip = ''
  for (let index = 0; index < count; index += 1) {
    const uid = (index + 1).toString(16).padStart(64, '0')
    catalog.set(uid, { definition: conformanceCatalogDefinition(tip || undefined) })
    tip = uid
  }
  return { catalog, tip }
}

function runSchemaCatalog(data: Record<string, unknown>): void {
  const vectors = data as unknown as SchemaCatalogVectors
  describe('schema catalog closure conformance', () => {
    it('pins the normative catalog limit', () => {
      expect(vectors.limit).toBe(MAX_SCHEMA_CATALOG_ENTRIES)
    })

    for (const vector of vectors.cases) {
      it(`${vector.id}: ${vector.name}`, () => {
        if ('numericField' in vector) {
          const transactionIndex =
            vector.numericField === 'schema.transactionIndex' ? vector.original : 0
          const definition = validateSchema({
            xcsVersion: '0.1',
            name: 'JSON number catalog',
            description: 'Exercises semantically integral uint32 JSON numbers.',
            fields: { courseId: { type: 'string' } },
          })
          const ledgerHash = 'aa'.repeat(32)
          const publisher = 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh'
          const uid = computeSchemaUid({
            networkId: 1,
            ledgerHash,
            ledgerIndex: 10,
            transactionIndex,
            publisher,
            schema: definition,
          })
          const bundle = {
            format: 'xcs-schema-catalog/1',
            profile: {
              profileId: 'xrpl-testnet-xcs-v0.1-json-number-vector',
              xcsVersion: '0.1',
              networkId: 1,
              requiredAmendment: 'bb'.repeat(32),
              registryAddress: publisher,
              registrationAmountDrops: '1',
              activationLedgerIndex: 1,
              activationLedgerHash: 'cc'.repeat(32),
            },
            targetUid: uid,
            checkpoint: { ledgerIndex: 10, ledgerHash },
            schemas: [
              {
                uid,
                definition,
                publisher,
                ledgerIndex: 10,
                ledgerHash,
                transactionIndex,
                transactionHash: 'dd'.repeat(32),
              },
            ],
          }
          let encoded = JSON.stringify(bundle)
          const replacements = {
            'checkpoint.ledgerIndex': [
              `"checkpoint":{"ledgerIndex":${vector.original}`,
              `"checkpoint":{"ledgerIndex":${vector.token}`,
            ],
            'schema.ledgerIndex': [
              `"publisher":"${publisher}","ledgerIndex":${vector.original}`,
              `"publisher":"${publisher}","ledgerIndex":${vector.token}`,
            ],
            'schema.transactionIndex': [
              `"transactionIndex":${vector.original},"transactionHash"`,
              `"transactionIndex":${vector.token},"transactionHash"`,
            ],
          } as const
          const [from, to] = replacements[vector.numericField]
          expect(encoded).toContain(from)
          encoded = encoded.replace(from, to)

          const parse = () => parseSchemaCatalogBundle(encoded)
          if (!vector.valid) {
            expect(parse).toThrowError(expect.objectContaining({ code: vector.errorCode }))
            return
          }
          const parsed = parse()
          expect(parsed.checkpoint.ledgerIndex).toBe(10)
          expect(parsed.schemas[0]?.ledgerIndex).toBe(10)
          expect(parsed.schemas[0]?.transactionIndex).toBe(transactionIndex)
          return
        }

        let candidate: SchemaDefinition
        let catalog: Map<string, Pick<RegisteredSchema, 'definition'>>
        if (vector.topology === 'linear-supersedes') {
          const generated = conformanceCatalogChain(vector.ancestorCount ?? 0)
          catalog = generated.catalog
          candidate = conformanceCatalogDefinition(generated.tip)
        } else {
          const generated = conformanceCatalogChain(vector.sharedAncestorCount ?? 0)
          catalog = generated.catalog
          const leftUid = (catalog.size + 1).toString(16).padStart(64, '0')
          const rightUid = (catalog.size + 2).toString(16).padStart(64, '0')
          catalog.set(leftUid, { definition: conformanceCatalogDefinition(generated.tip) })
          catalog.set(rightUid, { definition: conformanceCatalogDefinition(generated.tip) })
          candidate = {
            ...conformanceCatalogDefinition(rightUid),
            extends: leftUid,
          }
        }
        expect(catalog.size + 1).toBe(vector.expectedUniqueEntries)

        const validate = () =>
          assertSchemaCatalogClosureWithinLimit(candidate, (uid) => catalog.get(uid))
        if (vector.valid) {
          expect(validate).not.toThrow()
        } else {
          expect(validate).toThrowError(expect.objectContaining({ code: vector.errorCode }))
        }
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

function runNetworkProfile(data: Record<string, unknown>): void {
  const vectors = data as unknown as NetworkProfileVectors
  describe('network profile conformance', () => {
    for (const vector of vectors.cases) {
      it(`${vector.id}: ${vector.name}`, () => {
        const validate = () =>
          validateNetworkProfile(
            vector.inputJson === undefined ? vector.input : parseJsonStrict(vector.inputJson),
          )
        if (!vector.valid) {
          expect(validate).toThrowError(expect.objectContaining({ code: vector.errorCode }))
          return
        }
        expect(validate()).toEqual(vector.expected)
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
  'schema-catalog': runSchemaCatalog,
  'ripple-time': runRippleTime,
  'lifecycle-state': runLifecycleState,
  'network-profile': runNetworkProfile,
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
      revision: 12,
    })
    expect(
      Object.fromEntries(suite.manifest.files.map(({ handler, file }) => [handler, file])),
    ).toEqual(CONFORMANCE_HANDLER_FILES)
  })
})

for (const file of suite.files) {
  handlers[file.handler](file.data)
}
