import { describe, expect, it } from 'vitest'

import {
  assertFeatureResponseSupportsAmendment,
  normalizeLedgerResponse,
} from '../src/xrpl-source.js'

describe('normalizeLedgerResponse', () => {
  it('normalizes and orders expanded transactions from a validated ledger', () => {
    const normalized = normalizeLedgerResponse({
      validated: true,
      ledger: {
        ledger_index: 10,
        ledger_hash: 'A'.repeat(64),
        parent_hash: 'B'.repeat(64),
        close_time: 500,
        transactions: [
          {
            hash: 'D'.repeat(64),
            tx_json: { TransactionType: 'CredentialAccept' },
            meta: { TransactionIndex: 1, AffectedNodes: [] },
          },
          {
            hash: 'C'.repeat(64),
            tx_json: { TransactionType: 'Payment' },
            meta: { TransactionIndex: 0, AffectedNodes: [] },
          },
        ],
      },
    })

    expect(normalized.ledgerHash).toBe('a'.repeat(64))
    expect(normalized.transactions.map((entry) => entry.transactionIndex)).toEqual([0, 1])
  })

  it('rejects a ledger that is not marked validated', () => {
    expect(() =>
      normalizeLedgerResponse({
        validated: false,
        ledger: {},
      }),
    ).toThrow('non-validated')
  })
})

describe('assertFeatureResponseSupportsAmendment', () => {
  const amendmentId = 'A'.repeat(64)

  it('accepts the map shape returned by the XRPL feature method', () => {
    expect(() =>
      assertFeatureResponseSupportsAmendment(
        {
          [amendmentId.toLowerCase()]: {
            enabled: true,
            name: 'Credentials',
            supported: true,
            vetoed: false,
          },
        },
        amendmentId,
      ),
    ).not.toThrow()
  })

  it.each([
    ['absent', {}],
    ['disabled', { [amendmentId]: { enabled: false, supported: true } }],
    ['unsupported', { [amendmentId]: { enabled: true, supported: false } }],
  ])('fails closed when the amendment is %s', (_name, response) => {
    expect(() => assertFeatureResponseSupportsAmendment(response, amendmentId)).toThrow(amendmentId)
  })
})
