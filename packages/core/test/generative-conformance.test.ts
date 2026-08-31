import { describe, expect, it } from 'vitest'

import {
  canonicalize,
  computeSchemaUid,
  parseJsonStrict,
  resolveSchema,
  validateSchema,
  type FieldDescriptor,
  type RegisteredSchema,
  type SchemaDefinition,
  type SchemaUidInput,
} from '../src/index.js'
import {
  DEFAULT_GENERATIVE_RUNS,
  DEFAULT_GENERATIVE_SEED,
  generateJsonValue,
  permuteJsonObjects,
  readGenerativeConfig,
  Xorshift32,
} from './generative.js'

const config = readGenerativeConfig()
const publisher = 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh'
const alternatePublisher = 'rG1QQv2nh2gr7RCZ1P8YYcBUKCCN633jCn'
const hexadecimal = '0123456789abcdef'

function runLabel(index: number, serializedInput?: string): string {
  const location = `seed=0x${config.seed.toString(16).padStart(8, '0')} run=${index}`
  return serializedInput === undefined ? location : `${location} input=${serializedInput}`
}

function randomLedgerHash(random: Xorshift32): string {
  let result = ''
  for (let index = 0; index < 64; index += 1) {
    result += hexadecimal[random.nextInt(hexadecimal.length)]!
  }
  return result
}

function randomSchema(random: Xorshift32, index: number): SchemaDefinition {
  const scalarTypes = ['string', 'bool', 'uint', 'int', 'bytes'] as const
  const fields: Record<string, FieldDescriptor> = Object.create(null) as Record<
    string,
    FieldDescriptor
  >
  const fieldCount = 1 + random.nextInt(6)
  for (let fieldIndex = 0; fieldIndex < fieldCount; fieldIndex += 1) {
    const descriptor: FieldDescriptor = {
      type: scalarTypes[random.nextInt(scalarTypes.length)]!,
    }
    const optionalVariant = random.nextInt(3)
    if (optionalVariant === 1) descriptor.optional = false
    if (optionalVariant === 2) descriptor.optional = true
    fields[`field_${fieldIndex}`] = descriptor
  }
  return {
    xcsVersion: '0.1',
    name: `Generated ${index}`,
    description: `Deterministic schema ${index}`,
    fields,
  }
}

function permuteSchema(schema: SchemaDefinition): SchemaDefinition {
  const fields = Object.fromEntries(Object.entries(schema.fields).reverse()) as Record<
    string,
    FieldDescriptor
  >
  return {
    fields,
    description: schema.description,
    name: schema.name,
    xcsVersion: schema.xcsVersion,
  }
}

function baseUidInput(): SchemaUidInput {
  return {
    networkId: 0,
    ledgerHash: 'ab'.repeat(32),
    ledgerIndex: 0,
    transactionIndex: 0,
    publisher,
    schema: {
      xcsVersion: '0.1',
      name: 'Boundary schema',
      description: 'Exercises UID input boundaries.',
      fields: { value: { type: 'string', optional: false } },
    },
  }
}

interface GeneratedResolutionChain {
  input: SchemaDefinition
  catalog: RegisteredSchema[]
  context: {
    networkId: number
    publisher: string
    ledgerIndex: number
    transactionIndex: number
  }
  expectedFields: string[]
  expectedLineage: string[]
}

function resolutionUid(salt: number, index: number): string {
  return ((salt + index) & 0xff).toString(16).padStart(2, '0').repeat(32)
}

function resolutionSchema(index: number, parentUid?: string): SchemaDefinition {
  return {
    xcsVersion: '0.1',
    name: `Generated resolution level ${index}`,
    description: `Deterministic inheritance level ${index}.`,
    ...(parentUid === undefined ? {} : { extends: parentUid }),
    fields: { [`level_${index}`]: { type: 'string' } },
  }
}

function generatedResolutionChain(depth: number, salt: number): GeneratedResolutionChain {
  const ledgerIndex = 1_000 + salt
  const uids = Array.from({ length: depth }, (_, index) => resolutionUid(salt, index))
  const definitions = Array.from({ length: depth }, (_, index) =>
    resolutionSchema(index, index === 0 ? undefined : uids[index - 1]),
  )
  const catalog = definitions.slice(0, -1).map((definition, index): RegisteredSchema => ({
    uid: uids[index]!,
    definition,
    publisher: index % 2 === 0 ? publisher : alternatePublisher,
    networkId: 1,
    ledgerIndex,
    transactionIndex: index,
  }))

  return {
    input: definitions.at(-1)!,
    catalog,
    context: {
      networkId: 1,
      publisher: depth % 2 === 0 ? alternatePublisher : publisher,
      ledgerIndex,
      transactionIndex: depth - 1,
    },
    expectedFields: Array.from({ length: depth }, (_, index) => `level_${index}`),
    expectedLineage: uids.slice(0, -1),
  }
}

