import { describe, expect, it } from 'vitest'

import { parseSigningReadiness } from '../app/utils/signingReadiness'

const PROFILE_ID = 'xrpl-testnet-xcs-v0.1'
const READY = {
  profileId: PROFILE_ID,
  status: 'ready',
  checkpoint: {
    ledgerIndex: 123,
    ledgerHash: 'ab'.repeat(32),
    closeTime: 838_857_600,
    transactionRoot: 'cd'.repeat(32),
  },
} as const

describe('signing readiness boundary', () => {
  it('accepts a closed readiness proof for the expected profile', () => {
    expect(parseSigningReadiness(READY, PROFILE_ID)).toEqual(READY)
  })

  it('fails closed when the API binds readiness to another profile', () => {
    expect(() =>
      parseSigningReadiness({ ...READY, profileId: 'another-profile' }, PROFILE_ID),
    ).toThrowError('NETWORK_PROFILE_CHANGED_BEFORE_SIGNATURE')
  })

  it.each([
    null,
    { ...READY, status: 'catching_up' },
    { ...READY, checkpoint: { ...READY.checkpoint, ledgerIndex: -1 } },
    { ...READY, checkpoint: { ...READY.checkpoint, ledgerHash: 'AB'.repeat(32) } },
    { ...READY, checkpoint: { ...READY.checkpoint, closeTime: Number.NaN } },
    { ...READY, checkpoint: { ...READY.checkpoint, closeTime: 4_294_967_296 } },
    { ...READY, checkpoint: { ...READY.checkpoint, transactionRoot: null } },
  ])('rejects malformed or non-ready evidence %#', (input) => {
    expect(() => parseSigningReadiness(input, PROFILE_ID)).toThrowError(
      'INDEXER_SIGNING_READINESS_INVALID',
    )
  })
})
