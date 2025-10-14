// server/db/schema.ts
import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  boolean,
  varchar,
  index,
} from 'drizzle-orm/pg-core';

// Type imports for JSONB fields
interface SchemaFields {
  fields: any[];
}

interface W3CVerifiableCredential {
  '@context': string[];
  id: string;
  type: string[];
  issuer: any;
  issuanceDate: string;
  expirationDate?: string;
  credentialSubject: any;
  credentialSchema?: any;
  proof?: any;
}

// Schemas table
export const schemas = pgTable(
  'schemas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    version: varchar('version', { length: 50 }).notNull().default('1.0.0'),

    // JSONB field for schema fields definition
    // Structure: { fields: [{ name, type, required, description }] }
    fields: jsonb('fields').notNull().$type<SchemaFields>(),

    // Metadata
    creator: varchar('creator', { length: 35 }).notNull(), // XRPL address
    isPublic: boolean('is_public').notNull().default(true),

    // IPFS (if public schema)
    ipfsCid: text('ipfs_cid'),

    // Versioning
    parentSchemaId: uuid('parent_schema_id').references((): any => schemas.id),

    // Timestamps
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    creatorIdx: index('schemas_creator_idx').on(table.creator),
    publicIdx: index('schemas_public_idx').on(table.isPublic),
    parentIdx: index('schemas_parent_idx').on(table.parentSchemaId),
  })
);

// Credentials table
export const credentials = pgTable(
  'credentials',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // References
    schemaId: uuid('schema_id')
      .notNull()
      .references(() => schemas.id),

    // XRPL data
    issuer: varchar('issuer', { length: 35 }).notNull(), // XRPL address
    subject: varchar('subject', { length: 35 }).notNull(), // XRPL address

    // Credential data (W3C VC format in JSONB)
    vcDocument: jsonb('vc_document')
      .notNull()
      .$type<W3CVerifiableCredential>(),

    // Storage
    isPublic: boolean('is_public').notNull().default(false),
    ipfsCid: text('ipfs_cid'), // If public (on IPFS)

    // XRPL on-chain reference
    xrplTxHash: varchar('xrpl_tx_hash', { length: 64 }),
    xrplLedgerIndex: varchar('xrpl_ledger_index', { length: 20 }),
    credentialType: text('credential_type').notNull(), // Hex string from XRPL

    // Status
    accepted: boolean('accepted').notNull().default(false),
    acceptedAt: timestamp('accepted_at'),
    revoked: boolean('revoked').notNull().default(false),
    revokedAt: timestamp('revoked_at'),

    // Expiration
    expiresAt: timestamp('expires_at'),

    // Timestamps
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    issuerIdx: index('credentials_issuer_idx').on(table.issuer),
    subjectIdx: index('credentials_subject_idx').on(table.subject),
    schemaIdx: index('credentials_schema_idx').on(table.schemaId),
    acceptedIdx: index('credentials_accepted_idx').on(table.accepted),
    revokedIdx: index('credentials_revoked_idx').on(table.revoked),
  })
);
