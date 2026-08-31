import { describe, expect, it } from 'vitest'

import { digestProjectionSnapshot, type ProjectionSnapshot } from '../src/projection-digest.js'

const snapshot: ProjectionSnapshot = {
  version: 'xcs-projection-v1',
  profile: {
    profileId: 'testnet-v1',
    xcsVersion: '0.1',
    networkId: 1,
    requiredAmendment: 'A'.repeat(64),
    registryAddress: 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh',
    registrationAmountDrops: 1,
    activationLedgerIndex: 100,
    activationLedgerHash: 'a'.repeat(64),
  },
  ledgerCheckpoints: [
    {
      ledgerIndex: 100,
      ledgerHash: 'a'.repeat(64),
      parentHash: 'b'.repeat(64),
      closeTime: 1_000,
      transactionCount: 0,
      transactionRoot: 'c'.repeat(64),
    },
  ],
  schemaEvents: [],
  schemas: [],
  credentialEvents: [],
  credentialGenerations: [],
}

describe('projection digest', () => {
  it('is deterministic across object key insertion order', () => {
    const reordered: ProjectionSnapshot = {
      credentialGenerations: [],
      credentialEvents: [],
      schemas: [],
      schemaEvents: [],
      ledgerCheckpoints: snapshot.ledgerCheckpoints,
      profile: Object.fromEntries(Object.entries(snapshot.profile).reverse()),
      version: 'xcs-projection-v1',
    }

    expect(digestProjectionSnapshot(reordered)).toBe(digestProjectionSnapshot(snapshot))
  })

  it('changes when ledger-derived data changes', () => {
    const changed: ProjectionSnapshot = {
      ...snapshot,
      ledgerCheckpoints: [
        {
          ...snapshot.ledgerCheckpoints[0],
          transactionRoot: 'd'.repeat(64),
        },
      ],
    }

    expect(digestProjectionSnapshot(changed)).not.toBe(digestProjectionSnapshot(snapshot))
  })
})
