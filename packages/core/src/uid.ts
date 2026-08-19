import { isClassicAddress } from './address.js'
import { canonicalize } from './canonicalize.js'
import { fail } from './errors.js'
import { validateSchema } from './schema.js'
import { sha256Hex } from './sha256.js'
import type { JsonValue, SchemaUidInput } from './types.js'
import { encodeUtf8 } from './utf8.js'

function isUint32(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 0xffff_ffff
}

export function computeSchemaUid(input: SchemaUidInput): string {
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
    networkId: input.networkId,
    ledgerHash: input.ledgerHash.toLowerCase(),
    ledgerIndex: input.ledgerIndex,
    transactionIndex: input.transactionIndex,
    publisher: input.publisher,
    schema,
  } as unknown as JsonValue
  return sha256Hex(encodeUtf8(canonicalize(preimage)))
}
