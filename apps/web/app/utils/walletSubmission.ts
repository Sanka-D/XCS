import type { ReliableSubmissionResult, Signer, SignerResult } from '@xcs-protocol/sdk'
import { hashes, type SubmittableTransaction } from 'xrpl'
import type { SignedTransaction, Transaction } from 'xrpl-connect'

interface WalletSignOnly {
  sign(transaction: Transaction): Promise<SignedTransaction>
}

export interface SignedOperationInput {
  readonly transaction: Readonly<SubmittableTransaction>
  readonly txBlob: string
  readonly txHash: string
}

export type PersistSignedOperation = (input: SignedOperationInput) => Promise<void>

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

/**
 * Persistence is awaited inside the signer, before the SDK is allowed to make
 * its first submit call. A storage failure therefore prevents network effects.
 */
export function createPersistingWalletSigner(
  wallet: WalletSignOnly,
  persist: PersistSignedOperation,
): Signer {
  return {
    async sign(transaction) {
      const signed = await wallet.sign(transaction as Transaction)
      const normalized = normalizeWalletSignature(signed)
      await persist({
        transaction,
        txBlob: normalized.txBlob,
        txHash: normalized.hash,
      })
      return normalized
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
}
