import { readFileSync } from 'node:fs'

import { getTableName } from 'drizzle-orm'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'

import {
  credentialEvents,
  credentialGenerations,
  demoPins,
  indexerStatuses,
  ledgerCheckpoints,
  networkProfiles,
  pinChallenges,
  schemaEvents,
  schemas,
} from '../src/schema.js'

describe('database schema', () => {
  it('uses the stable public table names', () => {
    expect(
      [
        networkProfiles,
        ledgerCheckpoints,
        indexerStatuses,
        schemaEvents,
        schemas,
        credentialGenerations,
        credentialEvents,
        pinChallenges,
        demoPins,
      ].map(getTableName),
    ).toEqual([
      'network_profiles',
      'ledger_checkpoints',
      'indexer_status',
      'schema_events',
      'schemas',
      'credential_generations',
      'credential_events',
      'pin_challenges',
      'demo_pins',
    ])
  })

  it('declares durable fencing and nullable transaction-root constraints', () => {
    const statusConfig = getTableConfig(indexerStatuses)
    expect(statusConfig.checks.map((constraint) => constraint.name)).toEqual(
      expect.arrayContaining([
        'indexer_status_agreed_ledger',
        'indexer_status_ready_shape',
        'indexer_status_writer_epoch',
        'indexer_status_lease_window',
      ]),
    )
    expect(indexerStatuses.writerEpoch.notNull).toBe(true)
    expect(indexerStatuses.writerId.notNull).toBe(false)
    expect(indexerStatuses.leaseExpiresAt.notNull).toBe(false)
    expect(ledgerCheckpoints.transactionRoot.notNull).toBe(false)
  })

  it('keeps migration 0001 additive and encodes null-safe ready evidence', () => {
    const migration = readFileSync(
      new URL('../drizzle/0001_durable_indexer_status.sql', import.meta.url),
      'utf8',
    )
    expect(migration).toContain('ADD COLUMN "transaction_root" text')
    expect(migration).not.toContain('ADD COLUMN "transaction_root" text NOT NULL')
    expect(migration).toContain('"last_agreed_ledger_hash" IS NOT NULL')
    expect(migration).toContain(
      '"last_agreed_ledger_index" = LEAST("indexer_status"."primary_source_tip", "indexer_status"."secondary_source_tip")',
    )
    expect(migration).toContain('"writer_epoch" bigint NOT NULL')
    expect(migration).toContain('"lease_expires_at" timestamp with time zone')
  })
})
