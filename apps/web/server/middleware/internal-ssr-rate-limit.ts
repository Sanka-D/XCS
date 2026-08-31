import { resolveInternalSsrRateLimit } from '../utils/internalSsrRateLimit'

export default defineEventHandler((event) => {
  const config = useRuntimeConfig(event)
  const context = event.context as typeof event.context & {
    xcsSsrRateLimit?: ReturnType<typeof resolveInternalSsrRateLimit>
  }
  context.xcsSsrRateLimit ??= resolveInternalSsrRateLimit(
    config.apiInternalToken,
    event.node.req.socket.remoteAddress,
    getRequestHeader(event, 'x-forwarded-for'),
    config.trustedProxyCidrs,
  )
})
