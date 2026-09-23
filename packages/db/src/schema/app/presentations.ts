import { sql } from 'drizzle-orm'
import { check, foreignKey, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

import { HASH_PATTERN } from '../common.js'
import { appCredentialMetadata } from './issuance.js'
import { appOrganizations } from './organizations.js'

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
