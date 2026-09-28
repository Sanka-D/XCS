import { describe, expect, it } from 'vitest'

import {
  assertConnectedNetwork,
  assertProfileFileAbsent,
  assertProfileIdAllowed,
  assertReadyToDisableMasterKey,
  assertReadyToSetRegularKey,
  assertSeedSinkOutsideWorkingTree,
  buildCeremonyProfile,
  CeremonyError,
  describeDisableMasterKeyPlan,
  EXAMPLE_PROFILE_ID,
  parseCeremonyCommand,
  requireCeremonySeed,
  resolveCeremonyNetworkId,
  serializeProfileFile,
  summarizeAccountState,
} from '../src/ceremony.js'
import { XRPL_ACCOUNT_ONE, XRPL_ACCOUNT_ZERO } from '../src/profile-preflight.js'

const REGISTRY = 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh'
const OTHER = 'r9cZA1mLK5R5Am25ArfXFmqgNwjZgnfk59'
const AMENDMENT = '1CB67D082CF7D9102412D34258CEDB400E659352D3B207348889297A6D90F5EF'
const LEDGER_HASH = 'A'.repeat(64)

const LSF_DISABLE_MASTER = 0x0010_0000
const LSF_DEPOSIT_AUTH = 0x0100_0000
const LSF_REQUIRE_DEST_TAG = 0x0002_0000

function code(run: () => unknown): string {
  try {
    run()
  } catch (error) {
    if (error instanceof CeremonyError) return error.code
    return `unexpected:${String(error)}`
  }
  return 'no-error'
}

function state(overrides: Partial<Parameters<typeof summarizeAccountState>[0]> = {}) {
  return summarizeAccountState({
    address: REGISTRY,
    flags: 0,
    signerListCount: 0,
    outgoingDelegateCount: 0,
    ...overrides,
  })
}

describe('parseCeremonyCommand', () => {
  it('accepts each documented stage', () => {
    expect(parseCeremonyCommand('create-account')).toBe('create-account')
    expect(parseCeremonyCommand('disable-master-key')).toBe('disable-master-key')
    expect(parseCeremonyCommand('emit-profile')).toBe('emit-profile')
  })

  it('rejects an unknown or missing stage', () => {
    expect(code(() => parseCeremonyCommand(undefined))).toBe('CEREMONY_USAGE')
    expect(code(() => parseCeremonyCommand('disable-master'))).toBe('CEREMONY_USAGE')
  })
})

describe('resolveCeremonyNetworkId', () => {
  it('defaults to Testnet', () => {
    expect(resolveCeremonyNetworkId({})).toBe(1)
    expect(resolveCeremonyNetworkId({ XCS_CEREMONY_NETWORK_ID: ' ' })).toBe(1)
    expect(resolveCeremonyNetworkId({ XCS_CEREMONY_NETWORK_ID: '1' })).toBe(1)
  })

  it('refuses Mainnet outright', () => {
    expect(code(() => resolveCeremonyNetworkId({ XCS_CEREMONY_NETWORK_ID: '0' }))).toBe(
      'CEREMONY_MAINNET_FORBIDDEN',
    )
  })

  it('refuses any other network', () => {
    expect(code(() => resolveCeremonyNetworkId({ XCS_CEREMONY_NETWORK_ID: '2' }))).toBe(
      'CEREMONY_NETWORK_NOT_TESTNET',
    )
    expect(code(() => resolveCeremonyNetworkId({ XCS_CEREMONY_NETWORK_ID: 'mainnet' }))).toBe(
      'CEREMONY_NETWORK_NOT_TESTNET',
    )
  })
})

describe('assertConnectedNetwork', () => {
  it('passes when the connected server matches', () => {
    expect(assertConnectedNetwork(1, 1)).toBeUndefined()
  })

  it('refuses a Mainnet server by its own code', () => {
    expect(code(() => assertConnectedNetwork(1, 0))).toBe('CEREMONY_MAINNET_FORBIDDEN')
  })

  it('refuses a mismatched network', () => {
    expect(code(() => assertConnectedNetwork(1, 21_338))).toBe('CEREMONY_NETWORK_MISMATCH')
  })
})

