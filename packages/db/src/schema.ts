import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

// sql.raw is safe here because both patterns are compile-time constants. Using
// a bound parameter inside a CHECK expression would produce invalid DDL.
const HASH_PATTERN = sql.raw("'^[0-9a-f]{64}$'")
const ADDRESS_PATTERN = sql.raw("'^r[1-9A-HJ-NP-Za-km-z]{24,34}$'")
const ERROR_CODE_PATTERN = sql.raw("'^[A-Z][A-Z0-9_]{0,63}$'")
const WRITER_ID_PATTERN = sql.raw("'^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'")

export const INDEXER_STATUS_STATES = ['starting', 'catching_up', 'ready', 'halted'] as const
export type IndexerStatusState = (typeof INDEXER_STATUS_STATES)[number]

export const networkProfiles = pgTable(
  'network_profiles',
  {
    profileId: text('profile_id').primaryKey(),
    xcsVersion: text('xcs_version').notNull(),
    networkId: bigint('network_id', { mode: 'number' }).notNull(),
    requiredAmendment: text('required_amendment').notNull(),
    registryAddress: text('registry_address').notNull(),
    registrationAmountDrops: bigint('registration_amount_drops', {
      mode: 'number',
    }).notNull(),
    activationLedgerIndex: bigint('activation_ledger_index', {
      mode: 'number',
    }).notNull(),
    activationLedgerHash: text('activation_ledger_hash').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('network_profiles_xcs_version', sql`${table.xcsVersion} = '0.1'`),
    check('network_profiles_network_id', sql`${table.networkId} BETWEEN 0 AND 4294967295`),
    check('network_profiles_registration_amount', sql`${table.registrationAmountDrops} = 1`),
    check(
      'network_profiles_activation_index',
      sql`${table.activationLedgerIndex} BETWEEN 1 AND 4294967295`,
    ),
    check('network_profiles_activation_hash', sql`${table.activationLedgerHash} ~ ${HASH_PATTERN}`),
    check('network_profiles_registry_address', sql`${table.registryAddress} ~ ${ADDRESS_PATTERN}`),
  ],
)

export const ledgerCheckpoints = pgTable(
  'ledger_checkpoints',
  {
    profileId: text('profile_id')
      .notNull()
      .references(() => networkProfiles.profileId, { onDelete: 'restrict' }),
    ledgerIndex: bigint('ledger_index', { mode: 'number' }).notNull(),
    ledgerHash: text('ledger_hash').notNull(),
    parentHash: text('parent_hash').notNull(),
    closeTime: bigint('close_time', { mode: 'number' }).notNull(),
    transactionCount: integer('transaction_count').notNull(),
    transactionRoot: text('transaction_root'),
    processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: 'ledger_checkpoints_pk',
      columns: [table.profileId, table.ledgerIndex],
    }),
    uniqueIndex('ledger_checkpoints_profile_hash_uq').on(table.profileId, table.ledgerHash),
    check('ledger_checkpoints_index', sql`${table.ledgerIndex} >= 0`),
    check('ledger_checkpoints_index_uint32', sql`${table.ledgerIndex} BETWEEN 0 AND 4294967295`),
    check('ledger_checkpoints_hash', sql`${table.ledgerHash} ~ ${HASH_PATTERN}`),
    check('ledger_checkpoints_parent', sql`${table.parentHash} ~ ${HASH_PATTERN}`),
    check('ledger_checkpoints_close_time', sql`${table.closeTime} >= 0`),
    check('ledger_checkpoints_close_time_uint32', sql`${table.closeTime} BETWEEN 0 AND 4294967295`),
    check('ledger_checkpoints_tx_count', sql`${table.transactionCount} >= 0`),
    check(
      'ledger_checkpoints_transaction_root',
      sql`${table.transactionRoot} IS NULL OR ${table.transactionRoot} ~ ${HASH_PATTERN}`,
    ),
  ],
)

