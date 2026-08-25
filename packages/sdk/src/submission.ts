import { decode, hashes, type Client, type SubmittableTransaction } from 'xrpl'

import { XcsSdkError } from './errors.js'

export interface SignerResult {
  /** Uppercase or lowercase XRPL transaction hash. */
  readonly hash: string
  /** Fully signed XRPL binary transaction. */
  readonly txBlob: string
}

/**
 * Wallet integrations implement this interface. XCS deliberately has no seed-based signer.
 */
export interface Signer {
  sign(transaction: Readonly<SubmittableTransaction>): Promise<SignerResult>
}

export type SubmissionJournalStage =
  'prepared' | 'signed' | 'submitted' | 'validated' | 'expired' | 'pending' | 'failed'

export interface SubmissionJournalEntry {
  readonly operationId: string
  readonly at: string
  readonly stage: SubmissionJournalStage
  readonly txHash?: string | undefined
  readonly lastLedgerSequence?: number | undefined
  readonly engineResult?: string | undefined
  readonly ledgerIndex?: number | undefined
  readonly message?: string | undefined
}

export interface OperationJournal {
  append(entry: SubmissionJournalEntry): Promise<void>
}

export class MemoryOperationJournal implements OperationJournal {
  public readonly entries: SubmissionJournalEntry[] = []

  public async append(entry: SubmissionJournalEntry): Promise<void> {
    this.entries.push(entry)
  }
}

export interface PreparedTransaction<T extends SubmittableTransaction = SubmittableTransaction> {
  readonly transaction: T
  readonly lastLedgerSequence: number
}

export interface ValidatedSignature {
  /** Host-generated identifier shared with the operation journal. */
  readonly operationId: string
  /** The exact prepared transaction whose fields were compared with the signed blob. */
  readonly transaction: Readonly<SubmittableTransaction>
  readonly txBlob: string
  readonly txHash: string
  readonly lastLedgerSequence: number
}

export interface ReliableSubmissionOptions {
  readonly journal: OperationJournal
  readonly operationId?: string | undefined
  readonly failHard?: boolean | undefined
  readonly pollIntervalMs?: number | undefined
  readonly timeoutMs?: number | undefined
  /**
   * Runs after the signer hash/blob and exact transaction fields have been
   * validated, but before the first submission side effect. Hosts can use this
   * boundary to durably persist recovery material and repeat business guards.
   */
  readonly onValidatedSignature?:
    ((signature: ValidatedSignature) => void | Promise<void>) | undefined
}

export interface TransactionStatus {
  readonly status: 'validated' | 'pending' | 'expired' | 'not_found'
  readonly txHash: string
  readonly lastLedgerSequence?: number | undefined
  readonly ledgerIndex?: number | undefined
  readonly transactionResult?: string | undefined
}

export interface ReliableSubmissionResult extends TransactionStatus {
  readonly operationId: string
  readonly submitEngineResult?: string | undefined
}

const HASH_PATTERN = /^[0-9a-fA-F]{64}$/u
const BLOB_PATTERN = /^(?:[0-9a-fA-F]{2})+$/u
const XRPL_JS_5_MAX_URI_HEX_CHARACTERS = 256

export async function autofillXcsTransaction<T extends SubmittableTransaction>(
  client: Client,
  transaction: T,
): Promise<PreparedTransaction<T>> {
  if (!client.isConnected()) {
    throw new XcsSdkError(
      'XCS_SDK_CLIENT_NOT_CONNECTED',
      'Connect and validate the XRPL client before autofilling a transaction.',
    )
  }
  assertXrplJs5Compatibility(transaction)

  const prepared = await client.autofill(transaction)
  const lastLedgerSequence = prepared.LastLedgerSequence
  const sequence = prepared.Sequence
  if (
    typeof lastLedgerSequence !== 'number' ||
    !Number.isInteger(lastLedgerSequence) ||
    lastLedgerSequence <= 0 ||
    typeof sequence !== 'number' ||
    !Number.isInteger(sequence) ||
    sequence < 0 ||
    prepared.Fee === undefined
  ) {
    throw new XcsSdkError(
      'XCS_SDK_AUTOFILL_INCOMPLETE',
      'XRPL autofill did not provide Fee, Sequence, and LastLedgerSequence.',
    )
  }

  return {
    transaction: prepared,
    lastLedgerSequence,
  }
}