describe('assertProfileIdAllowed', () => {
  it('accepts a fresh identifier', () => {
    expect(assertProfileIdAllowed('xrpl-testnet-xcs-v0.1-beta1')).toBe(
      'xrpl-testnet-xcs-v0.1-beta1',
    )
  })

  it('rejects the documentation template identifier', () => {
    expect(code(() => assertProfileIdAllowed(EXAMPLE_PROFILE_ID))).toBe(
      'CEREMONY_PROFILE_ID_RESERVED',
    )
  })

  it('rejects the ADR 0003 controlled pilot identifier and its suffix', () => {
    expect(code(() => assertProfileIdAllowed('commons-testnet-xcs-v0.1-controlled-pilot'))).toBe(
      'CEREMONY_PROFILE_ID_RESERVED',
    )
    expect(code(() => assertProfileIdAllowed('anything-controlled-pilot'))).toBe(
      'CEREMONY_PROFILE_ID_RESERVED',
    )
  })
})

describe('buildCeremonyProfile and serializeProfileFile', () => {
  const profile = buildCeremonyProfile({
    profileId: 'xrpl-testnet-xcs-v0.1-beta1',
    networkId: 1,
    requiredAmendment: AMENDMENT,
    registryAddress: REGISTRY,
    activationLedgerIndex: 12_345,
    activationLedgerHash: LEDGER_HASH,
  })

  it('pins the registration amount and normalizes the hash through the indexer parser', () => {
    expect(profile.registrationAmountDrops).toBe('1')
    expect(profile.xcsVersion).toBe('0.1')
    expect(profile.activationLedgerHash).toBe('a'.repeat(64))
  })

  it('refuses a reserved identifier through the builder too', () => {
    expect(
      code(() =>
        buildCeremonyProfile({
          profileId: EXAMPLE_PROFILE_ID,
          networkId: 1,
          requiredAmendment: AMENDMENT,
          registryAddress: REGISTRY,
          activationLedgerIndex: 1,
          activationLedgerHash: LEDGER_HASH,
        }),
      ),
    ).toBe('CEREMONY_PROFILE_ID_RESERVED')
  })

  it('serializes stable published bytes with a trailing newline', () => {
    const text = serializeProfileFile(profile)
    expect(text.endsWith('\n')).toBe(true)
    expect(Object.keys(JSON.parse(text) as Record<string, unknown>)).toEqual([
      'profileId',
      'xcsVersion',
      'networkId',
      'requiredAmendment',
      'registryAddress',
      'registrationAmountDrops',
      'activationLedgerIndex',
      'activationLedgerHash',
    ])
  })
})

describe('assertProfileFileAbsent', () => {
  it('passes when the file does not exist', () => {
    expect(assertProfileFileAbsent('/tmp/testnet.json', false)).toBeUndefined()
  })

  it('refuses to overwrite a published profile', () => {
    expect(code(() => assertProfileFileAbsent('/tmp/testnet.json', true))).toBe(
      'CEREMONY_PROFILE_FILE_EXISTS',
    )
  })
})

describe('seed handling', () => {
  it('refuses any seed sink inside the working tree', () => {
    expect(code(() => assertSeedSinkOutsideWorkingTree('seed.txt', '/repo'))).toBe(
      'CEREMONY_SEED_IN_WORKING_TREE',
    )
    expect(code(() => assertSeedSinkOutsideWorkingTree('config/networks/../seed', '/repo'))).toBe(
      'CEREMONY_SEED_IN_WORKING_TREE',
    )
    expect(code(() => assertSeedSinkOutsideWorkingTree('/repo', '/repo'))).toBe(
      'CEREMONY_SEED_IN_WORKING_TREE',
    )
  })

  it('allows a path outside the working tree', () => {
    expect(assertSeedSinkOutsideWorkingTree('/var/secrets/seed', '/repo')).toBe('/var/secrets/seed')
    expect(assertSeedSinkOutsideWorkingTree('/repository-sibling/seed', '/repo')).toBe(
      '/repository-sibling/seed',
    )
  })

  it('reads the seed from the environment only', () => {
    expect(requireCeremonySeed({ XCS_CEREMONY_SEED: ' sEdDeAdBeEf ' })).toBe('sEdDeAdBeEf')
    expect(code(() => requireCeremonySeed({}))).toBe('CEREMONY_SEED_MISSING')
    expect(code(() => requireCeremonySeed({ XCS_CEREMONY_SEED: '' }))).toBe('CEREMONY_SEED_MISSING')
  })

  it('never puts the seed in the failure message', () => {
    try {
      requireCeremonySeed({})
    } catch (error) {
      expect((error as Error).message).not.toContain('sEd')
    }
  })
})

