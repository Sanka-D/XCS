import { describe, expect, it } from 'vitest'

import { loadApiConfig } from '../src/config.js'
import { DisabledPayloadResolver, PayloadUnavailableError } from '../src/payload-resolver.js'

describe('API configuration', () => {
  it('uses repository-standard XCS variables and disables fetching by default', () => {
    const config = loadApiConfig({
      XCS_DATABASE_URL: 'postgres://xcs:xcs@localhost/xcs',
      XCS_API_PORT: '3001',
    })
    expect(config).toMatchObject({
      databaseUrl: 'postgres://xcs:xcs@localhost/xcs',
      host: '0.0.0.0',
      port: 3001,
      allowedOrigins: ['http://localhost:3000'],
      payloadFetchEnabled: false,
      readinessMaxLedgerAgeSeconds: 120,
      demoPinning: { enabled: false },
    })
  })

  it('rejects an unsafe readiness staleness threshold', () => {
    expect(() =>
      loadApiConfig({
        XCS_DATABASE_URL: 'postgres://localhost/xcs',
        XCS_READINESS_MAX_LEDGER_AGE_SECONDS: '0',
      }),
    ).toThrow('XCS_READINESS_MAX_LEDGER_AGE_SECONDS')
  })

  it('rejects wildcard CORS and ambiguous booleans', () => {
    expect(() =>
      loadApiConfig({
        XCS_DATABASE_URL: 'postgres://localhost/xcs',
        XCS_ALLOWED_ORIGINS: '*',
      }),
    ).toThrow('cannot use *')
    expect(() =>
      loadApiConfig({
        XCS_DATABASE_URL: 'postgres://localhost/xcs',
        XCS_PAYLOAD_FETCH_ENABLED: 'yes',
      }),
    ).toThrow('exactly true or false')
  })

  it('rejects invalid or contradictory issuer trust configuration', () => {
    expect(() =>
      loadApiConfig({
        XCS_DATABASE_URL: 'postgres://localhost/xcs',
        XCS_TRUSTED_ISSUERS: 'not-an-address',
      }),
    ).toThrow('XCS_TRUSTED_ISSUERS')

    const issuer = 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh'
    expect(() =>
      loadApiConfig({
        XCS_DATABASE_URL: 'postgres://localhost/xcs',
        XCS_TRUSTED_ISSUERS: issuer,
        XCS_UNTRUSTED_ISSUERS: issuer,
      }),
    ).toThrow('must not overlap')
  })

  it('uses a network-free resolver when fetching is disabled', async () => {
    await expect(
      new DisabledPayloadResolver().resolve('https://example.test'),
    ).rejects.toBeInstanceOf(PayloadUnavailableError)
  })
})
