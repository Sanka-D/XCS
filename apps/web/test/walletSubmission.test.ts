import { createHttpsPayloadUri } from '@xcs-protocol/core'
import {
  buildCredentialAccept,
  buildCredentialCreate,
  buildCredentialDelete,
  signPreparedAndSubmit,
  type OperationJournal,
  type ReliableSubmissionResult,
  type SubmissionJournalEntry,
} from '@xcs-protocol/sdk'
import { hashes, Wallet, type Client, type Payment, type SubmittableTransaction } from 'xrpl'
import { describe, expect, it, vi } from 'vitest'

import {
  applyJournalEntry,
  canRetryOperation,
  type StoredOperation,
} from '../app/utils/operationJournal'
import {
  assertValidatedTesSuccess,
  createPersistingWalletSigner,
  normalizeWalletSignature,
} from '../app/utils/walletSubmission'

function signedPayment() {
  const signer = Wallet.generate()
  const transaction: Payment = {
    TransactionType: 'Payment',
    Account: signer.address,
    Destination: Wallet.generate().address,
    Amount: '1',
    Fee: '12',
    Sequence: 1,
    LastLedgerSequence: 100,
  }
  return { transaction, signed: signer.sign(transaction) }
}

function storedOperation(overrides: Partial<StoredOperation> = {}): StoredOperation {
  return {
    operationId: 'operation-1',
    account: Wallet.generate().address,
    profileId: 'xrpl-testnet-xcs-v0.1',
    networkId: 1,
    transactionType: 'Payment',
    createdAt: '2026-08-19T12:00:00.000Z',
    updatedAt: '2026-08-19T12:00:00.000Z',
    stage: 'prepared',
    ...overrides,
  }
}

describe('wallet sign-only normalization', () => {
  it('derives the XRPL hash when the wallet returns an empty hash', () => {
    const { signed } = signedPayment()
    const normalized = normalizeWalletSignature({ hash: '', tx_blob: signed.tx_blob })

    expect(normalized.hash).toBe(hashes.hashSignedTx(signed.tx_blob).toUpperCase())
    expect(normalized.txBlob).toBe(signed.tx_blob)
  })

  it('accepts a matching wallet hash regardless of case', () => {
    const { signed } = signedPayment()
    const normalized = normalizeWalletSignature({
      hash: signed.hash.toLowerCase(),
      tx_blob: signed.tx_blob,
    })

    expect(normalized.hash).toBe(signed.hash.toUpperCase())
  })

  it('rejects a non-empty wallet hash that does not match the signed blob', () => {
    const { signed } = signedPayment()
    expect(() =>
      normalizeWalletSignature({ hash: '0'.repeat(64), tx_blob: signed.tx_blob }),
    ).toThrow('WALLET_SIGNED_HASH_MISMATCH')
  })

  it('requires a complete signed blob', () => {
    expect(() => normalizeWalletSignature({ hash: '' })).toThrow('WALLET_SIGNED_BLOB_MISSING')
  })

  it('normalizes real xrpl.js blobs for every native XCS credential transaction', () => {
    const issuer = Wallet.generate()
    const subject = Wallet.generate()
    const schemaUid = '12'.repeat(32)
    const uri = createHttpsPayloadUri('https://issuer.example/c.json', '{}')
    const transactions: Array<{ transaction: SubmittableTransaction; signer: Wallet }> = [
      {
        transaction: buildCredentialCreate({
          issuer: issuer.address,
          subject: subject.address,
          schemaUid,
          uri,
        }),
        signer: issuer,
      },
      {
        transaction: buildCredentialAccept({
          subject: subject.address,
          issuer: issuer.address,
          schemaUid,
        }),
        signer: subject,
      },
      {
        transaction: buildCredentialDelete({
          account: issuer.address,
          issuer: issuer.address,
          subject: subject.address,
          schemaUid,
        }),
        signer: issuer,
      },
    ]

    for (const [index, item] of transactions.entries()) {
      const prepared = {
        ...item.transaction,
        Fee: '12',
        Sequence: index + 1,
        LastLedgerSequence: 100,
      }
      const signed = item.signer.sign(prepared)
      const normalized = normalizeWalletSignature({ hash: '', tx_blob: signed.tx_blob })
      expect(normalized.hash).toBe(signed.hash.toUpperCase())
    }
  })

  it('awaits durable persistence before returning the normalized signature', async () => {
    const { transaction, signed } = signedPayment()
    const events: string[] = []
    const persist = vi.fn(async () => {
      events.push('persisted')
    })
    const signer = createPersistingWalletSigner(
      {
        sign: async () => {
          events.push('signed')
          return { hash: '', tx_blob: signed.tx_blob }
        },
      },
      persist,
    )

    await expect(signer.sign(transaction)).resolves.toMatchObject({ hash: signed.hash })
    expect(events).toEqual(['signed', 'persisted'])
    expect(persist).toHaveBeenCalledOnce()
  })

  it('does not release a signature when durable persistence fails', async () => {
    const { transaction, signed } = signedPayment()
    const signer = createPersistingWalletSigner(
      { sign: async () => ({ hash: '', tx_blob: signed.tx_blob }) },
      async () => {
        throw new Error('INDEXED_DB_WRITE_FAILED')
      },
    )

    await expect(signer.sign(transaction)).rejects.toThrow('INDEXED_DB_WRITE_FAILED')
  })

  it('persists the blob before the SDK makes its first submit call', async () => {
    const { transaction, signed } = signedPayment()
    const events: string[] = []
    const journal: OperationJournal = {
      append: async (entry) => {
        events.push(`journal:${entry.stage}`)
      },
    }
    const signer = createPersistingWalletSigner(
      {
        sign: async () => {
          events.push('wallet:sign')
          return { hash: '', tx_blob: signed.tx_blob }
        },
      },
      async () => {
        events.push('indexeddb:persisted')
      },
    )
    const client = {
      isConnected: () => true,
      submit: async () => {
        events.push('network:submit')
        return { result: { engine_result: 'tesSUCCESS' } }
      },
      request: async () => ({
        result: {
          validated: true,
          ledger_index: 99,
          meta: { TransactionResult: 'tesSUCCESS' },
        },
      }),
    } as unknown as Client

    await expect(
      signPreparedAndSubmit(client, transaction, signer, {
        journal,
        operationId: 'operation-1',
        pollIntervalMs: 1,
        timeoutMs: 10,
      }),
    ).resolves.toMatchObject({ status: 'validated', transactionResult: 'tesSUCCESS' })
    expect(events.indexOf('indexeddb:persisted')).toBeLessThan(events.indexOf('network:submit'))
    expect(events).toEqual([
      'journal:prepared',
      'wallet:sign',
      'indexeddb:persisted',
      'journal:signed',
      'network:submit',
      'journal:submitted',
      'journal:validated',
    ])
  })
})

