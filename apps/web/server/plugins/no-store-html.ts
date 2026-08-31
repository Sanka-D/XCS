export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('render:response', (response) => {
    // A cached SSR document would reuse its public CSP nonce across clients.
    // Static /_nuxt assets bypass this render hook and keep immutable caching.
    response.headers['cache-control'] = 'private, no-store'
  })
})
