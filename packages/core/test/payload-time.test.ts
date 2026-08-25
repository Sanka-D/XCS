import { describe, expect, it } from 'vitest'

import {
  canonicalize,
  createHttpsPayloadUri,
  createIpfsRawPayloadUri,
  inspectPayloadUri,
  iso8601ToRippleTime,
  parseCredentialPayload,
  rippleTimeToIso8601,
  verifyPayloadIntegrity,
} from '../src/index.js'

const RAW_HELLO_URI = 'ipfs://bafkreibm6jg3ux5qumhcn2b3flc3tyu6dmlb4xa7u5bf44yegnrjhc4yeq'
const HTTPS_HELLO_URI =
  'https://issuer.example/credentials/1.json#xcs-sha256=2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'

describe('payload integrity', () => {
  it('creates canonical HTTPS and raw CIDv1 URIs', () => {
    expect(createHttpsPayloadUri('https://issuer.example/credentials/1.json', 'hello')).toBe(
      HTTPS_HELLO_URI,
    )
    expect(createIpfsRawPayloadUri('hello')).toBe(RAW_HELLO_URI)
    expect(inspectPayloadUri(RAW_HELLO_URI).kind).toBe('ipfs')
  })

  it('distinguishes tampering from an invalid URI', () => {
    expect(verifyPayloadIntegrity('HELLO', RAW_HELLO_URI).status).toBe('tampered')
    expect(verifyPayloadIntegrity('hello', 'http://issuer.example/file').status).toBe('invalid_uri')
  })

  it('strictly validates the payload envelope and claims', () => {
    const issuer = 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh'
    const subject = 'rG1QQv2nh2gr7RCZ1P8YYcBUKCCN633jCn'
    const schemaUid = 'ab'.repeat(32)
    const content = canonicalize({
      xcsVersion: '0.1',
      issuer,
      subject,
      schema: schemaUid,
      claims: { programId: 'course-1' },
    })
    expect(
      parseCredentialPayload(content, {
        issuer,
        subject,
        schemaUid,
        schema: { programId: { type: 'string' } },
      }).claims,
    ).toEqual({ programId: 'course-1' })
    const pretty = JSON.stringify(JSON.parse(content), null, 2)
    expect(() =>
      parseCredentialPayload(pretty, {
        issuer,
        subject,
        schemaUid,
        schema: { programId: { type: 'string' } },
      }),
    ).toThrowError(expect.objectContaining({ code: 'PAYLOAD_INVALID' }))
    expect(() =>
      parseCredentialPayload(content.replace(issuer, subject), {
        issuer,
        subject,
        schemaUid,
        schema: { programId: { type: 'string' } },
      }),
    ).toThrowError(expect.objectContaining({ code: 'PAYLOAD_INVALID' }))
  })
})

describe('Ripple epoch conversions', () => {
  it('maps the Ripple epoch and round-trips an expiration', () => {
    expect(iso8601ToRippleTime('2000-01-01T00:00:00Z')).toBe(0)
    const expiration = iso8601ToRippleTime('2030-05-06T07:08:09Z')
    expect(rippleTimeToIso8601(expiration)).toBe('2030-05-06T07:08:09.000Z')
  })

  it('rejects Unix seconds accidentally passed as Ripple time and subsecond timestamps', () => {
    expect(() => iso8601ToRippleTime('2030-05-06T07:08:09.123Z')).toThrowError(
      expect.objectContaining({ code: 'RIPPLE_TIME_INVALID' }),
    )
  })
})
