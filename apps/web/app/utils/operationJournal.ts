import type {
  OperationJournal,
  SubmissionJournalEntry,
  SubmissionJournalStage,
} from '@xcs-protocol/sdk'

const DATABASE_NAME = 'xcs-wallet-journal'
const DATABASE_VERSION = 1
const OPERATIONS_STORE = 'operations'

export interface OperationSeed {
  readonly operationId: string
  readonly account: string
  readonly profileId: string
  readonly networkId: number
  readonly transactionType: string
  readonly createdAt: string
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
}

export interface SignedOperationRecord {
  readonly operationId: string
  readonly txBlob: string
  readonly txHash: string
  readonly lastLedgerSequence: number
  readonly at: string
}

export function applyJournalEntry(
  operation: StoredOperation,
  entry: SubmissionJournalEntry,
): StoredOperation {
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
  return (
    typeof operation.txBlob === 'string' &&
    operation.txBlob.length > 0 &&
    ['signed', 'submitted', 'pending'].includes(operation.stage)
  )
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
