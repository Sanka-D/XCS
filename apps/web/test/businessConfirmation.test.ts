import { describe, expect, it, vi } from 'vitest'

import {
  inspectIndexedBusinessEvidence,
  reconfirmValidatedBusinessOperation,
} from '../app/utils/businessConfirmation'
import {
  canReconfirmOperation,
  operationBusinessConfirmation,
  type StoredOperation,
} from '../app/utils/operationJournal'

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
    ledgerIndex: 101,
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
      ledgerIndex: 101,
      ledgerHash: 'CD'.repeat(32),
      transactionIndex: 2,
      nodeIndex: 0,
      eventType: 'accepted',
      accepted: true,
      deletionCause: null,
    },
  }
}

describe('validated business re-confirmation', () => {
  it('confirms an accepted registration only with the exact publisher and canonical digest', () => {
    const schemaDigestHex = '56'.repeat(32)
    const schemaUid = '78'.repeat(32)
    const response = {
      transactionHash: TX_HASH.toLowerCase(),
      registration: {
        status: 'accepted',
        publisher: ISSUER,
        ledgerIndex: 102,
        ledgerHash: 'CD'.repeat(32),
        transactionIndex: 3,
        schemaUid,
        schemaDigestHex,
        reasonCode: null,
      },
    }
    const business = {
      action: 'schema-register' as const,
      publisher: ISSUER,
      schemaDigestHex,
      memoByteLength: 512,
    }

    expect(inspectIndexedBusinessEvidence(response, business, TX_HASH)).toEqual({
      confirmation: 'confirmed',
      evidence: {
        transactionHash: TX_HASH.toLowerCase(),
        ledgerIndex: 102,
        ledgerHash: 'cd'.repeat(32),
        transactionIndex: 3,
        schemaUid,
      },
    })
    expect(
      inspectIndexedBusinessEvidence(
        {
          ...response,
          registration: { ...response.registration, schemaDigestHex: '90'.repeat(32) },
        },
        business,
        TX_HASH,
      ),
    ).toEqual({ state: 'mismatch' })
  })

  it('keeps a protocol registration rejection separate from an evidence mismatch', () => {
    expect(
      inspectIndexedBusinessEvidence(
        {
          transactionHash: TX_HASH,
          registration: {
            status: 'rejected',
            publisher: ISSUER,
            ledgerIndex: 102,
            ledgerHash: 'CD'.repeat(32),
            transactionIndex: 3,
            schemaUid: null,
            schemaDigestHex: null,
            reasonCode: 'REGISTRATION_NOT_CANONICAL',
          },
        },
        {
          action: 'schema-register',
          publisher: ISSUER,
          schemaDigestHex: '56'.repeat(32),
          memoByteLength: 512,
        },
        TX_HASH,
      ),
    ).toMatchObject({
      confirmation: 'rejected',
      evidence: { reasonCode: 'REGISTRATION_NOT_CANONICAL' },
    })
  })

  it('confirms issuance only when created generation equals the transaction hash', () => {
    const business = {
      action: 'credential-issue' as const,
      issuer: ISSUER,
      subject: SUBJECT,
      schemaUid: SCHEMA_UID,
      credentialUri: `https://issuer.example/c.json#xcs-sha256=${'56'.repeat(32)}`,
      payloadDigestHex: '56'.repeat(32),
    }
    const event = {
      transactionHash: TX_HASH,
      event: {
        transactionHash: TX_HASH,
        issuer: ISSUER,
        subject: SUBJECT,
        schemaUid: SCHEMA_UID,
        generationId: TX_HASH,
        ledgerIndex: 103,
        ledgerHash: 'CD'.repeat(32),
        transactionIndex: 4,
        eventType: 'created',
        accepted: false,
        deletionCause: null,
      },
    }
    expect(inspectIndexedBusinessEvidence(event, business, TX_HASH)).toMatchObject({
      confirmation: 'confirmed',
      evidence: { generationId: TX_HASH.toLowerCase(), eventType: 'created' },
    })
    expect(
      inspectIndexedBusinessEvidence(
        { ...event, event: { ...event.event, generationId: GENERATION_ID } },
        business,
        TX_HASH,
      ),
    ).toEqual({ state: 'mismatch' })
    expect(
      inspectIndexedBusinessEvidence(
        { ...event, event: { ...event.event, accepted: true } },
        business,
        TX_HASH,
      ),
    ).toEqual({ state: 'mismatch' })

    const selfIssuedBusiness = { ...business, subject: ISSUER }
    expect(
      inspectIndexedBusinessEvidence(
        {
          ...event,
          event: { ...event.event, subject: ISSUER, accepted: true },
        },
        selfIssuedBusiness,
        TX_HASH,
      ),
    ).toMatchObject({ confirmation: 'confirmed' })
  })

  it('rejects an accepted event whose indexed accepted flag is contradictory', () => {
    const response = exactAcceptedEvent()
    response.event.accepted = false
    expect(inspectIndexedBusinessEvidence(response, storedOperation().business!, TX_HASH)).toEqual({
      state: 'mismatch',
    })
  })

  it('keeps the exact credential deletion cause in durable evidence', () => {
    const operation = storedOperation({
      transactionType: 'CredentialDelete',
      businessConfirmation: 'confirmed',
      business: {
        action: 'credential-reject',
        issuer: ISSUER,
        subject: SUBJECT,
        schemaUid: SCHEMA_UID,
        generationId: GENERATION_ID,
      },
      businessEvidence: {
        transactionHash: TX_HASH,
        ledgerIndex: 101,
        ledgerHash: 'CD'.repeat(32),
        transactionIndex: 2,
        schemaUid: SCHEMA_UID,
        generationId: GENERATION_ID,
        eventType: 'deleted',
        accepted: false,
        deletionCause: 'subject_rejected',
      },
    })

    expect(operationBusinessConfirmation(operation)).toBe('confirmed')
    expect(
      operationBusinessConfirmation({
        ...operation,
        businessEvidence: {
          ...operation.businessEvidence!,
          deletionCause: 'issuer_revoked',
        },
      }),
    ).toBe('pending')
    expect(
      operationBusinessConfirmation({
        ...operation,
        ledgerIndex: 102,
      }),
    ).toBe('pending')
  })

  it('persists an exact confirmed event without requiring a blob or XRPL submitter', async () => {
    const operation = new Proxy(storedOperation(), {
      get(target, property, receiver) {
        if (property === 'txBlob') throw new Error('SIGNED_BLOB_MUST_NOT_BE_READ')
        return Reflect.get(target, property, receiver)
      },
    })
    const loadEvidence = vi.fn(async () => exactAcceptedEvent())
    const persist = vi.fn(async () => undefined)

    await expect(
      reconfirmValidatedBusinessOperation({
        operation,
        loadEvidence,
        persist,
        now: () => new Date('2026-08-19T12:02:00.000Z'),
      }),
    ).resolves.toBe('confirmed')
    expect(loadEvidence).toHaveBeenCalledTimes(1)
    expect(persist).toHaveBeenCalledWith(
      'confirmed',
      '2026-08-19T12:02:00.000Z',
      expect.objectContaining({
        transactionHash: TX_HASH.toLowerCase(),
        generationId: GENERATION_ID,
        ledgerIndex: 101,
      }),
    )
  })

  it('does not offer re-confirmation after exact evidence is already stored', () => {
    expect(
      canReconfirmOperation(
        storedOperation({
          businessConfirmation: 'confirmed',
          businessEvidence: {
            transactionHash: TX_HASH,
            ledgerIndex: 101,
            ledgerHash: 'CD'.repeat(32),
            transactionIndex: 2,
            schemaUid: SCHEMA_UID,
            generationId: GENERATION_ID,
            eventType: 'accepted',
            accepted: true,
            deletionCause: null,
          },
        }),
      ),
    ).toBe(false)
  })

  it('persists mismatch and timeout outcomes without reporting success', async () => {
    const mismatchPersist = vi.fn(async () => undefined)
    await expect(
      reconfirmValidatedBusinessOperation({
        operation: storedOperation({ businessConfirmation: 'mismatch' }),
        loadEvidence: async () => ({
          transactionHash: TX_HASH,
          event: {
            transactionHash: TX_HASH,
            issuer: ISSUER,
            subject: SUBJECT,
            schemaUid: SCHEMA_UID,
            generationId: '56'.repeat(32),
            ledgerIndex: 101,
            ledgerHash: 'CD'.repeat(32),
            transactionIndex: 2,
            eventType: 'accepted',
            accepted: true,
            deletionCause: null,
          },
        }),
        persist: mismatchPersist,
      }),
    ).resolves.toBe('mismatch')
    expect(mismatchPersist).toHaveBeenCalledWith('mismatch', expect.any(String), undefined)

    vi.useFakeTimers()
    try {
      const timeoutPersist = vi.fn(async () => undefined)
      const confirmation = reconfirmValidatedBusinessOperation({
        operation: storedOperation({ businessConfirmation: 'pending' }),
        loadEvidence: async () => ({ transactionHash: TX_HASH, event: null }),
        persist: timeoutPersist,
        timeoutMs: 2,
        pollIntervalMs: 1,
      })
      const expectedTimeout = expect(confirmation).resolves.toBe('timeout')
      await vi.advanceTimersByTimeAsync(2)
      await expectedTimeout
      expect(timeoutPersist).toHaveBeenCalledWith('timeout', expect.any(String), undefined)
    } finally {
      vi.useRealTimers()
    }
  })

  it.each([
    ['not validated', { stage: 'pending' as const }],
    ['non-success XRPL result', { engineResult: 'tecNO_PERMISSION' }],
    ['missing transaction hash', { txHash: undefined }],
    ['wrong transaction type', { transactionType: 'Payment' }],
    ['wrong actor', { account: ISSUER }],
    ['missing generation context', { business: undefined }],
  ])('rejects %s before reading indexed events', async (_label, overrides) => {
    const operation = storedOperation(overrides)
    const loadEvidence = vi.fn(async () => exactAcceptedEvent())
    const persist = vi.fn(async () => undefined)

    expect(canReconfirmOperation(operation)).toBe(false)
    await expect(
      reconfirmValidatedBusinessOperation({ operation, loadEvidence, persist }),
    ).rejects.toThrow('OPERATION_BUSINESS_RECONFIRM_NOT_ALLOWED')
    expect(loadEvidence).not.toHaveBeenCalled()
    expect(persist).not.toHaveBeenCalled()
  })
})
