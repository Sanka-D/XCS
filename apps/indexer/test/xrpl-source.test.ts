import { describe, expect, it } from 'vitest'

import {
  assertFeatureResponseSupportsAmendment,
  normalizeLedgerResponse,
} from '../src/xrpl-source.js'

const LEDGER_HASH = 'a'.repeat(64)
const PARENT_HASH = 'b'.repeat(64)
const ACCOUNT_ROOT = 'c'.repeat(64)
const TRANSACTION_ROOT = 'd'.repeat(64)
const FIRST_TX_HASH = 'e'.repeat(64)
const SECOND_TX_HASH = 'f'.repeat(64)

function response(): Record<string, unknown> {
  return {
    validated: true,
    ledger_hash: LEDGER_HASH.toUpperCase(),
    ledger_index: 10,
    ledger: {
      account_hash: ACCOUNT_ROOT.toUpperCase(),
      close_flags: 0,
      close_time: 500,
      close_time_resolution: 10,
      closed: true,
      ledger_hash: LEDGER_HASH.toUpperCase(),
      ledger_index: 10,
      parent_close_time: 490,
      parent_hash: PARENT_HASH.toUpperCase(),
      total_coins: '99999999999999999',
      transaction_hash: TRANSACTION_ROOT.toUpperCase(),
      transactions: [
        {
          hash: SECOND_TX_HASH.toUpperCase(),
          tx_json: { TransactionType: 'CredentialAccept' },
          meta: { TransactionIndex: 1, TransactionResult: 'tesSUCCESS', AffectedNodes: [] },
        },
        {
          hash: FIRST_TX_HASH.toUpperCase(),
          tx_json: { TransactionType: 'Payment' },
          meta: { TransactionIndex: 0, TransactionResult: 'tesSUCCESS', AffectedNodes: [] },
        },
      ],
    },
  }
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('fixture is not a record')
  }
  return value as Record<string, unknown>
}

function ledger(value: Record<string, unknown>): Record<string, unknown> {
  return record(value.ledger)
}

function transactions(value: Record<string, unknown>): Record<string, unknown>[] {
  const candidate = ledger(value).transactions
  if (!Array.isArray(candidate)) throw new Error('fixture transactions are missing')
  return candidate.map(record)
}

