import { fail } from './errors.js'
import type {
  FieldDescriptor,
  RegisteredSchema,
  ResolvedSchema,
  ScalarFieldType,
  SchemaDefinition,
  SchemaResolutionContext,
} from './types.js'
import { encodeUtf8 } from './utf8.js'

const FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/
const UID = /^[0-9a-f]{64}$/
const SCALAR_TYPES = new Set(['string', 'bool', 'uint', 'int', 'bytes', 'address'])
const SCHEMA_KEYS = new Set([
  'xcsVersion',
  'name',
  'description',
  'extends',
  'supersedes',
  'fields',
])
const MAX_DEPTH = 16
const MAX_FIELDS = 256
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/u

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertOnlyKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail('SCHEMA_INVALID', `Unknown property ${key}`, `${path}.${key}`)
  }
}

function validateFields(
  input: unknown,
  path: string,
  descriptorDepth: number,
  fieldCounter: { value: number },
): Record<string, FieldDescriptor> {
  if (!isRecord(input) || Object.keys(input).length === 0) {
    return fail('SCHEMA_INVALID', 'fields must be a non-empty object', path)
  }
  if (descriptorDepth > MAX_DEPTH) {
    return fail('SCHEMA_DEPTH_EXCEEDED', `Field nesting exceeds ${MAX_DEPTH}`, path)
  }

  const result: Record<string, FieldDescriptor> = Object.create(null) as Record<
    string,
    FieldDescriptor
  >
  for (const [name, rawDescriptor] of Object.entries(input)) {
    if (!FIELD_NAME.test(name)) {
      return fail('SCHEMA_INVALID', 'Invalid field name', `${path}.${name}`, { name })
    }
    incrementFieldCount(fieldCounter, `${path}.${name}`)
    result[name] = validateFieldDescriptor(
      rawDescriptor,
      `${path}.${name}`,
      descriptorDepth,
      fieldCounter,
    )
  }
  return result
}

function incrementFieldCount(fieldCounter: { value: number }, path: string): void {
  fieldCounter.value += 1
  if (fieldCounter.value > MAX_FIELDS) {
    return fail(
      'SCHEMA_FIELD_LIMIT_EXCEEDED',
      `Schema defines more than ${MAX_FIELDS} fields`,
      path,
    )
  }
}

function validateFieldDescriptor(
  input: unknown,
  path: string,
  descriptorDepth: number,
  fieldCounter: { value: number },
): FieldDescriptor {
  if (!isRecord(input)) return fail('SCHEMA_INVALID', 'Field descriptor must be an object', path)
  if (typeof input.type !== 'string') {
    return fail('SCHEMA_INVALID', 'Field descriptor requires a string type', `${path}.type`)
  }
  if (input.optional !== undefined && typeof input.optional !== 'boolean') {
    return fail('SCHEMA_INVALID', 'optional must be a boolean', `${path}.optional`)
  }
  const optional = input.optional === true ? { optional: true as const } : {}

  if (SCALAR_TYPES.has(input.type)) {
    assertOnlyKeys(input, new Set(['type', 'optional']), path)
    return { type: input.type as ScalarFieldType, ...optional }
  }
  if (input.type === 'array') {
    assertOnlyKeys(input, new Set(['type', 'optional', 'items']), path)
    if (!('items' in input)) {
      return fail('SCHEMA_INVALID', 'Array descriptor requires items', `${path}.items`)
    }
    if (descriptorDepth >= MAX_DEPTH) {
      return fail('SCHEMA_DEPTH_EXCEEDED', `Field nesting exceeds ${MAX_DEPTH}`, path)
    }
    incrementFieldCount(fieldCounter, `${path}.items`)
    return {
      type: 'array',
      items: validateFieldDescriptor(
        input.items,
        `${path}.items`,
        descriptorDepth + 1,
        fieldCounter,
      ),
      ...optional,
    }
  }
  if (input.type === 'object') {
    assertOnlyKeys(input, new Set(['type', 'optional', 'fields']), path)
    return {
      type: 'object',
      fields: validateFields(input.fields, `${path}.fields`, descriptorDepth + 1, fieldCounter),
      ...optional,
    }
  }
  return fail('SCHEMA_INVALID', `Unsupported field type ${input.type}`, `${path}.type`)
}

