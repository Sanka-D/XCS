import type { XcsDatabase } from '@xcs-protocol/db'
import { describe, expect, it, vi } from 'vitest'

import { PostgresApiRepository } from '../src/repository.js'

const NOW = new Date('2026-08-24T12:00:00.000Z')

describe('PostgresApiRepository authority reads', () => {
  it('runs callbacks in a read-only repeatable-read transaction and uses database time', async () => {
    const execute = vi.fn(async () => [{ now: NOW }])
    const transactionDatabase = { execute } as unknown as XcsDatabase
    const transaction = vi.fn(
      async <T>(
        callback: (database: XcsDatabase) => Promise<T>,
        _config: { isolationLevel: string; accessMode: string },
      ) => callback(transactionDatabase),
    )
    const repository = new PostgresApiRepository({ transaction } as unknown as XcsDatabase)

    const observedAt = await repository.withConsistentSnapshot((snapshot) =>
      snapshot.getDatabaseTime(),
    )

    expect(observedAt).toEqual(NOW)
    expect(transaction).toHaveBeenCalledOnce()
    expect(transaction.mock.calls[0]?.[1]).toEqual({
      isolationLevel: 'repeatable read',
      accessMode: 'read only',
    })
    expect(execute).toHaveBeenCalledOnce()
  })
})
