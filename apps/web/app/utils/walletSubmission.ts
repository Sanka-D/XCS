import type { ReliableSubmissionResult, Signer, SignerResult } from '@xcs-protocol/sdk'
import { decode, hashes, verifySignature } from 'xrpl'
import type { SignedTransaction, Transaction } from 'xrpl-connect'

interface WalletSignOnly {
  sign(transaction: Transaction): Promise<SignedTransaction>
}

const HASH_PATTERN = /^[0-9A-F]{64}$/u

export interface StoredRecoveryMaterial {
  readonly txBlob: string
  readonly txHash: string
  readonly lastLedgerSequence: number
  readonly account: string
  readonly transactionType: string
  readonly networkId: number
}

/**
 * Treat persisted browser recovery state as untrusted input before it can
 * influence terminal reconciliation or create a new XRPL side effect.
 */
export function validateStoredRecoveryMaterial(material: StoredRecoveryMaterial): void {
  let decoded: Record<string, unknown>
  let derivedHash: string
  try {
    decoded = decode(material.txBlob)
    derivedHash = hashes.hashSignedTx(material.txBlob).toUpperCase()
    if (
      Object.hasOwn(decoded, 'Signers') ||
      typeof decoded.SigningPubKey !== 'string' ||
      decoded.SigningPubKey.length === 0 ||
      typeof decoded.TxnSignature !== 'string' ||
      decoded.TxnSignature.length === 0 ||
      !verifySignature(material.txBlob)
    ) {
      throw new Error('invalid single signature')
    }
  } catch {
    throw new Error('OPERATION_RECOVERY_BLOB_INVALID')
  }

  if (!HASH_PATTERN.test(material.txHash) || derivedHash !== material.txHash) {
    throw new Error('OPERATION_RECOVERY_HASH_MISMATCH')
  }

  const decodedLastLedgerSequence = decoded.LastLedgerSequence
  if (
    !Number.isSafeInteger(material.lastLedgerSequence) ||
    material.lastLedgerSequence <= 0 ||
    !Number.isSafeInteger(decodedLastLedgerSequence) ||
    (decodedLastLedgerSequence as number) <= 0
  ) {
    throw new Error('OPERATION_RECOVERY_LAST_LEDGER_SEQUENCE_INVALID')
  }
  if (decodedLastLedgerSequence !== material.lastLedgerSequence) {
    throw new Error('OPERATION_RECOVERY_LAST_LEDGER_SEQUENCE_MISMATCH')
  }
  if (decoded.Account !== material.account) {
    throw new Error('OPERATION_RECOVERY_ACCOUNT_MISMATCH')
  }
  if (decoded.TransactionType !== material.transactionType) {
    throw new Error('OPERATION_RECOVERY_TRANSACTION_TYPE_MISMATCH')
  }
  if (decoded.NetworkID !== undefined && decoded.NetworkID !== material.networkId) {
    throw new Error('OPERATION_RECOVERY_NETWORK_ID_MISMATCH')
  }
}

/**
 * Crossmark and GemWallet currently return an empty hash from sign-only flows.
 * The signed blob is the source of truth, so derive its canonical XRPL hash and
 * only treat a wallet-provided hash as an additional consistency assertion.
 */
export function normalizeWalletSignature(signed: SignedTransaction): SignerResult {
  const txBlob = typeof signed.tx_blob === 'string' ? signed.tx_blob.trim() : ''
  if (txBlob.length === 0) throw new Error('WALLET_SIGNED_BLOB_MISSING')

  let derivedHash: string
  try {
    derivedHash = hashes.hashSignedTx(txBlob).toUpperCase()
  } catch {
    throw new Error('WALLET_SIGNED_BLOB_INVALID')
  }

  const suppliedHash = typeof signed.hash === 'string' ? signed.hash.trim().toUpperCase() : ''
  if (suppliedHash.length > 0) {
    if (!HASH_PATTERN.test(suppliedHash)) throw new Error('WALLET_SIGNED_HASH_INVALID')
    if (suppliedHash !== derivedHash) throw new Error('WALLET_SIGNED_HASH_MISMATCH')
  }

  return { hash: derivedHash, txBlob }
}

/** Adapts a sign-only browser wallet without persisting unverified output. */
export function createWalletSigner(wallet: WalletSignOnly): Signer {
  return {
    async sign(transaction) {
      const signed = await wallet.sign(transaction as Transaction)
      return normalizeWalletSignature(signed)
    },
  }
}

export function assertValidatedTesSuccess(result: ReliableSubmissionResult): void {
  if (result.status !== 'validated') {
    throw new Error(`TRANSACTION_${result.status.toUpperCase()}:${result.txHash}`)
  }
  if (result.transactionResult !== 'tesSUCCESS') {
    throw new Error(`TRANSACTION_FAILED:${result.transactionResult ?? 'UNKNOWN'}`)
  }
  if (!Number.isSafeInteger(result.ledgerIndex) || (result.ledgerIndex as number) <= 0) {
    throw new Error('TRANSACTION_LEDGER_INDEX_INVALID')
  }
}
