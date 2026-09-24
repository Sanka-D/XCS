import { sql } from 'drizzle-orm'
import { check, foreignKey, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

import { HASH_PATTERN } from '../common.js'
import { appCredentialMetadata } from './issuance.js'
import { appOrganizations } from './organizations.js'
import { appUsers } from './identity.js'

export const appPresentations = pgTable(
  'app_presentations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    profileId: text('profile_id').notNull(),
    generationId: text('generation_id').notNull(),
    recipientUserId: uuid('recipient_user_id').notNull(),
    verifierOrganizationId: uuid('verifier_organization_id').references(() => appOrganizations.id, {
      onDelete: 'restrict',
    }),
    scope: text('scope', { enum: ['public', 'full'] }).notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      columns: [t.profileId, t.generationId, t.recipientUserId],
      foreignColumns: [
        appCredentialMetadata.profileId,
        appCredentialMetadata.generationId,
        appCredentialMetadata.recipientUserId,
      ],
      name: 'app_presentations_recipient_fk',
    }).onDelete('restrict'),
    index('app_presentations_recipient_idx').on(t.recipientUserId, t.createdAt),
    index('app_presentations_verifier_idx').on(t.verifierOrganizationId),
    check('app_presentations_scope', sql`${t.scope} IN ('public', 'full')`),
    check(
      'app_presentations_audience',
      sql`${t.scope} <> 'full' OR ${t.verifierOrganizationId} IS NOT NULL`,
    ),
    check('app_presentations_token', sql`${t.tokenHash} ~ ${HASH_PATTERN}`),
    check(
      'app_presentations_revocation',
      sql`${t.revokedAt} IS NULL OR ${t.revokedAt} >= ${t.createdAt}`,
    ),
  ],
)

// Verification history retains evidence summaries only: never claim values or link tokens.
export const appVerifierHistory = pgTable(
  'app_verifier_history',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    verifierOrganizationId: uuid('verifier_organization_id')
      .notNull()
      .references(() => appOrganizations.id, { onDelete: 'restrict' }),
    verifierUserId: uuid('verifier_user_id')
      .notNull()
      .references(() => appUsers.id, { onDelete: 'restrict' }),
    presentationId: uuid('presentation_id')
      .notNull()
      .references(() => appPresentations.id, { onDelete: 'restrict' }),
    profileId: text('profile_id').notNull(),
    generationId: text('generation_id').notNull(),
    scope: text('scope', { enum: ['public', 'full'] }).notNull(),
    onChain: text('on_chain').notNull(),
    schemaStatus: text('schema_status').notNull(),
    payloadStatus: text('payload_status').notNull(),
    issuerTrust: text('issuer_trust').notNull(),
    checkedAt: timestamp('checked_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('app_verifier_history_user_idx').on(t.verifierUserId, t.checkedAt, t.id),
    index('app_verifier_history_organization_idx').on(t.verifierOrganizationId, t.checkedAt, t.id),
    check('app_verifier_history_profile', sql`length(${t.profileId}) BETWEEN 1 AND 200`),
    check('app_verifier_history_generation', sql`${t.generationId} ~ ${HASH_PATTERN}`),
    check('app_verifier_history_scope', sql`${t.scope} IN ('public', 'full')`),
    check(
      'app_verifier_history_chain',
      sql`${t.onChain} IN ('not_found', 'pending', 'active', 'expired', 'deleted')`,
    ),
    check('app_verifier_history_schema', sql`${t.schemaStatus} IN ('valid', 'unknown')`),
    check(
      'app_verifier_history_payload',
      sql`${t.payloadStatus} IN ('valid', 'unavailable', 'tampered', 'invalid', 'not_checked')`,
    ),
    check(
      'app_verifier_history_trust',
      sql`${t.issuerTrust} IN ('trusted', 'untrusted', 'unknown')`,
    ),
  ],
)
