import { describe, expect, it } from 'vitest'

import { assertStoredProfileMatches } from '../src/repository.js'
import type { NetworkProfile } from '../src/types.js'

const profile: NetworkProfile = {
  profileId: 'testnet',
  xcsVersion: '0.1',
  networkId: 1,
  requiredAmendment: 'A'.repeat(64),
  registryAddress: 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh',
  registrationAmountDrops: '1',
  activationLedgerIndex: 100,
  activationLedgerHash: 'b'.repeat(64),
}

const stored = {
  profileId: profile.profileId,
  xcsVersion: profile.xcsVersion,
  networkId: profile.networkId,
  requiredAmendment: profile.requiredAmendment,
  registryAddress: profile.registryAddress,
  registrationAmountDrops: 1,
  activationLedgerIndex: profile.activationLedgerIndex,
  activationLedgerHash: profile.activationLedgerHash,
}

describe('network profile persistence guard', () => {
  it('accepts the exact immutable profile', () => {
    expect(() => assertStoredProfileMatches(stored, profile)).not.toThrow()
  })

  it.each([
    ['networkId', 2],
    ['requiredAmendment', 'C'.repeat(64)],
    ['registryAddress', 'rLs1MzkFWCxTbuAHgjeTZK4fcCDDnf2KRv'],
    ['activationLedgerIndex', 101],
    ['activationLedgerHash', 'd'.repeat(64)],
  ] as const)('fails closed when %s differs', (field, value) => {
    expect(() => assertStoredProfileMatches({ ...stored, [field]: value }, profile)).toThrow(field)
  })
})
