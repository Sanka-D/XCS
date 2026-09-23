import { createApp, toNodeListener, toWebHandler } from 'h3'
import inject from 'light-my-request'

import { createApi as createNativeApi, type CreateApiOptions } from '../../../server/xcs/api/app.js'

/** Exercise the real H3 HTTP listener; injection exists only in tests, never in production. */
export async function createApi(options: CreateApiOptions) {
  const api = await createNativeApi(options)
  const app = createApp().use(api.handler)
  const listener = toNodeListener(app)
  return {
    inject: (options: inject.InjectOptions) => inject(listener, options),
    fetch: toWebHandler(app),
    swagger: () => api.openapi,
    ready: async () => {},
    close: async () => {},
  }
}