export const indexerStatuses = pgTable(
  'indexer_status',
  {
    profileId: text('profile_id')
      .primaryKey()
      .references(() => networkProfiles.profileId, { onDelete: 'restrict' }),
    state: text('state').$type<IndexerStatusState>().notNull(),
    primarySourceTip: bigint('primary_source_tip', { mode: 'number' }),
    secondarySourceTip: bigint('secondary_source_tip', { mode: 'number' }),
    lastAgreedLedgerIndex: bigint('last_agreed_ledger_index', { mode: 'number' }),
    lastAgreedLedgerHash: text('last_agreed_ledger_hash'),
    errorCode: text('error_code'),
    writerId: text('writer_id'),
    writerEpoch: bigint('writer_epoch', { mode: 'number' }).notNull(),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'indexer_status_state',
      sql`${table.state} IN ('starting', 'catching_up', 'ready', 'halted')`,
    ),
    check(
      'indexer_status_primary_tip',
      sql`${table.primarySourceTip} IS NULL OR ${table.primarySourceTip} BETWEEN 0 AND 4294967295`,
    ),
    check(
      'indexer_status_secondary_tip',
      sql`${table.secondarySourceTip} IS NULL OR ${table.secondarySourceTip} BETWEEN 0 AND 4294967295`,
    ),
    check(
      'indexer_status_agreed_ledger',
      sql`(${table.lastAgreedLedgerIndex} IS NULL AND ${table.lastAgreedLedgerHash} IS NULL)
          OR (${table.lastAgreedLedgerIndex} IS NOT NULL
          AND ${table.lastAgreedLedgerHash} IS NOT NULL
          AND ${table.lastAgreedLedgerIndex} BETWEEN 0 AND 4294967295
          AND ${table.lastAgreedLedgerHash} ~ ${HASH_PATTERN})`,
    ),
    check(
      'indexer_status_agreed_not_ahead',
      sql`${table.state} = 'halted'
          OR ${table.lastAgreedLedgerIndex} IS NULL
          OR ((${table.primarySourceTip} IS NULL OR ${table.lastAgreedLedgerIndex} <= ${table.primarySourceTip})
          AND (${table.secondarySourceTip} IS NULL OR ${table.lastAgreedLedgerIndex} <= ${table.secondarySourceTip}))`,
    ),
    check(
      'indexer_status_ready_shape',
      sql`${table.state} <> 'ready'
          OR (${table.primarySourceTip} IS NOT NULL
          AND ${table.secondarySourceTip} IS NOT NULL
          AND ${table.lastAgreedLedgerIndex} IS NOT NULL
          AND ${table.lastAgreedLedgerHash} IS NOT NULL
          AND ${table.writerId} IS NOT NULL
          AND ${table.leaseExpiresAt} IS NOT NULL
          AND ${table.lastAgreedLedgerIndex} = LEAST(${table.primarySourceTip}, ${table.secondarySourceTip}))`,
    ),
    check(
      'indexer_status_error_code',
      sql`${table.errorCode} IS NULL OR ${table.errorCode} ~ ${ERROR_CODE_PATTERN}`,
    ),
    check(
      'indexer_status_error_shape',
      sql`(${table.state} = 'halted' AND ${table.errorCode} IS NOT NULL)
          OR (${table.state} <> 'halted' AND ${table.errorCode} IS NULL)`,
    ),
    check(
      'indexer_status_writer_id',
      sql`${table.writerId} IS NULL OR ${table.writerId} ~ ${WRITER_ID_PATTERN}`,
    ),
    check('indexer_status_writer_epoch', sql`${table.writerEpoch} BETWEEN 1 AND 9007199254740991`),
    check(
      'indexer_status_lease_window',
      sql`(${table.writerId} IS NULL AND ${table.leaseExpiresAt} IS NULL)
          OR (${table.writerId} IS NOT NULL
          AND ${table.leaseExpiresAt} IS NOT NULL
          AND ${table.leaseExpiresAt} >= ${table.updatedAt}
          AND ${table.leaseExpiresAt} <= ${table.updatedAt} + interval '5 minutes')`,
    ),
  ],
)

