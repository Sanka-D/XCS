import { describe, expect, it } from 'vitest'

import { QuorumLedgerSource } from '../src/quorum-ledger-source.js'
import { sourceErrorCode, XrplSourceError } from '../src/source-errors.js'
import type {
  LedgerSource,
  LedgerSourcePreflight,
  NetworkProfile,
  ValidatedLedger,
} from '../src/types.js'

const LEDGER_HASH = 'a'.repeat(64)

const profile: NetworkProfile = {
  profileId: 'testnet',
  xcsVersion: '0.1',
  networkId: 1,
  requiredAmendment: 'f'.repeat(64),
  registryAddress: 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh',
  registrationAmountDrops: '1',
  activationLedgerIndex: 100,
  activationLedgerHash: LEDGER_HASH,
}

function validatedLedger(): ValidatedLedger {
  return {
    ledgerIndex: 100,
    ledgerHash: LEDGER_HASH,
    parentHash: 'b'.repeat(64),
    accountRoot: 'c'.repeat(64),
    transactionRoot: 'd'.repeat(64),
    parentCloseTime: 999,
    closeTime: 1_000,
    closeTimeResolution: 10,
    closeFlags: 0,
    totalCoins: '99999999999999999',
    transactions: [
      {
        hash: 'e'.repeat(64),
        transactionIndex: 0,
        transaction: { TransactionType: 'Payment', Sequence: 1 },
        metadata: { TransactionIndex: 0, TransactionResult: 'tesSUCCESS' },
      },
    ],
  }
}

class StubSource implements LedgerSource {
  networkId = 1
  tip: number
  ledger = validatedLedger()
  connectError: unknown
  ledgerError: unknown
  amendmentChecks = 0

  constructor(tip: number) {
    this.tip = tip
  }

  async connect(): Promise<void> {
    if (this.connectError !== undefined) throw this.connectError
  }

  async disconnect(): Promise<void> {}

  async preflight(): Promise<LedgerSourcePreflight> {
    return {
      networkId: this.networkId,
      completeLedgerRanges: [{ min: 90, max: this.tip }],
      activationLedger: structuredClone(this.ledger),
      tips: { primary: this.tip, secondary: this.tip, effective: this.tip },
    }
  }

  async assertAmendmentEnabled(): Promise<void> {
    this.amendmentChecks += 1
  }

  async getValidatedLedgerIndex(): Promise<number> {
    return this.tip
  }

  async getValidatedLedgerTips() {
    return { primary: this.tip, secondary: this.tip, effective: this.tip }
  }

  async getLedger(): Promise<ValidatedLedger> {
    if (this.ledgerError !== undefined) throw this.ledgerError
    return structuredClone(this.ledger)
  }
}

