import type { Client } from 'xrpl'
import type { WalletManager } from 'xrpl-connect'

declare module '#app' {
  interface NuxtApp {
    $walletManager: WalletManager
    $xrplClientFactory: (rpcUrl: string) => Client
  }
}

declare module 'vue' {
  interface ComponentCustomProperties {
    $walletManager: WalletManager
    $xrplClientFactory: (rpcUrl: string) => Client
  }
}

export {}
