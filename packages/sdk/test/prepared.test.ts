import { Wallet, type Payment } from 'xrpl'
import { describe, expect, it } from 'vitest'

import {
  assertPreparedEnvelopeMatchesProfile,
  assertReadinessAdvancesPreparedCheckpoint,
  assertSignedBlobMatchesPrepared,
  bindPreparedTransactionContext,
  buildSchemaRegistrationPayment,
  createPreparedTransactionEnvelope,
  parsePreparedTransactionEnvelope,
} from '../src/index.js'

const TEST_WALLET = Wallet.fromEntropy(Uint8Array.from({ length: 16 }, (_, index) => index + 1))
const ACCOUNT = TEST_WALLET.classicAddress
const profile = {
  profileId: 'xrpl-testnet-xcs-v0.1',
  xcsVersion: '0.1',
  networkId: 1,
  requiredAmendment: 'AB'.repeat(32),
  registryAddress: 'rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe',
  registrationAmountDrops: '1',
  activationLedgerIndex: 1,
  activationLedgerHash: 'cd'.repeat(32),
} as const
const profileSha256 = '12'.repeat(32)
const checkpoint = {
  ledgerIndex: 100,
  ledgerHash: '34'.repeat(32),
  closeTime: 800_000_000,
  transactionRoot: '56'.repeat(32),
} as const
const schema = {
  xcsVersion: '0.1',
  name: 'Course completion',
  description: 'Successful completion of a course.',
  fields: { programId: { type: 'string' } },
} as const

function preparedTransaction(): Payment {
  const registration = buildSchemaRegistrationPayment({
    publisher: ACCOUNT,
    profile,
    schema,
  }).transaction
  return bindPreparedTransactionContext({
    transaction: {
      ...registration,
      Fee: '12',
      Sequence: 1,
      LastLedgerSequence: 120,
    },
    profile,
    profileSha256,
    checkpoint,
  })
}

