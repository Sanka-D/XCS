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

  while (Date.now() - start < timeout) {
    try {
      const value = await opts.fetcher();
      if (opts.predicate(value)) return value;
    } catch {
      // swallow transient errors
    }
    await new Promise((r) => setTimeout(r, interval));
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
