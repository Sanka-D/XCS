import { describe, expect, it } from 'vitest'

import { projectCredentialLifecycle } from '../src/index.js'

describe('credential lifecycle projection', () => {
  it('projects pending, active and expiry at the validated close-time boundary', () => {
    expect(
      projectCredentialLifecycle({
        objectExists: true,
        accepted: false,
        closeTime: 100,
      }),
    ).toBe('pending')
    expect(
      projectCredentialLifecycle({
        objectExists: true,
        accepted: true,
        expiration: 101,
        closeTime: 100,
      }),
    ).toBe('active')
    expect(
      projectCredentialLifecycle({
        objectExists: true,
        accepted: true,
        expiration: 100,
        closeTime: 100,
      }),
    ).toBe('expired')
  })

  it('lets deletion dominate acceptance and expiration', () => {
    expect(
      projectCredentialLifecycle({
        objectExists: false,
        accepted: true,
        expiration: 0,
        closeTime: 100,
      }),
    ).toBe('deleted')
  })

  it.each([
    { closeTime: -1 },
    { closeTime: 0x1_0000_0000 },
    { closeTime: 1.5 },
    { closeTime: 0, expiration: -1 },
    { closeTime: 0, expiration: 0x1_0000_0000 },
  ])('rejects invalid Ripple times: $closeTime/$expiration', (input) => {
    expect(() =>
      projectCredentialLifecycle({ objectExists: true, accepted: false, ...input }),
    ).toThrowError(expect.objectContaining({ code: 'RIPPLE_TIME_INVALID' }))
  })
})
