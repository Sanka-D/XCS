import { describe, expect, it } from 'vitest'

import {
  assertLocalPayloadStoreServerMode,
  resolveLocalPayloadStoreClientMode,
} from '../app/utils/localPayloadStoreMode'

describe('local payload store mode gate', () => {
  it('is disabled by default and enabled only for loopback development', () => {
    expect(resolveLocalPayloadStoreClientMode('disabled', false, 'xcs.example')).toBe(false)
    expect(resolveLocalPayloadStoreClientMode('enabled', true, 'localhost')).toBe(true)
    expect(resolveLocalPayloadStoreClientMode('enabled', true, '127.0.0.1')).toBe(true)
    expect(resolveLocalPayloadStoreClientMode('enabled', true, '[::1]')).toBe(true)
  })

  it('rejects production, remote origins and malformed or split configuration', () => {
    expect(() => resolveLocalPayloadStoreClientMode('enabled', false, 'localhost')).toThrow(
      'LOCAL_PAYLOAD_STORE_FORBIDDEN',
    )
    expect(() => resolveLocalPayloadStoreClientMode('enabled', true, 'xcs.example')).toThrow(
      'LOCAL_PAYLOAD_STORE_ORIGIN_FORBIDDEN',
    )
    expect(() => resolveLocalPayloadStoreClientMode('enabled', true, '127.0.0.999')).toThrow(
      'LOCAL_PAYLOAD_STORE_ORIGIN_FORBIDDEN',
    )
    expect(() => resolveLocalPayloadStoreClientMode(true, true, 'localhost')).toThrow(
      'LOCAL_PAYLOAD_STORE_MODE_INVALID',
    )
    expect(() => assertLocalPayloadStoreServerMode('enabled', 'disabled', true)).toThrow(
      'LOCAL_PAYLOAD_STORE_MODE_MISMATCH',
    )
    expect(() => assertLocalPayloadStoreServerMode('enabled', 'enabled', false)).toThrow(
      'LOCAL_PAYLOAD_STORE_FORBIDDEN',
    )
  })
})
