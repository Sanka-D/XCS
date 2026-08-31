import { describe, expect, it } from 'vitest'

import type { IndexerPreflightConfig } from '../src/config.js'
import { createPreflightAudit } from '../src/preflight-audit.js'
import type { QuorumLedgerSourcePreflight } from '../src/quorum-ledger-source.js'

const HASH = 'a'.repeat(64)

const config: IndexerPreflightConfig = {
  profile: {
    profileId: 'commons-testnet-xcs-v0.1-controlled-pilot',
    xcsVersion: '0.1',
    networkId: 1,
    requiredAmendment: 'B'.repeat(64),
    registryAddress: 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh',
    registrationAmountDrops: '1',
    activationLedgerIndex: 100,
    activationLedgerHash: HASH,
  },
  profileSha256: 'c'.repeat(64),
  registryPolicy: 'controlled-testnet-pilot',
  databaseScope: 'exclusive-profile',
  xrplRpcUrlPrimary: 'wss://primary.example.test/private-token',
  xrplRpcUrlSecondary: 'wss://secondary.example.test/private-token',
}

const result: QuorumLedgerSourcePreflight = {
  networkId: 1,
  completeLedgerRanges: [{ min: 90, max: 110 }],
  activationLedger: {
    ledgerIndex: 100,
    ledgerHash: HASH,
    parentHash: 'd'.repeat(64),
    accountRoot: 'e'.repeat(64),
    transactionRoot: 'f'.repeat(64),
    parentCloseTime: 999,
    closeTime: 1_000,
    closeTimeResolution: 10,
    closeFlags: 0,
    totalCoins: '100000000000000000',
    transactions: [],
  },
  tips: { primary: 110, secondary: 108, effective: 108 },
  sources: {
    primary: { tip: 110, completeLedgerRanges: [{ min: 90, max: 110 }] },
    secondary: { tip: 108, completeLedgerRanges: [{ min: 95, max: 108 }] },
  },
}

describe('preflight audit output', () => {
  it('includes profile, policy and per-source history evidence without endpoint secrets', () => {
    const audit = createPreflightAudit(config, result)

    expect(audit).toMatchObject({
      ok: true,
      profileId: 'commons-testnet-xcs-v0.1-controlled-pilot',
      profileSha256: 'c'.repeat(64),
      registryPolicy: 'controlled-testnet-pilot',
      databaseScope: 'exclusive-profile',
      networkId: 1,
      sourceTips: { primary: 110, secondary: 108, effective: 108 },
      sources: {
        primary: { tip: 110, completeLedgerRanges: [{ min: 90, max: 110 }] },
        secondary: { tip: 108, completeLedgerRanges: [{ min: 95, max: 108 }] },
      },
    })
    expect(JSON.stringify(audit)).not.toContain('example.test')
    expect(JSON.stringify(audit)).not.toContain('private-token')
  })
})
