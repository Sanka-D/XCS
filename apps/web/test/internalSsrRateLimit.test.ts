import { describe, expect, it } from 'vitest'

import {
  parseTrustedProxyCidrs,
  resolveInternalSsrRateLimit,
  resolveSsrClientAddress,
} from '../server/utils/internalSsrRateLimit'

const TOKEN = 'test-internal-ssr-token-000000000001'

describe('internal SSR rate-limit boundary', () => {
  it('derives a stable opaque key from the direct peer without creating client sessions', () => {
    const first = resolveInternalSsrRateLimit(TOKEN, '198.51.100.10', undefined, '')
    const second = resolveInternalSsrRateLimit(TOKEN, '198.51.100.10', '203.0.113.250', '')
    const other = resolveInternalSsrRateLimit(TOKEN, '198.51.100.11', undefined, '')

    expect(first).toEqual(second)
    expect(first.headers['x-xcs-client-key']).toMatch(/^[0-9a-f]{64}$/u)
    expect(first.headers['x-xcs-client-key']).not.toContain('198.51.100.10')
    expect(other.headers['x-xcs-client-key']).not.toBe(first.headers['x-xcs-client-key'])
  })

  it('uses forwarded addresses only behind an explicitly trusted immediate proxy', () => {
    const trusted = '10.42.0.0/16,2001:db8:42::/48'
    expect(resolveSsrClientAddress('10.42.0.5', '198.51.100.10', trusted)).toBe('198.51.100.10')
    expect(resolveSsrClientAddress('203.0.113.5', '198.51.100.10', trusted)).toBe('203.0.113.5')
    expect(resolveSsrClientAddress('::ffff:203.0.113.5', undefined, trusted)).toBe('203.0.113.5')
  })

  it('walks a trusted proxy chain from right to left and ignores attacker-controlled prefixes', () => {
    const trusted = '10.42.0.0/16'
    const first = resolveSsrClientAddress(
      '10.42.0.5',
      '192.0.2.250, 198.51.100.10, 10.42.0.6',
      trusted,
    )
    const rotatedPrefix = resolveSsrClientAddress(
      '10.42.0.5',
      '203.0.113.251, 198.51.100.10, 10.42.0.6',
      trusted,
    )
    expect(first).toBe('198.51.100.10')
    expect(rotatedPrefix).toBe(first)
  })

  it('fails closed for malformed forwarded chains, tokens and proxy ranges', () => {
    expect(resolveSsrClientAddress('10.42.0.5', 'attacker, 198.51.100.10', '10.42.0.0/16')).toBe(
      '10.42.0.5',
    )
    expect(resolveSsrClientAddress(undefined, '198.51.100.10', '10.42.0.0/16')).toBe(
      'unresolved-peer',
    )
    expect(() => resolveInternalSsrRateLimit('too-short', '127.0.0.1', undefined, '')).toThrow(
      'INTERNAL_SSR_TOKEN_INVALID',
    )
    expect(() => parseTrustedProxyCidrs('*')).toThrow('INTERNAL_SSR_TRUSTED_PROXY_CIDRS_INVALID')
    expect(() => parseTrustedProxyCidrs('0.0.0.0/0')).toThrow(
      'INTERNAL_SSR_TRUSTED_PROXY_CIDRS_INVALID',
    )
    expect(() => parseTrustedProxyCidrs('::/0')).toThrow('INTERNAL_SSR_TRUSTED_PROXY_CIDRS_INVALID')
  })
})
