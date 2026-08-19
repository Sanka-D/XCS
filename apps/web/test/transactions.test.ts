import { describe, expect, it } from 'vitest'

import {
  assertPreparedTransaction,
  assertTransactionSigner,
  exactCredentialPath,
} from '../app/utils/transactions'
import { payloadPublicationMatches } from '../app/utils/payloadPublication'

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

  it('invalidates publication confirmation when a rebuilt payload changes', () => {
    const published = {
      canonicalPayload: '{"claims":{"course":"A"}}',
      credentialUri: 'ipfs://first',
    }

    expect(
      payloadPublicationMatches(published, published.canonicalPayload, published.credentialUri),
    ).toBe(true)
    expect(payloadPublicationMatches(published, '{"claims":{"course":"B"}}', 'ipfs://second')).toBe(
      false,
    )
  })
})
