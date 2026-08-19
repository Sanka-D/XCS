import type { NetworkProfile } from '@xcs-protocol/core'
import {
  autofillXcsTransaction,
  connectAndValidateNetwork,
  signPreparedAndSubmit,
  submitSignedTransaction,
  type ReliableSubmissionResult,
} from '@xcs-protocol/sdk'
import { Client, type SubmittableTransaction } from 'xrpl'
import type { AccountInfo, Transaction, WalletManager } from 'xrpl-connect'
import {
  canRetryOperation,
  IndexedDbOperationJournal,
  type StoredOperation,
} from '~/utils/operationJournal'
import { assertTransactionSigner } from '~/utils/transactions'
import { assertValidatedTesSuccess, createPersistingWalletSigner } from '~/utils/walletSubmission'

const account = shallowRef<AccountInfo | null>(null)
const walletError = ref<string | null>(null)
const walletBusy = ref(false)
const listenersInstalled = ref(false)
const operations = shallowRef<StoredOperation[]>([])
const preparedProfiles = new WeakMap<object, NetworkProfile>()
let journal: IndexedDbOperationJournal | undefined

function operationJournal(): IndexedDbOperationJournal {
  if (!import.meta.client) throw new Error('WALLET_BROWSER_REQUIRED')
  journal ??= new IndexedDbOperationJournal()
  return journal
}

function assertWalletTestnet(connectedAccount: AccountInfo): void {
  if (connectedAccount.network.id !== 'testnet') throw new Error('WALLET_TESTNET_REQUIRED')
}

function sameProfile(left: NetworkProfile, right: NetworkProfile): boolean {
  return (
    left.profileId === right.profileId &&
    left.xcsVersion === right.xcsVersion &&
    left.networkId === right.networkId &&
    left.requiredAmendment === right.requiredAmendment &&
    left.registryAddress === right.registryAddress &&
    left.registrationAmountDrops === right.registrationAmountDrops &&
    left.activationLedgerIndex === right.activationLedgerIndex &&
    left.activationLedgerHash === right.activationLedgerHash
  )
}