export function validateSchema(input: unknown): SchemaDefinition {
  if (!isRecord(input)) return fail('SCHEMA_INVALID', 'Schema must be a JSON object', '$')
  assertOnlyKeys(input, SCHEMA_KEYS, '$')
  if (input.xcsVersion !== '0.1') {
    return fail('SCHEMA_INVALID', 'Schema xcsVersion must be 0.1', '$.xcsVersion')
  }
  if (
    typeof input.name !== 'string' ||
    CONTROL_CHARACTER.test(input.name) ||
    encodeUtf8(input.name).length < 1 ||
    encodeUtf8(input.name).length > 64
  ) {
    return fail('SCHEMA_INVALID', 'name must contain 1 to 64 UTF-8 bytes', '$.name')
  }
  if (
    typeof input.description !== 'string' ||
    CONTROL_CHARACTER.test(input.description) ||
    encodeUtf8(input.description).length < 1 ||
    encodeUtf8(input.description).length > 256
  ) {
    return fail('SCHEMA_INVALID', 'description must contain 1 to 256 UTF-8 bytes', '$.description')
  }
  for (const relation of ['extends', 'supersedes'] as const) {
    if (
      input[relation] !== undefined &&
      (typeof input[relation] !== 'string' || !UID.test(input[relation]))
    ) {
      return fail(
        'SCHEMA_INVALID',
        `${relation} must be a lowercase 32-byte schema UID`,
        `$.${relation}`,
      )
    }
  }
  if (input.extends !== undefined && input.extends === input.supersedes) {
    return fail('SCHEMA_INVALID', 'extends and supersedes cannot reference the same schema', '$')
  }

  const result: SchemaDefinition = {
    xcsVersion: '0.1',
    name: input.name,
    description: input.description,
    fields: validateFields(input.fields, '$.fields', 1, { value: 0 }),
  }
  if (typeof input.extends === 'string') result.extends = input.extends
  if (typeof input.supersedes === 'string') result.supersedes = input.supersedes
  return result
}

function isPrior(
  candidate: Pick<RegisteredSchema, 'ledgerIndex' | 'transactionIndex'>,
  ledgerIndex: number,
  transactionIndex: number,
): boolean {
  return (
    candidate.ledgerIndex < ledgerIndex ||
    (candidate.ledgerIndex === ledgerIndex && candidate.transactionIndex < transactionIndex)
  )
}

function countFields(fields: Record<string, FieldDescriptor>): number {
  let count = 0
  for (const descriptor of Object.values(fields)) {
    count += countFieldDescriptor(descriptor)
  }
  return count
}

function countFieldDescriptor(descriptor: FieldDescriptor): number {
  if (descriptor.type === 'array') return 1 + countFieldDescriptor(descriptor.items)
  if (descriptor.type === 'object') return 1 + countFields(descriptor.fields)
  return 1
}

