export default defineNuxtConfig({
  compatibilityDate: '2026-08-19',
  css: ['~/assets/css/main.css'],
  devtools: { enabled: false },
  modules: ['@nuxtjs/i18n'],
  i18n: {
    defaultLocale: 'fr',
    strategy: 'prefix_except_default',
    locales: [
      { code: 'fr', language: 'fr-FR', name: 'Français', file: 'fr.json' },
      { code: 'en', language: 'en-US', name: 'English', file: 'en.json' },
    ],
    langDir: 'locales',
  },
  runtimeConfig: {
    apiBaseUrl: 'http://localhost:3001',
    public: {
      apiBaseUrl: 'http://localhost:3001',
      profileId: '',
      rpcUrl: 'wss://s.altnet.rippletest.net:51233',
    },
  },
  typescript: {
    strict: true,
    typeCheck: true,
  },
})
