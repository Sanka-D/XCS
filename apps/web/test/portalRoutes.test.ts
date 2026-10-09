import { describe, expect, it } from 'vitest'
import {
  authReturnPath,
  legacyPortalDestination,
  walletReturnPath,
} from '../app/utils/portalRoutes'

describe('portal route allowlists', () => {
  it('keeps exact localized role destinations and rejects bearer/query redirects', () => {
    expect(authReturnPath('/fr/presentations')).toBe('/fr/presentations')
    expect(authReturnPath('/issuer/recipients')).toBe('/issuer/recipients')
    expect(authReturnPath('/admin')).toBe('/admin')
    expect(
      authReturnPath('/admin/applications/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/verifier'),
    ).toBe('/admin/applications/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/verifier')
    expect(
      authReturnPath(
        `/recipient/credentials/${'a'.repeat(64)}/present?profile=xrpl-testnet-xcs-v1`,
      ),
    ).toBe(`/recipient/credentials/${'a'.repeat(64)}/present?profile=xrpl-testnet-xcs-v1`)
    expect(authReturnPath('/presentations#secret')).toBe('/account')
    expect(authReturnPath('/issuer?organizationId=secret')).toBe('/account')
    expect(
      authReturnPath(`/recipient/credentials/${'a'.repeat(64)}?profile=xrpl-testnet&token=secret`),
    ).toBe('/account')
    expect(
      authReturnPath(`/recipient/credentials/${'a'.repeat(64)}?profile=https://outside.test`),
    ).toBe('/account')
    expect(authReturnPath('/admin/applications/not-an-id/verifier')).toBe('/account')
    expect(authReturnPath(`/recipient/credentials/${'a'.repeat(63)}`)).toBe('/account')
    expect(authReturnPath('https://outside.test/issuer')).toBe('/account')
  })

  it('returns wallet setup to allowlisted exact recipient and issuer screens', () => {
    expect(walletReturnPath('/fr/recipient', 'fr')).toBe('/fr/recipient')
    expect(
      walletReturnPath(
        `/issuer/issue/${'a'.repeat(8)}-${'b'.repeat(4)}-${'c'.repeat(4)}-${'d'.repeat(4)}-${'e'.repeat(12)}`,
        'en',
      ),
    ).toContain('/issuer/issue/')
    expect(walletReturnPath('/presentations#secret', 'fr')).toBe('/fr/recipient')
  })

  it('preserves locale and drops all legacy route inputs', () => {
    expect(legacyPortalDestination('/schemas/register', 'fr')).toBe(
      '/fr/issuer/schemas/new#xcs-legacy-redirect',
    )
    expect(legacyPortalDestination('/verify', 'en')).toBe('/presentations#xcs-legacy-redirect')
  })
})