describe('normalizeLedgerResponse', () => {
  it('normalizes the complete canonical header and orders expanded transactions', () => {
    const normalized = normalizeLedgerResponse(response())

    expect(normalized).toMatchObject({
      ledgerIndex: 10,
      ledgerHash: LEDGER_HASH,
      parentHash: PARENT_HASH,
      accountRoot: ACCOUNT_ROOT,
      transactionRoot: TRANSACTION_ROOT,
      parentCloseTime: 490,
      closeTime: 500,
      closeTimeResolution: 10,
      closeFlags: 0,
      totalCoins: '99999999999999999',
    })
    expect(normalized.transactions.map((entry) => entry.transactionIndex)).toEqual([0, 1])
    expect(normalized.transactions.map((entry) => entry.hash)).toEqual([
      FIRST_TX_HASH,
      SECOND_TX_HASH,
    ])
  })

  it('accepts the flattened expanded-transaction response shape', () => {
    const value = response()
    ledger(value).transactions = [
      {
        hash: FIRST_TX_HASH,
        TransactionType: 'Payment',
        metaData: { TransactionIndex: 0, TransactionResult: 'tesSUCCESS', AffectedNodes: [] },
      },
    ]

    expect(normalizeLedgerResponse(value).transactions[0]).toMatchObject({
      hash: FIRST_TX_HASH,
      transaction: { TransactionType: 'Payment' },
      transactionIndex: 0,
    })
  })

  it('rejects a ledger that is not marked validated or closed', () => {
    const unvalidated = response()
    unvalidated.validated = false
    expect(() => normalizeLedgerResponse(unvalidated)).toThrow('non-validated')

    const open = response()
    ledger(open).closed = false
    expect(() => normalizeLedgerResponse(open)).toThrow('marked closed')
  })

  it.each([
    'ledger_index',
    'ledger_hash',
    'parent_hash',
    'account_hash',
    'transaction_hash',
    'parent_close_time',
    'close_time',
    'close_time_resolution',
    'close_flags',
    'total_coins',
    'transactions',
  ])('rejects an omitted canonical ledger field: %s', (field) => {
    const value = response()
    delete ledger(value)[field]
    expect(() => normalizeLedgerResponse(value)).toThrow()
  })

  it.each(['ledger_index', 'ledger_hash'])('rejects an omitted response field: %s', (field) => {
    const value = response()
    delete value[field]
    expect(() => normalizeLedgerResponse(value)).toThrow()
  })

  it('rejects disagreement between outer and inner ledger identity', () => {
    const wrongIndex = response()
    wrongIndex.ledger_index = 11
    expect(() => normalizeLedgerResponse(wrongIndex)).toThrow('index values disagree')

    const wrongHash = response()
    wrongHash.ledger_hash = '9'.repeat(64)
    expect(() => normalizeLedgerResponse(wrongHash)).toThrow('hash values disagree')
  })

  it('rejects missing transaction hashes and metadata', () => {
    const missingHash = response()
    delete transactions(missingHash)[0]!.hash
    expect(() => normalizeLedgerResponse(missingHash)).toThrow('transaction hash')

    const missingMetadata = response()
    delete transactions(missingMetadata)[0]!.meta
    expect(() => normalizeLedgerResponse(missingMetadata)).toThrow('transaction metadata')

    const missingIndex = response()
    delete record(transactions(missingIndex)[0]!.meta).TransactionIndex
    expect(() => normalizeLedgerResponse(missingIndex)).toThrow('TransactionIndex')
  })

  it('rejects missing or empty canonical transaction and metadata fields', () => {
    const missingType = response()
    delete record(transactions(missingType)[0]!.tx_json).TransactionType
    expect(() => normalizeLedgerResponse(missingType)).toThrow('TransactionType')

    const emptyType = response()
    record(transactions(emptyType)[0]!.tx_json).TransactionType = ''
    expect(() => normalizeLedgerResponse(emptyType)).toThrow('TransactionType')

    const missingNodes = response()
    delete record(transactions(missingNodes)[0]!.meta).AffectedNodes
    expect(() => normalizeLedgerResponse(missingNodes)).toThrow('AffectedNodes')

    const malformedNodes = response()
    record(transactions(malformedNodes)[0]!.meta).AffectedNodes = {}
    expect(() => normalizeLedgerResponse(malformedNodes)).toThrow('AffectedNodes')

    const missingResult = response()
    delete record(transactions(missingResult)[0]!.meta).TransactionResult
    expect(() => normalizeLedgerResponse(missingResult)).toThrow('TransactionResult')

    const emptyResult = response()
    record(transactions(emptyResult)[0]!.meta).TransactionResult = '   '
    expect(() => normalizeLedgerResponse(emptyResult)).toThrow('TransactionResult')
  })

  it('rejects conflicting transaction hash representations', () => {
    const value = response()
    record(transactions(value)[0]!.tx_json).hash = '8'.repeat(64)
    expect(() => normalizeLedgerResponse(value)).toThrow('values disagree')
  })

  it('rejects duplicate transaction hashes', () => {
    const value = response()
    transactions(value)[1]!.hash = SECOND_TX_HASH
    expect(() => normalizeLedgerResponse(value)).toThrow('duplicate transaction hash')
  })

  it.each([2, 0])('rejects discontinuous or duplicate transaction index %s', (index) => {
    const value = response()
    record(transactions(value)[0]!.meta).TransactionIndex = index
    expect(() => normalizeLedgerResponse(value)).toThrow('missing transaction index')
  })

  it.each(['01', '-1', '18446744073709551616', 100])(
    'rejects non-canonical total coins %j',
    (totalCoins) => {
      const value = response()
      ledger(value).total_coins = totalCoins
      expect(() => normalizeLedgerResponse(value)).toThrow('canonical uint64')
    },
  )
})

describe('assertFeatureResponseSupportsAmendment', () => {
  const amendmentId = 'A'.repeat(64)

  it('accepts both XRPL feature response shapes', () => {
    const feature = {
      [amendmentId.toLowerCase()]: {
        enabled: true,
        name: 'Credentials',
        supported: true,
        vetoed: false,
      },
    }
    expect(() => assertFeatureResponseSupportsAmendment(feature, amendmentId)).not.toThrow()
    expect(() =>
      assertFeatureResponseSupportsAmendment({ features: feature }, amendmentId),
    ).not.toThrow()
  })

  it.each([
    ['absent', {}],
    ['disabled', { [amendmentId]: { enabled: false, supported: true } }],
    ['unsupported', { [amendmentId]: { enabled: true, supported: false } }],
  ])('fails closed when the amendment is %s', (_name, featureResponse) => {
    expect(() => assertFeatureResponseSupportsAmendment(featureResponse, amendmentId)).toThrow(
      amendmentId,
    )
  })
})
