import {
  canonicalize,
  encodeUtf8Hex,
  sha256Hex,
  type JsonValue,
  type NetworkProfile,
} from '@xcs-protocol/core'
import { hashes, validate, type Memo, type SubmittableTransaction } from 'xrpl'

import { assertTransactionMemosFit } from './encoding.js'
import { XcsSdkError } from './errors.js'
import { parseNetworkProfile } from './network.js'
import { assertSignedTransactionMatches } from './submission.js'
import { assertXcsTransactionSemantics } from './transaction-validation.js'

export const PREPARED_TRANSACTION_FORMAT = 'xcs-prepared-transaction/1' as const
export const XCS_PREPARED_CONTEXT_MEMO_TYPE = 'xcs:prepared' as const

const HASH = /^[0-9a-f]{64}$/u
const PROFILE_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/u
const SUPPORTED_TRANSACTION_TYPES = new Set([
  'Payment',
  'CredentialCreate',
  'CredentialAccept',
  'CredentialDelete',
])

export interface AuthoritativeCheckpoint {
  readonly ledgerIndex: number
  readonly ledgerHash: string
  readonly closeTime: number
  readonly transactionRoot: string
}

export interface AuthoritativeReadiness {
  readonly profileId: string
  readonly status: 'ready'
  readonly checkpoint: AuthoritativeCheckpoint
}

export interface PreparedXcsTransactionEnvelope {
  readonly format: typeof PREPARED_TRANSACTION_FORMAT
  readonly profileId: string
  /** SHA-256 of the exact profile file bytes reviewed by the operator. */
  readonly profileSha256: string
  readonly checkpoint: AuthoritativeCheckpoint
  readonly transaction: SubmittableTransaction
  readonly transactionSha256: string
}

export interface ValidatedPreparedBlob {
  readonly txHash: string
  readonly lastLedgerSequence: number
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new XcsSdkError('XCS_SDK_PREPARED_INVALID', `${label} must be an object.`)
  }
  return value as Record<string, unknown>
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const expectedKeys = new Set(expected)
  if (
    Object.keys(value).length !== expectedKeys.size ||
    Object.keys(value).some((key) => !expectedKeys.has(key))
  ) {
    throw new XcsSdkError('XCS_SDK_PREPARED_INVALID', `${label} has unknown or missing fields.`)
  }
}

function uint32(value: unknown, label: string, positive = false): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < (positive ? 1 : 0) ||
    value > 0xffff_ffff
  ) {
    throw new XcsSdkError(
      'XCS_SDK_PREPARED_INVALID',
      `${label} must be ${positive ? 'a positive' : 'a'} uint32.`,
    )
  }
  return value
}

function lowercaseHash(value: unknown, label: string): string {
  if (typeof value !== 'string' || !HASH.test(value)) {
    throw new XcsSdkError(
      'XCS_SDK_PREPARED_INVALID',
      `${label} must be lowercase 32-byte hexadecimal.`,
    )
  }
  return value
}

function transactionDigest(transaction: SubmittableTransaction): string {
  try {
    return sha256Hex(new TextEncoder().encode(canonicalize(transaction as unknown as JsonValue)))
  } catch (cause) {
    throw new XcsSdkError(
      'XCS_SDK_PREPARED_INVALID',
      'Prepared transaction must contain only canonical JSON values.',
      { cause: cause instanceof Error ? cause.message : String(cause) },
    )
  }
}

function preparedContextDigest(input: {
  readonly profileId: string
  readonly profileSha256: string
  readonly checkpoint: AuthoritativeCheckpoint
}): string {
  return sha256Hex(
    new TextEncoder().encode(
      canonicalize({
        purpose: 'xcs.prepared.context',
        version: '1',
        profileId: input.profileId,
        profileSha256: input.profileSha256,
        checkpoint: input.checkpoint,
      } as unknown as JsonValue),
    ),
  )
}

function contextMemoDigest(
  profileId: string,
  profileSha256: string,
  value: AuthoritativeCheckpoint,
): string {
  return preparedContextDigest({ profileId, profileSha256, checkpoint: value }).toUpperCase()
}

function transactionMemos(transaction: Readonly<SubmittableTransaction>): readonly Memo[] {
  const memos = (transaction as Readonly<Record<string, unknown>>).Memos
  if (memos === undefined) return []
  if (!Array.isArray(memos)) {
    throw new XcsSdkError('XCS_SDK_PREPARED_INVALID', 'transaction.Memos must be an array.')
  }
  return memos as readonly Memo[]
}

