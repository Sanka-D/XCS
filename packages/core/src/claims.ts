import { isClassicAddress } from './address.js'
import { fail } from './errors.js'
import type { FieldDescriptor, JsonObject, JsonValue, ResolvedSchema } from './types.js'

const UINT_MAX = (1n << 256n) - 1n
const INT_MIN = -(1n << 255n)
const INT_MAX = (1n << 255n) - 1n
const DECIMAL_UNSIGNED = /^(?:0|[1-9][0-9]*)$/
const DECIMAL_SIGNED = /^(?:0|-?[1-9][0-9]*)$/
const BASE64URL = /^[A-Za-z0-9_-]*$/
const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isResolvedSchema(
  value: ResolvedSchema | Record<string, FieldDescriptor>,
): value is ResolvedSchema {
  if (!isRecord(value) || !isRecord(value.definition) || !isRecord(value.fields)) return false
  return (
    value.definition.xcsVersion === '0.1' &&
    typeof value.definition.name === 'string' &&
    typeof value.definition.description === 'string' &&
    isRecord(value.definition.fields) &&
    Array.isArray(value.lineage) &&
    value.lineage.every((uid) => typeof uid === 'string')
  )
}

function isCanonicalBase64Url(value: string): boolean {
  if (!BASE64URL.test(value) || value.length % 4 === 1) return false
  const remainder = value.length % 4
  if (remainder === 2) {
    const last = BASE64URL_ALPHABET.indexOf(value.at(-1) ?? '')
    return last >= 0 && (last & 0x0f) === 0
  }
  if (remainder === 3) {
    const last = BASE64URL_ALPHABET.indexOf(value.at(-1) ?? '')
    return last >= 0 && (last & 0x03) === 0
  }
  return true
}

function validateValue(value: unknown, descriptor: FieldDescriptor, path: string): JsonValue {
  if (value === null) return fail('CLAIMS_INVALID', 'null is not allowed in XCS claims', path)

  switch (descriptor.type) {
    case 'string':
      if (typeof value !== 'string') return fail('CLAIMS_INVALID', 'Expected string', path)
      return value
    case 'bool':
      if (typeof value !== 'boolean') return fail('CLAIMS_INVALID', 'Expected boolean', path)
      return value
    case 'uint': {
      if (typeof value !== 'string' || !DECIMAL_UNSIGNED.test(value)) {
        return fail('CLAIMS_INVALID', 'Expected canonical unsigned decimal string', path)
      }
      if (value.length > 78) return fail('CLAIMS_INVALID', 'uint exceeds 256-bit range', path)
      const parsed = BigInt(value)
      if (parsed > UINT_MAX) return fail('CLAIMS_INVALID', 'uint exceeds 256-bit range', path)
      return value
    }
    case 'int': {
      if (typeof value !== 'string' || !DECIMAL_SIGNED.test(value)) {
        return fail('CLAIMS_INVALID', 'Expected canonical signed decimal string', path)
      }
      if (value.length > 79) {
        return fail('CLAIMS_INVALID', 'int exceeds signed 256-bit range', path)
      }
      const parsed = BigInt(value)
      if (parsed < INT_MIN || parsed > INT_MAX) {
        return fail('CLAIMS_INVALID', 'int exceeds signed 256-bit range', path)
      }
      return value
    }
    case 'bytes':
      if (typeof value !== 'string' || !isCanonicalBase64Url(value)) {
        return fail('CLAIMS_INVALID', 'Expected canonical base64url without padding', path)
      }
      return value
    case 'address':
      if (typeof value !== 'string' || !isClassicAddress(value)) {
        return fail('CLAIMS_INVALID', 'Expected an XRPL classic address', path)
      }
      return value
    case 'array':
      if (!Array.isArray(value)) return fail('CLAIMS_INVALID', 'Expected array', path)
      return value.map((item, index) => validateValue(item, descriptor.items, `${path}[${index}]`))
    case 'object':
      return validateObject(value, descriptor.fields, path)
  }
}

function validateObject(
  input: unknown,
  fields: Record<string, FieldDescriptor>,
  path: string,
): JsonObject {
  if (!isRecord(input)) return fail('CLAIMS_INVALID', 'Expected object', path)
  for (const key of Object.keys(input)) {
    if (!Object.hasOwn(fields, key)) {
      return fail('CLAIMS_INVALID', `Unknown claim ${key}`, `${path}.${key}`)
    }
  }

  const result: JsonObject = Object.create(null) as JsonObject
  for (const [name, descriptor] of Object.entries(fields)) {
    if (!Object.hasOwn(input, name)) {
      if (descriptor.optional === true) continue
      return fail('CLAIMS_INVALID', `Missing required claim ${name}`, `${path}.${name}`)
    }
    result[name] = validateValue(input[name], descriptor, `${path}.${name}`)
  }
  return result
}

export function validateClaims(
  input: unknown,
  schema: ResolvedSchema | Record<string, FieldDescriptor>,
): JsonObject {
  const fields = isResolvedSchema(schema) ? schema.fields : schema
  return validateObject(input, fields, '$.claims')
}
