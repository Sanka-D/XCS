const LOWERCASE_HASH = /^[0-9a-f]{64}$/u
const MAX_UINT32 = 4_294_967_295

export interface SigningReadiness {
  readonly profileId: string
  readonly status: 'ready'
  readonly checkpoint: {
    readonly ledgerIndex: number
    readonly ledgerHash: string
    readonly closeTime: number
    readonly transactionRoot: string
  }
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
}

/**
 * Treat the read API as an untrusted boundary. Freshness itself is evaluated
 * with database time by the API; the browser only accepts its closed, profile-
 * bound proof before allowing a wallet side effect.
 */
export function parseSigningReadiness(input: unknown, expectedProfileId: string): SigningReadiness {
  if (!isRecord(input)) throw new Error('INDEXER_SIGNING_READINESS_INVALID')
  if (input.profileId !== expectedProfileId) {
    throw new Error('NETWORK_PROFILE_CHANGED_BEFORE_SIGNATURE')
  }
  if (input.status !== 'ready' || !isRecord(input.checkpoint)) {
    throw new Error('INDEXER_SIGNING_READINESS_INVALID')
  }

  const checkpoint = input.checkpoint
  if (
    !Number.isSafeInteger(checkpoint.ledgerIndex) ||
    (checkpoint.ledgerIndex as number) < 0 ||
    (checkpoint.ledgerIndex as number) > MAX_UINT32 ||
    typeof checkpoint.ledgerHash !== 'string' ||
    !LOWERCASE_HASH.test(checkpoint.ledgerHash) ||
    !Number.isSafeInteger(checkpoint.closeTime) ||
    (checkpoint.closeTime as number) < 0 ||
    (checkpoint.closeTime as number) > MAX_UINT32 ||
    typeof checkpoint.transactionRoot !== 'string' ||
    !LOWERCASE_HASH.test(checkpoint.transactionRoot)
  ) {
    throw new Error('INDEXER_SIGNING_READINESS_INVALID')
  }

  return {
    profileId: expectedProfileId,
    status: 'ready',
    checkpoint: {
      ledgerIndex: checkpoint.ledgerIndex as number,
      ledgerHash: checkpoint.ledgerHash,
      closeTime: checkpoint.closeTime as number,
      transactionRoot: checkpoint.transactionRoot,
    },
  }
}