export function useWallet() {
  const { $walletManager } = useNuxtApp()
  const config = useRuntimeConfig()
  const { getActiveNetworkProfile } = useXcsApi()

  if (import.meta.client && !listenersInstalled.value) {
    listenersInstalled.value = true
    $walletManager.on('connect', (connectedAccount) => {
      const nextAccount = connectedAccount as AccountInfo
      try {
        assertWalletTestnet(nextAccount)
        account.value = nextAccount
        walletError.value = null
      } catch (error) {
        account.value = null
        walletError.value = error instanceof Error ? error.message : String(error)
      }
    })
    $walletManager.on('disconnect', () => {
      account.value = null
    })
    $walletManager.on('error', (error) => {
      walletError.value = error instanceof Error ? error.message : String(error)
    })
  }

  async function availableWallets() {
    return $walletManager.getAvailableWallets()
  }

  async function connect(walletId: string) {
    walletBusy.value = true
    walletError.value = null
    try {
      const connectedAccount = await $walletManager.connect(walletId, { network: 'testnet' })
      assertWalletTestnet(connectedAccount)
      account.value = connectedAccount
    } catch (error) {
      account.value = null
      walletError.value = error instanceof Error ? error.message : String(error)
      if ($walletManager.connected) await $walletManager.disconnect().catch(() => undefined)
      throw error
    } finally {
      walletBusy.value = false
    }
  }

  async function disconnect() {
    await $walletManager.disconnect()
    account.value = null
  }

  async function prepare(
    transaction: Transaction,
    expectedProfile?: NetworkProfile,
  ): Promise<Transaction> {
    if (!account.value) throw new Error('WALLET_NOT_CONNECTED')
    assertWalletTestnet(account.value)
    assertTransactionSigner(transaction, account.value.address)

    const profile = await getActiveNetworkProfile()
    if (expectedProfile !== undefined && !sameProfile(expectedProfile, profile)) {
      throw new Error('NETWORK_PROFILE_CHANGED_BEFORE_PREVIEW')
    }
    const client = new Client(config.public.rpcUrl)
    try {
      await connectAndValidateNetwork(client, profile)
      const prepared = await autofillXcsTransaction(client, transaction)
      preparedProfiles.set(prepared.transaction, profile)
      return prepared.transaction
    } finally {
      if (client.isConnected()) await client.disconnect()
    }
  }

  async function signAndSubmit(transaction: Transaction): Promise<ReliableSubmissionResult> {
    if (!account.value) throw new Error('WALLET_NOT_CONNECTED')
    assertWalletTestnet(account.value)
    assertTransactionSigner(transaction, account.value.address)

    const preparedProfile = preparedProfiles.get(transaction)
    if (!preparedProfile) throw new Error('TRANSACTION_PREVIEW_REQUIRED')
    const activeProfile = await getActiveNetworkProfile()
    if (!sameProfile(preparedProfile, activeProfile)) {
      throw new Error('NETWORK_PROFILE_CHANGED_AFTER_PREVIEW')
    }

    walletBusy.value = true
    walletError.value = null
    const operationId = crypto.randomUUID()
    const operationStore = operationJournal()
    const client = new Client(config.public.rpcUrl)

    try {
      // Network identity is known before the wallet is asked to sign. The SDK
      // will refuse to sign or submit through an unvalidated client.
      await connectAndValidateNetwork(client, activeProfile)
      const createdAt = new Date().toISOString()
      await operationStore.create({
        operationId,
        account: account.value.address,
        profileId: activeProfile.profileId,
        networkId: activeProfile.networkId,
        transactionType: String(transaction.TransactionType),
        createdAt,
      })

      const signer = createPersistingWalletSigner(
        $walletManager as WalletManager,
        async ({ transaction: signedTransaction, txBlob, txHash }) => {
          const lastLedgerSequence = signedTransaction.LastLedgerSequence
          if (
            typeof lastLedgerSequence !== 'number' ||
            !Number.isInteger(lastLedgerSequence) ||
            lastLedgerSequence <= 0
          ) {
            throw new Error('TRANSACTION_MUST_BE_PREPARED')
          }
          await operationStore.persistSigned({
            operationId,
            txBlob,
            txHash,
            lastLedgerSequence,
            at: new Date().toISOString(),
          })
        },
      )

      const result = await signPreparedAndSubmit(
        client,
        transaction as SubmittableTransaction,
        signer,
        { journal: operationStore, operationId },
      )
      assertValidatedTesSuccess(result)
      preparedProfiles.delete(transaction)
      return result
    } finally {
      await loadOperations().catch(() => undefined)
      if (client.isConnected()) await client.disconnect()
      walletBusy.value = false
    }
  }

  async function loadOperations(): Promise<StoredOperation[]> {
    if (!import.meta.client) return []
    operations.value = await operationJournal().list()
    return operations.value
  }

  async function retryOperation(operationId: string): Promise<ReliableSubmissionResult> {
    walletBusy.value = true
    walletError.value = null
    const operationStore = operationJournal()
    const client = new Client(config.public.rpcUrl)
    try {
      const stored = (await operationStore.list()).find(
        (operation) => operation.operationId === operationId,
      )
      if (!stored || !canRetryOperation(stored) || !stored.txBlob) {
        throw new Error('OPERATION_NOT_RECOVERABLE')
      }

      const activeProfile = await getActiveNetworkProfile()
      if (
        stored.profileId !== activeProfile.profileId ||
        stored.networkId !== activeProfile.networkId
      ) {
        throw new Error('OPERATION_NETWORK_PROFILE_MISMATCH')
      }
      await connectAndValidateNetwork(client, activeProfile)

      const result = await submitSignedTransaction(client, stored.txBlob, {
        journal: operationStore,
        operationId,
      })
      assertValidatedTesSuccess(result)
      return result
    } finally {
      await loadOperations().catch(() => undefined)
      if (client.isConnected()) await client.disconnect()
      walletBusy.value = false
    }
  }

  return {
    account: readonly(account),
    busy: readonly(walletBusy),
    error: readonly(walletError),
    operations: readonly(operations),
    availableWallets,
    connect,
    disconnect,
    prepare,
    signAndSubmit,
    loadOperations,
    retryOperation,
  }
}
