export const XRPL_SOURCE_ERROR_CODES = [
  'SOURCE_RESPONSE_INVALID',
  'SOURCE_NETWORK_MISMATCH',
  'SOURCE_HISTORY_INCOMPLETE',
  'SOURCE_ACTIVATION_MISMATCH',
  'SOURCE_AMENDMENT_UNAVAILABLE',
  'SOURCE_REGISTRY_NOT_BLACKHOLED',
  'SOURCE_DIVERGENCE',
  'SOURCE_TIP_REGRESSION',
  'SOURCE_UNAVAILABLE',
] as const

export type XrplSourceErrorCode = (typeof XRPL_SOURCE_ERROR_CODES)[number]

export const STABLE_INDEXER_ERROR_CODES = [
  ...XRPL_SOURCE_ERROR_CODES,
  'LEDGER_BEFORE_ACTIVATION',
  'LEDGER_GAP',
  'LEDGER_PARENT_MISMATCH',
  'ACTIVATION_HASH_MISMATCH',
  'CHECKPOINT_EVIDENCE_MISSING',
  'CHECKPOINT_CONFLICT',
  'REPLAY_TARGET_INVALID',
  'REPLAY_TARGET_UNAVAILABLE',
  'REPLAY_TARGET_MISMATCH',
  'REPLAY_TARGET_EXCEEDED',
  'INDEXER_LEASE_UNAVAILABLE',
  'INDEXER_LEASE_LOST',
  'INDEXER_FAILED',
] as const

export type StableIndexerErrorCode = (typeof STABLE_INDEXER_ERROR_CODES)[number]

const stableIndexerErrorCodes = new Set<string>(STABLE_INDEXER_ERROR_CODES)

export class XrplSourceError extends Error {
  constructor(
    readonly code: XrplSourceErrorCode,
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {},
    options: { cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'XrplSourceError'
  }
}

export function sourceFailure(
  code: XrplSourceErrorCode,
  message: string,
  details: Readonly<Record<string, unknown>> = {},
): never {
  throw new XrplSourceError(code, message, details)
}

export function sourceErrorCode(error: unknown): StableIndexerErrorCode {
  if (error instanceof XrplSourceError) return error.code
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string'
  ) {
    const code = (error as { code: string }).code
    if (stableIndexerErrorCodes.has(code)) return code as StableIndexerErrorCode
  }
  return 'INDEXER_FAILED'
}
