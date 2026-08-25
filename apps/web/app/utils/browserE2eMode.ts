const ENABLED = 'enabled'
const DISABLED = 'disabled'

function parseMode(value: unknown): typeof ENABLED | typeof DISABLED {
  if (value !== ENABLED && value !== DISABLED) throw new Error('BROWSER_E2E_MODE_INVALID')
  return value
}

/**
 * The browser harness is deliberately unavailable from a production bundle,
 * even if public runtime configuration is tampered with after build time.
 */
export function resolveBrowserE2eClientMode(value: unknown, development: boolean): boolean {
  const mode = parseMode(value)
  if (mode === ENABLED && !development) throw new Error('BROWSER_E2E_MODE_FORBIDDEN')
  return mode === ENABLED
}

/** Keeps the private server switch and browser-visible switch inseparable. */
export function assertBrowserE2eServerMode(
  privateValue: unknown,
  publicValue: unknown,
  development: boolean,
): void {
  const privateMode = parseMode(privateValue)
  const publicMode = parseMode(publicValue)
  if (privateMode !== publicMode) throw new Error('BROWSER_E2E_MODE_MISMATCH')
  if (privateMode === ENABLED && !development) throw new Error('BROWSER_E2E_MODE_FORBIDDEN')
}