describe('generative conformance configuration', () => {
  it('uses the frozen defaults and xorshift32 sequence', () => {
    expect(readGenerativeConfig({})).toEqual({
      seed: DEFAULT_GENERATIVE_SEED,
      runs: DEFAULT_GENERATIVE_RUNS,
    })
    const random = new Xorshift32(DEFAULT_GENERATIVE_SEED)
    expect(Array.from({ length: 4 }, () => random.nextUint32())).toEqual([
      1984833552, 3670165366, 3618964064, 2296252956,
    ])
  })

  it('accepts decimal and hexadecimal seed overrides and bounded run counts', () => {
    expect(
      readGenerativeConfig({ XCS_GENERATIVE_SEED: '42', XCS_GENERATIVE_RUNS: '10000' }),
    ).toEqual({ seed: 42, runs: 10_000 })
    expect(readGenerativeConfig({ XCS_GENERATIVE_SEED: '0x58435301' }).seed).toBe(
      DEFAULT_GENERATIVE_SEED,
    )
  })

  it.each([
    { XCS_GENERATIVE_SEED: '0' },
    { XCS_GENERATIVE_SEED: '-1' },
    { XCS_GENERATIVE_SEED: '4294967296' },
    { XCS_GENERATIVE_SEED: '1.5' },
    { XCS_GENERATIVE_RUNS: '0' },
    { XCS_GENERATIVE_RUNS: '10001' },
    { XCS_GENERATIVE_RUNS: '1.5' },
  ])('rejects invalid override $XCS_GENERATIVE_SEED $XCS_GENERATIVE_RUNS', (source) => {
    expect(() => readGenerativeConfig(source)).toThrow()
  })
})