function assertPreparedContextMemo(
  transaction: Readonly<SubmittableTransaction>,
  profileId: string,
  profileSha256: string,
  value: AuthoritativeCheckpoint,
): void {
  const memoType = encodeUtf8Hex(XCS_PREPARED_CONTEXT_MEMO_TYPE)
  const matching = transactionMemos(transaction).filter(
    (entry) => entry?.Memo?.MemoType?.toUpperCase() === memoType,
  )
  if (matching.length !== 1) {
    throw new XcsSdkError(
      'XCS_SDK_PREPARED_INVALID',
      'Prepared transaction must contain exactly one signed XCS context memo.',
    )
  }
  const outer = matching[0] as unknown as Record<string, unknown>
  const memo = record(outer.Memo, 'XCS prepared context memo')
  exactKeys(memo, ['MemoType', 'MemoData'], 'XCS prepared context memo')
  if (
    memo.MemoType !== memoType ||
    memo.MemoData !== contextMemoDigest(profileId, profileSha256, value)
  ) {
    throw new XcsSdkError(
      'XCS_SDK_PREPARED_INVALID',
      'Signed XCS context memo does not match the prepared profile and checkpoint.',
    )
  }
  assertTransactionMemosFit(transactionMemos(transaction))
}

function preparedTransaction(value: unknown): SubmittableTransaction {
  const transaction = record(value, 'transaction')
  if (
    typeof transaction.TransactionType !== 'string' ||
    !SUPPORTED_TRANSACTION_TYPES.has(transaction.TransactionType)
  ) {
    throw new XcsSdkError(
      'XCS_SDK_PREPARED_INVALID',
      'Prepared transaction is not an XCS transaction type.',
    )
  }
  if (
    Object.hasOwn(transaction, 'TxnSignature') ||
    Object.hasOwn(transaction, 'Signers') ||
    (Object.hasOwn(transaction, 'SigningPubKey') && transaction.SigningPubKey !== '')
  ) {
    throw new XcsSdkError(
      'XCS_SDK_PREPARED_INVALID',
      'Prepared transaction must not contain XRPL signatures.',
    )
  }
  try {
    validate(transaction)
  } catch (cause) {
    throw new XcsSdkError(
      'XCS_SDK_PREPARED_INVALID',
      'Prepared transaction is not valid XRPL transaction JSON.',
      { cause: cause instanceof Error ? cause.message : 'XRPL validation failed.' },
    )
  }
  uint32(transaction.Sequence, 'transaction.Sequence')
  uint32(transaction.LastLedgerSequence, 'transaction.LastLedgerSequence', true)
  if (
    (typeof transaction.Fee !== 'string' && typeof transaction.Fee !== 'number') ||
    String(transaction.Fee).length === 0
  ) {
    throw new XcsSdkError(
      'XCS_SDK_PREPARED_INVALID',
      'Prepared transaction must contain an autofilled Fee.',
    )
  }
  return transaction as unknown as SubmittableTransaction
}

function checkpoint(value: unknown): AuthoritativeCheckpoint {
  const candidate = record(value, 'checkpoint')
  exactKeys(candidate, ['ledgerIndex', 'ledgerHash', 'closeTime', 'transactionRoot'], 'checkpoint')
  return {
    ledgerIndex: uint32(candidate.ledgerIndex, 'checkpoint.ledgerIndex'),
    ledgerHash: lowercaseHash(candidate.ledgerHash, 'checkpoint.ledgerHash'),
    closeTime: uint32(candidate.closeTime, 'checkpoint.closeTime'),
    transactionRoot: lowercaseHash(candidate.transactionRoot, 'checkpoint.transactionRoot'),
  }
}

function assertCheckpointCompatibleWithProfile(
  value: AuthoritativeCheckpoint,
  profile: NetworkProfile,
  code: 'XCS_SDK_PREPARED_INVALID' | 'XCS_SDK_PREPARED_PROFILE_MISMATCH',
): void {
  if (
    value.ledgerIndex < profile.activationLedgerIndex ||
    (value.ledgerIndex === profile.activationLedgerIndex &&
      value.ledgerHash !== profile.activationLedgerHash)
  ) {
    throw new XcsSdkError(
      code,
      'Prepared checkpoint is incompatible with the network profile activation anchor.',
    )
  }
}

