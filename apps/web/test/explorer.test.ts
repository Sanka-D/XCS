import { describe, expect, it } from 'vitest'

import {
  decodeUtf8HexForDisplay,
  displayXrplTime,
  explorerErrorKind,
  explorerResultPath,
  httpStatusFromError,
  normalizedExplorerQuery,
  normalizedHex256,
  singleQueryValue,
} from '../app/utils/explorer'

const HASH = 'ab'.repeat(32)

describe('explorer routing and boundary helpers', () => {
  it('normalizes only a single bounded search value', () => {
    expect(singleQueryValue(['unsafe', 'duplicate'])).toBe('')
    expect(normalizedExplorerQuery(`  ${'x'.repeat(250)}  `)).toHaveLength(128)
    expect(normalizedHex256(HASH.toUpperCase())).toBe(HASH)
    expect(normalizedHex256('not-a-hash')).toBeUndefined()
  })

  it('routes only complete exact result coordinates', () => {
    expect(explorerResultPath({ type: 'schema', schemaUid: HASH })).toBe(`/schemas/${HASH}`)
    expect(explorerResultPath({ type: 'credential_generation', generationId: HASH })).toBe(
      `/credentials/${HASH}`,
    )
    expect(explorerResultPath({ type: 'credential_event', transactionHash: HASH })).toBe(
      `/transactions/${HASH}`,
    )
    expect(explorerResultPath({ type: 'schema', schemaUid: 'invalid' })).toBeUndefined()
  })

  it('classifies fetch errors without exposing their server message', () => {
    expect(httpStatusFromError({ response: { status: 503 } })).toBe(503)
    expect(explorerErrorKind({ statusCode: 404 })).toBe('not-found')
    expect(explorerErrorKind({ response: { status: 503 } })).toBe('unavailable')
    expect(explorerErrorKind({ status: 400 })).toBe('invalid')
    expect(explorerErrorKind(new Error('secret upstream detail'))).toBe('generic')
  })

  it('decodes display-only UTF-8 URI metadata and rejects malformed or control bytes', () => {
    const uri = 'https://issuer.example/credential.json'
    const encoded = Array.from(new TextEncoder().encode(uri), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join('')
    expect(decodeUtf8HexForDisplay(encoded)).toBe(uri)
    expect(decodeUtf8HexForDisplay('0')).toBeUndefined()
    expect(decodeUtf8HexForDisplay('zz')).toBeUndefined()
    expect(decodeUtf8HexForDisplay('00')).toBeUndefined()
  })

  it('formats XRPL epoch seconds without treating them as Unix seconds', () => {
    expect(displayXrplTime(0, 'en-US')).toContain('Jan 1, 2000')
    expect(displayXrplTime(-1, 'en-US')).toBeUndefined()
  })
})