export const schemaEvents = pgTable(
  'schema_events',
  {
    profileId: text('profile_id')
      .notNull()
      .references(() => networkProfiles.profileId, { onDelete: 'restrict' }),
    transactionHash: text('transaction_hash').notNull(),
    ledgerIndex: bigint('ledger_index', { mode: 'number' }).notNull(),
    ledgerHash: text('ledger_hash').notNull(),
    transactionIndex: integer('transaction_index').notNull(),
    publisher: text('publisher').notNull(),
    status: text('status').notNull(),
    reasonCode: text('reason_code'),
    schemaUid: text('schema_uid'),
    memoJson: jsonb('memo_json').$type<unknown>(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: 'schema_events_pk',
      columns: [table.profileId, table.transactionHash],
    }),
    index('schema_events_ledger_idx').on(
      table.profileId,
      table.ledgerIndex,
      table.transactionIndex,
    ),
    index('schema_events_activity_idx').on(
      table.profileId,
      table.ledgerIndex,
      table.transactionIndex,
      table.transactionHash,
    ),
    index('schema_events_publisher_idx').on(table.profileId, table.publisher),
    check('schema_events_tx_hash', sql`${table.transactionHash} ~ ${HASH_PATTERN}`),
    check('schema_events_ledger_hash', sql`${table.ledgerHash} ~ ${HASH_PATTERN}`),
    check('schema_events_ledger_index_uint32', sql`${table.ledgerIndex} BETWEEN 0 AND 4294967295`),
    check('schema_events_tx_index', sql`${table.transactionIndex} >= 0`),
    check('schema_events_status', sql`${table.status} IN ('accepted', 'rejected')`),
    check(
      'schema_events_result_shape',
      sql`(${table.status} = 'accepted' AND ${table.schemaUid} IS NOT NULL AND ${table.reasonCode} IS NULL AND ${table.memoJson} IS NOT NULL)
          OR (${table.status} = 'rejected' AND ${table.schemaUid} IS NULL AND ${table.reasonCode} IS NOT NULL)`,
    ),
    check(
      'schema_events_schema_uid',
      sql`${table.schemaUid} IS NULL OR ${table.schemaUid} ~ ${HASH_PATTERN}`,
    ),
  ],
)

export const schemas = pgTable(
  'schemas',
  {
    profileId: text('profile_id')
      .notNull()
      .references(() => networkProfiles.profileId, { onDelete: 'restrict' }),
    schemaUid: text('schema_uid').notNull(),
    publisher: text('publisher').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull(),
    parentUid: text('parent_uid'),
    supersedesUid: text('supersedes_uid'),
    definition: jsonb('definition').$type<Record<string, unknown>>().notNull(),
    resolvedDefinition: jsonb('resolved_definition').$type<Record<string, unknown>>().notNull(),
    registrationTransactionHash: text('registration_transaction_hash').notNull(),
    ledgerIndex: bigint('ledger_index', { mode: 'number' }).notNull(),
    transactionIndex: integer('transaction_index').notNull(),
    registeredAt: timestamp('registered_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: 'schemas_pk',
      columns: [table.profileId, table.schemaUid],
    }),
    uniqueIndex('schemas_registration_tx_uq').on(
      table.profileId,
      table.registrationTransactionHash,
    ),
    foreignKey({
      name: 'schemas_registration_event_fk',
      columns: [table.profileId, table.registrationTransactionHash],
      foreignColumns: [schemaEvents.profileId, schemaEvents.transactionHash],
    }).onDelete('restrict'),
    index('schemas_publisher_order_idx').on(
      table.profileId,
      table.publisher,
      table.ledgerIndex,
      table.transactionIndex,
    ),
    index('schemas_order_idx').on(
      table.profileId,
      table.ledgerIndex,
      table.transactionIndex,
      table.schemaUid,
    ),
    index('schemas_search_idx').using(
      'gin',
      sql`to_tsvector('simple', ${table.name} || ' ' || ${table.description})`,
    ),
    check('schemas_uid', sql`${table.schemaUid} ~ ${HASH_PATTERN}`),
    check(
      'schemas_parent_uid',
      sql`${table.parentUid} IS NULL OR ${table.parentUid} ~ ${HASH_PATTERN}`,
    ),
    check(
      'schemas_supersedes_uid',
      sql`${table.supersedesUid} IS NULL OR ${table.supersedesUid} ~ ${HASH_PATTERN}`,
    ),
    check(
      'schemas_registration_tx_hash',
      sql`${table.registrationTransactionHash} ~ ${HASH_PATTERN}`,
    ),
    check('schemas_ledger_index_uint32', sql`${table.ledgerIndex} BETWEEN 0 AND 4294967295`),
    check('schemas_transaction_index', sql`${table.transactionIndex} >= 0`),
  ],
)

