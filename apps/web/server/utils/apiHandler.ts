import { createError, defineEventHandler } from 'h3'
import type { createApiRuntime } from '../xcs/api/runtime'

declare module 'h3' {
  interface H3EventContext {
    xcsApi?: Awaited<ReturnType<typeof createApiRuntime>>
    xcsClientAddress?: string
  }
}

export const apiHandler = defineEventHandler((event) => {
  if (!event.context.xcsApi) throw createError({ statusCode: 503, message: 'API_UNAVAILABLE' })
  return event.context.xcsApi.handler(event)
})
