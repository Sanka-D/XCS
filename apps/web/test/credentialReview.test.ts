import {
  canonicalize,
  createHttpsPayloadUri,
  encodeUtf8Hex,
  type CredentialPayload,
  type ResolvedSchema,
} from '@xcs-protocol/core'
import { describe, expect, it, vi } from 'vitest'

import {
  assertCredentialAcceptanceReviewCurrent,
  assertCredentialGenerationCurrent,
  credentialActionBlockReason,
  credentialRevocationBlockReason,
  createIssuerTrustAcknowledgementToken,
  createPayloadFetchConsentToken,
  inspectCredentialOperationEvent,
  loadCredentialReview,
  loadCredentialReviewWithConsent,
  parseApiCredentialDetail,
  waitForCredentialOperationEvent,
} from '../app/utils/credentialReview'

const ISSUER = 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh'
const SUBJECT = 'r9cZA1mLK5R5Am25ArfXFmqgNwjZgnfk59'
const UID = '12'.repeat(32)
const GENERATION = '34'.repeat(32)
const schema: ResolvedSchema = {
  definition: {
    xcsVersion: '0.1',
    name: 'Completion',
    description: 'Course completion',
    fields: { programId: { type: 'string' } },
  },
  fields: { programId: { type: 'string' } },
  lineage: [],
}
const payload: CredentialPayload = {
  xcsVersion: '0.1',
  issuer: ISSUER,
  subject: SUBJECT,
  schema: UID,
  claims: { programId: 'course-1' },
}
const canonical = canonicalize(payload)
const uri = createHttpsPayloadUri('https://issuer.example/credentials/one.json', canonical)
const credential = {
  generationId: GENERATION,
  issuer: ISSUER,
  subject: SUBJECT,
  schemaUid: UID,
  uriHex: encodeUtf8Hex(uri),
  expiration: null,
  state: 'pending',
}
const report = {
  onChain: 'pending',
  schema: 'valid',
  payload: 'valid',
  issuerTrust: 'trusted',
  generationId: GENERATION,
}

