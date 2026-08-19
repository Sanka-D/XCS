import type { WalletManager } from 'xrpl-connect'

declare module '#app' {
  interface NuxtApp {
    $walletManager: WalletManager
  }
}

declare module 'vue' {
  interface ComponentCustomProperties {
    $walletManager: WalletManager
  }
}

export {}
