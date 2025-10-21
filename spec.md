1. Project Overview
   A decentralized credential platform built on XRPL that allows anyone to create schemas and issue verifiable credentials. Credentials can be stored privately (on our service) or publicly (on IPFS), following W3C Verifiable Credentials standards.
   Core Features (MVP)

Schema Registry (create, version, view schemas)
Credential Issuance (private or public/IPFS)
XRPL on-chain attestation
Subject credential acceptance view
W3C VC compliant structure

2. Technology Stack
   Frontend & Backend

Framework: Nuxt 4 (Full SSR)
Runtime: Node.js 20+
Language: TypeScript

Database

Primary DB: PostgreSQL 16+
ORM: Drizzle ORM
JSON Storage: JSONB columns for flexible schema/credential data

XRPL Integration

Library: xrpl.js v4+
Network: Testnet (wss://s.altnet.rippletest.net:51233)

IPFS Integration

Provider: Agnostic (configurable via env)
Suggested: Pinata, Web3.Storage, or NFT.Storage
Library: ipfs-http-client or provider SDK

UI/UX

Framework: Vue 3 (Composition API)
Styling: TailwindCSS
Components: Nuxt UI or shadcn-vue
Forms: VeeValidate + Zod
Icons: Heroicons or Lucide

3. Project Structure
   xrpl-credential-platform/
   ├── app/
   │ ├── components/
   │ │ ├── schema/
   │ │ │ ├── SchemaForm.vue
   │ │ │ ├── SchemaCard.vue
   │ │ │ ├── SchemaList.vue
   │ │ │ └── SchemaVersionHistory.vue
   │ │ ├── credential/
   │ │ │ ├── CredentialForm.vue
   │ │ │ ├── CredentialCard.vue
   │ │ │ ├── CredentialList.vue
   │ │ │ └── CredentialAcceptance.vue
   │ │ ├── ui/
   │ │ │ ├── Button.vue
   │ │ │ ├── Input.vue
   │ │ │ ├── Select.vue
   │ │ │ ├── Card.vue
   │ │ │ ├── Badge.vue
   │ │ │ └── Modal.vue
   │ │ └── layout/
   │ │ ├── AppHeader.vue
   │ │ └── AppFooter.vue
   │ ├── pages/
   │ │ ├── index.vue # Landing page
   │ │ ├── schemas/
   │ │ │ ├── index.vue # Browse schemas
   │ │ │ ├── create.vue # Create new schema
   │ │ │ └── [id].vue # Schema detail + version history
   │ │ ├── credentials/
   │ │ │ ├── index.vue # Browse credentials
   │ │ │ ├── issue.vue # Issue new credential
   │ │ │ ├── [id].vue # Credential detail
   │ │ │ └── accept.vue # Accept pending credentials (subject view)
   │ │ └── docs/
   │ │ ├── index.vue # API documentation
   │ │ └── w3c-guide.vue # W3C VC guide
   │ ├── layouts/
   │ │ └── default.vue
   │ └── app.vue
   ├── server/
   │ ├── api/
   │ │ ├── schema/
   │ │ │ ├── create.post.ts # Create schema
   │ │ │ ├── list.post.ts # List/search schemas
   │ │ │ ├── get.post.ts # Get schema by ID
   │ │ │ └── update-version.post.ts # Update schema version
   │ │ ├── credential/
   │ │ │ ├── issue.post.ts # Issue credential
   │ │ │ ├── list.post.ts # List/query credentials
   │ │ │ ├── get.post.ts # Get credential by ID
   │ │ │ ├── revoke.post.ts # Revoke credential
   │ │ │ └── accept.post.ts # Accept credential (subject)
   │ │ └── health.get.ts # Health check
   │ ├── utils/
   │ │ ├── xrpl.ts # XRPL client & helpers
   │ │ ├── ipfs.ts # IPFS client & helpers
   │ │ ├── w3c-vc.ts # W3C VC format helpers
   │ │ ├── validation.ts # Zod schemas
   │ │ └── errors.ts # Error classes
   │ ├── db/
   │ │ ├── schema.ts # Drizzle schema definitions
   │ │ ├── index.ts # DB connection
   │ │ └── migrations/ # SQL migrations
   │ └── middleware/
   │ └── error-handler.ts # Global error handling
   ├── lib/
   │ ├── types/
   │ │ ├── schema.ts # Schema types
   │ │ ├── credential.ts # Credential types
   │ │ └── w3c-vc.ts # W3C VC types
   │ └── constants.ts # App constants
   ├── public/
   │ └── favicon.ico
   ├── .env.example
   ├── nuxt.config.ts
   ├── drizzle.config.ts
   ├── tsconfig.json
   ├── package.json
   └── README.md

4. Database Schema
   PostgreSQL Tables (via Drizzle ORM)
   // server/db/schema.ts
   import { pgTable, uuid, text, timestamp, jsonb, boolean, varchar } from 'drizzle-orm/pg-core';

// Schemas table
export const schemas = pgTable('schemas', {
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
parentSchemaId: uuid('parent_schema_id').references(() => schemas.id),

// Timestamps
createdAt: timestamp('created_at').notNull().defaultNow(),
updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// Credentials table  
export const credentials = pgTable('credentials', {
id: uuid('id').primaryKey().defaultRandom(),

// References
schemaId: uuid('schema_id').notNull().references(() => schemas.id),

// XRPL data
issuer: varchar('issuer', { length: 35 }).notNull(), // XRPL address
subject: varchar('subject', { length: 35 }).notNull(), // XRPL address

// Credential data (W3C VC format in JSONB)
vcDocument: jsonb('vc_document').notNull().$type<W3CVerifiableCredential>(),

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
});

// Indexes
export const schemaIndexes = {
creatorIdx: index('schemas_creator_idx').on(schemas.creator),
publicIdx: index('schemas_public_idx').on(schemas.isPublic),
parentIdx: index('schemas_parent_idx').on(schemas.parentSchemaId),
};

export const credentialIndexes = {
issuerIdx: index('credentials_issuer_idx').on(credentials.issuer),
subjectIdx: index('credentials_subject_idx').on(credentials.subject),
schemaIdx: index('credentials_schema_idx').on(credentials.schemaId),
acceptedIdx: index('credentials_accepted_idx').on(credentials.accepted),
revokedIdx: index('credentials_revoked_idx').on(credentials.revoked),
};
