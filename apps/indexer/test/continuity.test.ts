import { describe, expect, it } from 'vitest'

import { assertLedgerContinuity, LedgerContinuityError } from '../src/continuity.js'
import type { NetworkProfile, ValidatedLedger } from '../src/types.js'

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)
const HASH_C = 'c'.repeat(64)

const profile: NetworkProfile = {
  profileId: 'test',
  xcsVersion: '0.1',
  networkId: 1,
  requiredAmendment: HASH_C,
  registryAddress: 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh',
  registrationAmountDrops: '1',
  activationLedgerIndex: 100,
  activationLedgerHash: HASH_A,
}

function ledger(overrides: Partial<ValidatedLedger> = {}): ValidatedLedger {
  return {
    ledgerIndex: 100,
    ledgerHash: HASH_A,
    parentHash: HASH_C,
    accountRoot: HASH_B,
    transactionRoot: HASH_C,
    parentCloseTime: 990,
    closeTime: 1_000,
    closeTimeResolution: 10,
    closeFlags: 0,
    totalCoins: '100000000000000000',
    transactions: [],
    ...overrides,
  }
}

describe('assertLedgerContinuity', () => {
  it('accepts the pinned activation ledger', () => {
    expect(() => assertLedgerContinuity(profile, undefined, ledger())).not.toThrow()
  })

  it('rejects starting after activation', () => {
    expect(() =>
      assertLedgerContinuity(profile, undefined, ledger({ ledgerIndex: 101 })),
    ).toThrowError(expect.objectContaining<Partial<LedgerContinuityError>>({ code: 'LEDGER_GAP' }))
  })

  it('rejects a parent hash mismatch', () => {
    expect(() =>
      assertLedgerContinuity(
        profile,
        {
          ledgerIndex: 100,
          ledgerHash: HASH_A,
          parentHash: HASH_C,
          closeTime: 1_000,
          transactionCount: 0,
          transactionRoot: HASH_C,
        },
        ledger({ ledgerIndex: 101, ledgerHash: HASH_B, parentHash: HASH_C }),
      ),
    ).toThrowError(
      expect.objectContaining<Partial<LedgerContinuityError>>({
        code: 'LEDGER_PARENT_MISMATCH',
      }),
    )
  })
})