export async function prepareSignAndSubmit<T extends SubmittableTransaction>(
  client: Client,
  transaction: T,
  signer: Signer,
  options: ReliableSubmissionOptions,
): Promise<ReliableSubmissionResult> {
  const prepared = await autofillXcsTransaction(client, transaction)
  return signPreparedAndSubmit(client, prepared.transaction, signer, options)
}

/**
 * Signs an already-autofilled transaction after the user has reviewed its final
 * Fee, Sequence, and LastLedgerSequence. This is the browser-safe counterpart to
 * prepareSignAndSubmit when the UI must display the exact transaction first.
 */
export async function signPreparedAndSubmit<T extends SubmittableTransaction>(
  client: Client,
  transaction: T,
  signer: Signer,
  options: ReliableSubmissionOptions,
): Promise<ReliableSubmissionResult> {
  if (!client.isConnected()) {
    throw new XcsSdkError(
      'XCS_SDK_CLIENT_NOT_CONNECTED',
      'Connect and validate the XRPL client before signing a transaction.',
    )
  }
  assertXrplJs5Compatibility(transaction)
  const lastLedgerSequence = transaction.LastLedgerSequence
  const sequence = transaction.Sequence
  if (
    typeof lastLedgerSequence !== 'number' ||
    !Number.isInteger(lastLedgerSequence) ||
    lastLedgerSequence <= 0 ||
    typeof sequence !== 'number' ||
    !Number.isInteger(sequence) ||
    sequence < 0 ||
    transaction.Fee === undefined
  ) {
    throw new XcsSdkError(
      'XCS_SDK_AUTOFILL_INCOMPLETE',
      'Prepared transaction must contain Fee, Sequence, and LastLedgerSequence.',
    )
  }

  const operationId = options.operationId ?? crypto.randomUUID()
  await append(options.journal, {
    operationId,
    stage: 'prepared',
    lastLedgerSequence,
  })

  let signed: SignerResult
  let derivedHash: string
  try {
    signed = await signer.sign(transaction)
    assertSignerResult(signed)
    derivedHash = hashes.hashSignedTx(signed.txBlob).toUpperCase()
    if (derivedHash !== signed.hash.toUpperCase()) {
      throw new XcsSdkError(
        'XCS_SDK_INVALID_SIGNER_RESULT',
        'Signer transaction hash does not match the signed transaction blob.',
      )
    }
    assertSignedTransactionMatches(transaction, signed.txBlob)
    await options.onValidatedSignature?.({
      operationId,
      transaction,
      txBlob: signed.txBlob,
      txHash: derivedHash,
      lastLedgerSequence,
    })
  } catch (error) {
    await append(options.journal, {
      operationId,
      stage: 'failed',
      lastLedgerSequence,
      message: 'Wallet signing or pre-submission validation failed.',
    })
    throw error
  }

  return submitSignedTransaction(client, signed.txBlob, {
    ...options,
    operationId,
  })
}

