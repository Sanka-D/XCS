import { describe, expect, it } from 'vitest'

import { parseVerificationReport } from '../src/index.js'

describe('verification report runtime parsing', () => {
  it('accepts all four explicit dimensions including unknown issuer trust', () => {
    expect(
      parseVerificationReport({
        onChain: 'active',
        schema: 'valid',
        payload: 'not_checked',
        issuerTrust: 'unknown',
        generationId: 'ab'.repeat(32),
      }),
    ).toEqual({
      onChain: 'active',
      schema: 'valid',
      payload: 'not_checked',
      issuerTrust: 'unknown',
      generationId: 'ab'.repeat(32),
    })
  })

  it.each(['onChain', 'schema', 'payload', 'issuerTrust'] as const)(
    'rejects a missing %s dimension',
    (dimension) => {
      const report: Record<string, unknown> = {
        onChain: 'active',
        schema: 'valid',
        payload: 'valid',
        issuerTrust: 'trusted',
      }
      delete report[dimension]
      expect(() => parseVerificationReport(report)).toThrowError(
        expect.objectContaining({ code: 'VERIFICATION_REPORT_INVALID', path: `$.${dimension}` }),
      )
    },
  )

  it('rejects unknown properties, statuses and non-canonical generation IDs', () => {
    const valid = {
      onChain: 'active',
      schema: 'valid',
      payload: 'valid',
      issuerTrust: 'trusted',
    }
    expect(() => parseVerificationReport({ ...valid, trusted: true })).toThrowError(
      expect.objectContaining({ code: 'VERIFICATION_REPORT_INVALID', path: '$.trusted' }),
    )
    expect(() => parseVerificationReport({ ...valid, issuerTrust: 'verified' })).toThrowError(
      expect.objectContaining({ code: 'VERIFICATION_REPORT_INVALID', path: '$.issuerTrust' }),
    )
    expect(() => parseVerificationReport({ ...valid, generationId: 'AB'.repeat(32) })).toThrowError(
      expect.objectContaining({ code: 'VERIFICATION_REPORT_INVALID', path: '$.generationId' }),
    )
  })
})
