import { encode, hashes, type Client, type SubmittableTransaction } from 'xrpl'
import { describe, expect, it, vi } from 'vitest'

import {
  autofillXcsTransaction,
  getTransactionStatus,
  MemoryOperationJournal,
  prepareSignAndSubmit,
  signPreparedAndSubmit,
  submitSignedTransaction,
  XcsSdkError,
} from '../src/index.js'

const ACCOUNT = 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh'
const DESTINATION = 'r9cZA1mLK5R5Am25ArfXFmqgNwjZgnfk59'

function signedBlob(lastLedgerSequence = 50): string {
  return encode({
    TransactionType: 'Payment',
    Account: ACCOUNT,
    Destination: DESTINATION,
    Amount: '1',
    Fee: '12',
    Sequence: 1,
    LastLedgerSequence: lastLedgerSequence,
    SigningPubKey: '',
  })
}

function mockClient(overrides: Record<string, unknown> = {}): Client {
  return {
    isConnected: () => true,
    autofill: vi.fn(async (transaction: SubmittableTransaction) => ({
      ...transaction,
      Fee: '12',
      Sequence: 1,
      LastLedgerSequence: 50,
    })),
    submit: vi.fn(async () => ({ result: { engine_result: 'tesSUCCESS' } })),
    request: vi.fn(async (request: { command: string }) => {
      if (request.command === 'tx') {
        return {
          result: {
            validated: true,
            ledger_index: 49,
            meta: { TransactionResult: 'tesSUCCESS' },
          },
        }
      }
      return { result: { ledger_current_index: 49 } }
    }),
    ...overrides,
  } as unknown as Client
}

