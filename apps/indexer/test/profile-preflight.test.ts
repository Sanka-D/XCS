import { describe, expect, it } from 'vitest'

import {
  assertRegistryBlackholed,
  assertSourceCoversProfile,
  normalizeAccountObjectsPage,
  normalizeServerInfo,
  parseCompleteLedgers,
  XRPL_ACCOUNT_ONE,
  XRPL_ACCOUNT_ZERO,
} from '../src/profile-preflight.js'
import type { NetworkProfile } from '../src/types.js'

const ACTIVATION_HASH = 'a'.repeat(64)
const TIP_HASH = 'b'.repeat(64)
const REGISTRY = 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh'
const OTHER_ACCOUNT = 'r9cZA1mLK5R5Am25ArfXFmqgNwjZgnfk59'
const LSF_DISABLE_MASTER = 0x0010_0000
const LSF_DEPOSIT_AUTH = 0x0100_0000
const LSF_REQUIRE_DEST_TAG = 0x0002_0000

const profile: NetworkProfile = {
  profileId: 'testnet',
  xcsVersion: '0.1',
  networkId: 1,
  requiredAmendment: 'c'.repeat(64),
  registryAddress: REGISTRY,
  registrationAmountDrops: '1',
  activationLedgerIndex: 100,
  activationLedgerHash: ACTIVATION_HASH,
}

function serverInfo(overrides: Record<string, unknown> = {}): unknown {
  return {
    info: {
      network_id: 1,
      complete_ledgers: '90-150',
      validated_ledger: { seq: 150, hash: TIP_HASH },
      ...overrides,
    },
  }
}

function accountInfo(
  overrides: {
    result?: Record<string, unknown>
    accountData?: Record<string, unknown>
  } = {},
): unknown {
  return {
    validated: true,
    ledger_hash: ACTIVATION_HASH,
    ledger_index: 100,
    ...overrides.result,
    account_data: {
      Account: REGISTRY,
      LedgerEntryType: 'AccountRoot',
      Flags: LSF_DISABLE_MASTER,
      RegularKey: XRPL_ACCOUNT_ZERO,
      ...overrides.accountData,
    },
  }
}

function accountObjectsPage(overrides: Record<string, unknown> = {}): unknown {
  return {
    account: REGISTRY,
    account_objects: [],
    ledger_hash: ACTIVATION_HASH,
    ledger_index: 100,
    validated: true,
    ...overrides,
  }
}

describe('source network and history preflight', () => {
  it('parses, sorts and merges contiguous complete-ledger ranges', () => {
    expect(parseCompleteLedgers('100-110,90-99,200,108-120')).toEqual([
      { min: 90, max: 120 },
      { min: 200, max: 200 },
    ])
  })

  it.each(['empty', '', '10-9', 'abc', '1-4294967296'])(
    'rejects unavailable or malformed history %j',
    (ranges) => {
      expect(() => parseCompleteLedgers(ranges)).toThrow()
    },
  )

  it('normalizes server identity and accepts contiguous activation-to-tip history', () => {
    const status = normalizeServerInfo(serverInfo())
    expect(status).toEqual({
      networkId: 1,
      validatedLedgerIndex: 150,
      validatedLedgerHash: TIP_HASH,
      completeLedgerRanges: [{ min: 90, max: 150 }],
    })
    expect(() => assertSourceCoversProfile(status, profile)).not.toThrow()
  })

  it('rejects a different network', () => {
    const status = normalizeServerInfo(serverInfo({ network_id: 2 }))
    expect(() => assertSourceCoversProfile(status, profile)).toThrowError(
      expect.objectContaining({ code: 'SOURCE_NETWORK_MISMATCH' }),
    )
  })

  it('rejects a tip before activation or a gap in retained history', () => {
    const beforeActivation = normalizeServerInfo(
      serverInfo({ complete_ledgers: '1-99', validated_ledger: { seq: 99, hash: TIP_HASH } }),
    )
    expect(() => assertSourceCoversProfile(beforeActivation, profile)).toThrowError(
      expect.objectContaining({ code: 'SOURCE_HISTORY_INCOMPLETE' }),
    )

    const gap = normalizeServerInfo(serverInfo({ complete_ledgers: '90-120,122-150' }))
    expect(() => assertSourceCoversProfile(gap, profile)).toThrowError(
      expect.objectContaining({ code: 'SOURCE_HISTORY_INCOMPLETE' }),
    )
  })
})

