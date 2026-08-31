import { assertInternalSsrToken, parseTrustedProxyCidrs } from '../utils/internalSsrRateLimit'

export default defineNitroPlugin(() => {
  const config = useRuntimeConfig()
  assertInternalSsrToken(config.apiInternalToken)
  parseTrustedProxyCidrs(config.trustedProxyCidrs)
  if (!import.meta.dev && config.apiInternalToken === 'xcs-development-internal-token-0001') {
    throw new Error('INTERNAL_SSR_TOKEN_FORBIDDEN')
  }
})
