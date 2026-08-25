import { describe, expect, it, vi } from 'vitest'

import { reconfirmValidatedBusinessOperation } from '../app/utils/businessConfirmation'
import { canReconfirmOperation, type StoredOperation } from '../app/utils/operationJournal'

const ISSUER = 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh'
const SUBJECT = 'r9cZA1mLK5R5Am25ArfXFmqgNwjZgnfk59'
const SCHEMA_UID = '12'.repeat(32)
const GENERATION_ID = '34'.repeat(32)
const TX_HASH = 'AB'.repeat(32)

function storedOperation(overrides: Partial<StoredOperation> = {}): StoredOperation {
  return {
    operationId: 'operation-1',
    account: SUBJECT,
    profileId: 'xrpl-testnet-xcs-v0.1',
    networkId: 1,
    transactionType: 'CredentialAccept',
    createdAt: '2026-08-19T12:00:00.000Z',
    updatedAt: '2026-08-19T12:01:00.000Z',
    stage: 'validated',
    txHash: TX_HASH,
    engineResult: 'tesSUCCESS',
    businessConfirmation: 'timeout',
    business: {
      action: 'credential-accept',
      issuer: ISSUER,
      subject: SUBJECT,
      schemaUid: SCHEMA_UID,
      generationId: GENERATION_ID,
    },
    ...overrides,
  }
}

function exactAcceptedEvent() {
  return {
    transactionHash: TX_HASH.toLowerCase(),
    event: {
      transactionHash: TX_HASH.toLowerCase(),
      issuer: ISSUER,
      subject: SUBJECT,
      schemaUid: SCHEMA_UID,
      generationId: GENERATION_ID,
      eventType: 'accepted',
      deletionCause: null,
    },
  }
}

describe('validated business re-confirmation', () => {
  it('persists an exact confirmed event without requiring a blob or XRPL submitter', async () => {
    const operation = new Proxy(storedOperation(), {
      get(target, property, receiver) {
        if (property === 'txBlob') throw new Error('SIGNED_BLOB_MUST_NOT_BE_READ')
        return Reflect.get(target, property, receiver)
      },
    })
    const loadEvent = vi.fn(async () => exactAcceptedEvent())
    const persist = vi.fn(async () => undefined)

    await expect(
      reconfirmValidatedBusinessOperation({
        operation,
        loadEvent,
        persist,
        now: () => new Date('2026-08-19T12:02:00.000Z'),
      }),
    ).resolves.toBe('confirmed')
    expect(loadEvent).toHaveBeenCalledTimes(1)
    expect(persist).toHaveBeenCalledWith('confirmed', '2026-08-19T12:02:00.000Z')
  })

  it('persists mismatch and timeout outcomes without reporting success', async () => {
    const mismatchPersist = vi.fn(async () => undefined)
    await expect(
      reconfirmValidatedBusinessOperation({
        operation: storedOperation({ businessConfirmation: 'mismatch' }),
        loadEvent: async () => ({
          transactionHash: TX_HASH,
          event: {
            transactionHash: TX_HASH,
            issuer: ISSUER,
            subject: SUBJECT,
            schemaUid: SCHEMA_UID,
            generationId: '56'.repeat(32),
            eventType: 'accepted',
            deletionCause: null,
          },
        }),
        persist: mismatchPersist,
      }),
    ).resolves.toBe('mismatch')
    expect(mismatchPersist).toHaveBeenCalledWith('mismatch', expect.any(String))

    vi.useFakeTimers()
    try {
      const timeoutPersist = vi.fn(async () => undefined)
      const confirmation = reconfirmValidatedBusinessOperation({
        operation: storedOperation({ businessConfirmation: 'pending' }),
        loadEvent: async () => ({ transactionHash: TX_HASH, event: null }),
        persist: timeoutPersist,
        timeoutMs: 2,
        pollIntervalMs: 1,
      })
      const expectedTimeout = expect(confirmation).resolves.toBe('timeout')
      await vi.advanceTimersByTimeAsync(2)
      await expectedTimeout
      expect(timeoutPersist).toHaveBeenCalledWith('timeout', expect.any(String))
    } finally {
      vi.useRealTimers()
    }
  })

  it.each([
    ['not validated', { stage: 'pending' as const }],
    ['non-success XRPL result', { engineResult: 'tecNO_PERMISSION' }],
    ['missing transaction hash', { txHash: undefined }],
    ['already confirmed', { businessConfirmation: 'confirmed' as const }],
    ['wrong transaction type', { transactionType: 'Payment' }],
    ['wrong actor', { account: ISSUER }],
    ['missing generation context', { business: undefined }],
  ])('rejects %s before reading indexed events', async (_label, overrides) => {
    const operation = storedOperation(overrides)
    const loadEvent = vi.fn(async () => exactAcceptedEvent())
    const persist = vi.fn(async () => undefined)

    expect(canReconfirmOperation(operation)).toBe(false)
    await expect(
      reconfirmValidatedBusinessOperation({ operation, loadEvent, persist }),
    ).rejects.toThrow('OPERATION_BUSINESS_RECONFIRM_NOT_ALLOWED')
    expect(loadEvent).not.toHaveBeenCalled()
    expect(persist).not.toHaveBeenCalled()
  })
})
