export type ReplayTargetErrorCode =
  | 'REPLAY_TARGET_INVALID'
  | 'REPLAY_TARGET_UNAVAILABLE'
  | 'REPLAY_TARGET_MISMATCH'
  | 'REPLAY_TARGET_EXCEEDED'

export interface ReplayTarget {
  ledgerIndex: number
  ledgerHash: string
}

export class ReplayTargetError extends Error {
  constructor(
    readonly code: ReplayTargetErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'ReplayTargetError'
  }
}

export function createReplayTarget(ledgerIndex: unknown, ledgerHash: unknown): ReplayTarget {
  if (
    typeof ledgerIndex !== 'number' ||
    !Number.isSafeInteger(ledgerIndex) ||
    ledgerIndex < 1 ||
    ledgerIndex > 0xffff_ffff
  ) {
    throw new ReplayTargetError(
      'REPLAY_TARGET_INVALID',
      'Replay ledger index must be a positive uint32',
    )
  }
  if (typeof ledgerHash !== 'string' || !/^[0-9a-fA-F]{64}$/u.test(ledgerHash)) {
    throw new ReplayTargetError(
      'REPLAY_TARGET_INVALID',
      'Replay ledger hash must be a 32-byte hexadecimal hash',
    )
  }
  return { ledgerIndex, ledgerHash: ledgerHash.toLowerCase() }
}

export function loadReplayTarget(environment: NodeJS.ProcessEnv = process.env): ReplayTarget {
  const ledgerIndex = environment.XCS_REPLAY_TARGET_LEDGER_INDEX
  const ledgerHash = environment.XCS_REPLAY_TARGET_LEDGER_HASH
  if (ledgerIndex === undefined || ledgerHash === undefined) {
    throw new ReplayTargetError(
      'REPLAY_TARGET_INVALID',
      'XCS_REPLAY_TARGET_LEDGER_INDEX and XCS_REPLAY_TARGET_LEDGER_HASH are required',
    )
  }
  if (!/^(?:0|[1-9]\d*)$/u.test(ledgerIndex)) {
    throw new ReplayTargetError(
      'REPLAY_TARGET_INVALID',
      'XCS_REPLAY_TARGET_LEDGER_INDEX must be a canonical uint32',
    )
  }
  return createReplayTarget(Number(ledgerIndex), ledgerHash)
}
