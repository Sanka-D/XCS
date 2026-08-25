function isLoopbackHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '[::1]' || /^127(?:\.\d{1,3}){3}$/u.test(hostname)
}

/**
 * Validates the browser-visible submission endpoint before it is serialized
 * into a page or handed to xrpl.js. Private quorum endpoints never belong here.
 */
export function assertPublicRpcUrl(input: unknown): string {
  if (typeof input !== 'string' || input.length === 0 || input.trim() !== input) {
    throw new Error('PUBLIC_RPC_URL_INVALID')
  }

  let parsed: URL
  try {
    parsed = new URL(input)
  } catch {
    throw new Error('PUBLIC_RPC_URL_INVALID')
  }

  if (
    parsed.username !== '' ||
    parsed.password !== '' ||
    (parsed.protocol !== 'wss:' &&
      !(parsed.protocol === 'ws:' && isLoopbackHostname(parsed.hostname)))
  ) {
    throw new Error('PUBLIC_RPC_URL_UNSAFE')
  }

  return parsed.toString()
}
