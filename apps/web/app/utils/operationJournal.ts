import type {
  OperationJournal,
  SubmissionJournalEntry,
  SubmissionJournalStage,
} from '@xcs-protocol/sdk'
import { isClassicAddress } from '@xcs-protocol/core'

const DATABASE_NAME = 'xcs-wallet-journal'
const DATABASE_VERSION = 1
const OPERATIONS_STORE = 'operations'

export type BusinessConfirmation = 'pending' | 'confirmed' | 'mismatch' | 'timeout'

export interface OperationSeed {
  readonly operationId: string
  readonly account: string
  readonly profileId: string
  readonly networkId: number
  readonly transactionType: string
  readonly createdAt: string
  readonly business?: OperationBusinessContext | undefined
}

export type OperationBusinessContext =
  | { readonly action: 'schema-register' }
  | {
      readonly action: 'credential-issue'
      readonly issuer: string
      readonly subject: string
      readonly schemaUid: string
      readonly payloadDigestHex?: string | undefined
    }
  | {
      readonly action: 'credential-accept' | 'credential-reject' | 'credential-revoke'
      readonly issuer: string
      readonly subject: string
      readonly schemaUid: string
      /** Exact ledger generation reviewed before this tuple-only native action. */
      readonly generationId: string
      readonly payloadDigestHex?: string | undefined
    }

export interface StoredOperation extends OperationSeed {
  readonly updatedAt: string
  readonly stage: SubmissionJournalStage
  readonly txHash?: string | undefined
  readonly txBlob?: string | undefined
  readonly lastLedgerSequence?: number | undefined
  readonly engineResult?: string | undefined
  readonly ledgerIndex?: number | undefined
  readonly message?: string | undefined
  readonly businessConfirmation?: BusinessConfirmation | undefined
}

export interface SignedOperationRecord {
  readonly operationId: string
  readonly txBlob: string
  readonly txHash: string
  readonly lastLedgerSequence: number
  readonly at: string
}

export interface OperationReceipt {
  readonly receiptVersion: '0.1'
  readonly operationId: string
  readonly account: string
  readonly profileId: string
  readonly networkId: number
  readonly transactionType: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly stage: SubmissionJournalStage
  readonly business?: OperationBusinessContext | undefined
  readonly txHash?: string | undefined
  readonly lastLedgerSequence?: number | undefined
  readonly engineResult?: string | undefined
  readonly ledgerIndex?: number | undefined
  readonly businessConfirmation?: BusinessConfirmation | undefined
}

const CREDENTIAL_ACTIONS = new Set([
  'credential-issue',
  'credential-accept',
  'credential-reject',
  'credential-revoke',
])
const TRANSACTION_HASH = /^[0-9a-f]{64}$/i

export function validateOperationBusinessContext(input: unknown): OperationBusinessContext {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('OPERATION_BUSINESS_CONTEXT_INVALID')
  }
  const candidate = input as Record<string, unknown>
  const action = candidate.action
  if (action === 'schema-register') return { action }
  if (typeof action !== 'string' || !CREDENTIAL_ACTIONS.has(action)) {
    throw new Error('OPERATION_ACTION_INVALID')
  }
  if (typeof candidate.issuer !== 'string' || typeof candidate.subject !== 'string') {
    throw new Error('OPERATION_CREDENTIAL_ADDRESS_INVALID')
  }
  if (!isClassicAddress(candidate.issuer) || !isClassicAddress(candidate.subject)) {
    throw new Error('OPERATION_CREDENTIAL_ADDRESS_INVALID')
  }
  if (typeof candidate.schemaUid !== 'string') throw new Error('OPERATION_SCHEMA_UID_INVALID')
  const schemaUid = candidate.schemaUid.toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(schemaUid)) throw new Error('OPERATION_SCHEMA_UID_INVALID')
  if (
    candidate.payloadDigestHex !== undefined &&
    (typeof candidate.payloadDigestHex !== 'string' ||
      !/^[0-9a-f]{64}$/i.test(candidate.payloadDigestHex))
  ) {
    throw new Error('OPERATION_PAYLOAD_DIGEST_INVALID')
  }
  const payloadDigestHex =
    typeof candidate.payloadDigestHex === 'string'
      ? candidate.payloadDigestHex.toLowerCase()
      : undefined
  const generationId =
    typeof candidate.generationId === 'string' ? candidate.generationId.toLowerCase() : undefined
  if (
    action !== 'credential-issue' &&
    (generationId === undefined || !/^[0-9a-f]{64}$/.test(generationId))
  ) {
    throw new Error('OPERATION_GENERATION_ID_INVALID')
  }
  if (action === 'credential-issue') {
    return {
      action,
      issuer: candidate.issuer,
      subject: candidate.subject,
      schemaUid,
      ...(payloadDigestHex ? { payloadDigestHex } : {}),
    }
  }
  return {
    action: action as 'credential-accept' | 'credential-reject' | 'credential-revoke',
    issuer: candidate.issuer,
    subject: candidate.subject,
    schemaUid,
    generationId: generationId!,
    ...(payloadDigestHex ? { payloadDigestHex } : {}),
  }
}

