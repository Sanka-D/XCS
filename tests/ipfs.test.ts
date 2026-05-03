import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stub useRuntimeConfig (Nuxt global) before importing the SUT.
(globalThis as any).useRuntimeConfig = () => ({
  pinataJwt: 'test-jwt',
  public: { ipfsGateway: 'https://gateway.pinata.cloud' },
});

import { pinJSON, fetchJSON, unpin, gatewayUrl } from '../server/utils/ipfs';

describe('ipfs', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('pinJSON posts to Pinata and returns the CID', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ IpfsHash: 'bafyTest' }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    const cid = await pinJSON({ hello: 'world' });

    expect(cid).toBe('bafyTest');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.pinata.cloud/pinning/pinJSONToIPFS',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer test-jwt' }),
      })
    );
  });

  it('pinJSON throws on non-2xx', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 500 }))
    );
    await expect(pinJSON({ x: 1 })).rejects.toThrow(/Pinata pin failed/);
  });

  it('fetchJSON parses gateway response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    );
    const data = await fetchJSON('bafyTest');
    expect(data).toEqual({ ok: true });
  });

  it('unpin returns true on 200', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })));
    expect(await unpin('bafyTest')).toBe(true);
  });

  it('gatewayUrl builds the public URL', () => {
    expect(gatewayUrl('bafyTest')).toBe('https://gateway.pinata.cloud/ipfs/bafyTest');
  });
});
