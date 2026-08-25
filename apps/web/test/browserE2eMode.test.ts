import { describe, expect, it } from 'vitest'

import {
  assertBrowserE2eServerMode,
  resolveBrowserE2eClientMode,
} from '../app/utils/browserE2eMode'

describe('browser E2E mode gate', () => {
  it('is disabled by default and enabled only in development', () => {
    expect(resolveBrowserE2eClientMode('disabled', false)).toBe(false)
    expect(resolveBrowserE2eClientMode('enabled', true)).toBe(true)
    expect(() => resolveBrowserE2eClientMode('enabled', false)).toThrow(
      'BROWSER_E2E_MODE_FORBIDDEN',
    )
  })

  it('rejects malformed or split public/private configuration', () => {
    expect(() => resolveBrowserE2eClientMode(true, true)).toThrow('BROWSER_E2E_MODE_INVALID')
    expect(() => assertBrowserE2eServerMode('enabled', 'disabled', true)).toThrow(
      'BROWSER_E2E_MODE_MISMATCH',
    )
  })

  it('rejects the synthetic dependencies in a production server', () => {
    expect(() => assertBrowserE2eServerMode('enabled', 'enabled', false)).toThrow(
      'BROWSER_E2E_MODE_FORBIDDEN',
    )
    expect(() => assertBrowserE2eServerMode('disabled', 'disabled', false)).not.toThrow()
  })
})