export function parseAuthoritativeReadiness(input: unknown): AuthoritativeReadiness {
  const readiness = record(input, 'authoritative readiness')
  exactKeys(readiness, ['profileId', 'status', 'checkpoint'], 'authoritative readiness')
  if (typeof readiness.profileId !== 'string' || !PROFILE_ID.test(readiness.profileId)) {
    throw new XcsSdkError('XCS_SDK_PREPARED_INVALID', 'Readiness profileId is invalid.')
  }
  if (readiness.status !== 'ready') {
    throw new XcsSdkError(
      'XCS_SDK_PREPARED_INVALID',
      'Authoritative readiness status must be ready.',
    )
  }
  return {
    profileId: readiness.profileId,
    status: 'ready',
    checkpoint: checkpoint(readiness.checkpoint),
  }
}

export function createPreparedTransactionEnvelope(input: {
  readonly profile: NetworkProfile
  readonly profileSha256: string
  readonly checkpoint: AuthoritativeCheckpoint
  readonly transaction: SubmittableTransaction
}): PreparedXcsTransactionEnvelope {
  const profile = parseNetworkProfile(input.profile)
  const profileSha256 = lowercaseHash(input.profileSha256, 'profileSha256')
  const validatedCheckpoint = checkpoint(input.checkpoint)
  assertCheckpointCompatibleWithProfile(validatedCheckpoint, profile, 'XCS_SDK_PREPARED_INVALID')
  const transaction = preparedTransaction(input.transaction)
  assertXcsTransactionSemantics(transaction, profile)
  if ((transaction.LastLedgerSequence as number) < validatedCheckpoint.ledgerIndex) {
    throw new XcsSdkError(
      'XCS_SDK_PREPARED_INVALID',
      'Prepared transaction ledger window already precedes its authoritative checkpoint.',
    )
  }
  assertPreparedContextMemo(transaction, profile.profileId, profileSha256, validatedCheckpoint)
  return {
    format: PREPARED_TRANSACTION_FORMAT,
    profileId: profile.profileId,
    profileSha256,
    checkpoint: validatedCheckpoint,
    transaction,
    transactionSha256: transactionDigest(transaction),
  }
}

export function parsePreparedTransactionEnvelope(input: unknown): PreparedXcsTransactionEnvelope {
  const envelope = record(input, 'prepared transaction envelope')
  exactKeys(
    envelope,
    ['format', 'profileId', 'profileSha256', 'checkpoint', 'transaction', 'transactionSha256'],
    'prepared transaction envelope',
  )
  if (envelope.format !== PREPARED_TRANSACTION_FORMAT) {
    throw new XcsSdkError(
      'XCS_SDK_PREPARED_INVALID',
      `Prepared transaction format must be ${PREPARED_TRANSACTION_FORMAT}.`,
    )
  }
  if (typeof envelope.profileId !== 'string' || !PROFILE_ID.test(envelope.profileId)) {
    throw new XcsSdkError('XCS_SDK_PREPARED_INVALID', 'profileId is invalid.')
  }
  const profileSha256 = lowercaseHash(envelope.profileSha256, 'profileSha256')
  const validatedCheckpoint = checkpoint(envelope.checkpoint)
  const transaction = preparedTransaction(envelope.transaction)
  if ((transaction.LastLedgerSequence as number) < validatedCheckpoint.ledgerIndex) {
    throw new XcsSdkError(
      'XCS_SDK_PREPARED_INVALID',
      'Prepared transaction ledger window already precedes its authoritative checkpoint.',
    )
  }
  assertPreparedContextMemo(transaction, envelope.profileId, profileSha256, validatedCheckpoint)
  const expectedDigest = transactionDigest(transaction)
  if (lowercaseHash(envelope.transactionSha256, 'transactionSha256') !== expectedDigest) {
    throw new XcsSdkError(
      'XCS_SDK_PREPARED_INVALID',
      'Prepared transaction digest does not match its transaction.',
    )
  }
  return {
    format: PREPARED_TRANSACTION_FORMAT,
    profileId: envelope.profileId,
    profileSha256,
    checkpoint: validatedCheckpoint,
    transaction,
    transactionSha256: expectedDigest,
  }
}