export async function submitSignedTransaction(
  client: Client,
  txBlob: string,
  options: ReliableSubmissionOptions,
): Promise<ReliableSubmissionResult> {
  if (!client.isConnected()) {
    throw new XcsSdkError(
      'XCS_SDK_CLIENT_NOT_CONNECTED',
      'Connect and validate the XRPL client before submitting a transaction.',
    )
  }
  if (!BLOB_PATTERN.test(txBlob)) {
    throw new XcsSdkError(
      'XCS_SDK_INVALID_SIGNED_BLOB',
      'Signed transaction input must be non-empty hexadecimal data.',
    )
  }

  const operationId = options.operationId ?? crypto.randomUUID()
  let decoded: Record<string, unknown>
  let txHash: string
  try {
    decoded = decode(txBlob)
    txHash = hashes.hashSignedTx(txBlob).toUpperCase()
  } catch {
    throw new XcsSdkError('XCS_SDK_INVALID_SIGNED_BLOB', 'Cannot decode signed transaction.')
  }

  const lastLedgerSequence = asPositiveInteger(decoded.LastLedgerSequence)
  if (lastLedgerSequence === undefined) {
    throw new XcsSdkError(
      'XCS_SDK_INVALID_SIGNED_BLOB',
      'Reliable submission requires a signed transaction with LastLedgerSequence.',
    )
  }

  // Persist the recovery identifiers before the first network side effect.
  await append(options.journal, {
    operationId,
    stage: 'signed',
    txHash,
    lastLedgerSequence,
  })

  let submitEngineResult: string | undefined
  try {
    const response = await client.submit(txBlob, {
      autofill: false,
      failHard: options.failHard ?? false,
    })
    submitEngineResult = readString(response.result, 'engine_result')
    await append(options.journal, {
      operationId,
      stage: 'submitted',
      txHash,
      lastLedgerSequence,
      engineResult: submitEngineResult,
    })
    if (submitEngineResult?.startsWith('tem') === true) {
      await append(options.journal, {
        operationId,
        stage: 'failed',
        txHash,
        lastLedgerSequence,
        engineResult: submitEngineResult,
        message: 'rippled rejected the malformed transaction before relay.',
      })
      return {
        operationId,
        status: 'not_found',
        txHash,
        lastLedgerSequence,
        submitEngineResult,
      }
    }
  } catch {
    // Submission acknowledgement can be lost after rippled accepted the blob. Reconcile by hash.
    await append(options.journal, {
      operationId,
      stage: 'pending',
      txHash,
      lastLedgerSequence,
      message: 'Submission acknowledgement unavailable; reconciling by transaction hash.',
    })
  }

  const status = await waitForTransaction(client, txHash, lastLedgerSequence, options)
  await append(options.journal, {
    operationId,
    stage: status.status === 'not_found' ? 'pending' : status.status,
    txHash,
    lastLedgerSequence,
    ledgerIndex: status.ledgerIndex,
    engineResult: status.transactionResult,
  })

  return { ...status, operationId, submitEngineResult }
}

export async function getTransactionStatus(
  client: Client,
  txHash: string,
  lastLedgerSequence?: number,
): Promise<TransactionStatus> {
  if (!HASH_PATTERN.test(txHash)) {
    throw new XcsSdkError(
      'XCS_SDK_SUBMISSION_FAILED',
      'Transaction hash must be 64 hex characters.',
    )
  }

  try {
    const response = await client.request({
      command: 'tx',
      transaction: txHash.toUpperCase(),
      binary: false,
    })
    const result = response.result as unknown as Record<string, unknown>
    if (result.validated === true) {
      return {
        status: 'validated',
        txHash: txHash.toUpperCase(),
        lastLedgerSequence,
        ledgerIndex: asPositiveInteger(result.ledger_index),
        transactionResult: readTransactionResult(result.meta),
      }
    }

    return { status: 'pending', txHash: txHash.toUpperCase(), lastLedgerSequence }
  } catch (error) {
    if (!isTransactionNotFound(error)) {
      throw error
    }
  }

  if (lastLedgerSequence !== undefined) {
    const currentLedger = await getCurrentLedgerIndex(client)
    if (currentLedger > lastLedgerSequence) {
      return {
        status: 'expired',
        txHash: txHash.toUpperCase(),
        lastLedgerSequence,
      }
    }
  }

  return { status: 'not_found', txHash: txHash.toUpperCase(), lastLedgerSequence }
}

