import { ref, type Ref } from 'vue';

export interface WaitOptions<T> {
  fetcher: () => Promise<T>;
  predicate: (v: T) => boolean;
  intervalMs?: number;
  timeoutMs?: number;
}

export async function waitForIndexer<T>(opts: WaitOptions<T>): Promise<T> {
  const interval = opts.intervalMs ?? 1500;
  const timeout = opts.timeoutMs ?? 60_000;
  const start = Date.now();

  while (true) {
    let value: T;
    try {
      value = await opts.fetcher();
    } catch {
      // swallow fetcher errors — keep polling
      const elapsed = Date.now() - start;
      const remaining = timeout - elapsed;
      if (remaining <= 0) break;
      await new Promise((r) => setTimeout(r, Math.min(interval, remaining)));
      continue;
    }

    // Predicate errors propagate (a buggy predicate is a real bug, not noise).
    if (opts.predicate(value)) return value;

    const elapsed = Date.now() - start;
    const remaining = timeout - elapsed;
    if (remaining <= 0) break;
    await new Promise((r) => setTimeout(r, Math.min(interval, remaining)));
  }

  throw new Error(`indexer wait timeout after ${timeout}ms`);
}

export function useIndexerWait() {
  const waiting: Ref<boolean> = ref(false);

  async function wait<T>(opts: WaitOptions<T>): Promise<T> {
    waiting.value = true;
    try {
      return await waitForIndexer(opts);
    } finally {
      waiting.value = false;
    }
  }

  return { waiting, wait };
}
