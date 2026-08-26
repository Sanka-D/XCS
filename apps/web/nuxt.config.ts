const browserE2eInput = process.env.XCS_BROWSER_E2E
if (browserE2eInput !== undefined && browserE2eInput !== '0' && browserE2eInput !== '1') {
  throw new Error('XCS_BROWSER_E2E must be exactly "0" or "1".')
}
if (browserE2eInput === '1' && process.env.NODE_ENV === 'production') {
  throw new Error('XCS_BROWSER_E2E cannot be enabled in production.')
}
const browserE2eMode = browserE2eInput === '1' ? 'enabled' : 'disabled'
const apiInternalToken =
  process.env.NUXT_API_INTERNAL_TOKEN ??
  (process.env.NODE_ENV === 'production' ? '' : 'xcs-development-internal-token-0001')

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
    apiInternalToken,
    trustedProxyCidrs: process.env.NUXT_TRUSTED_PROXY_CIDRS ?? '',
    browserE2eMode,
    public: {
      apiBaseUrl: 'http://localhost:3001',
      profileId: '',
      rpcUrl: 'wss://s.altnet.rippletest.net:51233',
      browserE2eMode,
    },
  },
  typescript: {
    strict: true,
    typeCheck: true,
  },
})
