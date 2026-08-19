import { Client } from 'xrpl'

import type { LedgerSource, LedgerTransaction, ValidatedLedger } from './types.js'

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} is not an object`)
  }
  return value as Record<string, unknown>
}

function uint(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} is not a non-negative safe integer`)
  }
  return value
}

function hash(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${label} is not a 32-byte hex value`)
  }
  return value.toLowerCase()
}

export function assertFeatureResponseSupportsAmendment(value: unknown, amendmentId: string): void {
  const result = asRecord(value, 'feature result')
  const match = Object.entries(result).find(
    ([key]) => key.toUpperCase() === amendmentId.toUpperCase(),
  )
  if (match === undefined) {
    throw new Error(`Required XRPL amendment ${amendmentId} is absent from feature response`)
  }
  const feature = asRecord(match[1], `feature result ${match[0]}`)
  if (feature.enabled !== true || feature.supported !== true) {
    throw new Error(`Required XRPL amendment ${amendmentId} is not enabled and supported`)
  }
}

function normalizeTransaction(value: unknown): LedgerTransaction {
  const envelope = asRecord(value, 'expanded ledger transaction')
  const transaction =
    typeof envelope.tx_json === 'object' && envelope.tx_json !== null
      ? asRecord(envelope.tx_json, 'tx_json')
      : typeof envelope.tx === 'object' && envelope.tx !== null
        ? asRecord(envelope.tx, 'tx')
        : envelope
  const metadataValue = envelope.meta ?? envelope.metaData ?? transaction.metaData
  const metadata = asRecord(metadataValue, 'transaction metadata')
  const transactionHash = envelope.hash ?? transaction.hash
  const transactionIndex = uint(metadata.TransactionIndex, 'metadata.TransactionIndex')

  const cleanTransaction = { ...transaction }
  delete cleanTransaction.meta
  delete cleanTransaction.metaData
  delete cleanTransaction.hash

  return {
    hash: hash(transactionHash, 'transaction hash'),
    transaction: cleanTransaction,
    metadata,
    transactionIndex,
  }
}

export function normalizeLedgerResponse(value: unknown): ValidatedLedger {
  const result = asRecord(value, 'ledger response')
  if (result.validated !== true) {
    throw new Error('XRPL server returned a non-validated ledger')
  }
  const ledger = asRecord(result.ledger, 'ledger')
  const transactions = Array.isArray(ledger.transactions)
    ? ledger.transactions
        .map(normalizeTransaction)
        .sort((left, right) => left.transactionIndex - right.transactionIndex)
    : []

  return {
    ledgerIndex: uint(ledger.ledger_index ?? result.ledger_index, 'ledger_index'),
    ledgerHash: hash(ledger.ledger_hash ?? result.ledger_hash, 'ledger_hash'),
    parentHash: hash(ledger.parent_hash, 'parent_hash'),
    closeTime: uint(ledger.close_time, 'close_time'),
    transactions,
  }
}

export class XrplLedgerSource implements LedgerSource {
  private readonly client: Client

  constructor(url: string) {
    this.client = new Client(url)
  }

  async connect(): Promise<void> {
    if (!this.client.isConnected()) await this.client.connect()
  }

  async disconnect(): Promise<void> {
    if (this.client.isConnected()) await this.client.disconnect()
  }

  async assertAmendmentEnabled(amendmentId: string): Promise<void> {
    const request = this.client.request.bind(this.client) as unknown as (
      request: Record<string, unknown>,
    ) => Promise<{ result: unknown }>
    const response = await request({ command: 'feature', feature: amendmentId })
    assertFeatureResponseSupportsAmendment(response.result, amendmentId)
  }

  async getValidatedLedgerIndex(): Promise<number> {
    const response = await this.client.request({ command: 'server_info' })
    const info = asRecord(response.result.info, 'server_info.info')
    const validatedLedger = asRecord(info.validated_ledger, 'server_info.info.validated_ledger')
    return uint(validatedLedger.seq, 'validated_ledger.seq')
  }

  async getLedger(ledgerIndex: number): Promise<ValidatedLedger> {
    const response = await this.client.request({
      command: 'ledger',
      ledger_index: ledgerIndex,
      transactions: true,
      expand: true,
      binary: false,
    })
    return normalizeLedgerResponse(response.result)
  }
}