export function assertPreparedEnvelopeMatchesProfile(
  envelopeInput: unknown,
  profileInput: unknown,
  profileSha256: string,
): PreparedXcsTransactionEnvelope {
  const envelope = parsePreparedTransactionEnvelope(envelopeInput)
  const profile = parseNetworkProfile(profileInput)
  if (
    envelope.profileId !== profile.profileId ||
    envelope.profileSha256 !== lowercaseHash(profileSha256, 'profileSha256')
  ) {
    throw new XcsSdkError(
      'XCS_SDK_PREPARED_PROFILE_MISMATCH',
      'Prepared transaction is bound to a different network profile file.',
    )
  }
  assertCheckpointCompatibleWithProfile(
    envelope.checkpoint,
    profile,
    'XCS_SDK_PREPARED_PROFILE_MISMATCH',
  )
  assertXcsTransactionSemantics(envelope.transaction, profile)
  return envelope
}

/**
 * Add the context commitment before autofill, so the wallet signature protects
 * the exact profile bytes and authoritative checkpoint reviewed offline.
 */
export function bindPreparedTransactionContext<T extends SubmittableTransaction>(input: {
  readonly transaction: T
  readonly profile: NetworkProfile
  readonly profileSha256: string
  readonly checkpoint: AuthoritativeCheckpoint
}): T {
  const profile = parseNetworkProfile(input.profile)
  const profileSha256 = lowercaseHash(input.profileSha256, 'profileSha256')
  const validatedCheckpoint = checkpoint(input.checkpoint)
  assertCheckpointCompatibleWithProfile(validatedCheckpoint, profile, 'XCS_SDK_PREPARED_INVALID')
  assertXcsTransactionSemantics(input.transaction, profile)
  const existing = transactionMemos(input.transaction)
  const memoType = encodeUtf8Hex(XCS_PREPARED_CONTEXT_MEMO_TYPE)
  if (existing.some((entry) => entry?.Memo?.MemoType?.toUpperCase() === memoType)) {
    throw new XcsSdkError(
      'XCS_SDK_PREPARED_INVALID',
      'Transaction already contains an XCS prepared context memo.',
    )
  }
  const memos: Memo[] = [
    ...existing,
    {
      Memo: {
        MemoType: memoType,
        MemoData: contextMemoDigest(profile.profileId, profileSha256, validatedCheckpoint),
      },
    },
  ]
  assertTransactionMemosFit(memos)
  return { ...input.transaction, Memos: memos } as T
}

export function assertSignedBlobMatchesPrepared(
  envelopeInput: unknown,
  txBlob: string,
): ValidatedPreparedBlob {
  const envelope = parsePreparedTransactionEnvelope(envelopeInput)
  assertSignedTransactionMatches(envelope.transaction, txBlob)
  let txHash: string
  try {
    txHash = hashes.hashSignedTx(txBlob).toUpperCase()
  } catch {
    throw new XcsSdkError('XCS_SDK_INVALID_SIGNED_BLOB', 'Cannot hash signed transaction.')
  }
  return {
    txHash,
    lastLedgerSequence: envelope.transaction.LastLedgerSequence as number,
  }
}

export function assertReadinessAdvancesPreparedCheckpoint(
  envelopeInput: unknown,
  readinessInput: unknown,
): void {
  const envelope = parsePreparedTransactionEnvelope(envelopeInput)
  const readiness = parseAuthoritativeReadiness(readinessInput)
  const current = readiness.checkpoint
  if (readiness.profileId !== envelope.profileId) {
    throw new XcsSdkError(
      'XCS_SDK_PREPARED_PROFILE_MISMATCH',
      'Readiness belongs to a different network profile.',
    )
  }
  if (
    current.ledgerIndex < envelope.checkpoint.ledgerIndex ||
    (current.ledgerIndex === envelope.checkpoint.ledgerIndex &&
      (current.ledgerHash !== envelope.checkpoint.ledgerHash ||
        current.closeTime !== envelope.checkpoint.closeTime ||
        current.transactionRoot !== envelope.checkpoint.transactionRoot))
  ) {
    throw new XcsSdkError(
      'XCS_SDK_PREPARED_READINESS_REGRESSION',
      'Authoritative readiness regressed from the transaction preparation checkpoint.',
    )
  }
}