describe('reliable submission', () => {
  it('autofills Fee, Sequence and LastLedgerSequence', async () => {
    const transaction = {
      TransactionType: 'Payment' as const,
      Account: ACCOUNT,
      Destination: DESTINATION,
      Amount: '1',
    }
    const prepared = await autofillXcsTransaction(mockClient(), transaction)
    expect(prepared.lastLedgerSequence).toBe(50)
    expect(prepared.transaction).toMatchObject({ Fee: '12', Sequence: 1, LastLedgerSequence: 50 })
  })

  it('fails clearly above the temporary xrpl.js 5 URI interoperability limit', async () => {
    const base = {
      TransactionType: 'CredentialCreate' as const,
      Account: ACCOUNT,
      Subject: DESTINATION,
      CredentialType: '12'.repeat(32),
    }
    await expect(
      autofillXcsTransaction(mockClient(), { ...base, URI: '61'.repeat(128) }),
    ).resolves.toMatchObject({ lastLedgerSequence: 50 })
    await expect(
      autofillXcsTransaction(mockClient(), { ...base, URI: '61'.repeat(129) }),
    ).rejects.toMatchObject({
      code: 'XCS_SDK_INVALID_URI',
      details: { xrplJsMaxByteLength: 128, protocolMaxByteLength: 256 },
    })
  })

  it('submits a signed blob, reconciles by hash, and journals no blob', async () => {
    const journal = new MemoryOperationJournal()
    const result = await submitSignedTransaction(mockClient(), signedBlob(), {
      journal,
      pollIntervalMs: 1,
      timeoutMs: 10,
      operationId: 'operation-1',
    })

    expect(result).toMatchObject({
      status: 'validated',
      operationId: 'operation-1',
      transactionResult: 'tesSUCCESS',
    })
    expect(journal.entries.map((entry) => entry.stage)).toEqual([
      'signed',
      'submitted',
      'validated',
    ])
    expect(JSON.stringify(journal.entries)).not.toContain(signedBlob())
  })

  it('signs a reviewed prepared transaction without autofilling it again', async () => {
    const blob = signedBlob()
    const autofill = vi.fn()
    const client = mockClient({ autofill })
    const result = await signPreparedAndSubmit(
      client,
      {
        TransactionType: 'Payment',
        Account: ACCOUNT,
        Destination: DESTINATION,
        Amount: '1',
        Fee: '12',
        Sequence: 1,
        LastLedgerSequence: 50,
      },
      {
        sign: async () => ({ txBlob: blob, hash: hashes.hashSignedTx(blob) }),
      },
      { journal: new MemoryOperationJournal(), pollIntervalMs: 1, timeoutMs: 10 },
    )

    expect(result).toMatchObject({ status: 'validated', transactionResult: 'tesSUCCESS' })
    expect(autofill).not.toHaveBeenCalled()
  })

  it('still reconciles after an ambiguous submit acknowledgement failure', async () => {
    const journal = new MemoryOperationJournal()
    const client = mockClient({
      submit: vi.fn(async () => Promise.reject(new Error('socket lost'))),
    })
    const result = await submitSignedTransaction(client, signedBlob(), {
      journal,
      pollIntervalMs: 1,
      timeoutMs: 10,
    })

    expect(result.status).toBe('validated')
    expect(journal.entries.map((entry) => entry.stage)).toEqual(['signed', 'pending', 'validated'])
  })

  it('does not poll a transaction rejected as malformed', async () => {
    const journal = new MemoryOperationJournal()
    const request = vi.fn()
    const client = mockClient({
      submit: vi.fn(async () => ({ result: { engine_result: 'temMALFORMED' } })),
      request,
    })
    const result = await submitSignedTransaction(client, signedBlob(), {
      journal,
      pollIntervalMs: 1,
      timeoutMs: 10,
    })

    expect(result).toMatchObject({ status: 'not_found', submitEngineResult: 'temMALFORMED' })
    expect(journal.entries.map((entry) => entry.stage)).toEqual(['signed', 'submitted', 'failed'])
    expect(request).not.toHaveBeenCalled()
  })

  it('reports expiration only after the last ledger sequence passes', async () => {
    const notFound = Object.assign(new Error('txnNotFound'), { data: { error: 'txnNotFound' } })
    const client = mockClient({
      request: vi
        .fn()
        .mockRejectedValueOnce(notFound)
        .mockResolvedValueOnce({ result: { ledger_current_index: 51 } }),
    })

    await expect(getTransactionStatus(client, 'AB'.repeat(32), 50)).resolves.toMatchObject({
      status: 'expired',
    })
  })

  it('rejects incomplete autofill and mismatched signer hashes', async () => {
    const incomplete = mockClient({ autofill: vi.fn(async (transaction) => transaction) })
    await expect(
      autofillXcsTransaction(incomplete, {
        TransactionType: 'Payment',
        Account: ACCOUNT,
        Destination: DESTINATION,
        Amount: '1',
      }),
    ).rejects.toBeInstanceOf(XcsSdkError)

    const blob = signedBlob()
    await expect(
      prepareSignAndSubmit(
        mockClient(),
        {
          TransactionType: 'Payment',
          Account: ACCOUNT,
          Destination: DESTINATION,
          Amount: '1',
        },
        { sign: async () => ({ txBlob: blob, hash: 'FF'.repeat(32) }) },
        { journal: new MemoryOperationJournal() },
      ),
    ).rejects.toBeInstanceOf(XcsSdkError)

    expect(hashes.hashSignedTx(blob)).toMatch(/^[A-F0-9]{64}$/u)
  })

  it('rejects a correctly hashed blob when the signer changed transaction fields', async () => {
    const changedBlob = encode({
      TransactionType: 'Payment',
      Account: ACCOUNT,
      Destination: ACCOUNT,
      Amount: '1',
      Fee: '12',
      Sequence: 1,
      LastLedgerSequence: 50,
      Flags: 0,
      SigningPubKey: '',
    })
    await expect(
      prepareSignAndSubmit(
        mockClient(),
        {
          TransactionType: 'Payment',
          Account: ACCOUNT,
          Destination: DESTINATION,
          Amount: '1',
        },
        {
          sign: async () => ({
            txBlob: changedBlob,
            hash: hashes.hashSignedTx(changedBlob),
          }),
        },
        { journal: new MemoryOperationJournal() },
      ),
    ).rejects.toMatchObject({ code: 'XCS_SDK_INVALID_SIGNER_RESULT' })
  })
})