describe('registry blackhole preflight', () => {
  it('accepts an omitted signer_lists field when account_objects confirms there is no signer list', () => {
    expect(() =>
      assertRegistryBlackholed({ accountInfo: accountInfo(), accountObjects: [], profile }),
    ).not.toThrow()
  })

  it.each([
    ['root response', { result: { signer_lists: null } }],
    ['account_data', { accountData: { signer_lists: {} } }],
  ])('rejects a non-array signer_lists field in the %s', (_name, overrides) => {
    expect(() =>
      assertRegistryBlackholed({
        accountInfo: accountInfo(overrides),
        accountObjects: [],
        profile,
      }),
    ).toThrowError(expect.objectContaining({ code: 'SOURCE_RESPONSE_INVALID' }))
  })

  it.each([XRPL_ACCOUNT_ZERO, XRPL_ACCOUNT_ONE])(
    'accepts disabled master and known blackhole regular key %s',
    (regularKey) => {
      expect(() =>
        assertRegistryBlackholed({
          accountInfo: accountInfo({ accountData: { RegularKey: regularKey } }),
          accountObjects: [],
          profile,
        }),
      ).not.toThrow()
    },
  )

  it.each([
    ['master enabled', { Flags: 0 }],
    ['deposit auth enabled', { Flags: LSF_DISABLE_MASTER | LSF_DEPOSIT_AUTH }],
    ['destination tag required', { Flags: LSF_DISABLE_MASTER | LSF_REQUIRE_DEST_TAG }],
    ['regular key usable', { RegularKey: REGISTRY }],
  ])('rejects a registry with %s', (_name, accountData) => {
    expect(() =>
      assertRegistryBlackholed({
        accountInfo: accountInfo({ accountData }),
        accountObjects: [],
        profile,
      }),
    ).toThrowError(expect.objectContaining({ code: 'SOURCE_REGISTRY_NOT_BLACKHOLED' }))
  })

  it('rejects signer lists and delegated permissions', () => {
    expect(() =>
      assertRegistryBlackholed({
        accountInfo: accountInfo({ result: { signer_lists: [{ SignerQuorum: 1 }] } }),
        accountObjects: [],
        profile,
      }),
    ).toThrowError(expect.objectContaining({ code: 'SOURCE_REGISTRY_NOT_BLACKHOLED' }))

    expect(() =>
      assertRegistryBlackholed({
        accountInfo: accountInfo(),
        accountObjects: [{ LedgerEntryType: 'SignerList' }],
        profile,
      }),
    ).toThrowError(expect.objectContaining({ code: 'SOURCE_REGISTRY_NOT_BLACKHOLED' }))

    expect(() =>
      assertRegistryBlackholed({
        accountInfo: accountInfo(),
        accountObjects: [
          { LedgerEntryType: 'Delegate', Account: REGISTRY, Authorize: OTHER_ACCOUNT },
        ],
        profile,
      }),
    ).toThrowError(expect.objectContaining({ code: 'SOURCE_REGISTRY_NOT_BLACKHOLED' }))
  })

  it('allows an incoming delegation that does not authorize transactions from the registry', () => {
    expect(() =>
      assertRegistryBlackholed({
        accountInfo: accountInfo(),
        accountObjects: [
          { LedgerEntryType: 'Delegate', Account: OTHER_ACCOUNT, Authorize: REGISTRY },
        ],
        profile,
      }),
    ).not.toThrow()
  })

  it.each([
    ['missing delegating account', { Authorize: REGISTRY }],
    ['invalid delegating account', { Account: 'not-an-address', Authorize: REGISTRY }],
    ['missing authorized account', { Account: REGISTRY }],
    ['invalid authorized account', { Account: REGISTRY, Authorize: 'not-an-address' }],
  ])('rejects a Delegate with %s', (_name, fields) => {
    expect(() =>
      assertRegistryBlackholed({
        accountInfo: accountInfo(),
        accountObjects: [{ LedgerEntryType: 'Delegate', ...fields }],
        profile,
      }),
    ).toThrowError(expect.objectContaining({ code: 'SOURCE_RESPONSE_INVALID' }))
  })

  it('binds account_info to the activation ledger and registry account', () => {
    for (const invalid of [
      accountInfo({ result: { validated: false } }),
      accountInfo({ result: { ledger_hash: 'f'.repeat(64) } }),
      accountInfo({ result: { ledger_index: 101 } }),
      accountInfo({ accountData: { Account: XRPL_ACCOUNT_ONE } }),
      accountInfo({ accountData: { LedgerEntryType: 'Credential' } }),
    ]) {
      expect(() =>
        assertRegistryBlackholed({ accountInfo: invalid, accountObjects: [], profile }),
      ).toThrow()
    }
  })
})

describe('account_objects response normalization', () => {
  it('binds a validated page to the registry and activation ledger', () => {
    expect(
      normalizeAccountObjectsPage(
        accountObjectsPage({
          account_objects: [{ LedgerEntryType: 'Offer', index: 'd'.repeat(64) }],
          marker: 'next-page',
        }),
        profile,
      ),
    ).toEqual({
      objects: [{ LedgerEntryType: 'Offer', index: 'd'.repeat(64) }],
      marker: 'next-page',
    })
  })

  it.each([
    ['wrong account', { account: XRPL_ACCOUNT_ONE }],
    ['unvalidated', { validated: false }],
    ['wrong hash', { ledger_hash: 'f'.repeat(64) }],
    ['wrong index', { ledger_index: 101 }],
    ['missing object type', { account_objects: [{}] }],
    ['non-object entry', { account_objects: ['Delegate'] }],
  ])('rejects %s', (_name, overrides) => {
    expect(() => normalizeAccountObjectsPage(accountObjectsPage(overrides), profile)).toThrow()
  })
})
