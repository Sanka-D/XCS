import { CrossmarkAdapter, GemWalletAdapter, WalletManager, type WalletAdapter } from 'xrpl-connect'

export default defineNuxtPlugin(() => {
  // Alpha support is intentionally restricted to adapters whose sign-only
  // response exposes the complete signed transaction blob.
  const adapters: WalletAdapter[] = [new CrossmarkAdapter(), new GemWalletAdapter()]

  const walletManager = new WalletManager({
    adapters,
    network: 'testnet',
    autoConnect: false,
    logger: { level: import.meta.dev ? 'warn' : 'error' },
  })

  return {
    provide: { walletManager },
  }
})
