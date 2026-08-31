declare module 'xrpl-connect' {
  import type { SubmittableTransaction } from 'xrpl'

  export interface NetworkInfo {
    id: string
    name: string
    wss: string
    rpc?: string
    walletConnectId?: string
  }

  export interface AccountInfo {
    address: string
    publicKey?: string
    network: NetworkInfo
  }

  export type Transaction = SubmittableTransaction

  export interface SignedTransaction {
    hash?: string
    tx_blob?: string
    signature?: string
    [key: string]: unknown
  }

  export interface SubmittedTransaction {
    hash: string
    id?: string
    [key: string]: unknown
  }

  export interface WalletAdapter {
    readonly id: string
    readonly name: string
    isAvailable(): Promise<boolean>
  }

  export interface WalletManagerOptions {
    adapters: WalletAdapter[]
    network: 'mainnet' | 'testnet' | 'devnet' | NetworkInfo
    autoConnect?: boolean
    logger?: { level?: 'debug' | 'info' | 'warn' | 'error' | 'silent' }
  }

  export class WalletManager {
    constructor(options: WalletManagerOptions)
    readonly account: AccountInfo | null
    readonly connected: boolean
    on(event: string, listener: (payload?: unknown) => void): this
    connect(walletId: string, options?: { network?: string }): Promise<AccountInfo>
    disconnect(): Promise<void>
    getAvailableWallets(): Promise<WalletAdapter[]>
    sign(transaction: Transaction): Promise<SignedTransaction>
    signAndSubmit(transaction: Transaction): Promise<SubmittedTransaction>
  }

  export class CrossmarkAdapter implements WalletAdapter {
    readonly id: string
    readonly name: string
    constructor(options?: Record<string, unknown>)
    isAvailable(): Promise<boolean>
  }

  export class GemWalletAdapter implements WalletAdapter {
    readonly id: string
    readonly name: string
    constructor(options?: Record<string, unknown>)
    isAvailable(): Promise<boolean>
  }
}