export const credentialGenerations = pgTable(
  'credential_generations',
  {
    profileId: text('profile_id')
      .notNull()
      .references(() => networkProfiles.profileId, { onDelete: 'restrict' }),
    generationId: text('generation_id').notNull(),
    ledgerObjectId: text('ledger_object_id').notNull(),
    issuer: text('issuer').notNull(),
    subject: text('subject').notNull(),
    schemaUid: text('schema_uid').notNull(),
    uriHex: text('uri_hex'),
    expiration: bigint('expiration', { mode: 'number' }),
    accepted: boolean('accepted').notNull().default(false),
    createdLedgerIndex: bigint('created_ledger_index', { mode: 'number' }).notNull(),
    createdTransactionIndex: integer('created_transaction_index').notNull(),
    lastLedgerIndex: bigint('last_ledger_index', { mode: 'number' }).notNull(),
    deletedLedgerIndex: bigint('deleted_ledger_index', { mode: 'number' }),
    deletionCause: text('deletion_cause'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: 'credential_generations_pk',
      columns: [table.profileId, table.generationId],
    }),
    uniqueIndex('credential_generations_live_uq')
      .on(table.profileId, table.issuer, table.subject, table.schemaUid)
      .where(sql`${table.deletedLedgerIndex} IS NULL`),
    foreignKey({
      name: 'credential_generations_schema_fk',
      columns: [table.profileId, table.schemaUid],
      foreignColumns: [schemas.profileId, schemas.schemaUid],
    }).onDelete('restrict'),
    index('credential_generations_exact_idx').on(
      table.profileId,
      table.issuer,
      table.subject,
      table.schemaUid,
      table.createdLedgerIndex,
    ),
    index('credential_generations_stats_idx').on(
      table.profileId,
      table.deletedLedgerIndex,
      table.accepted,
      table.expiration,
    ),
    check('credential_generations_id', sql`${table.generationId} ~ ${HASH_PATTERN}`),
    check('credential_generations_object', sql`${table.ledgerObjectId} ~ ${HASH_PATTERN}`),
    check('credential_generations_schema', sql`${table.schemaUid} ~ ${HASH_PATTERN}`),
    check(
      'credential_generations_expiration',
      sql`${table.expiration} IS NULL OR ${table.expiration} >= 0`,
    ),
    check(
      'credential_generations_expiration_uint32',
      sql`${table.expiration} IS NULL OR ${table.expiration} BETWEEN 0 AND 4294967295`,
    ),
    check(
      'credential_generations_created_ledger_uint32',
      sql`${table.createdLedgerIndex} BETWEEN 0 AND 4294967295`,
    ),
    check(
      'credential_generations_created_transaction_index',
      sql`${table.createdTransactionIndex} >= 0`,
    ),
    check(
      'credential_generations_last_ledger_uint32',
      sql`${table.lastLedgerIndex} BETWEEN 0 AND 4294967295`,
    ),
    check(
      'credential_generations_deleted_ledger_uint32',
      sql`${table.deletedLedgerIndex} IS NULL OR ${table.deletedLedgerIndex} BETWEEN 0 AND 4294967295`,
    ),
    check(
      'credential_generations_ledger_order',
      sql`${table.lastLedgerIndex} >= ${table.createdLedgerIndex}
          AND (${table.deletedLedgerIndex} IS NULL OR ${table.deletedLedgerIndex} = ${table.lastLedgerIndex})`,
    ),
    check(
      'credential_generations_deletion',
      sql`(${table.deletedLedgerIndex} IS NULL AND ${table.deletionCause} IS NULL)
          OR (${table.deletedLedgerIndex} IS NOT NULL AND ${table.deletionCause} IS NOT NULL)`,
    ),
    check(
      'credential_generations_deletion_cause',
      sql`${table.deletionCause} IS NULL OR ${table.deletionCause} IN ('issuer_revoked', 'subject_rejected', 'subject_removed', 'expired_cleanup', 'account_deleted', 'self_deleted')`,
    ),
  ],
)

