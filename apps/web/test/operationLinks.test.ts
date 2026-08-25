import { describe, expect, it } from 'vitest'

import {
  assertLinkGeneration,
  assertLinkProfile,
  buildCredentialAcceptLink,
  buildCredentialVerifyLink,
  singleRouteQueryValue,
} from '../app/utils/operationLinks'

const ISSUER = 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh'
const SUBJECT = 'r9cZA1mLK5R5Am25ArfXFmqgNwjZgnfk59'
const SCHEMA_UID = '12'.repeat(32)
const GENERATION_ID = '34'.repeat(32)

describe('credential operation links', () => {
  it('omits the subject from an acceptance link and binds profile plus generation', () => {
    const link = buildCredentialAcceptLink({
      profileId: 'xrpl-testnet-xcs-v0.1',
      issuer: ISSUER,
      schemaUid: SCHEMA_UID.toUpperCase(),
      generationId: GENERATION_ID.toUpperCase(),
    })

    expect(link).toContain('profile=xrpl-testnet-xcs-v0.1')
    expect(link).toContain(`issuer=${ISSUER}`)
    expect(link).toContain(`schema=${SCHEMA_UID}`)
    expect(link).toContain(`generation=${GENERATION_ID}`)
    expect(link).not.toContain('subject=')
  })

  it('binds all exact lookup coordinates in a verification link', () => {
    const link = buildCredentialVerifyLink({
      profileId: 'profile with spaces',
      issuer: ISSUER,
      subject: SUBJECT,
      schemaUid: SCHEMA_UID,
      generationId: GENERATION_ID,
    })

    expect(link).toBe(
      `/verify?profile=profile+with+spaces&issuer=${ISSUER}&subject=${SUBJECT}&schema=${SCHEMA_UID}&generation=${GENERATION_ID}`,
    )
  })

  it('fails closed when a linked profile or generation differs', () => {
    expect(() => assertLinkProfile('profile-a', 'profile-b')).toThrow(
      'CREDENTIAL_LINK_PROFILE_MISMATCH',
    )
    expect(() => assertLinkGeneration(GENERATION_ID, '56'.repeat(32))).toThrow(
      'CREDENTIAL_LINK_GENERATION_MISMATCH',
    )
  })

  it('does not silently drop repeated or valueless security constraints', () => {
    expect(singleRouteQueryValue(undefined)).toBe('')
    expect(singleRouteQueryValue(GENERATION_ID)).toBe(GENERATION_ID)
    expect(singleRouteQueryValue('')).not.toBe('')
    expect(singleRouteQueryValue([GENERATION_ID, '56'.repeat(32)])).not.toBe('')
    expect(singleRouteQueryValue(null)).not.toBe('')
  })
})