describe('reliable submission outcome', () => {
  const successful: ReliableSubmissionResult = {
    operationId: 'operation-1',
    status: 'validated',
    txHash: 'A'.repeat(64),
    transactionResult: 'tesSUCCESS',
  }

  it('only accepts a validated tesSUCCESS result', () => {
    expect(() => assertValidatedTesSuccess(successful)).not.toThrow()
  })

  it('does not report a pending transaction as successful', () => {
    expect(() => assertValidatedTesSuccess({ ...successful, status: 'pending' })).toThrow(
      'TRANSACTION_PENDING',
    )
  })

  it('does not report a validated tec result as successful', () => {
    expect(() =>
      assertValidatedTesSuccess({ ...successful, transactionResult: 'tecUNFUNDED_PAYMENT' }),
    ).toThrow('TRANSACTION_FAILED:tecUNFUNDED_PAYMENT')
  })
})

describe('operation journal state', () => {
  it('preserves the signed blob while applying SDK journal entries', () => {
    const operation = storedOperation({
      stage: 'signed',
      txBlob: 'ABCD',
      txHash: 'A'.repeat(64),
    })
    const entry: SubmissionJournalEntry = {
      operationId: operation.operationId,
      at: '2026-08-19T12:01:00.000Z',
      stage: 'pending',
      txHash: operation.txHash,
      lastLedgerSequence: 100,
    }

    const updated = applyJournalEntry(operation, entry)
    expect(updated.txBlob).toBe('ABCD')
    expect(updated.stage).toBe('pending')
    expect(canRetryOperation(updated)).toBe(true)
  })

  it('never offers retry for a validated transaction', () => {
    const operation = storedOperation({
      stage: 'pending',
      txBlob: 'ABCD',
      txHash: 'A'.repeat(64),
    })
    const validated = applyJournalEntry(operation, {
      operationId: operation.operationId,
      at: '2026-08-19T12:02:00.000Z',
      stage: 'validated',
      txHash: operation.txHash,
      engineResult: 'tesSUCCESS',
    })

    expect(validated.txBlob).toBeUndefined()
    expect(canRetryOperation(validated)).toBe(false)
  })
})
