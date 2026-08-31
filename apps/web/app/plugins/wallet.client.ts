import { Client } from 'xrpl'
import { CrossmarkAdapter, GemWalletAdapter, WalletManager, type WalletAdapter } from 'xrpl-connect'
import { resolveBrowserE2eClientMode } from '~/utils/browserE2eMode'

export default defineNuxtPlugin(async () => {
  const config = useRuntimeConfig()
  const browserE2e = resolveBrowserE2eClientMode(config.public.browserE2eMode, import.meta.dev)
  // Alpha support is intentionally restricted to adapters whose sign-only
  // response exposes the complete signed transaction blob.
  const adapters: WalletAdapter[] = [new CrossmarkAdapter(), new GemWalletAdapter()]

  if (import.meta.dev && browserE2e) {
    const { createBrowserE2eLedgerClient, createBrowserE2eWalletManager } =
      await import('~/utils/browserE2eHarness')
    return {
      provide: {
        walletManager: createBrowserE2eWalletManager(),
        xrplClientFactory: () => createBrowserE2eLedgerClient(),
      },
    }
  }

  const walletManager = new WalletManager({
    adapters,
    network: 'testnet',
    autoConnect: false,
    logger: { level: import.meta.dev ? 'warn' : 'error' },
  })

  return {
    provide: {
      walletManager,
      xrplClientFactory: (rpcUrl: string) => new Client(rpcUrl),
    },
  }
})
