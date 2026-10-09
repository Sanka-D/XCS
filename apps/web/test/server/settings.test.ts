import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { loadApiConfig } from '../../server/xcs/config.js'
import { apiEnvironment, apiSettings, publicProfileId } from '../../server/xcs/settings.js'

const CONTROLLED_PILOT_PROFILE = fileURLToPath(
  new URL('../fixtures/network-profiles/controlled-pilot.json', import.meta.url),
)
const BROWSER_E2E_PROFILE = fileURLToPath(
  new URL('../fixtures/network-profiles/browser-e2e.json', import.meta.url),
)

describe('checked-in web settings', () => {
  it('keeps the present defaults and the safe posture', () => {
    const config = loadApiConfig(apiEnvironment({ XCS_DATABASE_URL: 'postgres://localhost/xcs' }))
    expect(config).toMatchObject({
      payloadFetchEnabled: false,
      readinessMaxLedgerAgeSeconds: 120,
      ipfsGateway: 'https://ipfs.io/',
      trustedIssuers: [],
      untrustedIssuers: [],
      operationalMetrics: { enabled: false },
      demoPinning: { enabled: false },
    })
  })

  it('cannot be reintroduced or weakened by a deployment variable of the same name', () => {
    const issuer = 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh'
    const config = loadApiConfig(
      apiEnvironment({
        XCS_DATABASE_URL: 'postgres://localhost/xcs',
        XCS_PAYLOAD_FETCH_ENABLED: 'true',
        XCS_DEMO_PINNING_ENABLED: 'true',
        XCS_READINESS_MAX_LEDGER_AGE_SECONDS: '3600',
        XCS_IPFS_GATEWAY_URL: 'https://gateway.invalid.example/',
        XCS_TRUSTED_ISSUERS: issuer,
      }),
    )
    expect(config).toMatchObject({
      payloadFetchEnabled: false,
      readinessMaxLedgerAgeSeconds: 120,
      ipfsGateway: 'https://ipfs.io/',
      trustedIssuers: [],
      operationalMetrics: { enabled: false },
      demoPinning: { enabled: false },
    })
  })

  it('takes the metrics token from the deployment, since its presence is the switch', () => {
    const token = 'deployment-supplied-metrics-token-0001'
    expect(apiSettings).not.toHaveProperty('XCS_METRICS_TOKEN')
    expect(
      loadApiConfig(
        apiEnvironment({
          XCS_DATABASE_URL: 'postgres://localhost/xcs',
          XCS_METRICS_TOKEN: token,
        }),
      ).operationalMetrics,
    ).toEqual({ enabled: true, token })
  })

  it('leaves the pinning secret unread while demo pinning is off', () => {
    expect(apiSettings.XCS_DEMO_PINNING_ENABLED).toBe('false')
    expect(
      loadApiConfig(apiEnvironment({ XCS_DATABASE_URL: 'postgres://localhost/xcs' })).demoPinning,
    ).toEqual({ enabled: false })
  })

  it('keeps the canonical Identity issuer when local qualification is not enabled', () => {
    expect(
      apiEnvironment({
        XCS_AUTH_ORIGIN: 'https://localhost:3445',
        XCS_IDENTITY_ISSUER: 'https://localhost:3446',
      }).XCS_IDENTITY_ISSUER,
    ).toBe('https://account.xrpl.in')
  })

  it('allows an explicit HTTPS loopback Identity provider for local qualification', () => {
    expect(
      apiEnvironment({
        XCS_LOCAL_IDENTITY_QUALIFICATION: '1',
        XCS_AUTH_ORIGIN: 'https://localhost:3445',
        XCS_IDENTITY_ISSUER: 'https://127.0.0.1:3446',
      }).XCS_IDENTITY_ISSUER,
    ).toBe('https://127.0.0.1:3446')
  })

  it.each([
    {
      XCS_LOCAL_IDENTITY_QUALIFICATION: 'true',
      XCS_AUTH_ORIGIN: 'https://localhost:3445',
      XCS_IDENTITY_ISSUER: 'https://localhost:3446',
    },
    {
      XCS_LOCAL_IDENTITY_QUALIFICATION: '1',
      XCS_AUTH_ORIGIN: 'https://xcs.example',
      XCS_IDENTITY_ISSUER: 'https://localhost:3446',
    },
    {
      XCS_LOCAL_IDENTITY_QUALIFICATION: '1',
      XCS_AUTH_ORIGIN: 'https://localhost:3445',
      XCS_IDENTITY_ISSUER: 'https://identity.example',
    },
    {
      XCS_LOCAL_IDENTITY_QUALIFICATION: '1',
      XCS_AUTH_ORIGIN: 'https://localhost:3445',
      XCS_IDENTITY_ISSUER: 'http://127.0.0.1:3446',
    },
    {
      XCS_LOCAL_IDENTITY_QUALIFICATION: '1',
      XCS_AUTH_ORIGIN: 'https://localhost:3445',
      XCS_IDENTITY_ISSUER: 'https://localhost:3446/path',
    },
    {
      XCS_LOCAL_IDENTITY_QUALIFICATION: '1',
      XCS_AUTH_ORIGIN: 'https://localhost:3445',
      XCS_IDENTITY_ISSUER: ' https://localhost:3446',
    },
  ])('rejects an unsafe local Identity qualification contract', (environment) => {
    expect(() => apiEnvironment(environment)).toThrow('LOCAL_IDENTITY_QUALIFICATION_INVALID')
  })
})

describe('the browser-visible profile identifier', () => {
  it('is the profileId inside the profile file this deployment serves', () => {
    expect(publicProfileId({ XCS_NETWORK_PROFILE: CONTROLLED_PILOT_PROFILE })).toBe(
      'commons-testnet-xcs-v0.1-controlled-pilot',
    )
    expect(publicProfileId({ XCS_NETWORK_PROFILE: BROWSER_E2E_PROFILE })).toBe(
      'xrpl-testnet-xcs-browser-e2e',
    )
  })

  it('is empty when no profile file is named, which does not filter the network list', () => {
    expect(publicProfileId({})).toBe('')
    expect(publicProfileId({ XCS_NETWORK_PROFILE: '  ' })).toBe('')
  })

  it('fails closed on a missing or invalid profile rather than guessing a label', () => {
    expect(() => publicProfileId({ XCS_NETWORK_PROFILE: '/xcs/no/such/profile.json' })).toThrow()
    expect(() =>
      publicProfileId({
        XCS_NETWORK_PROFILE: fileURLToPath(
          new URL('../../../../config/networks/testnet.example.json', import.meta.url),
        ),
      }),
    ).toThrow()
  })
})
