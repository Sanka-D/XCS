import { encode, hashes, type Client, type SubmittableTransaction } from 'xrpl'
import type {
  AccountInfo,
  SignedTransaction,
  Transaction,
  WalletAdapter,
  WalletManager,
} from 'xrpl-connect'

export const BROWSER_E2E_WALLET_ID = 'xcs-browser-e2e'
export const BROWSER_E2E_ACCOUNT = 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh'
export const BROWSER_E2E_SUBJECT_WALLET_ID = 'xcs-browser-e2e-subject'
export const BROWSER_E2E_SUBJECT_ACCOUNT = 'r9cZA1mLK5R5Am25ArfXFmqgNwjZgnfk59'

interface BrowserE2eEffects {
  walletSignatures: number
  ledgerSubmissions: number
}

function browserE2eEffects(): BrowserE2eEffects {
  const runtime = globalThis as typeof globalThis & {
    __xcsBrowserE2eEffects?: BrowserE2eEffects
  }
  runtime.__xcsBrowserE2eEffects ??= { walletSignatures: 0, ledgerSubmissions: 0 }
  return runtime.__xcsBrowserE2eEffects
}

const NETWORK_ID = 1
const LEDGER_INDEX = 100_001
const LAST_LEDGER_SEQUENCE = LEDGER_INDEX + 20

// These bytes are intentionally not a usable signature or secret. The local
// fake ledger accepts the syntactic blob so the application can still prove
// exact signed-field comparison, hashing, journaling and finality transitions.
const SYNTHETIC_PUBLIC_KEY = `02${'11'.repeat(32)}`
const SYNTHETIC_SIGNATURE = 'AA'

type WalletListener = (payload?: unknown) => void

const BROWSER_E2E_WALLETS = [
  {
    id: BROWSER_E2E_WALLET_ID,
    name: 'XCS deterministic E2E wallet',
    address: BROWSER_E2E_ACCOUNT,
  },
  {
    id: BROWSER_E2E_SUBJECT_WALLET_ID,
    name: 'XCS deterministic E2E subject wallet',
    address: BROWSER_E2E_SUBJECT_ACCOUNT,
  },
] as const

class BrowserE2eWalletManager {
  private readonly listeners = new Map<string, Set<WalletListener>>()
  private currentAccount: AccountInfo | null = null

  public get account(): AccountInfo | null {
    return this.currentAccount
  }

  public get connected(): boolean {
    return this.currentAccount !== null
  }

  public on(event: string, listener: WalletListener): this {
    const listeners = this.listeners.get(event) ?? new Set<WalletListener>()
    listeners.add(listener)
    this.listeners.set(event, listeners)
    return this
  }

  public async getAvailableWallets(): Promise<WalletAdapter[]> {
    return BROWSER_E2E_WALLETS.map(({ id, name }) => ({
      id,
      name,
      isAvailable: async () => true,
    }))
  }

  public async connect(walletId: string, options?: { network?: string }): Promise<AccountInfo> {
    const wallet = BROWSER_E2E_WALLETS.find((candidate) => candidate.id === walletId)
    if (!wallet) throw new Error('BROWSER_E2E_WALLET_UNKNOWN')
    if (options?.network !== undefined && options.network !== 'testnet') {
      throw new Error('BROWSER_E2E_TESTNET_REQUIRED')
    }
    this.currentAccount = {
      address: wallet.address,
      network: {
        id: 'testnet',
        name: 'XRPL Testnet (deterministic E2E)',
        wss: 'ws://127.0.0.1:1',
      },
    }
    this.emit('connect', this.currentAccount)
    return this.currentAccount
  }

  public async disconnect(): Promise<void> {
    this.currentAccount = null
    this.emit('disconnect')
  }

  public async sign(transaction: Transaction): Promise<SignedTransaction> {
    if (this.currentAccount === null) throw new Error('BROWSER_E2E_WALLET_NOT_CONNECTED')
    browserE2eEffects().walletSignatures += 1
    const txBlob = encode({
      ...transaction,
      SigningPubKey: SYNTHETIC_PUBLIC_KEY,
      TxnSignature: SYNTHETIC_SIGNATURE,
    })
    return { tx_blob: txBlob, hash: hashes.hashSignedTx(txBlob) }
  }

  private emit(event: string, payload?: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) listener(payload)
  }
}

interface BrowserE2eClientShape {
  readonly networkID: number
  readonly buildVersion: string
  connect(): Promise<void>
  disconnect(): Promise<void>
  isConnected(): boolean
  autofill(transaction: SubmittableTransaction): Promise<SubmittableTransaction>
  submit(txBlob: string): Promise<{ result: Record<string, unknown> }>
  request(request: Record<string, unknown>): Promise<{ result: Record<string, unknown> }>
}

class BrowserE2eLedgerClient implements BrowserE2eClientShape {
  public readonly networkID = NETWORK_ID
  public readonly buildVersion = 'browser-e2e-no-rippled'
  private connected = false
  private readonly submitted = new Set<string>()

  public async connect(): Promise<void> {
    this.connected = true
  }

  public async disconnect(): Promise<void> {
    this.connected = false
  }

  public isConnected(): boolean {
    return this.connected
  }

  public async autofill(transaction: SubmittableTransaction): Promise<SubmittableTransaction> {
    this.assertConnected()
    return {
      ...transaction,
      Sequence: transaction.Sequence ?? 1,
      Fee: transaction.Fee ?? '12',
      LastLedgerSequence: transaction.LastLedgerSequence ?? LAST_LEDGER_SEQUENCE,
    }
  }

  public async submit(txBlob: string): Promise<{ result: Record<string, unknown> }> {
    this.assertConnected()
    browserE2eEffects().ledgerSubmissions += 1
    this.submitted.add(hashes.hashSignedTx(txBlob).toUpperCase())
    return {
      result: {
        engine_result: 'tesSUCCESS',
        engine_result_code: 0,
        engine_result_message: 'Synthetic browser E2E acceptance.',
      },
    }
  }

  public async request(
    request: Record<string, unknown>,
  ): Promise<{ result: Record<string, unknown> }> {
    this.assertConnected()
    if (request.command === 'feature') {
      const amendment = String(request.feature)
      return { result: { [amendment]: { enabled: true, supported: true } } }
    }
    if (request.command === 'tx') {
      const hash = String(request.transaction).toUpperCase()
      if (!this.submitted.has(hash)) {
        throw Object.assign(new Error('txnNotFound'), { data: { error: 'txnNotFound' } })
      }
      return {
        result: {
          validated: true,
          ledger_index: LEDGER_INDEX,
          meta: { TransactionResult: 'tesSUCCESS' },
        },
      }
    }
    if (request.command === 'ledger_current') {
      return { result: { ledger_current_index: LEDGER_INDEX } }
    }
    throw new Error(`BROWSER_E2E_XRPL_COMMAND_UNSUPPORTED:${String(request.command)}`)
  }

  private assertConnected(): void {
    if (!this.connected) throw new Error('BROWSER_E2E_XRPL_NOT_CONNECTED')
  }
}

export function createBrowserE2eWalletManager(): WalletManager {
  return new BrowserE2eWalletManager() as unknown as WalletManager
}

export function createBrowserE2eLedgerClient(): Client {
  return new BrowserE2eLedgerClient() as unknown as Client
}