function resolveInternal(
  schema: SchemaDefinition,
  context: SchemaResolutionContext,
  visiting: Set<string>,
): ResolvedSchema {
  let lineage: string[] = []
  let fields: Record<string, FieldDescriptor> = Object.create(null) as Record<
    string,
    FieldDescriptor
  >

  if (schema.extends !== undefined) {
    if (visiting.size >= MAX_DEPTH - 1) {
      return fail('SCHEMA_DEPTH_EXCEEDED', `Inheritance depth exceeds ${MAX_DEPTH}`, '$.extends')
    }
    if (visiting.has(schema.extends)) {
      return fail('SCHEMA_INHERITANCE_CYCLE', 'Schema inheritance cycle detected', '$.extends')
    }
    const parent = context.getSchema(schema.extends)
    if (parent === undefined || parent.uid !== schema.extends) {
      return fail('SCHEMA_PARENT_NOT_FOUND', 'Parent schema was not found', '$.extends', {
        uid: schema.extends,
      })
    }
    if (parent.networkId !== context.networkId) {
      return fail(
        'SCHEMA_PARENT_NETWORK_MISMATCH',
        'Parent schema belongs to a different XRPL network',
        '$.extends',
      )
    }
    if (!isPrior(parent, context.ledgerIndex, context.transactionIndex)) {
      return fail('SCHEMA_PARENT_NOT_PRIOR', 'Parent schema must precede its child', '$.extends')
    }
    visiting.add(schema.extends)
    const resolvedParent = resolveInternal(
      validateSchema(parent.definition),
      {
        networkId: parent.networkId,
        publisher: parent.publisher,
        ledgerIndex: parent.ledgerIndex,
        transactionIndex: parent.transactionIndex,
        getSchema: context.getSchema,
      },
      visiting,
    )
    visiting.delete(schema.extends)
    lineage = [...resolvedParent.lineage, schema.extends]
    if (lineage.length + 1 > MAX_DEPTH) {
      return fail('SCHEMA_DEPTH_EXCEEDED', `Inheritance depth exceeds ${MAX_DEPTH}`, '$.extends')
    }
    fields = Object.assign(
      Object.create(null) as Record<string, FieldDescriptor>,
      resolvedParent.fields,
    )
  }

  for (const [name, descriptor] of Object.entries(schema.fields)) {
    if (Object.hasOwn(fields, name)) {
      return fail(
        'SCHEMA_OVERRIDE_FORBIDDEN',
        `Inherited field ${name} cannot be redefined`,
        `$.fields.${name}`,
      )
    }
    fields[name] = descriptor
  }

  if (schema.supersedes !== undefined) {
    const previous = context.getSchema(schema.supersedes)
    if (
      previous === undefined ||
      previous.uid !== schema.supersedes ||
      previous.networkId !== context.networkId
    ) {
      return fail(
        'SCHEMA_SUPERSEDES_NOT_FOUND',
        'Superseded schema was not found on this network',
        '$.supersedes',
      )
    }
    if (!isPrior(previous, context.ledgerIndex, context.transactionIndex)) {
      return fail(
        'SCHEMA_SUPERSEDES_NOT_PRIOR',
        'Superseded schema must precede its replacement',
        '$.supersedes',
      )
    }
    if (previous.publisher !== context.publisher) {
      return fail(
        'SCHEMA_SUPERSEDES_PUBLISHER_MISMATCH',
        'Only the original publisher may supersede a schema',
        '$.supersedes',
      )
    }
  }

  if (countFields(fields) > MAX_FIELDS) {
    return fail(
      'SCHEMA_FIELD_LIMIT_EXCEEDED',
      `Resolved schema contains more than ${MAX_FIELDS} fields`,
      '$.fields',
    )
  }
  return { definition: schema, fields, lineage }
}

export function resolveSchema(
  input: SchemaDefinition,
  context: SchemaResolutionContext,
): ResolvedSchema {
  if (
    !Number.isInteger(context.networkId) ||
    context.networkId < 0 ||
    context.networkId > 0xffff_ffff ||
    !Number.isInteger(context.ledgerIndex) ||
    context.ledgerIndex < 0 ||
    context.ledgerIndex > 0xffff_ffff ||
    !Number.isInteger(context.transactionIndex) ||
    context.transactionIndex < 0 ||
    context.transactionIndex > 0xffff_ffff ||
    typeof context.publisher !== 'string' ||
    typeof context.getSchema !== 'function'
  ) {
    return fail('SCHEMA_INVALID', 'Invalid schema resolution context', '$context')
  }
  return resolveInternal(validateSchema(input), context, new Set())
}