export function isGenerationBoundBusinessContext(
  input: OperationBusinessContext | undefined,
): input is Extract<
  OperationBusinessContext,
  { readonly action: 'credential-accept' | 'credential-reject' | 'credential-revoke' }
> {
  return (
    input?.action === 'credential-accept' ||
    input?.action === 'credential-reject' ||
    input?.action === 'credential-revoke'
  )
}

function sanitizeOperationBusinessContext(input: unknown): OperationBusinessContext | undefined {
  try {
    return validateOperationBusinessContext(input)
  } catch {
    return undefined
  }
}

function sanitizeBusinessConfirmation(input: unknown): BusinessConfirmation | undefined {
  return input === 'pending' || input === 'confirmed' || input === 'mismatch' || input === 'timeout'
    ? input
    : undefined
}

export function operationBusinessConfirmation(
  operation: StoredOperation,
): BusinessConfirmation | undefined {
  const business = sanitizeOperationBusinessContext(operation.business)
  if (!isGenerationBoundBusinessContext(business)) return undefined
  const confirmation = sanitizeBusinessConfirmation(operation.businessConfirmation) ?? 'pending'
  if (
    confirmation !== 'pending' &&
    (operation.stage !== 'validated' || operation.engineResult !== 'tesSUCCESS')
  ) {
    return 'pending'
  }
  return confirmation
}

/** Creates a portable receipt without signed blobs, payloads, claims or free-form messages. */
export function toSanitizedOperationReceipt(operation: StoredOperation): OperationReceipt {
  const business = sanitizeOperationBusinessContext(operation.business)
  const businessConfirmation = operationBusinessConfirmation(operation)
  return {
    receiptVersion: '0.1',
    operationId: operation.operationId,
    account: operation.account,
    profileId: operation.profileId,
    networkId: operation.networkId,
    transactionType: operation.transactionType,
    createdAt: operation.createdAt,
    updatedAt: operation.updatedAt,
    stage: operation.stage,
    ...(business ? { business } : {}),
    ...(businessConfirmation ? { businessConfirmation } : {}),
    ...(operation.txHash ? { txHash: operation.txHash } : {}),
    ...(operation.lastLedgerSequence !== undefined
      ? { lastLedgerSequence: operation.lastLedgerSequence }
      : {}),
    ...(operation.engineResult ? { engineResult: operation.engineResult } : {}),
    ...(operation.ledgerIndex !== undefined ? { ledgerIndex: operation.ledgerIndex } : {}),
  }
}

export function serializeOperationReceipts(
  operations: readonly StoredOperation[],
  exportedAt: string = new Date().toISOString(),
): string {
  return JSON.stringify(
    {
      receiptExportVersion: '0.1',
      exportedAt,
      receipts: operations.map(toSanitizedOperationReceipt),
    },
    null,
    2,
  )
}

export function applyJournalEntry(
  operation: StoredOperation,
  entry: SubmissionJournalEntry,
): StoredOperation {
  if (['validated', 'expired', 'failed'].includes(operation.stage)) return operation
  const terminal = ['validated', 'expired', 'failed'].includes(entry.stage)
  return {
    ...operation,
    updatedAt: entry.at,
    stage: entry.stage,
    txHash: entry.txHash ?? operation.txHash,
    txBlob: terminal ? undefined : operation.txBlob,
    lastLedgerSequence: entry.lastLedgerSequence ?? operation.lastLedgerSequence,
    engineResult: entry.engineResult ?? operation.engineResult,
    ledgerIndex: entry.ledgerIndex ?? operation.ledgerIndex,
    message: entry.message,
  }
}

export function canRetryOperation(operation: StoredOperation): boolean {
  const hasRecoveryMaterial =
    typeof operation.txBlob === 'string' &&
    operation.txBlob.length > 0 &&
    ['signed', 'submitted', 'pending'].includes(operation.stage)
  if (!hasRecoveryMaterial) return false
  if (!['CredentialAccept', 'CredentialDelete'].includes(operation.transactionType)) return true
  try {
    return isGenerationBoundBusinessContext(
      operation.business ? validateOperationBusinessContext(operation.business) : undefined,
    )
  } catch {
    return false
  }
}

export function canReconfirmOperation(operation: StoredOperation): boolean {
  if (
    operation.stage !== 'validated' ||
    operation.engineResult !== 'tesSUCCESS' ||
    typeof operation.txHash !== 'string' ||
    !TRANSACTION_HASH.test(operation.txHash)
  ) {
    return false
  }
  const confirmation = operationBusinessConfirmation(operation)
  if (!confirmation || confirmation === 'confirmed') return false
  try {
    const business = operation.business
      ? validateOperationBusinessContext(operation.business)
      : undefined
    if (!isGenerationBoundBusinessContext(business)) return false
    if (business.action === 'credential-accept') {
      return (
        operation.transactionType === 'CredentialAccept' && operation.account === business.subject
      )
    }
    if (business.action === 'credential-reject') {
      return (
        operation.transactionType === 'CredentialDelete' && operation.account === business.subject
      )
    }
    return operation.transactionType === 'CredentialDelete' && operation.account === business.issuer
  } catch {
    return false
  }
}

