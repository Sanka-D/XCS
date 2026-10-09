const AUTH_DESTINATIONS = new Set([
  '/account',
  '/admin',
  '/admin/audit',
  '/admin/verifiers',
  '/issuer',
  '/issuer/apply',
  '/issuer/application',
  '/issuer/credentials',
  '/issuer/recipients',
  '/issuer/schemas',
  '/issuer/schemas/new',
  '/issuer/settings',
  '/recipient',
  '/recipient/invitations',
  '/presentations',
  '/verifier',
  '/verifier/apply',
])

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const PROFILE_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/u
const CREDENTIAL_DESTINATION_PATTERNS = [
  /^\/issuer\/credentials\/[0-9a-f]{64}$/u,
  /^\/recipient\/credentials\/[0-9a-f]{64}(?:\/present)?$/u,
]
const AUTH_DESTINATION_PATTERNS = [
  new RegExp(`^/admin/applications/${UUID}/(?:issuer|verifier)$`, 'u'),
  new RegExp(`^/issuer/issue/${UUID}$`, 'u'),
  ...CREDENTIAL_DESTINATION_PATTERNS,
]

const WALLET_DESTINATIONS = [
  new RegExp(`^/issuer(?:/(?:schemas/new|recipients|issue/${UUID}))?$`, 'u'),
  /^\/recipient(?:\/credentials\/[0-9a-f]{64})?$/u,
]

function localizedPath(path: string, locale: string): string {
  return locale === 'fr' ? `/fr${path}` : path
}

function unlocalizedPath(value: string): string {
  return value.startsWith('/fr/') ? value.slice(3) : value
}

/** A fixed in-app auth destination, never a bearer, fragment or nested redirect. */
export function authReturnPath(value: unknown): string {
  if (typeof value !== 'string' || value.includes('#')) return '/account'
  let target: URL
  try {
    target = new URL(value, 'https://xcs.invalid')
  } catch {
    return '/account'
  }
  if (target.origin !== 'https://xcs.invalid' || !value.startsWith('/')) return '/account'
  const path = unlocalizedPath(target.pathname)
  if (target.search) {
    const entries = [...target.searchParams.entries()]
    const profile = target.searchParams.get('profile')
    return CREDENTIAL_DESTINATION_PATTERNS.some((pattern) => pattern.test(path)) &&
      entries.length === 1 &&
      entries[0]?.[0] === 'profile' &&
      profile !== null &&
      PROFILE_ID.test(profile)
      ? value
      : '/account'
  }
  return AUTH_DESTINATIONS.has(path) ||
    AUTH_DESTINATION_PATTERNS.some((pattern) => pattern.test(path))
    ? value
    : '/account'
}

/** Wallet onboarding may return only to the exact role screen that initiated it. */
export function walletReturnPath(value: unknown, locale: string, fallback = '/recipient'): string {
  if (typeof value !== 'string' || value.includes('?') || value.includes('#')) {
    return localizedPath(fallback, locale)
  }
  const path = unlocalizedPath(value)
  return WALLET_DESTINATIONS.some((pattern) => pattern.test(path))
    ? value
    : localizedPath(fallback, locale)
}

export const LEGACY_PORTAL_REDIRECTS = {
  '/studio': '/',
  '/schemas/register': '/issuer/schemas/new',
  '/issue': '/issuer/recipients',
  '/accept': '/recipient',
  '/revoke': '/issuer/credentials',
  '/verify': '/presentations',
  '/operations': '/account',
} as const

export function legacyPortalDestination(
  path: keyof typeof LEGACY_PORTAL_REDIRECTS,
  locale: string,
) {
  // A non-empty sentinel replaces any incoming fragment across the HTTP
  // redirect. app.vue removes it before the redirected page is used.
  return `${localizedPath(LEGACY_PORTAL_REDIRECTS[path], locale)}#xcs-legacy-redirect`
}
