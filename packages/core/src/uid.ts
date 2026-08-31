import { isClassicAddress } from './address.js'
import { canonicalize } from './canonicalize.js'
import { fail } from './errors.js'
import { validateSchema } from './schema.js'
import { sha256Hex } from './sha256.js'
import type { JsonValue, SchemaUidInput } from './types.js'
import { encodeUtf8 } from './utf8.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isUint32(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 0xffff_ffff
}

function normalizeUint32(value: number): number {
  return value === 0 ? 0 : value
}

export function computeSchemaUid(input: SchemaUidInput): string {
  if (!isRecord(input)) {
    return fail('UID_INPUT_INVALID', 'Schema UID input must be an object', '$')
  }
  if (!isUint32(input.networkId)) {
    return fail('UID_INPUT_INVALID', 'networkId must be a uint32', '$.networkId')
  }
  if (typeof input.ledgerHash !== 'string' || !/^[0-9a-fA-F]{64}$/.test(input.ledgerHash)) {
    return fail(
      'UID_INPUT_INVALID',
      'ledgerHash must be a 32-byte hexadecimal hash',
      '$.ledgerHash',
    )
  }
  if (!isUint32(input.ledgerIndex)) {
    return fail('UID_INPUT_INVALID', 'ledgerIndex must be a uint32', '$.ledgerIndex')
  }
  if (!isUint32(input.transactionIndex)) {
    return fail('UID_INPUT_INVALID', 'transactionIndex must be a uint32', '$.transactionIndex')
  }
  if (!isClassicAddress(input.publisher)) {
    return fail('UID_INPUT_INVALID', 'publisher must be an XRPL classic address', '$.publisher')
  }

  const schema = validateSchema(input.schema)
  const preimage = {
    purpose: 'xcs.schema.uid',
    version: '0.1',
    networkId: normalizeUint32(input.networkId),
    ledgerHash: input.ledgerHash.toLowerCase(),
    ledgerIndex: normalizeUint32(input.ledgerIndex),
    transactionIndex: normalizeUint32(input.transactionIndex),
    publisher: input.publisher,
    schema,
  } as unknown as JsonValue
  return sha256Hex(encodeUtf8(canonicalize(preimage)))
}