describe('prepared transaction envelope', () => {
  it('binds exact transaction fields, profile bytes, and authoritative checkpoint', () => {
    const transaction = preparedTransaction()
    const envelope = createPreparedTransactionEnvelope({
      profile,
      profileSha256,
      checkpoint,
      transaction,
    })

    expect(parsePreparedTransactionEnvelope(envelope)).toEqual(envelope)
    expect(assertPreparedEnvelopeMatchesProfile(envelope, profile, profileSha256)).toEqual(envelope)
    expect(envelope.transactionSha256).toMatch(/^[0-9a-f]{64}$/u)
  })

  it('rejects unknown fields, transaction tampering, and a different profile file', () => {
    const transaction = preparedTransaction()
    const envelope = createPreparedTransactionEnvelope({
      profile,
      profileSha256,
      checkpoint,
      transaction,
    })

    expect(() => parsePreparedTransactionEnvelope({ ...envelope, extra: true })).toThrow(
      'unknown or missing fields',
    )
    expect(() =>
      parsePreparedTransactionEnvelope({
        ...envelope,
        transaction: { ...transaction, Amount: '2' },
      }),
    ).toThrow('digest does not match')
    expect(() => assertPreparedEnvelopeMatchesProfile(envelope, profile, '78'.repeat(32))).toThrow(
      'different network profile file',
    )
    expect(() =>
      parsePreparedTransactionEnvelope({
        ...envelope,
        checkpoint: { ...checkpoint, ledgerIndex: 99 },
      }),
    ).toThrow('context memo')
  })

  it('binds the activation anchor and rejects a conflicting same-index checkpoint', () => {
    const activationCheckpoint = {
      ...checkpoint,
      ledgerIndex: profile.activationLedgerIndex,
      ledgerHash: profile.activationLedgerHash,
    }
    const registration = buildSchemaRegistrationPayment({
      publisher: ACCOUNT,
      profile,
      schema,
    }).transaction
    const bound = bindPreparedTransactionContext({
      transaction: registration,
      profile,
      profileSha256,
      checkpoint: activationCheckpoint,
    })
    const envelope = createPreparedTransactionEnvelope({
      profile,
      profileSha256,
      checkpoint: activationCheckpoint,
      transaction: { ...bound, Fee: '12', Sequence: 1, LastLedgerSequence: 120 },
    })

    expect(() =>
      bindPreparedTransactionContext({
        transaction: registration,
        profile,
        profileSha256,
        checkpoint: { ...activationCheckpoint, ledgerHash: 'ef'.repeat(32) },
      }),
    ).toThrow('activation anchor')
    expect(() =>
      assertPreparedEnvelopeMatchesProfile(
        envelope,
        { ...profile, activationLedgerHash: 'ef'.repeat(32) },
        profileSha256,
      ),
    ).toThrow('activation anchor')
  })

  it('accepts only a signed blob that preserves every reviewed transaction field', () => {
    const transaction = preparedTransaction()
    const envelope = createPreparedTransactionEnvelope({
      profile,
      profileSha256,
      checkpoint,
      transaction,
    })
    const matchingBlob = TEST_WALLET.sign(transaction).tx_blob
    const changedBlob = TEST_WALLET.sign({ ...transaction, Amount: '2' }).tx_blob

    expect(assertSignedBlobMatchesPrepared(envelope, matchingBlob)).toMatchObject({
      txHash: expect.stringMatching(/^[0-9A-F]{64}$/u),
      lastLedgerSequence: 120,
    })
    expect(() => assertSignedBlobMatchesPrepared(envelope, changedBlob)).toThrow(
      'Signer changed transaction fields',
    )
  })

  it('rejects readiness from another profile or a regressed ledger view', () => {
    const transaction = preparedTransaction()
    const envelope = createPreparedTransactionEnvelope({
      profile,
      profileSha256,
      checkpoint,
      transaction,
    })

    expect(() =>
      assertReadinessAdvancesPreparedCheckpoint(envelope, {
        profileId: profile.profileId,
        status: 'ready',
        checkpoint: { ...checkpoint, ledgerIndex: 99 },
      }),
    ).toThrow('regressed')
    expect(() =>
      assertReadinessAdvancesPreparedCheckpoint(envelope, {
        profileId: profile.profileId,
        status: 'ready',
        checkpoint: { ...checkpoint, ledgerHash: '90'.repeat(32) },
      }),
    ).toThrow('regressed')
    expect(() =>
      assertReadinessAdvancesPreparedCheckpoint(envelope, {
        profileId: profile.profileId,
        status: 'ready',
        checkpoint: { ...checkpoint, transactionRoot: '90'.repeat(32) },
      }),
    ).toThrow('regressed')
    expect(() =>
      assertReadinessAdvancesPreparedCheckpoint(envelope, {
        profileId: 'another-profile',
        status: 'ready',
        checkpoint,
      }),
    ).toThrow('different network profile')

    expect(() =>
      assertReadinessAdvancesPreparedCheckpoint(envelope, {
        profileId: profile.profileId,
        status: 'ready',
        checkpoint: { ...checkpoint, ledgerIndex: 101, ledgerHash: '90'.repeat(32) },
      }),
    ).not.toThrow()
  })

  it('requires the exact successful readiness response shape', () => {
    const transaction = preparedTransaction()
    const envelope = createPreparedTransactionEnvelope({
      profile,
      profileSha256,
      checkpoint,
      transaction,
    })

    expect(() =>
      assertReadinessAdvancesPreparedCheckpoint(envelope, {
        profileId: profile.profileId,
        status: 'not_ready',
        checkpoint,
      }),
    ).toThrow('status must be ready')
    expect(() =>
      assertReadinessAdvancesPreparedCheckpoint(envelope, {
        profileId: profile.profileId,
        status: 'ready',
        checkpoint,
        cached: true,
      }),
    ).toThrow('unknown or missing fields')
  })
})
