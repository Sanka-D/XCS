import { describe, expect, it } from 'vitest'

import { assertPublicRpcUrl } from '../app/utils/publicRpcUrl'

describe('public XRPL submission endpoint', () => {
  it.each([
    'wss://s.altnet.rippletest.net:51233',
    'wss://public.example.test/xrpl',
    'ws://localhost:6006',
    'ws://127.0.0.1:6006',
    'ws://[::1]:6006',
  ])('accepts a browser-safe endpoint: %s', (value) => {
    expect(assertPublicRpcUrl(value)).toBe(new URL(value).toString())
  })

  it.each([
    '',
    ' wss://public.example.test',
    'https://public.example.test',
    'ws://public.example.test',
    'wss://user:password@public.example.test',
    'not-a-url',
  ])('rejects an endpoint that could leak credentials or weaken transport: %s', (value) => {
    expect(() => assertPublicRpcUrl(value)).toThrow(/^PUBLIC_RPC_URL_/u)
  })
})