export const credentialEvents = pgTable(
  'credential_events',
  {
    profileId: text('profile_id')
      .notNull()
      .references(() => networkProfiles.profileId, { onDelete: 'restrict' }),
    transactionHash: text('transaction_hash').notNull(),
    nodeIndex: integer('node_index').notNull(),
    generationId: text('generation_id'),
    ledgerObjectId: text('ledger_object_id').notNull(),
    ledgerIndex: bigint('ledger_index', { mode: 'number' }).notNull(),
    ledgerHash: text('ledger_hash').notNull(),
    transactionIndex: integer('transaction_index').notNull(),
    eventType: text('event_type').notNull(),
    issuer: text('issuer').notNull(),
    subject: text('subject').notNull(),
    schemaUid: text('schema_uid').notNull(),
    uriHex: text('uri_hex'),
    expiration: bigint('expiration', { mode: 'number' }),
    accepted: boolean('accepted').notNull(),
    deletionCause: text('deletion_cause'),
    snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: 'credential_events_pk',
      columns: [table.profileId, table.transactionHash, table.nodeIndex],
    }),
    index('credential_events_generation_idx').on(
      table.profileId,
      table.generationId,
      table.ledgerIndex,
      table.transactionIndex,
      table.nodeIndex,
    ),
    foreignKey({
      name: 'credential_events_schema_fk',
      columns: [table.profileId, table.schemaUid],
      foreignColumns: [schemas.profileId, schemas.schemaUid],
    }).onDelete('restrict'),
    foreignKey({
      name: 'credential_events_generation_fk',
      columns: [table.profileId, table.generationId],
      foreignColumns: [credentialGenerations.profileId, credentialGenerations.generationId],
    }).onDelete('restrict'),
    index('credential_events_exact_idx').on(
      table.profileId,
      table.issuer,
      table.subject,
      table.schemaUid,
      table.ledgerIndex,
    ),
    check('credential_events_tx_hash', sql`${table.transactionHash} ~ ${HASH_PATTERN}`),
    check('credential_events_object', sql`${table.ledgerObjectId} ~ ${HASH_PATTERN}`),
    check('credential_events_ledger_hash', sql`${table.ledgerHash} ~ ${HASH_PATTERN}`),
    check('credential_events_schema', sql`${table.schemaUid} ~ ${HASH_PATTERN}`),
    check('credential_events_generation_id', sql`${table.generationId} IS NOT NULL`),
    check('credential_events_node_index', sql`${table.nodeIndex} >= 0`),
    check(
      'credential_events_ledger_index_uint32',
      sql`${table.ledgerIndex} BETWEEN 0 AND 4294967295`,
    ),
    check('credential_events_transaction_index', sql`${table.transactionIndex} >= 0`),
    check(
      'credential_events_expiration_uint32',
      sql`${table.expiration} IS NULL OR ${table.expiration} BETWEEN 0 AND 4294967295`,
    ),
    check('credential_events_type', sql`${table.eventType} IN ('created', 'accepted', 'deleted')`),
    check(
      'credential_events_delete_shape',
      sql`(${table.eventType} = 'deleted' AND ${table.deletionCause} IS NOT NULL)
          OR (${table.eventType} <> 'deleted' AND ${table.deletionCause} IS NULL)`,
    ),
  ],
)

