import type { Transaction } from 'xrpl-connect'

export function assertTransactionSigner(transaction: Transaction, address: string): void {
  if (transaction.Account !== address) throw new Error('SIGNER_ACCOUNT_MISMATCH')
}

export function assertPreparedTransaction(transaction: Transaction): void {
  if (
    transaction.Fee === undefined ||
    transaction.Sequence === undefined ||
    transaction.LastLedgerSequence === undefined
  ) {
    throw new Error('TRANSACTION_MUST_BE_PREPARED')
  }
}

export function exactCredentialPath(
  network: string,
  issuer: string,
  subject: string,
  schemaUid: string,
): string {
  return `/v1/networks/${encodeURIComponent(network)}/credentials/${encodeURIComponent(issuer)}/${encodeURIComponent(subject)}/${encodeURIComponent(schemaUid.toLowerCase())}`
}

export function exactCredentialEventPath(
  network: string,
  issuer: string,
  subject: string,
  schemaUid: string,
  transactionHash: string,
): string {
  return `${exactCredentialPath(network, issuer, subject, schemaUid)}/events/${encodeURIComponent(transactionHash.toLowerCase())}`
}
