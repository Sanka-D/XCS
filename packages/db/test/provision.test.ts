import { describe, expect, it, vi } from 'vitest'

import { provisionRuntimeDatabaseRoles, type DatabaseClient } from '../src/index.js'

function client(): DatabaseClient {
  return {
    db: {} as DatabaseClient['db'],
    sql: {
      begin: vi.fn(),
    } as unknown as DatabaseClient['sql'],
    close: vi.fn(),
  }
}

describe('runtime database role provisioning', () => {
  it.each([
    ['', 'valid'],
    ['too-short', 'valid'],
    ['a'.repeat(32), 'contains/slash'],
  ])('rejects unsafe runtime passwords before opening a transaction', async (indexer, api) => {
    const database = client()

    await expect(
      provisionRuntimeDatabaseRoles(database, {
        indexerPassword: indexer === 'valid' ? 'i'.repeat(32) : indexer,
        apiPassword: api === 'valid' ? 'a'.repeat(32) : api,
      }),
    ).rejects.toThrow('32-256 URL-safe characters')
    expect(database.sql.begin).not.toHaveBeenCalled()
  })

  it('requires distinct runtime passwords', async () => {
    const database = client()
    const password = 'same-runtime-password-000000000000'

    await expect(
      provisionRuntimeDatabaseRoles(database, {
        indexerPassword: password,
        apiPassword: password,
      }),
    ).rejects.toThrow('must be distinct')
    expect(database.sql.begin).not.toHaveBeenCalled()
  })
})
