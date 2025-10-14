// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  modules: ['@nuxt/ui'],
  css: ['~/assets/css/main.css'],

  // Use default component auto-import
  // Components will be auto-imported from ~/components

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
    },
  },

  nitro: {
    experimental: {
      database: true,
    },
  },
});