describe('summarizeAccountState', () => {
  it('decodes the flags the blackhole policy cares about', () => {
    const summary = state({
      flags: LSF_DISABLE_MASTER | LSF_DEPOSIT_AUTH | LSF_REQUIRE_DEST_TAG,
      regularKey: XRPL_ACCOUNT_ZERO,
    })
    expect(summary.masterKeyDisabled).toBe(true)
    expect(summary.depositAuthEnabled).toBe(true)
    expect(summary.destinationTagRequired).toBe(true)
    expect(summary.regularKeyIsAccountZero).toBe(true)
  })

  it('treats a missing regular key as not blackholed', () => {
    expect(state().regularKeyIsAccountZero).toBe(false)
    expect(state().regularKey).toBeUndefined()
  })

  it('does not accept ACCOUNT_ONE for this script', () => {
    expect(state({ regularKey: XRPL_ACCOUNT_ONE }).regularKeyIsAccountZero).toBe(false)
  })
})

describe('assertReadyToSetRegularKey', () => {
  it('passes on a fresh account', () => {
    expect(assertReadyToSetRegularKey(state())).toBeUndefined()
  })

  it('refuses once the master key is gone', () => {
    expect(code(() => assertReadyToSetRegularKey(state({ flags: LSF_DISABLE_MASTER })))).toBe(
      'CEREMONY_MASTER_KEY_ALREADY_DISABLED',
    )
  })
})

describe('assertReadyToDisableMasterKey', () => {
  it('passes only when the regular key is already ACCOUNT_ZERO', () => {
    expect(assertReadyToDisableMasterKey(state({ regularKey: XRPL_ACCOUNT_ZERO }))).toBeUndefined()
  })

  it('refuses when no regular key is set', () => {
    expect(code(() => assertReadyToDisableMasterKey(state()))).toBe('CEREMONY_REGULAR_KEY_NOT_SET')
  })

  it('refuses when the regular key is some other account', () => {
    expect(code(() => assertReadyToDisableMasterKey(state({ regularKey: OTHER })))).toBe(
      'CEREMONY_REGULAR_KEY_NOT_SET',
    )
  })

  it('refuses when the account could not receive the one-drop payment', () => {
    expect(
      code(() =>
        assertReadyToDisableMasterKey(
          state({ regularKey: XRPL_ACCOUNT_ZERO, flags: LSF_REQUIRE_DEST_TAG }),
        ),
      ),
    ).toBe('CEREMONY_ACCOUNT_NOT_RECEIVABLE')
    expect(
      code(() =>
        assertReadyToDisableMasterKey(
          state({ regularKey: XRPL_ACCOUNT_ZERO, flags: LSF_DEPOSIT_AUTH }),
        ),
      ),
    ).toBe('CEREMONY_ACCOUNT_NOT_RECEIVABLE')
  })

  it('refuses a second run', () => {
    expect(
      code(() =>
        assertReadyToDisableMasterKey(
          state({ regularKey: XRPL_ACCOUNT_ZERO, flags: LSF_DISABLE_MASTER }),
        ),
      ),
    ).toBe('CEREMONY_MASTER_KEY_ALREADY_DISABLED')
  })
})

describe('describeDisableMasterKeyPlan', () => {
  it('names the account, the network and the verified regular key', () => {
    const plan = describeDisableMasterKeyPlan({
      address: REGISTRY,
      networkId: 1,
      rpcUrl: 'wss://s.altnet.rippletest.net:51233',
      regularKey: XRPL_ACCOUNT_ZERO,
    })
    expect(plan).toContain(REGISTRY)
    expect(plan).toContain('network id:  1')
    expect(plan).toContain('wss://s.altnet.rippletest.net:51233')
    expect(plan).toContain(XRPL_ACCOUNT_ZERO)
    expect(plan).toContain('irreversible')
  })
})
