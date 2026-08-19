import type { Checkpoint, NetworkProfile, ValidatedLedger } from './types.js'

export class LedgerContinuityError extends Error {
  readonly code:
    | 'LEDGER_BEFORE_ACTIVATION'
    | 'LEDGER_GAP'
    | 'LEDGER_PARENT_MISMATCH'
    | 'ACTIVATION_HASH_MISMATCH'

  constructor(code: LedgerContinuityError['code'], message: string) {
    super(message)
    this.name = 'LedgerContinuityError'
    this.code = code
  }
}

export function assertLedgerContinuity(
  profile: NetworkProfile,
  previous: Checkpoint | undefined,
  ledger: ValidatedLedger,
): void {
  if (previous === undefined) {
    if (ledger.ledgerIndex !== profile.activationLedgerIndex) {
      throw new LedgerContinuityError(
        ledger.ledgerIndex < profile.activationLedgerIndex
          ? 'LEDGER_BEFORE_ACTIVATION'
          : 'LEDGER_GAP',
        `Expected activation ledger ${profile.activationLedgerIndex}, received ${ledger.ledgerIndex}`,
      )
    }

    if (ledger.ledgerHash !== profile.activationLedgerHash.toLowerCase()) {
      throw new LedgerContinuityError(
        'ACTIVATION_HASH_MISMATCH',
        `Activation ledger hash does not match profile ${profile.profileId}`,
      )
    }
    return
  }

  if (ledger.ledgerIndex !== previous.ledgerIndex + 1) {
    throw new LedgerContinuityError(
      'LEDGER_GAP',
      `Expected ledger ${previous.ledgerIndex + 1}, received ${ledger.ledgerIndex}`,
    )
  }

  if (ledger.parentHash !== previous.ledgerHash) {
    throw new LedgerContinuityError(
      'LEDGER_PARENT_MISMATCH',
      `Ledger ${ledger.ledgerIndex} does not descend from ${previous.ledgerHash}`,
    )
  }
}

export function assertTransactionOrdering(ledger: ValidatedLedger): void {
  for (const [position, transaction] of ledger.transactions.entries()) {
    if (transaction.transactionIndex !== position) {
      throw new LedgerContinuityError(
        'LEDGER_GAP',
        `Ledger ${ledger.ledgerIndex} is missing transaction index ${position}`,
      )
    }
  }
}