export const pinChallenges = pgTable(
  'pin_challenges',
  {
    challengeId: text('challenge_id').primaryKey(),
    profileId: text('profile_id')
      .notNull()
      .references(() => networkProfiles.profileId, { onDelete: 'restrict' }),
    wallet: text('wallet').notNull(),
    requesterIpHash: text('requester_ip_hash').notNull(),
    message: text('message').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('pin_challenges_wallet_created_idx').on(table.profileId, table.wallet, table.createdAt),
    index('pin_challenges_ip_created_idx').on(table.requesterIpHash, table.createdAt),
    index('pin_challenges_expiry_idx').on(table.expiresAt),
    check('pin_challenges_id', sql`${table.challengeId} ~ ${HASH_PATTERN}`),
    check('pin_challenges_ip_hash', sql`${table.requesterIpHash} ~ ${HASH_PATTERN}`),
    check('pin_challenges_wallet', sql`${table.wallet} ~ ${ADDRESS_PATTERN}`),
    check('pin_challenges_expiry', sql`${table.expiresAt} > ${table.createdAt}`),
  ],
)

export const demoPins = pgTable(
  'demo_pins',
  {
    pinId: text('pin_id').primaryKey(),
    challengeId: text('challenge_id')
      .notNull()
      .unique()
      .references(() => pinChallenges.challengeId, { onDelete: 'restrict' }),
    profileId: text('profile_id')
      .notNull()
      .references(() => networkProfiles.profileId, { onDelete: 'restrict' }),
    wallet: text('wallet').notNull(),
    requesterIpHash: text('requester_ip_hash').notNull(),
    cid: text('cid').notNull(),
    byteLength: integer('byte_length').notNull(),
    status: text('status').notNull(),
    failureCode: text('failure_code'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    unpinnedAt: timestamp('unpinned_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('demo_pins_wallet_quota_idx').on(table.wallet, table.createdAt),
    index('demo_pins_ip_quota_idx').on(table.requesterIpHash, table.createdAt),
    index('demo_pins_expiry_idx').on(table.status, table.expiresAt),
    index('demo_pins_cid_active_idx').on(table.cid, table.status, table.expiresAt),
    check('demo_pins_id', sql`${table.pinId} ~ ${HASH_PATTERN}`),
    check('demo_pins_ip_hash', sql`${table.requesterIpHash} ~ ${HASH_PATTERN}`),
    check('demo_pins_wallet', sql`${table.wallet} ~ ${ADDRESS_PATTERN}`),
    check('demo_pins_cid', sql`${table.cid} ~ '^b[a-z2-7]+$'`),
    check('demo_pins_byte_length', sql`${table.byteLength} BETWEEN 1 AND 65536`),
    check('demo_pins_status', sql`${table.status} IN ('pending', 'pinned', 'failed', 'unpinned')`),
    check(
      'demo_pins_failure_shape',
      sql`(${table.status} = 'failed' AND ${table.failureCode} IS NOT NULL)
          OR (${table.status} <> 'failed' AND ${table.failureCode} IS NULL)`,
    ),
    check(
      'demo_pins_unpinned_shape',
      sql`(${table.status} = 'unpinned' AND ${table.unpinnedAt} IS NOT NULL)
          OR (${table.status} <> 'unpinned' AND ${table.unpinnedAt} IS NULL)`,
    ),
  ],
)

export type NetworkProfileRow = typeof networkProfiles.$inferSelect
export type NewNetworkProfileRow = typeof networkProfiles.$inferInsert
export type LedgerCheckpointRow = typeof ledgerCheckpoints.$inferSelect
export type IndexerStatusRow = typeof indexerStatuses.$inferSelect
export type NewIndexerStatusRow = typeof indexerStatuses.$inferInsert
export type SchemaEventRow = typeof schemaEvents.$inferSelect
export type SchemaRow = typeof schemas.$inferSelect
export type CredentialGenerationRow = typeof credentialGenerations.$inferSelect
export type CredentialEventRow = typeof credentialEvents.$inferSelect
export type PinChallengeRow = typeof pinChallenges.$inferSelect
export type DemoPinRow = typeof demoPins.$inferSelect
