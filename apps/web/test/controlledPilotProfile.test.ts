import { describe, expect, it } from 'vitest'

import { hasControlledPilotProfileId } from '../app/utils/controlledPilotProfile'

describe('controlled pilot profile banner boundary', () => {
  it('matches only profile identifiers ending with the controlled pilot suffix', () => {
    expect(hasControlledPilotProfileId('xrpl-testnet-commons-controlled-pilot')).toBe(true)
    expect(hasControlledPilotProfileId('xrpl-testnet-commons-controlled-pilot-preview')).toBe(false)
    expect(hasControlledPilotProfileId('xrpl-testnet-commons')).toBe(false)
    expect(hasControlledPilotProfileId(undefined)).toBe(false)
  })

  it('does not coerce non-string profile selectors into a pilot profile', () => {
    expect(
      hasControlledPilotProfileId({ profileId: 'xrpl-testnet-commons-controlled-pilot' }),
    ).toBe(false)
    expect(hasControlledPilotProfileId(true)).toBe(false)
  })
})
