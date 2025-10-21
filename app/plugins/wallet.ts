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
    console.log('[Wallet Plugin] Starting initialization...');

    // Import from xrpl-connect - WalletManager is exported but missing from .d.ts types
    console.log('[Wallet Plugin] Importing xrpl-connect...');
    const { CrossmarkAdapter, GemWalletAdapter, WalletManager } = await import('xrpl-connect') as any;

    console.log('[Wallet Plugin] Exports available:', {
      CrossmarkAdapter: !!CrossmarkAdapter,
      GemWalletAdapter: !!GemWalletAdapter,
      WalletManager: !!WalletManager,
    });

    if (!CrossmarkAdapter || !GemWalletAdapter || !WalletManager) {
      throw new Error('Failed to import required exports from xrpl-connect');
    }

    console.log('[Wallet Plugin] xrpl-connect imported successfully');

    // Initialize adapters
    console.log('[Wallet Plugin] Initializing adapters...');
    const adapters: any[] = [];

    try {
      console.log('[Wallet Plugin] Creating CrossmarkAdapter...');
      const crossmark = new CrossmarkAdapter();
      adapters.push(crossmark);
      console.log('[Wallet Plugin] CrossmarkAdapter created successfully');
    } catch (err) {
      console.error('[Wallet Plugin] Failed to create CrossmarkAdapter:', err);
    }

    try {
      console.log('[Wallet Plugin] Creating GemWalletAdapter...');
      const gem = new GemWalletAdapter();
      adapters.push(gem);
      console.log('[Wallet Plugin] GemWalletAdapter created successfully');
    } catch (err) {
      console.error('[Wallet Plugin] Failed to create GemWalletAdapter:', err);
    }

    console.log(
      `[Wallet Plugin] Adapters initialized: ${adapters.length} adapters available`
    );

    if (adapters.length === 0) {
      throw new Error('No wallet adapters could be initialized');
    }

    // Initialize wallet manager
    console.log('[Wallet Plugin] Creating WalletManager...');
    const walletManager = new WalletManager({
      adapters,
      network: 'testnet',
      autoConnect: false, // Set to false for better control
      logger: { level: 'debug' },
    });

    console.log('[Wallet Plugin] WalletManager created successfully');

    // Store in window for debugging
    if (process.dev) {
      window.walletManager = walletManager;
      console.log('[Wallet Plugin] WalletManager available at window.walletManager');
    }

    // Provide to app via $walletManager
    return {
      provide: {
        walletManager,
      },
    };
  } catch (error) {
    console.error('[Wallet Plugin] Failed to initialize wallet manager:', error);
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
