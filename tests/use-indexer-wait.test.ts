import { describe, it, expect, vi } from 'vitest';
import { waitForIndexer } from '../app/composables/useIndexerWait';

describe('waitForIndexer', () => {
  it('returns the first value matching the predicate', async () => {
    let n = 0;
    const fetcher = vi.fn(async () => ++n);
    const result = await waitForIndexer({
      fetcher,
      predicate: (v) => v >= 3,
      intervalMs: 1,
      timeoutMs: 1000,
    });
    expect(result).toBe(3);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('rejects after timeout', async () => {
    const fetcher = vi.fn(async () => null);
    await expect(
      waitForIndexer({
        fetcher,
        predicate: (v) => v !== null,
        intervalMs: 5,
        timeoutMs: 30,
      })
    ).rejects.toThrow(/timeout/i);
  });

  it('swallows transient fetcher errors and keeps polling', async () => {
    let calls = 0;
    const fetcher = vi.fn(async () => {
      calls++;
      if (calls < 3) throw new Error('boom');
      return 'ok';
    });
    const result = await waitForIndexer({
      fetcher,
      predicate: (v) => v === 'ok',
      intervalMs: 1,
      timeoutMs: 1000,
    });
    expect(result).toBe('ok');
  });
});
