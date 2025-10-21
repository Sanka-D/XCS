export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  modules: ['@nuxt/ui'],
  css: ['~/assets/css/main.css'],
  ssr: false,
  vue: {
    compilerOptions: {
      isCustomElement: (tag) => tag === 'xrpl-wallet-connector',
    },
  },
  vite: {
    optimizeDeps: {
      exclude: ['xrpl-connect', 'xumm-oauth2-pkce', 'xumm'],
      esbuildOptions: {
        define: {
          global: 'globalThis',
        },
      },
    },
    resolve: {
      alias: {
        'xumm-oauth2-pkce': 'xumm-oauth2-pkce/dist/browser.min.js',
        events: 'eventemitter3',
      },
    },
    build: {
      rollupOptions: {
        external: ['crypto', 'zlib', 'util', 'stream', 'buffer'],
        output: {
          manualChunks: {
            'xrpl-connect': ['xrpl-connect'],
          },
          globals: {
            crypto: 'Crypto',
            zlib: 'Zlib',
          },
        },
      },
    },
  },

  runtimeConfig: {
    // Private (server-only)
    xrplServer:
      process.env.XRPL_SERVER || 'wss://s.altnet.rippletest.net:51233',
    issuerSeed: process.env.ISSUER_SEED || '',

    // IPFS config
    ipfsProvider: process.env.IPFS_PROVIDER || 'pinata',
    ipfsHost: process.env.IPFS_HOST || '',
    pinataJwt: process.env.PINATA_JWT || '',

    // Database
    databaseUrl:
      process.env.DATABASE_URL ||
      'postgresql://localhost:5432/xrpl_credentials',

    // Public
    public: {
      baseUrl: process.env.BASE_URL || 'http://localhost:3000',
      ipfsGateway: process.env.IPFS_GATEWAY || 'https://ipfs.io',
      walletConnectProjectId:
        process.env.NUXT_PUBLIC_WALLETCONNECT_PROJECT_ID || '',
    },
  },

  nitro: {
    experimental: {
      database: true,
    },
  },
});
