import { defineNuxtPlugin } from '#app';

declare global {
  interface Window {
    walletManager?: any;
  }
}

export default defineNuxtPlugin(async () => {
  // Only run on client side
  if (process.server) return;

  try {
    const {
      CrossmarkAdapter,
      GemWalletAdapter,
      WalletConnectAdapter,
      XamanAdapter,
      WalletManager,
    } = (await import('xrpl-connect')) as any;

    if (!CrossmarkAdapter || !GemWalletAdapter || !WalletManager) {
      throw new Error('Failed to import required exports from xrpl-connect');
    }

    const adapters: any[] = [];

    try {
      const crossmark = new CrossmarkAdapter();
      adapters.push(crossmark);
    } catch (err) {
      console.error('[Wallet Plugin] Failed to create CrossmarkAdapter:', err);
    }

    try {
      const gem = new GemWalletAdapter();
      adapters.push(gem);
    } catch (err) {
      console.error('[Wallet Plugin] Failed to create GemWalletAdapter:', err);
    }
    try {
      const walletConnect = new WalletConnectAdapter({
        projectId: '32798b46e13dfb0049706a524cf132d6',
      });
      adapters.push(walletConnect);
    } catch (err) {
      console.error('[Wallet Plugin] Failed to create GemWalletAdapter:', err);
    }
    try {
      const xaman = new XamanAdapter({
        apiKey: '15ba80a8-cba2-4789-a45b-c6a850d9d91b',
      });
      adapters.push(xaman);
    } catch (err) {
      console.error('[Wallet Plugin] Failed to create GemWalletAdapter:', err);
    }

    if (adapters.length === 0) {
      throw new Error('No wallet adapters could be initialized');
    }

    const walletManager = new WalletManager({
      adapters,
      network: 'testnet',
      autoConnect: false, // Set to false for better control
      logger: { level: 'debug' },
    });

    return {
      provide: {
        walletManager,
      },
    };
  } catch (error) {
    console.error(
      '[Wallet Plugin] Failed to initialize wallet manager:',
      error
    );
    if (error instanceof Error) {
      console.error('[Wallet Plugin] Error message:', error.message);
      console.error('[Wallet Plugin] Error stack:', error.stack);
    }
    // Return null manager so app doesn't crash
    return {
      provide: {
        walletManager: null,
      },
    };
  }
});
