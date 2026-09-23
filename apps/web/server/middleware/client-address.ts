import { defineEventHandler, getRequestHeader } from 'h3'
import { resolveClientAddress } from '../utils/clientAddress'

export default defineEventHandler((event) => {
  // Nitro 2 stores localFetch's server-owned context on req.__unenv__, but does
  // not copy arbitrary fields to the new H3 event. HTTP headers cannot set it.
  const request = event.node.req as typeof event.node.req & {
    __unenv__?: { xcsClientAddress?: unknown }
  }
  const inheritedAddress = request.__unenv__?.xcsClientAddress
  event.context.xcsClientAddress ??=
    typeof inheritedAddress === 'string'
      ? inheritedAddress
      : resolveClientAddress(
          event.node.req.socket.remoteAddress,
          getRequestHeader(event, 'x-forwarded-for'),
          process.env.XCS_TRUSTED_PROXY_CIDRS ?? '',
        )
})