describe(`generative JCS conformance (${config.runs} runs)`, () => {
  it('preserves round-trip, idempotence, key-order independence and inputs', () => {
    const random = new Xorshift32(config.seed)
    for (let index = 0; index < config.runs; index += 1) {
      const value = generateJsonValue(random)
      const inputSnapshot = JSON.stringify(value)
      const label = runLabel(index, inputSnapshot)
      const canonical = canonicalize(value)
      const parsed = parseJsonStrict(canonical)

      expect(canonicalize(parsed), `${label} round-trip`).toBe(canonical)
      expect(canonicalize(parseJsonStrict(canonicalize(parsed))), `${label} idempotence`).toBe(
        canonical,
      )
      expect(canonicalize(permuteJsonObjects(value, random)), `${label} permutation`).toBe(
        canonical,
      )
      expect(JSON.stringify(value), `${label} input mutation`).toBe(inputSnapshot)
    }
  })

  it('rejects generated duplicate decoded keys and unpaired surrogates', () => {
    const random = new Xorshift32(config.seed)
    for (let index = 0; index < config.runs; index += 1) {
      const key = `key_${random.nextUint32()}`
      const escapedKey = Array.from(
        key,
        (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`,
      ).join('')
      const duplicateInput = `{${JSON.stringify(key)}:0,"${escapedKey}":1}`
      expect(
        () => parseJsonStrict(duplicateInput),
        `${runLabel(index, duplicateInput)} duplicate key`,
      ).toThrowError(expect.objectContaining({ code: 'JSON_DUPLICATE_KEY' }))

      const surrogate = 0xd800 + random.nextInt(0x800)
      const escapedSurrogate = surrogate.toString(16).padStart(4, '0')
      const surrogateInput = `"\\u${escapedSurrogate}"`
      expect(
        () => parseJsonStrict(surrogateInput),
        `${runLabel(index, surrogateInput)} unpaired surrogate`,
      ).toThrowError(expect.objectContaining({ code: 'JSON_INVALID_UNICODE' }))
      expect(
        () => canonicalize(String.fromCharCode(surrogate)),
        `${runLabel(index, surrogateInput)} in-memory unpaired surrogate`,
      ).toThrowError(expect.objectContaining({ code: 'JSON_INVALID_UNICODE' }))
    }
  })
})

describe(`generative schema UID conformance (${config.runs} runs)`, () => {
  it('is stable across repeats, hash casing, schema order and optional=false normalization', () => {
    const random = new Xorshift32(config.seed)
    for (let index = 0; index < config.runs; index += 1) {
      const input: SchemaUidInput = {
        networkId: random.nextUint32(),
        ledgerHash: randomLedgerHash(random),
        ledgerIndex: random.nextUint32(),
        transactionIndex: random.nextUint32(),
        publisher,
        schema: randomSchema(random, index),
      }
      const inputSnapshot = JSON.stringify(input)
      const label = runLabel(index, inputSnapshot)
      const expected = computeSchemaUid(input)

      expect(computeSchemaUid(input), `${label} repeat`).toBe(expected)
      expect(
        computeSchemaUid({ ...input, ledgerHash: input.ledgerHash.toUpperCase() }),
        label,
      ).toBe(expected)
      expect(computeSchemaUid({ ...input, schema: permuteSchema(input.schema) }), label).toBe(
        expected,
      )
      expect(computeSchemaUid({ ...input, schema: validateSchema(input.schema) }), label).toBe(
        expected,
      )
      expect(JSON.stringify(input), `${label} input mutation`).toBe(inputSnapshot)
    }
  })

  it('accepts uint32 endpoints and rejects every numeric field outside them', () => {
    for (const field of ['networkId', 'ledgerIndex', 'transactionIndex'] as const) {
      for (const value of [0, 0xffff_ffff]) {
        expect(() => computeSchemaUid({ ...baseUidInput(), [field]: value })).not.toThrow()
      }
      for (const value of [-1, 0x1_0000_0000, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(() => computeSchemaUid({ ...baseUidInput(), [field]: value })).toThrowError(
          expect.objectContaining({ code: 'UID_INPUT_INVALID' }),
        )
      }
    }
  })

  it('normalizes explicit optional=false before UID computation', () => {
    const explicit = baseUidInput()
    const omitted = baseUidInput()
    omitted.schema = validateSchema(omitted.schema)
    expect(explicit.schema.fields.value).toEqual({ type: 'string', optional: false })
    expect(omitted.schema.fields.value).toEqual({ type: 'string' })
    expect(computeSchemaUid(explicit)).toBe(computeSchemaUid(omitted))
  })
})

describe('deterministic schema resolution properties', () => {
  it('resolves every supported chain depth as an ordered union without mutating inputs', () => {
    const random = new Xorshift32(config.seed)
    for (let depth = 1; depth <= 16; depth += 1) {
      const chain = generatedResolutionChain(depth, random.nextInt(10_000))
      const snapshot = JSON.stringify(chain)
      const catalog = new Map(chain.catalog.map((registration) => [registration.uid, registration]))
      const resolved = resolveSchema(chain.input, {
        ...chain.context,
        getSchema: (uid) => catalog.get(uid),
      })
      const label = runLabel(depth - 1, snapshot)

      expect(Object.keys(resolved.fields), `${label} field union`).toEqual(chain.expectedFields)
      expect(resolved.lineage, `${label} lineage`).toEqual(chain.expectedLineage)
      expect(JSON.stringify(chain), `${label} input mutation`).toBe(snapshot)
    }
  })

  it('classifies missing, cross-network, future, override and cycle mutations', () => {
    const rootUid = '71'.repeat(32)
    const parentUid = '72'.repeat(32)
    const root: RegisteredSchema = {
      uid: rootUid,
      definition: resolutionSchema(0),
      publisher,
      networkId: 1,
      ledgerIndex: 500,
      transactionIndex: 0,
    }
    const parent: RegisteredSchema = {
      uid: parentUid,
      definition: resolutionSchema(1, rootUid),
      publisher: alternatePublisher,
      networkId: 1,
      ledgerIndex: 500,
      transactionIndex: 1,
    }
    const input = resolutionSchema(2, parentUid)
    const context = {
      networkId: 1,
      publisher,
      ledgerIndex: 500,
      transactionIndex: 2,
    }
    const resolve = (catalogEntries: RegisteredSchema[], candidate = input) => {
      const catalog = new Map(
        catalogEntries.map((registration) => [registration.uid, registration]),
      )
      return resolveSchema(candidate, {
        ...context,
        getSchema: (uid) => catalog.get(uid),
      })
    }
    const cases: Array<{
      name: string
      code: string
      catalog: RegisteredSchema[]
      input?: SchemaDefinition
    }> = [
      {
        name: 'missing parent',
        code: 'SCHEMA_PARENT_NOT_FOUND',
        catalog: [root],
      },
      {
        name: 'cross-network parent',
        code: 'SCHEMA_PARENT_NETWORK_MISMATCH',
        catalog: [root, { ...parent, networkId: 2 }],
      },
      {
        name: 'future parent',
        code: 'SCHEMA_PARENT_NOT_PRIOR',
        catalog: [root, { ...parent, transactionIndex: 2 }],
      },
      {
        name: 'inherited override',
        code: 'SCHEMA_OVERRIDE_FORBIDDEN',
        catalog: [root, parent],
        input: {
          ...input,
          fields: { level_0: { type: 'bool' } },
        },
      },
      {
        name: 'inheritance cycle',
        code: 'SCHEMA_INHERITANCE_CYCLE',
        catalog: [
          root,
          {
            ...parent,
            definition: { ...parent.definition, extends: parentUid },
          },
        ],
      },
    ]

    for (const mutation of cases) {
      expect(
        () => resolve(mutation.catalog, mutation.input),
        `${mutation.name} seed=0x${config.seed.toString(16)}`,
      ).toThrowError(expect.objectContaining({ code: mutation.code }))
    }
  })
})

describe('generated schema limit boundaries', () => {
  it('accepts 256 descriptors and rejects 257 descriptors', () => {
    const fields = (count: number): Record<string, FieldDescriptor> =>
      Object.fromEntries(
        Array.from({ length: count }, (_, index) => [`field_${index}`, { type: 'string' }]),
      ) as Record<string, FieldDescriptor>

    expect(() =>
      validateSchema({
        xcsVersion: '0.1',
        name: 'At descriptor limit',
        description: 'Exactly 256 descriptors.',
        fields: fields(256),
      }),
    ).not.toThrow()
    expect(() =>
      validateSchema({
        xcsVersion: '0.1',
        name: 'Above descriptor limit',
        description: 'Exactly 257 descriptors.',
        fields: fields(257),
      }),
    ).toThrowError(expect.objectContaining({ code: 'SCHEMA_FIELD_LIMIT_EXCEEDED' }))
  })

  it('accepts 16 descriptor levels and rejects 17', () => {
    const nested = (arrayCount: number): FieldDescriptor => {
      let descriptor: FieldDescriptor = { type: 'string' }
      for (let index = 0; index < arrayCount; index += 1) {
        descriptor = { type: 'array', items: descriptor }
      }
      return descriptor
    }
    const schema = (arrayCount: number): SchemaDefinition => ({
      xcsVersion: '0.1',
      name: 'Depth boundary',
      description: 'Exercises descriptor depth.',
      fields: { value: nested(arrayCount) },
    })

    expect(() => validateSchema(schema(15))).not.toThrow()
    expect(() => validateSchema(schema(16))).toThrowError(
      expect.objectContaining({ code: 'SCHEMA_DEPTH_EXCEEDED' }),
    )
  })

  it('accepts 256 resolved descriptors and rejects 257', () => {
    const parentUid = '73'.repeat(32)
    const parent: RegisteredSchema = {
      uid: parentUid,
      definition: validateSchema({
        xcsVersion: '0.1',
        name: 'Generated descriptor parent',
        description: 'Contributes 255 descriptors to the resolved schema.',
        fields: Object.fromEntries(
          Array.from({ length: 255 }, (_, index) => [`parent_${index}`, { type: 'string' }]),
        ),
      }),
      publisher,
      networkId: 1,
      ledgerIndex: 600,
      transactionIndex: 0,
    }
    const context = {
      networkId: 1,
      publisher: alternatePublisher,
      ledgerIndex: 600,
      transactionIndex: 1,
      getSchema: (uid: string) => (uid === parentUid ? parent : undefined),
    }
    const child = (fieldCount: number): SchemaDefinition => ({
      xcsVersion: '0.1',
      name: 'Generated descriptor child',
      description: 'Exercises the resolved descriptor count boundary.',
      extends: parentUid,
      fields: Object.fromEntries(
        Array.from({ length: fieldCount }, (_, index) => [`child_${index}`, { type: 'string' }]),
      ) as Record<string, FieldDescriptor>,
    })

    expect(Object.keys(resolveSchema(child(1), context).fields)).toHaveLength(256)
    expect(() => resolveSchema(child(2), context)).toThrowError(
      expect.objectContaining({ code: 'SCHEMA_FIELD_LIMIT_EXCEEDED' }),
    )
  })
})
