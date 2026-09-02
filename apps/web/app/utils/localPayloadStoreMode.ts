const ENABLED = 'enabled'
const DISABLED = 'disabled'

function parseMode(value: unknown): typeof ENABLED | typeof DISABLED {
  if (value !== ENABLED && value !== DISABLED) {
    throw new Error('LOCAL_PAYLOAD_STORE_MODE_INVALID')
  }
  return value
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[(.*)\]$/u, '$1')
  if (normalized === 'localhost' || normalized === '::1') return true
  const octets = normalized.split('.')
  return (
    octets.length === 4 &&
    octets[0] === '127' &&
    octets.every((octet) => /^\d{1,3}$/u.test(octet) && Number(octet) <= 255)
  )
}

/** The browser store is deliberately unavailable outside a loopback development origin. */
export function resolveLocalPayloadStoreClientMode(
  value: unknown,
  development: boolean,
  hostname: string,
): boolean {
  const mode = parseMode(value)
  if (mode === ENABLED && !development) throw new Error('LOCAL_PAYLOAD_STORE_FORBIDDEN')
  if (mode === ENABLED && !isLoopbackHostname(hostname)) {
    throw new Error('LOCAL_PAYLOAD_STORE_ORIGIN_FORBIDDEN')
  }
  return mode === ENABLED
}

/** Keeps the private server switch and browser-visible switch inseparable. */
export function assertLocalPayloadStoreServerMode(
  privateValue: unknown,
  publicValue: unknown,
  development: boolean,
): void {
  const privateMode = parseMode(privateValue)
  const publicMode = parseMode(publicValue)
  if (privateMode !== publicMode) throw new Error('LOCAL_PAYLOAD_STORE_MODE_MISMATCH')
  if (privateMode === ENABLED && !development) {
    throw new Error('LOCAL_PAYLOAD_STORE_FORBIDDEN')
  }
}
