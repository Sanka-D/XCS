import { isDeepStrictEqual } from 'node:util'

import { sourceFailure, XrplSourceError } from './source-errors.js'
import type {
  LedgerSource,
  LedgerSourcePreflight,
  LedgerSourceTips,
  NetworkProfile,
  ValidatedLedger,
} from './types.js'

async function both<T>(primary: Promise<T>, secondary: Promise<T>, operation: string) {
  const [primaryResult, secondaryResult] = await Promise.allSettled([primary, secondary])
  if (primaryResult.status === 'rejected') {
    const reason = primaryResult.reason
    if (reason instanceof XrplSourceError) throw reason
    throw new XrplSourceError(
      'SOURCE_UNAVAILABLE',
      `XRPL source quorum could not complete ${operation}`,
      { operation },
      { cause: reason },
    )
  }
  if (secondaryResult.status === 'rejected') {
    const reason = secondaryResult.reason
    if (reason instanceof XrplSourceError) throw reason
    throw new XrplSourceError(
      'SOURCE_UNAVAILABLE',
      `XRPL source quorum could not complete ${operation}`,
      { operation },
      { cause: reason },
    )
  }
  return [primaryResult.value, secondaryResult.value] as const
}

export function assertTipsDoNotRegress(
  previous: LedgerSourceTips | undefined,
  current: LedgerSourceTips,
): void {
  if (
    previous !== undefined &&
    (current.primary < previous.primary || current.secondary < previous.secondary)
  ) {
    return sourceFailure('SOURCE_TIP_REGRESSION', 'An XRPL quorum source tip regressed', {
      previousPrimary: previous.primary,
      previousSecondary: previous.secondary,
      currentPrimary: current.primary,
      currentSecondary: current.secondary,
    })
  }
}

export class QuorumLedgerSource implements LedgerSource {
  private lastTips: LedgerSourceTips | undefined

  constructor(
    private readonly primary: LedgerSource,
    private readonly secondary: LedgerSource,
  ) {}

  async connect(): Promise<void> {
    const results = await Promise.allSettled([this.primary.connect(), this.secondary.connect()])
    if (results.some((result) => result.status === 'rejected')) {
      await Promise.allSettled([this.primary.disconnect(), this.secondary.disconnect()])
      const failure = results.find(
        (result): result is PromiseRejectedResult => result.status === 'rejected',
      )
      throw new XrplSourceError(
        'SOURCE_UNAVAILABLE',
        'Both XRPL quorum sources must connect',
        {},
        { cause: failure?.reason },
      )
    }
  }

  async disconnect(): Promise<void> {
    const results = await Promise.allSettled([
      this.primary.disconnect(),
      this.secondary.disconnect(),
    ])
    if (results.some((result) => result.status === 'rejected')) {
      return sourceFailure('SOURCE_UNAVAILABLE', 'Could not disconnect both XRPL quorum sources')
    }
  }

  async preflight(profile: NetworkProfile): Promise<LedgerSourcePreflight> {
    const [primary, secondary] = await both(
      this.primary.preflight(profile),
      this.secondary.preflight(profile),
      'profile preflight',
    )
    if (
      primary.networkId !== profile.networkId ||
      secondary.networkId !== profile.networkId ||
      primary.networkId !== secondary.networkId
    ) {
      return sourceFailure('SOURCE_NETWORK_MISMATCH', 'XRPL quorum preflight networks disagree', {
        expectedNetworkId: profile.networkId,
        primaryNetworkId: primary.networkId,
        secondaryNetworkId: secondary.networkId,
      })
    }
    this.assertSameLedger(primary.activationLedger, secondary.activationLedger)
    const tips = {
      primary: primary.tips.effective,
      secondary: secondary.tips.effective,
      effective: Math.min(primary.tips.effective, secondary.tips.effective),
    }
    assertTipsDoNotRegress(this.lastTips, tips)
    this.lastTips = tips
    return {
      networkId: primary.networkId,
      completeLedgerRanges: primary.completeLedgerRanges,
      activationLedger: primary.activationLedger,
      tips,
    }
  }

  async assertAmendmentEnabled(amendmentId: string): Promise<void> {
    await both(
      this.primary.assertAmendmentEnabled(amendmentId),
      this.secondary.assertAmendmentEnabled(amendmentId),
      'amendment check',
    )
  }

  async getValidatedLedgerIndex(): Promise<number> {
    return (await this.getValidatedLedgerTips()).effective
  }

  async getValidatedLedgerTips(): Promise<LedgerSourceTips> {
    const [primary, secondary] = await both(
      this.primary.getValidatedLedgerIndex(),
      this.secondary.getValidatedLedgerIndex(),
      'validated ledger tip lookup',
    )
    const tips = { primary, secondary, effective: Math.min(primary, secondary) }
    assertTipsDoNotRegress(this.lastTips, tips)
    this.lastTips = tips
    return tips
  }

  async getLedger(ledgerIndex: number): Promise<ValidatedLedger> {
    const [primary, secondary] = await both(
      this.primary.getLedger(ledgerIndex),
      this.secondary.getLedger(ledgerIndex),
      `ledger ${ledgerIndex} lookup`,
    )
    this.assertSameLedger(primary, secondary)
    return primary
  }

  private assertSameLedger(primary: ValidatedLedger, secondary: ValidatedLedger): void {
    if (!isDeepStrictEqual(primary, secondary)) {
      return sourceFailure(
        'SOURCE_DIVERGENCE',
        `XRPL quorum sources disagree on ledger ${primary.ledgerIndex}`,
        {
          primaryLedgerIndex: primary.ledgerIndex,
          primaryLedgerHash: primary.ledgerHash,
          secondaryLedgerIndex: secondary.ledgerIndex,
          secondaryLedgerHash: secondary.ledgerHash,
        },
      )
    }
  }
}
