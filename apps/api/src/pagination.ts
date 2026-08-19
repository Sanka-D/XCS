import type { SchemaCursor } from './types.js'

const UID_PATTERN = /^[0-9a-f]{64}$/

export function encodeSchemaCursor(cursor: SchemaCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

export function decodeSchemaCursor(value: string): SchemaCursor {
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
  } catch {
    throw new Error('Invalid cursor')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Invalid cursor')
  }
  const cursor = parsed as Record<string, unknown>
  if (
    Object.keys(cursor).length !== 3 ||
    typeof cursor.ledgerIndex !== 'number' ||
    !Number.isSafeInteger(cursor.ledgerIndex) ||
    cursor.ledgerIndex < 0 ||
    typeof cursor.transactionIndex !== 'number' ||
    !Number.isSafeInteger(cursor.transactionIndex) ||
    cursor.transactionIndex < 0 ||
    typeof cursor.schemaUid !== 'string' ||
    !UID_PATTERN.test(cursor.schemaUid)
  ) {
    throw new Error('Invalid cursor')
  }
  return {
    ledgerIndex: cursor.ledgerIndex,
    transactionIndex: cursor.transactionIndex,
    schemaUid: cursor.schemaUid,
  }
}