describe('exact credential review', () => {
  it('loads the exact HTTPS payload and permits a fully valid trusted acceptance', async () => {
    const review = await loadCredentialReview({
      credential,
      report,
      issuer: ISSUER,
      subject: SUBJECT,
      schemaUid: UID,
      schema,
      fetchPayload: true,
      fetchImpl: async () =>
        new Response(canonical, { headers: { 'content-type': 'application/json' } }),
    })

    expect(review).toMatchObject({
      generationId: GENERATION,
      issuer: ISSUER,
      subject: SUBJECT,
      schemaUid: UID,
      uri,
      claims: { programId: 'course-1' },
    })
    expect(credentialActionBlockReason(review, 'accept')).toBeUndefined()
  })

  it('blocks acceptance unless every gate is valid and trusted', async () => {
    const review = await loadCredentialReview({
      credential,
      report: { ...report, issuerTrust: 'untrusted' },
      issuer: ISSUER,
      subject: SUBJECT,
      schemaUid: UID,
      schema,
      fetchPayload: true,
      fetchImpl: async () =>
        new Response(canonical, { headers: { 'content-type': 'application/json' } }),
    })

    expect(credentialActionBlockReason(review, 'accept')).toBe('CREDENTIAL_ISSUER_NOT_TRUSTED')
  })

  it('requires a generation-bound subject acknowledgement for an unknown issuer', async () => {
    const review = await loadCredentialReview({
      credential,
      report: { ...report, issuerTrust: 'unknown' },
      issuer: ISSUER,
      subject: SUBJECT,
      schemaUid: UID,
      schema,
      fetchPayload: true,
      fetchImpl: async () =>
        new Response(canonical, { headers: { 'content-type': 'application/json' } }),
    })

    expect(credentialActionBlockReason(review, 'accept')).toBe(
      'CREDENTIAL_ISSUER_TRUST_ACK_REQUIRED',
    )
    const acknowledgement = createIssuerTrustAcknowledgementToken(review, 'profile-a')
    expect(acknowledgement).toEqual({
      profileId: 'profile-a',
      issuer: ISSUER,
      subject: SUBJECT,
      generationId: GENERATION,
      issuerTrust: 'unknown',
    })
    expect(
      credentialActionBlockReason(review, 'accept', acknowledgement, 'profile-a'),
    ).toBeUndefined()
  })

  it('invalidates an unknown-issuer acknowledgement when issuer, generation or trust changes', async () => {
    const review = await loadCredentialReview({
      credential,
      report: { ...report, issuerTrust: 'unknown' },
      issuer: ISSUER,
      subject: SUBJECT,
      schemaUid: UID,
      schema,
      fetchPayload: true,
      fetchImpl: async () =>
        new Response(canonical, { headers: { 'content-type': 'application/json' } }),
    })
    const acknowledgement = createIssuerTrustAcknowledgementToken(review, 'profile-a')

    expect(
      credentialActionBlockReason(
        { ...review, generationId: '56'.repeat(32) },
        'accept',
        acknowledgement,
        'profile-a',
      ),
    ).toBe('CREDENTIAL_ISSUER_TRUST_ACK_STALE')
    expect(
      credentialActionBlockReason(
        { ...review, issuer: SUBJECT },
        'accept',
        acknowledgement,
        'profile-a',
      ),
    ).toBe('CREDENTIAL_ISSUER_TRUST_ACK_STALE')
    expect(
      credentialActionBlockReason(
        { ...review, subject: ISSUER },
        'accept',
        acknowledgement,
        'profile-a',
      ),
    ).toBe('CREDENTIAL_ISSUER_TRUST_ACK_STALE')
    expect(credentialActionBlockReason(review, 'accept', acknowledgement, 'profile-b')).toBe(
      'CREDENTIAL_ISSUER_TRUST_ACK_STALE',
    )
    expect(
      credentialActionBlockReason(
        { ...review, report: { ...review.report, issuerTrust: 'trusted' } },
        'accept',
        acknowledgement,
        'profile-a',
      ),
    ).toBe('CREDENTIAL_ISSUER_TRUST_ACK_STALE')
    expect(
      credentialActionBlockReason(
        { ...review, report: { ...review.report, issuerTrust: 'untrusted' } },
        'accept',
        acknowledgement,
        'profile-a',
      ),
    ).toBe('CREDENTIAL_ISSUER_NOT_TRUSTED')
    expect(
      credentialActionBlockReason(
        { ...review, report: { ...review.report, issuerTrust: 'trusted' } },
        'accept',
      ),
    ).toBeUndefined()
  })

  it('rejects a trust or profile change observed after the wallet returns', async () => {
    const review = await loadCredentialReview({
      credential,
      report: { ...report, issuerTrust: 'unknown' },
      issuer: ISSUER,
      subject: SUBJECT,
      schemaUid: UID,
      schema,
      fetchPayload: true,
      fetchImpl: async () =>
        new Response(canonical, { headers: { 'content-type': 'application/json' } }),
    })
    const acknowledgement = createIssuerTrustAcknowledgementToken(review, 'profile-a')

    expect(() =>
      assertCredentialAcceptanceReviewCurrent(
        review,
        { ...review, report: { ...review.report, issuerTrust: 'untrusted' } },
        'profile-a',
        'profile-a',
        acknowledgement,
      ),
    ).toThrow('CREDENTIAL_ISSUER_TRUST_CHANGED_AFTER_SIGNATURE')
    expect(() =>
      assertCredentialAcceptanceReviewCurrent(
        review,
        review,
        'profile-a',
        'profile-b',
        acknowledgement,
      ),
    ).toThrow('NETWORK_PROFILE_CHANGED_AFTER_SIGNATURE')
  })

  it('keeps a pending credential rejectable when its payload cannot be reviewed', async () => {
    const fetchImpl = vi.fn()
    const review = await loadCredentialReview({
      credential,
      report: { ...report, payload: 'tampered' },
      issuer: ISSUER,
      subject: SUBJECT,
      schemaUid: UID,
      schema,
      fetchImpl,
    })

    expect(fetchImpl).not.toHaveBeenCalled()
    expect(credentialActionBlockReason(review, 'delete')).toBeUndefined()
    expect(credentialActionBlockReason(review, 'accept')).toBe('CREDENTIAL_PAYLOAD_REVIEW_FAILED')
  })

  it('loads URI metadata without contacting the issuer before consent', async () => {
    const fetchImpl = vi.fn()
    const review = await loadCredentialReview({
      credential,
      report: { ...report, payload: 'not_checked' },
      issuer: ISSUER,
      subject: SUBJECT,
      schemaUid: UID,
      schema,
      fetchImpl,
    })

    expect(review).toMatchObject({ uri, generationId: GENERATION })
    expect(review).not.toHaveProperty('claims')
    expect(review).not.toHaveProperty('payload')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('never fetches a replacement URI that was not covered by the displayed consent', async () => {
    const metadataReview = await loadCredentialReview({
      credential,
      report: { ...report, payload: 'not_checked' },
      issuer: ISSUER,
      subject: SUBJECT,
      schemaUid: UID,
      schema,
    })
    const consent = createPayloadFetchConsentToken(metadataReview)
    const replacementCanonical = canonicalize({
      ...payload,
      claims: { programId: 'replacement' },
    })
    const replacementUri = createHttpsPayloadUri(
      'https://replacement.example/credentials/two.json',
      replacementCanonical,
    )
    const fetchReplacement = vi.fn(async () =>
      Promise.resolve(
        new Response(replacementCanonical, { headers: { 'content-type': 'application/json' } }),
      ),
    )

    await expect(
      loadCredentialReviewWithConsent({
        credential: {
          ...credential,
          generationId: '56'.repeat(32),
          uriHex: encodeUtf8Hex(replacementUri),
        },
        report: {
          ...report,
          generationId: '56'.repeat(32),
          payload: 'not_checked',
        },
        issuer: ISSUER,
        subject: SUBJECT,
        schemaUid: UID,
        schema,
        consent,
        fetchImpl: fetchReplacement,
      }),
    ).rejects.toThrow('CREDENTIAL_PAYLOAD_CONSENT_STALE')
    expect(fetchReplacement).not.toHaveBeenCalled()
  })

  it('rejects tuple and generation mismatches before an action is prepared', async () => {
    await expect(
      loadCredentialReview({
        credential: { ...credential, subject: ISSUER },
        report,
        issuer: ISSUER,
        subject: SUBJECT,
        schemaUid: UID,
        schema,
      }),
    ).rejects.toThrow('CREDENTIAL_EXACT_LOOKUP_MISMATCH')
    await expect(
      loadCredentialReview({
        credential,
        report: { ...report, generationId: '56'.repeat(32) },
        issuer: ISSUER,
        subject: SUBJECT,
        schemaUid: UID,
        schema,
      }),
    ).rejects.toThrow('CREDENTIAL_REVIEW_GENERATION_MISMATCH')
  })

  it('allows issuer revocation only while the exact generation still exists', () => {
    const exact = parseApiCredentialDetail(credential, {
      issuer: ISSUER,
      subject: SUBJECT,
      schemaUid: UID,
    })
    expect(credentialRevocationBlockReason(exact)).toBeUndefined()
    expect(credentialRevocationBlockReason({ ...exact, state: 'deleted' })).toBe(
      'CREDENTIAL_ALREADY_DELETED',
    )
  })

  it('rechecks the exact generation and action state after wallet signing', () => {
    const expected = {
      action: 'credential-accept' as const,
      issuer: ISSUER,
      subject: SUBJECT,
      schemaUid: UID,
      generationId: GENERATION,
    }
    expect(() => assertCredentialGenerationCurrent(credential, expected)).not.toThrow()
    expect(() =>
      assertCredentialGenerationCurrent({ ...credential, generationId: '56'.repeat(32) }, expected),
    ).toThrow('CREDENTIAL_GENERATION_CHANGED_AFTER_SIGNATURE')
  })

  it('confirms only an event matching hash, generation and mutation type', () => {
    const expected = {
      action: 'credential-reject' as const,
      issuer: ISSUER,
      subject: SUBJECT,
      schemaUid: UID,
      generationId: GENERATION,
      txHash: 'AB'.repeat(32),
    }
    expect(
      inspectCredentialOperationEvent(
        {
          transactionHash: expected.txHash.toLowerCase(),
          event: {
            transactionHash: expected.txHash.toLowerCase(),
            issuer: ISSUER,
            subject: SUBJECT,
            schemaUid: UID,
            generationId: GENERATION,
            eventType: 'deleted',
            accepted: false,
            deletionCause: 'subject_rejected',
          },
        },
        expected,
      ),
    ).toBe('confirmed')
    expect(
      inspectCredentialOperationEvent(
        {
          transactionHash: expected.txHash,
          event: {
            transactionHash: expected.txHash,
            issuer: ISSUER,
            subject: SUBJECT,
            schemaUid: UID,
            generationId: '56'.repeat(32),
            eventType: 'deleted',
            accepted: false,
            deletionCause: 'subject_rejected',
          },
        },
        expected,
      ),
    ).toBe('mismatch')
    expect(
      inspectCredentialOperationEvent(
        {
          transactionHash: expected.txHash,
          event: {
            transactionHash: expected.txHash,
            issuer: SUBJECT,
            subject: SUBJECT,
            schemaUid: UID,
            generationId: GENERATION,
            eventType: 'deleted',
            accepted: false,
            deletionCause: 'subject_rejected',
          },
        },
        expected,
      ),
    ).toBe('mismatch')
    expect(() =>
      inspectCredentialOperationEvent({ transactionHash: 'CD'.repeat(32), event: null }, expected),
    ).toThrow('CREDENTIAL_EVENT_RESPONSE_INVALID')

    expect(
      inspectCredentialOperationEvent(
        {
          transactionHash: expected.txHash,
          event: {
            transactionHash: expected.txHash,
            issuer: ISSUER,
            subject: SUBJECT,
            schemaUid: UID,
            generationId: GENERATION,
            eventType: 'accepted',
            accepted: false,
            deletionCause: null,
          },
        },
        { ...expected, action: 'credential-accept' },
      ),
    ).toBe('mismatch')
  })

  it('bounds indexer event reconciliation instead of reporting success indefinitely', async () => {
    vi.useFakeTimers()
    try {
      const confirmation = waitForCredentialOperationEvent({
        action: 'credential-accept',
        issuer: ISSUER,
        subject: SUBJECT,
        schemaUid: UID,
        generationId: GENERATION,
        txHash: 'AB'.repeat(32),
        loadEvent: async () => ({ transactionHash: 'AB'.repeat(32), event: null }),
        timeoutMs: 2_000,
        pollIntervalMs: 1_000,
      })
      const expectedTimeout = expect(confirmation).rejects.toThrow(
        'CREDENTIAL_EVENT_CONFIRMATION_TIMEOUT',
      )
      await vi.advanceTimersByTimeAsync(2_000)
      await expectedTimeout
    } finally {
      vi.useRealTimers()
    }
  })
})
