import type { ReliableSubmissionResult, Signer, SignerResult } from '@xcs-protocol/sdk'
import { hashes } from 'xrpl'
import type { SignedTransaction, Transaction } from 'xrpl-connect'

interface WalletSignOnly {
  sign(transaction: Transaction): Promise<SignedTransaction>
}

const HASH_PATTERN = /^[0-9A-F]{64}$/u

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
