import { describe, expect, it } from 'vitest'

import {
  assertPreparedTransaction,
  assertTransactionSigner,
  exactCredentialEventPath,
  exactCredentialPath,
} from '../app/utils/transactions'

const address = 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh'

describe('transaction safety helpers', () => {
  it('rejects a transaction for a different connected account', () => {
    expect(() =>
      assertTransactionSigner(
        { TransactionType: 'Payment', Account: address, Destination: address, Amount: '1' },
        'rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY',
      ),
    ).toThrow('SIGNER_ACCOUNT_MISMATCH')
  })

  it('requires fee, sequence and LastLedgerSequence before signing', () => {
    expect(() =>
      assertPreparedTransaction({
        TransactionType: 'Payment',
        Account: address,
        Destination: address,
        Amount: '1',
      }),
    ).toThrow('TRANSACTION_MUST_BE_PREPARED')
  })

  it('accepts a fully prepared transaction', () => {
    expect(() =>
      assertPreparedTransaction({
        TransactionType: 'Payment',
        Account: address,
        Destination: address,
        Amount: '1',
        Fee: '12',
        Sequence: 1,
        LastLedgerSequence: 100,
      }),
    ).not.toThrow()
  })

  it('encodes every exact-lookup path segment', () => {
    expect(exactCredentialPath('test net', 'r/issuer', 'r subject', 'AA')).toBe(
      '/v1/networks/test%20net/credentials/r%2Fissuer/r%20subject/aa',
    )
  })

  it('builds a transaction-bound event lookup instead of a full history URL', () => {
    const transactionHash = 'AB'.repeat(32)
    const path = exactCredentialEventPath(
      'test net',
      'r/issuer',
      'r subject',
      'AA',
      transactionHash,
    )

    expect(path).toBe(
      `/v1/networks/test%20net/credentials/r%2Fissuer/r%20subject/aa/events/${transactionHash.toLowerCase()}`,
    )
    expect(path).not.toBe('/v1/networks/test%20net/credentials/r%2Fissuer/r%20subject/aa/events')
  })
})
