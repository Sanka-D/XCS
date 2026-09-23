import { defineNitroPlugin, useRuntimeConfig } from 'nitropack/runtime'
import { loadApiConfig } from '../xcs/api/config'
import { createApiRuntime } from '../xcs/api/runtime'

export default defineNitroPlugin(async (nitroApp) => {
  const config = useRuntimeConfig()
  if (import.meta.dev && config.browserE2eMode === 'enabled') return
  const runtime = await createApiRuntime(
    loadApiConfig({
      ...process.env,
      NUXT_DATABASE_URL: config.databaseUrl,
      NUXT_PAYLOAD_DATABASE_URL: config.payloadDatabaseUrl,
    }),
  )
  nitroApp.hooks.hook('request', (event) => {
    event.context.xcsApi = runtime
  })
  nitroApp.hooks.hook('close', runtime.close)
})
