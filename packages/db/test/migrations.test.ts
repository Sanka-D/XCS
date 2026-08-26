import { describe, expect, it } from 'vitest'

import {
  DEFAULT_MIGRATION_STATEMENT_TIMEOUT_MS,
  parseMigrationStatementTimeoutMs,
} from '../src/migrations.js'

describe('database migration configuration', () => {
  it('defaults projection validation to 30 minutes and allows an explicit larger window', () => {
    expect(parseMigrationStatementTimeoutMs(undefined)).toBe(30 * 60 * 1_000)
    expect(parseMigrationStatementTimeoutMs(undefined)).toBe(DEFAULT_MIGRATION_STATEMENT_TIMEOUT_MS)
    expect(parseMigrationStatementTimeoutMs(' 7200000 ')).toBe(7_200_000)
    expect(parseMigrationStatementTimeoutMs('0')).toBe(0)
  })

  it.each(['', '-1', '1.5', 'not-a-number', '2147483648'])(
    'rejects invalid statement timeout %j before running migrations',
    (value) => {
      expect(() => parseMigrationStatementTimeoutMs(value)).toThrow(
        /XCS_MIGRATION_STATEMENT_TIMEOUT_MS|Migration statement timeout/u,
      )
    },
  )
})
