import { readFileSync } from 'node:fs'

import { getTableName } from 'drizzle-orm'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'

import {
  credentialEvents,
  credentialGenerations,
  demoPins,
  indexerIncidents,
  indexerStatuses,
  ledgerCheckpoints,
  networkProfiles,
  pinChallenges,
  schemaEvents,
  schemas,
} from '../src/schema.js'

const PROJECTION_INTEGRITY_CHECKS = [
  [ledgerCheckpoints, ['ledger_checkpoints_index_uint32', 'ledger_checkpoints_close_time_uint32']],
  [schemaEvents, ['schema_events_ledger_index_uint32']],
  [schemas, ['schemas_ledger_index_uint32', 'schemas_transaction_index']],
  [
    credentialGenerations,
    [
      'credential_generations_expiration_uint32',
      'credential_generations_created_ledger_uint32',
      'credential_generations_created_transaction_index',
      'credential_generations_last_ledger_uint32',
      'credential_generations_deleted_ledger_uint32',
      'credential_generations_ledger_order',
    ],
  ],
  [
    credentialEvents,
    [
      'credential_events_generation_id',
      'credential_events_node_index',
      'credential_events_ledger_index_uint32',
      'credential_events_transaction_index',
      'credential_events_expiration_uint32',
    ],
  ],
] as const

describe('database schema', () => {
  it('uses the stable public table names', () => {
    expect(
      [
        networkProfiles,
        ledgerCheckpoints,
        indexerStatuses,
        indexerIncidents,
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
      'indexer_incidents',
      'schema_events',
      'schemas',
      'credential_generations',
      'credential_events',
      'pin_challenges',
      'demo_pins',
    ])
  })

  it('adds an immutable fenced halt history in migration 0004', () => {
    const incidentConfig = getTableConfig(indexerIncidents)
    expect(incidentConfig.primaryKeys.map((key) => key.getName())).toContain('indexer_incidents_pk')
    expect(incidentConfig.checks.map((constraint) => constraint.name)).toEqual(
      expect.arrayContaining([
        'indexer_incidents_writer_epoch',
        'indexer_incidents_error_code',
        'indexer_incidents_primary_tip',
        'indexer_incidents_secondary_tip',
        'indexer_incidents_agreed_ledger',
      ]),
    )

    const migration = readFileSync(
      new URL('../drizzle/0004_indexer_incidents.sql', import.meta.url),
      'utf8',
    )
    expect(migration).toContain('CREATE TABLE "indexer_incidents"')
    expect(migration).toContain('PRIMARY KEY("profile_id","writer_epoch")')
    expect(migration).toContain(
      'GRANT SELECT, INSERT ON TABLE "public"."indexer_incidents" TO xcs_indexer',
    )
    expect(migration).toContain('GRANT SELECT ON TABLE "public"."indexer_incidents" TO xcs_api')
    expect(migration).not.toMatch(/^\s*(?:DROP|DELETE|UPDATE)\b/imu)

    const journal = JSON.parse(
      readFileSync(new URL('../drizzle/meta/_journal.json', import.meta.url), 'utf8'),
    ) as { entries: Array<{ idx: number; tag: string }> }
    expect(journal.entries.find(({ idx }) => idx === 4)).toMatchObject({
      idx: 4,
      tag: '0004_indexer_incidents',
    })
    expect(journal.entries.filter(({ idx }) => idx === 4)).toHaveLength(1)
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

  it('adds only the discovery indexes in migration 0002', () => {
    const migration = readFileSync(
      new URL('../drizzle/0002_discovery_indexes.sql', import.meta.url),
      'utf8',
    )
    expect(migration).toContain('CREATE INDEX "credential_generations_stats_idx"')
    expect(migration).toContain('CREATE INDEX "schema_events_activity_idx"')
    expect(migration).toContain('CREATE INDEX "schemas_order_idx"')
    expect(migration).toContain('CREATE INDEX "schemas_search_idx"')
    expect(migration).toContain('to_tsvector(\'simple\', "name" || \' \' || "description")')
    expect(migration).not.toMatch(/\b(?:ALTER|DROP|DELETE|UPDATE|INSERT)\b/u)

    expect(getTableConfig(schemaEvents).indexes.map((item) => item.config.name)).toContain(
      'schema_events_activity_idx',
    )
    expect(getTableConfig(schemas).indexes.map((item) => item.config.name)).toEqual(
      expect.arrayContaining(['schemas_order_idx', 'schemas_search_idx']),
    )
    expect(getTableConfig(credentialGenerations).indexes.map((item) => item.config.name)).toContain(
      'credential_generations_stats_idx',
    )
  })

  it('adds projection-integrity checks through a low-lock migration 0003', () => {
    const expectedCheckNames = PROJECTION_INTEGRITY_CHECKS.flatMap(([, names]) => names)

    expect(expectedCheckNames).toHaveLength(16)
    expect(new Set(expectedCheckNames).size).toBe(16)
    for (const [table, expectedNames] of PROJECTION_INTEGRITY_CHECKS) {
      const declaredNames = getTableConfig(table).checks.map((constraint) => constraint.name)
      expect(declaredNames).toEqual(expect.arrayContaining([...expectedNames]))
    }

    const migration = readFileSync(
      new URL('../drizzle/0003_projection_integrity.sql', import.meta.url),
      'utf8',
    )
    const migratedCheckNames = Array.from(
      migration.matchAll(/ADD CONSTRAINT "([^"]+)" CHECK/gu),
      ([, name]) => name,
    )

    expect(migration).toMatch(/^SET LOCAL lock_timeout = '5s';/u)
    expect(migration.match(/\bNOT VALID\b/gu)).toHaveLength(16)
    expect(migratedCheckNames).toHaveLength(16)
    expect(migratedCheckNames.toSorted()).toEqual(expectedCheckNames.toSorted())
    expect(migration).not.toMatch(/\bVALIDATE\s+CONSTRAINT\b/iu)
    expect(migration).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|DROP)\b/iu)

    const journal = JSON.parse(
      readFileSync(new URL('../drizzle/meta/_journal.json', import.meta.url), 'utf8'),
    ) as { entries: Array<{ idx: number; tag: string }> }
    expect(journal.entries.find(({ idx }) => idx === 3)).toMatchObject({
      idx: 3,
      tag: '0003_projection_integrity',
    })
    expect(journal.entries.filter(({ idx }) => idx === 3)).toHaveLength(1)
  })
})