async function waitForTransaction(
  client: Client,
  txHash: string,
  lastLedgerSequence: number,
  options: ReliableSubmissionOptions,
): Promise<TransactionStatus> {
  const timeoutMs = options.timeoutMs ?? 60_000
  const pollIntervalMs = options.pollIntervalMs ?? 1_000
  const deadline = Date.now() + timeoutMs

  do {
    const status = await getTransactionStatus(client, txHash, lastLedgerSequence)
    if (status.status === 'validated' || status.status === 'expired') {
      return status
    }
    if (Date.now() >= deadline) {
      return { ...status, status: status.status === 'not_found' ? 'pending' : status.status }
    }
    await delay(pollIntervalMs)
  } while (true)
}

async function getCurrentLedgerIndex(client: Client): Promise<number> {
  const response = await client.request({ command: 'ledger_current' })
  return response.result.ledger_current_index
}

async function append(
  journal: OperationJournal,
  entry: Omit<SubmissionJournalEntry, 'at'>,
): Promise<void> {
  const materialized: SubmissionJournalEntry = { ...entry, at: new Date().toISOString() }
  await journal.append(materialized)
}

function assertSignerResult(result: SignerResult): void {
  if (!HASH_PATTERN.test(result.hash) || !BLOB_PATTERN.test(result.txBlob)) {
    throw new XcsSdkError(
      'XCS_SDK_INVALID_SIGNER_RESULT',
      'Signer must return a 64-character transaction hash and a signed hexadecimal blob.',
    )
  }
}

function assertSignedTransactionMatches(
  prepared: Readonly<SubmittableTransaction>,
  txBlob: string,
): void {
  const signed = decode(txBlob)
  const preparedFields = withoutSignatureFields(prepared as unknown as Record<string, unknown>)
  const signedFields = withoutSignatureFields(signed)
  if (stableJson(preparedFields) !== stableJson(signedFields)) {
    throw new XcsSdkError(
      'XCS_SDK_INVALID_SIGNER_RESULT',
      'Signer changed transaction fields other than the XRPL signature fields.',
    )
  }
}

function assertXrplJs5Compatibility(transaction: Readonly<SubmittableTransaction>): void {
  if (
    transaction.TransactionType === 'CredentialCreate' &&
    typeof transaction.URI === 'string' &&
    transaction.URI.length > XRPL_JS_5_MAX_URI_HEX_CHARACTERS
  ) {
    throw new XcsSdkError(
      'XCS_SDK_INVALID_URI',
      'xrpl.js 5.0.0 submission supports at most 128 URI bytes; use a shorter HTTPS URL or an IPFS CID.',
      {
        byteLength: transaction.URI.length / 2,
        protocolMaxByteLength: 256,
        xrplJsMaxByteLength: 128,
      },
    )
  }
}

function withoutSignatureFields(input: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const result = { ...input }
  delete result.Signers
  delete result.SigningPubKey
  delete result.TxnSignature
  return result
}

function stableJson(input: unknown): string {
  if (Array.isArray(input)) return `[${input.map(stableJson).join(',')}]`
  if (typeof input === 'object' && input !== null) {
    const record = input as Record<string, unknown>
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(input) ?? 'null'
}

function asPositiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}

function readString(input: unknown, key: string): string | undefined {
  if (typeof input !== 'object' || input === null) return undefined
  const value = (input as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : undefined
}

function readTransactionResult(meta: unknown): string | undefined {
  if (typeof meta === 'string') return undefined
  return readString(meta, 'TransactionResult')
}

function isTransactionNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const record = error as Record<string, unknown>
  if (record.data && typeof record.data === 'object') {
    const data = record.data as Record<string, unknown>
    if (data.error === 'txnNotFound') return true
  }
  return readString(error, 'message')?.includes('txnNotFound') === true
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
