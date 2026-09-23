import { describe, expect, it } from 'vitest'
import { loadApiConfig } from '../../../server/xcs/api/config.js'
import {
  DisabledPayloadResolver,
  PayloadUnavailableError,
} from '../../../server/xcs/api/payload-resolver.js'

const base = { NUXT_DATABASE_URL: 'postgres://xcs_api@localhost/xcs' }
const hosted = {
  ...base,
  NUXT_PAYLOAD_DATABASE_URL: 'postgres://xcs_payload_writer@localhost/xcs',
  XCS_HOSTED_PAYLOADS_ENABLED: 'true',
  XCS_PUBLIC_PAYLOAD_BASE_URL: 'https://payload.test',
  XCS_PAYLOAD_STORAGE_IP_HASH_SECRET: 'test-storage-ip-hash-secret-0000000',
  XCS_HOSTED_PAYLOAD_NETWORKS: 'testnet',
}

describe('API configuration', () => {
  it('starts read-only without a writer or an internal SSR token', () => {
    expect(loadApiConfig(base)).toMatchObject({
      databaseUrl: base.NUXT_DATABASE_URL,
      payloadDatabaseUrl: undefined,
      trustedProxyCidrs: [],
      allowedOrigins: ['http://localhost:3000'],
      payloadFetchEnabled: false,
      readinessMaxLedgerAgeSeconds: 120,
      operationalMetrics: { enabled: false },
      hostedPayloads: { enabled: false },
      demoPinning: { enabled: false },
    })
  })
  it('requires the least-privilege database roles without exposing URL secrets', () => {
    expect(() => loadApiConfig({})).toThrow('NUXT_DATABASE_URL is required')
    for (const url of [
      'postgres://admin:private-password@localhost/xcs',
      'not-a-url',
      'https://xcs_api@localhost/xcs',
    ]) {
      expect(() => loadApiConfig({ NUXT_DATABASE_URL: url })).toThrow(
        'NUXT_DATABASE_URL must be a PostgreSQL URL for the xcs_api role',
      )
    }
    expect(() => loadApiConfig({ ...hosted, NUXT_PAYLOAD_DATABASE_URL: undefined })).toThrow(
      'NUXT_PAYLOAD_DATABASE_URL is required',
    )
    expect(() =>
      loadApiConfig({ ...hosted, NUXT_PAYLOAD_DATABASE_URL: base.NUXT_DATABASE_URL }),
    ).toThrow('xcs_payload_writer role')
  })
  it('enables hosting only with an explicit short HTTPS origin and writer', () => {
    expect(loadApiConfig(hosted).hostedPayloads).toMatchObject({
      enabled: true,
      publicBaseUrl: 'https://payload.test',
      networks: ['testnet'],
    })
    for (const origin of [
      'http://localhost',
      'https://payload.test/path',
      'https://user:pass@payload.test',
      `https://${'a'.repeat(50)}.test`,
    ]) {
      expect(() => loadApiConfig({ ...hosted, XCS_PUBLIC_PAYLOAD_BASE_URL: origin })).toThrow(
        'short HTTPS origin',
      )
    }
    expect(() => loadApiConfig({ ...hosted, XCS_HOSTED_PAYLOADS_ENABLED: 'yes' })).toThrow(
      'exactly true or false',
    )
    expect(() =>
      loadApiConfig({ ...hosted, XCS_PAYLOAD_STORAGE_IP_HASH_SECRET: undefined }),
    ).toThrow('XCS_PAYLOAD_STORAGE_IP_HASH_SECRET is required')
  })
  it('accepts only explicit trusted proxies', () => {
    expect(
      loadApiConfig({ ...base, XCS_TRUSTED_PROXY_CIDRS: '127.0.0.1,10.42.0.0/16,2001:db8::/32' })
        .trustedProxyCidrs,
    ).toEqual(['127.0.0.1', '10.42.0.0/16', '2001:db8::/32'])
    for (const value of ['*', '0.0.0.0/0', '::/0'])
      expect(() => loadApiConfig({ ...base, XCS_TRUSTED_PROXY_CIDRS: value })).toThrow(
        'explicit IP addresses or CIDRs',
      )
  })
  it('requires a strong metrics token when enabled', () => {
    const token = 'test-operational-metrics-token-00000001'
    expect(
      loadApiConfig({ ...base, XCS_METRICS_ENABLED: 'true', XCS_METRICS_TOKEN: token })
        .operationalMetrics,
    ).toEqual({ enabled: true, token })
    expect(() => loadApiConfig({ ...base, XCS_METRICS_ENABLED: 'true' })).toThrow(
      'XCS_METRICS_TOKEN is required',
    )
    expect(() =>
      loadApiConfig({ ...base, XCS_METRICS_ENABLED: 'true', XCS_METRICS_TOKEN: 'too-short' }),
    ).toThrow('32 to 256 URL-safe random characters')
    expect(() => loadApiConfig({ ...base, XCS_METRICS_ENABLED: 'yes' })).toThrow(
      'exactly true or false',
    )
  })
  it('rejects unsafe readiness, wildcard CORS and ambiguous booleans', () => {
    expect(() => loadApiConfig({ ...base, XCS_READINESS_MAX_LEDGER_AGE_SECONDS: '0' })).toThrow(
      'XCS_READINESS_MAX_LEDGER_AGE_SECONDS',
    )
    expect(() => loadApiConfig({ ...base, XCS_ALLOWED_ORIGINS: '*' })).toThrow('cannot use *')
    expect(() => loadApiConfig({ ...base, XCS_PAYLOAD_FETCH_ENABLED: 'yes' })).toThrow(
      'exactly true or false',
    )
  })
  it('rejects invalid or contradictory issuer trust', () => {
    expect(() => loadApiConfig({ ...base, XCS_TRUSTED_ISSUERS: 'not-an-address' })).toThrow(
      'XCS_TRUSTED_ISSUERS',
    )
    const issuer = 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh'
    expect(() =>
      loadApiConfig({ ...base, XCS_TRUSTED_ISSUERS: issuer, XCS_UNTRUSTED_ISSUERS: issuer }),
    ).toThrow('must not overlap')
  })
  it('does not use the network when fetching is disabled', async () => {
    await expect(
      new DisabledPayloadResolver().resolve('https://example.test'),
    ).rejects.toBeInstanceOf(PayloadUnavailableError)
  })
})