describe('QuorumLedgerSource', () => {
  it('runs both preflights, compares activation and exposes the minimum tip', async () => {
    const primary = new StubSource(110)
    const secondary = new StubSource(108)
    const source = new QuorumLedgerSource(primary, secondary)

    await expect(source.preflight(profile)).resolves.toMatchObject({
      networkId: 1,
      activationLedger: { ledgerHash: LEDGER_HASH },
      tips: { primary: 110, secondary: 108, effective: 108 },
      sources: {
        primary: { tip: 110, completeLedgerRanges: [{ min: 90, max: 110 }] },
        secondary: { tip: 108, completeLedgerRanges: [{ min: 90, max: 108 }] },
      },
    })
    await expect(source.assertAmendmentEnabled(profile.requiredAmendment)).resolves.toBeUndefined()
    expect(primary.amendmentChecks).toBe(1)
    expect(secondary.amendmentChecks).toBe(1)
  })

  it('rejects preflight network and activation disagreement', async () => {
    const wrongNetwork = new StubSource(110)
    wrongNetwork.networkId = 2
    await expect(
      new QuorumLedgerSource(new StubSource(110), wrongNetwork).preflight(profile),
    ).rejects.toMatchObject({ code: 'SOURCE_NETWORK_MISMATCH' })

    const wrongActivation = new StubSource(110)
    wrongActivation.ledger.accountRoot = '9'.repeat(64)
    await expect(
      new QuorumLedgerSource(new StubSource(110), wrongActivation).preflight(profile),
    ).rejects.toMatchObject({ code: 'SOURCE_DIVERGENCE' })
  })

  it('returns the minimum current tip and rejects either source regressing', async () => {
    const primary = new StubSource(110)
    const secondary = new StubSource(108)
    const source = new QuorumLedgerSource(primary, secondary)

    await expect(source.getValidatedLedgerTips()).resolves.toEqual({
      primary: 110,
      secondary: 108,
      effective: 108,
    })
    primary.tip = 111
    secondary.tip = 109
    await expect(source.getValidatedLedgerTips()).resolves.toEqual({
      primary: 111,
      secondary: 109,
      effective: 109,
    })
    secondary.tip = 108
    await expect(source.getValidatedLedgerTips()).rejects.toMatchObject({
      code: 'SOURCE_TIP_REGRESSION',
    })
  })

  it.each([
    ['ledger index', (ledger: ValidatedLedger) => (ledger.ledgerIndex = 101)],
    ['ledger hash', (ledger: ValidatedLedger) => (ledger.ledgerHash = '1'.repeat(64))],
    ['parent hash', (ledger: ValidatedLedger) => (ledger.parentHash = '2'.repeat(64))],
    ['account root', (ledger: ValidatedLedger) => (ledger.accountRoot = '3'.repeat(64))],
    ['transaction root', (ledger: ValidatedLedger) => (ledger.transactionRoot = '4'.repeat(64))],
    ['parent close time', (ledger: ValidatedLedger) => (ledger.parentCloseTime += 1)],
    ['close time', (ledger: ValidatedLedger) => (ledger.closeTime += 1)],
    ['close resolution', (ledger: ValidatedLedger) => (ledger.closeTimeResolution += 1)],
    ['close flags', (ledger: ValidatedLedger) => (ledger.closeFlags = 1)],
    ['total coins', (ledger: ValidatedLedger) => (ledger.totalCoins = '1')],
    [
      'transaction',
      (ledger: ValidatedLedger) => (ledger.transactions[0]!.transaction.Sequence = 2),
    ],
    [
      'metadata',
      (ledger: ValidatedLedger) =>
        (ledger.transactions[0]!.metadata.TransactionResult = 'tecFAILED'),
    ],
    ['transaction omission', (ledger: ValidatedLedger) => (ledger.transactions = [])],
  ])('fails closed on normalized %s disagreement', async (_name, mutate) => {
    const primary = new StubSource(110)
    const secondary = new StubSource(110)
    mutate(secondary.ledger)

    await expect(new QuorumLedgerSource(primary, secondary).getLedger(100)).rejects.toMatchObject({
      code: 'SOURCE_DIVERGENCE',
    })
  })

  it('maps transport failure to a stable unavailable error and preserves source errors', async () => {
    const unavailable = new StubSource(110)
    unavailable.ledgerError = new Error('socket closed')
    await expect(
      new QuorumLedgerSource(new StubSource(110), unavailable).getLedger(100),
    ).rejects.toMatchObject({ code: 'SOURCE_UNAVAILABLE' })

    const invalid = new StubSource(110)
    invalid.ledgerError = new XrplSourceError('SOURCE_RESPONSE_INVALID', 'bad response')
    await expect(
      new QuorumLedgerSource(new StubSource(110), invalid).getLedger(100),
    ).rejects.toMatchObject({ code: 'SOURCE_RESPONSE_INVALID' })
  })
})

describe('sourceErrorCode', () => {
  it('allows only declared stable codes', () => {
    expect(sourceErrorCode({ code: 'SOURCE_REGISTRY_NOT_RECEIVABLE' })).toBe(
      'SOURCE_REGISTRY_NOT_RECEIVABLE',
    )
    expect(sourceErrorCode({ code: 'SOURCE_TIP_REGRESSION' })).toBe('SOURCE_TIP_REGRESSION')
    expect(sourceErrorCode({ code: 'LEDGER_PARENT_MISMATCH' })).toBe('LEDGER_PARENT_MISMATCH')
    expect(sourceErrorCode({ code: '23505' })).toBe('INDEXER_FAILED')
    expect(sourceErrorCode({ code: 'arbitrary-provider-message' })).toBe('INDEXER_FAILED')
  })
})