export class IndexedDbOperationJournal implements OperationJournal {
  readonly #factory: IDBFactory
  #databasePromise: Promise<IDBDatabase> | undefined

  public constructor(factory: IDBFactory = globalThis.indexedDB) {
    if (!factory) throw new Error('INDEXED_DB_UNAVAILABLE')
    this.#factory = factory
  }

  public async create(seed: OperationSeed): Promise<void> {
    await this.#mutate(seed.operationId, (existing) => {
      if (existing) throw new Error('OPERATION_ID_ALREADY_EXISTS')
      return {
        ...seed,
        updatedAt: seed.createdAt,
        stage: 'prepared',
        ...(isGenerationBoundBusinessContext(seed.business)
          ? { businessConfirmation: 'pending' as const }
          : {}),
      }
    })
  }

  public async persistSigned(record: SignedOperationRecord): Promise<void> {
    await this.#mutate(record.operationId, (existing) => {
      if (!existing) throw new Error('OPERATION_NOT_FOUND')
      return {
        ...existing,
        updatedAt: record.at,
        stage: 'signed',
        txHash: record.txHash,
        txBlob: record.txBlob,
        lastLedgerSequence: record.lastLedgerSequence,
        message: undefined,
      }
    })
  }

  public async setBusinessConfirmation(
    operationId: string,
    confirmation: Exclude<BusinessConfirmation, 'pending'>,
    at: string,
  ): Promise<void> {
    await this.#mutate(operationId, (existing) => {
      if (!existing) throw new Error('OPERATION_NOT_FOUND')
      const business = existing.business
        ? validateOperationBusinessContext(existing.business)
        : undefined
      if (!isGenerationBoundBusinessContext(business)) {
        throw new Error('OPERATION_GENERATION_CONTEXT_REQUIRED')
      }
      if (existing.stage !== 'validated' || existing.engineResult !== 'tesSUCCESS') {
        throw new Error('OPERATION_XRPL_SUCCESS_REQUIRED')
      }
      return {
        ...existing,
        updatedAt: at,
        businessConfirmation: confirmation,
      }
    })
  }

  public async append(entry: SubmissionJournalEntry): Promise<void> {
    await this.#mutate(entry.operationId, (existing) => {
      if (!existing) throw new Error('OPERATION_NOT_FOUND')
      return applyJournalEntry(existing, entry)
    })
  }

  public async list(): Promise<StoredOperation[]> {
    const database = await this.#open()
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(OPERATIONS_STORE, 'readonly')
      const request = transaction.objectStore(OPERATIONS_STORE).getAll()
      request.onerror = () => reject(request.error ?? new Error('INDEXED_DB_READ_FAILED'))
      request.onsuccess = () => {
        const operations = (request.result as StoredOperation[]).sort((left, right) =>
          right.updatedAt.localeCompare(left.updatedAt),
        )
        resolve(operations)
      }
    })
  }

  async #mutate(
    operationId: string,
    mutate: (current: StoredOperation | undefined) => StoredOperation,
  ): Promise<void> {
    const database = await this.#open()
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(OPERATIONS_STORE, 'readwrite')
      const store = transaction.objectStore(OPERATIONS_STORE)
      const request = store.get(operationId)

      request.onerror = () => reject(request.error ?? new Error('INDEXED_DB_READ_FAILED'))
      request.onsuccess = () => {
        try {
          store.put(mutate(request.result as StoredOperation | undefined))
        } catch (error) {
          transaction.abort()
          reject(error)
        }
      }
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error ?? new Error('INDEXED_DB_WRITE_FAILED'))
      transaction.onabort = () => reject(transaction.error ?? new Error('INDEXED_DB_WRITE_ABORTED'))
    })
  }

  #open(): Promise<IDBDatabase> {
    this.#databasePromise ??= new Promise((resolve, reject) => {
      const request = this.#factory.open(DATABASE_NAME, DATABASE_VERSION)
      request.onupgradeneeded = () => {
        const database = request.result
        if (!database.objectStoreNames.contains(OPERATIONS_STORE)) {
          database.createObjectStore(OPERATIONS_STORE, { keyPath: 'operationId' })
        }
      }
      request.onerror = () => reject(request.error ?? new Error('INDEXED_DB_OPEN_FAILED'))
      request.onblocked = () => reject(new Error('INDEXED_DB_OPEN_BLOCKED'))
      request.onsuccess = () => resolve(request.result)
    })
    return this.#databasePromise
  }
}
