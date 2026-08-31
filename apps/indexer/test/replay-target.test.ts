import { describe, expect, it } from 'vitest'

import { createReplayTarget, loadReplayTarget } from '../src/replay-target.js'

describe('replay target', () => {
  it('requires an index and hash and normalizes the hash', () => {
    expect(
      loadReplayTarget({
        XCS_REPLAY_TARGET_LEDGER_INDEX: '123',
        XCS_REPLAY_TARGET_LEDGER_HASH: 'A'.repeat(64),
      }),
    ).toEqual({ ledgerIndex: 123, ledgerHash: 'a'.repeat(64) })

    expect(() => loadReplayTarget({ XCS_REPLAY_TARGET_LEDGER_INDEX: '123' })).toThrow(
      'are required',
    )
  })

  it.each([
    [0, 'a'.repeat(64)],
    [-1, 'a'.repeat(64)],
    [1.5, 'a'.repeat(64)],
    [0x1_0000_0000, 'a'.repeat(64)],
    [123, 'not-a-hash'],
  ])('rejects invalid target evidence %#', (index, hash) => {
    expect(() => createReplayTarget(index, hash)).toThrowError(
      expect.objectContaining({ code: 'REPLAY_TARGET_INVALID' }),
    )
  })

  it.each(['0', '01', '-1', '1.5', '4294967296'])('rejects invalid encoded index %s', (index) => {
    expect(() =>
      loadReplayTarget({
        XCS_REPLAY_TARGET_LEDGER_INDEX: index,
        XCS_REPLAY_TARGET_LEDGER_HASH: 'a'.repeat(64),
      }),
    ).toThrowError(expect.objectContaining({ code: 'REPLAY_TARGET_INVALID' }))
  })
})
