import ipaddr from 'ipaddr.js'

type Address = ReturnType<typeof ipaddr.parse>
type Cidr = ReturnType<typeof ipaddr.parseCIDR>

function normalizedAddress(value: unknown): Address | undefined {
  if (typeof value !== 'string' || !ipaddr.isValid(value)) return undefined
  const parsed = ipaddr.parse(value)
  return parsed instanceof ipaddr.IPv6 && parsed.isIPv4MappedAddress()
    ? parsed.toIPv4Address()
    : parsed
}

function normalizedAddressText(address: Address): string {
  return address instanceof ipaddr.IPv6 ? address.toRFC5952String() : address.toString()
}

export function parseTrustedProxyCidrs(value: unknown): Cidr[] {
  if (typeof value !== 'string') throw new Error('TRUSTED_PROXY_CIDRS_INVALID')
  const entries = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)

  return entries.map((entry) => {
    if (!entry.includes('/') && !ipaddr.isValid(entry)) {
      throw new Error('TRUSTED_PROXY_CIDRS_INVALID')
    }
    const withPrefix = entry.includes('/')
      ? entry
      : `${entry}/${ipaddr.parse(entry).kind() === 'ipv4' ? 32 : 128}`
    if (!ipaddr.isValidCIDR(withPrefix)) {
      throw new Error('TRUSTED_PROXY_CIDRS_INVALID')
    }
    const cidr = ipaddr.parseCIDR(withPrefix)
    if (cidr[1] === 0) throw new Error('TRUSTED_PROXY_CIDRS_INVALID')
    return cidr
  })
}

function isTrusted(address: Address, trustedProxyCidrs: Cidr[]): boolean {
  return trustedProxyCidrs.some(([network, prefix]) => {
    if (network.kind() !== address.kind()) return false
    return address.match(network, prefix)
  })
}

export function resolveClientAddress(
  remoteAddress: unknown,
  forwardedFor: unknown,
  trustedProxyCidrsInput: unknown,
): string {
  const remote = normalizedAddress(remoteAddress)
  if (remote === undefined) return 'unresolved-peer'

  const trustedProxyCidrs = parseTrustedProxyCidrs(trustedProxyCidrsInput)
  if (!isTrusted(remote, trustedProxyCidrs) || typeof forwardedFor !== 'string') {
    return normalizedAddressText(remote)
  }

  const forwarded = forwardedFor.split(',').map((entry) => normalizedAddress(entry.trim()))
  if (forwarded.length === 0 || forwarded.some((entry) => entry === undefined)) {
    return normalizedAddressText(remote)
  }

  let current = remote
  for (let index = forwarded.length - 1; index >= 0; index -= 1) {
    if (!isTrusted(current, trustedProxyCidrs)) break
    current = forwarded[index]!
  }
  return normalizedAddressText(current)
}
