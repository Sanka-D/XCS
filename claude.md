# XCS - XRPL Credential System

## Project Overview

A decentralized credential platform built on XRPL that allows anyone to create schemas and issue verifiable credentials. Credentials can be stored privately (on our service) or publicly (on IPFS), following W3C Verifiable Credentials standards.

## Technology Stack

- **Framework**: Nuxt 4 (Full SSR)
- **Runtime**: Node.js 20+
- **Language**: TypeScript
- **Database**: PostgreSQL 16+ with Drizzle ORM
- **XRPL**: xrpl.js v4+, Testnet (wss://s.altnet.rippletest.net:51233)
- **IPFS**: ipfs-http-client (configurable provider)
- **UI**: Vue 3 (Composition API) + TailwindCSS + Nuxt UI
- **Validation**: Zod

## Current Project Status

### ✅ Spec-Discrepancy Remediation (2026-05-03)

Phases 0–9 implemented across 16 commits on `feat/spec-fixes`:

- ✅ **Phase 0**: Vitest test infrastructure (6 test files, 31 passing)
- ✅ **Phase 1**: W3C VC wrapper (canonical-json + signed/verified roundtrip)
- ✅ **Phase 2**: Pinata IPFS utility (`pinJSON`, `fetchJSON`, `unpin`, `gatewayUrl`)
- ✅ **Phase 3**: Public schema publishing (isPublic toggle + IPFS pin + on-chain CID memo)
- ✅ **Phase 4**: W3C VC hardening & public credential publishing (signed VC + IPFS + URI)
- ✅ **Phase 5**: Credential verification endpoint (`/api/credential/verify` + `/verify` page)
- ✅ **Phase 6**: Wallet-signed CredentialAccept (new `/api/credential/accept-signed` endpoint)
- ✅ **Phase 7**: `useIndexerWait` composable (UX polling for sink latency)
- ✅ **Phase 8**: Schema versioning (`parent_uid` + history chain + cycle defense)
- ✅ **Phase 9**: Server-side expiration filter (`excludeExpired`) + `isExpired` decoration

### ✅ Completed

#### Backend Infrastructure
- ✅ Database schema defined (`server/db/schema.ts`)
  - Schemas table with versioning support
  - Credentials table with W3C VC format
  - Proper indexes for performance
- ✅ Database connection setup (`server/db/index.ts`)
- ✅ Type definitions (`lib/types/schema.ts`)
  - SchemaField, SchemaFields, Schema interfaces
  - Credential and W3CVerifiableCredential interfaces

#### Server Utilities
- ✅ XRPL client (`server/utils/xrpl.ts`)
  - Connection management
  - Credential creation on-chain (CredentialCreate)
  - Credential acceptance (CredentialAccept)
  - Credential deletion (CredentialDelete)
  - Ripple time conversion
- ✅ IPFS client (`server/utils/ipfs.ts`)
  - Publish to IPFS
  - Get from IPFS
  - Unpin functionality
  - Gateway URL builder
- ✅ W3C VC utilities (`server/utils/w3c-vs.ts`)
  - W3C VC document generation
  - Schema validation
- ✅ Validation schemas (`server/utils/validation.ts`)

#### API Endpoints
- ✅ Schema Management
  - `POST /api/schema/create` - Create new schema
  - `POST /api/schema/list` - List/search schemas
  - `GET /api/schema` - Get schema by ID
  - `POST /api/schema/update-version` - Update schema version
- ✅ Credential Management
  - `POST /api/credential/issue` - Issue credential
  - `POST /api/credential/list` - List/query credentials
  - `GET /api/credential` - Get credential by ID
  - `POST /api/credential/revoke` - Revoke credential
  - `POST /api/credential/accept` - Accept credential (subject)

#### Components
- ✅ `SchemaForm.vue` - Full schema creation form with dynamic fields
- ✅ `CredentialForm.vue` - Credential issuance form
- ✅ `CredentialAcceptance.vue` - Subject acceptance view

#### Configuration
- ✅ Nuxt config with runtime config
- ✅ Drizzle config
- ✅ Environment variables template
- ✅ Package.json with all dependencies

### ✅ Backend Infrastructure (Phase Remediation)

#### Database Setup
- ✅ Database tables managed by `substreams-sink-sql` (Phase 9)
  - `schemas(uid PK, issuer, schema_json, ledger_index, tx_index, tx_hash)`
  - `credentials(id PK, issuer, subject, credential_type, uri, expiration, created_ledger, status, tx_hash)`
  - Schema defined in `substreams/schema.sql`
  - Sink configuration: `substreams-sink-sql setup/run`

#### Server Utilities
- ✅ W3C VC utilities (`server/utils/w3c-vc.ts`)
  - Canonical JSON generation (Phase 1)
  - W3C VC wrapper with signature verification (Phase 1)
  - Proof generation with ED25519 signatures (Phase 1)
  - 6 unit tests covering signed/verified roundtrips
- ✅ IPFS client (`server/utils/ipfs.ts`)
  - Pinata integration with JWT auth (Phase 2)
  - `pinJSON()`, `fetchJSON()`, `unpin()`, `gatewayUrl()` (Phase 2)
  - Configurable IPFS_GATEWAY in runtime config (Phase 4)
  - Timeout handling + error recovery (Phase 4)
- ✅ Error handling
  - Inline `createError()` usage (Nuxt native, no separate errors.ts)
  - Validation errors via Zod integration

#### API Endpoints
- ✅ Schema Management
  - `POST /api/schema/create` — Public/private toggle + IPFS publish (Phase 3)
  - `POST /api/schema/list` — Full list/search with filters
  - `GET /api/schema` — Schema by ID
  - `POST /api/schema/update-version` — Versioning with parent_uid (Phase 8)
- ✅ Credential Management
  - `POST /api/credential/issue` — Signed W3C VC + IPFS publish (Phase 4)
  - `POST /api/credential/list` — Full list/query with expiration filter (Phase 9)
  - `GET /api/credential` — Credential by ID with expiration check (Phase 9)
  - `POST /api/credential/revoke` — Revoke on-chain
  - `POST /api/credential/accept` — Legacy seed-based (Phase 6)
  - `POST /api/credential/accept-signed` — Wallet-signed (Phase 6)
  - `POST /api/credential/verify` — Pure verification endpoint (Phase 5)
- ✅ Health endpoint (`/api/health.get.ts`)

### ✅ Frontend/UI (Phase Remediation)

#### Pages
- ✅ `app/pages/index.vue` — Landing page
- ✅ `app/pages/schemas/index.vue` — Browse schemas
- ✅ `app/pages/schemas/create.vue` — Create schema with isPublic toggle (Phase 3)
- ✅ `app/pages/schemas/[id].vue` — Schema detail with version history (Phase 8)
- ✅ `app/pages/credentials/index.vue` — Browse credentials
- ✅ `app/pages/credentials/issue.vue` — Issue credential with isPublic toggle (Phase 4)
- ✅ `app/pages/credentials/[id].vue` — Credential detail
- ✅ `app/pages/credentials/accept.vue` — Accept credentials with wallet signature (Phase 6)
- ✅ `app/pages/credentials/verify.vue` — Verify credentials page (Phase 5)
- ✅ `app/pages/docs/index.vue` — Documentation

#### Components
- ✅ Schema Components
  - `SchemaForm.vue` — Full schema creation with dynamic fields
  - `SchemaCard.vue` — Schema summary
  - `SchemaList.vue` — List with search/filter
  - `SchemaVersionHistory.vue` — Version chain + cycle defense (Phase 8)
- ✅ Credential Components
  - `CredentialForm.vue` — Credential issuance form
  - `CredentialCard.vue` — Credential summary
  - `CredentialList.vue` — List with filters
  - `CredentialAcceptance.vue` — Subject acceptance view (with wallet signature)

#### Layouts & Infrastructure
- ✅ `app/layouts/default.vue` — Header + footer
- ✅ `app/app.vue` — NuxtLayout + NuxtPage
- ✅ `useIndexerWait` composable — Polling for sink latency (Phase 7)
- ✅ W3C VC Guide integrated into docs

### 🚧 Remaining Work

#### Polish & Testing
1. **Manual Testing**
   - [ ] Create schema (private and public) → verify IPFS + chain state
   - [ ] Issue credential (private and public) → verify URI + sink latency
   - [ ] Accept credential (wallet-signed) → verify on-chain state
   - [ ] Verify credential → ensure W3C signature checks
   - [ ] Revoke credential → verify on-chain deletion
   - [ ] Schema versioning → test parent_uid chain + cycle defense

2. **UX Improvements**
   - [ ] Loading spinners on all async operations
   - [ ] Confirmation modals for destructive actions (revoke, delete)
   - [ ] Form validation feedback (Zod errors → UI)
   - [ ] Mobile responsiveness polish

3. **Code Quality**
   - [ ] Review remaining TypeScript errors (if any)
   - [ ] Lint check (`npm run lint`)
   - [ ] Type safety verification

### 📝 Future Enhancements (Not MVP)

- [ ] **Authentication System**: Add user wallet connection (XUMM or similar)
  - Currently using env-based issuer wallet
  - Future: Allow users to connect their own wallets
  - Need wallet signature verification
  - Session management

- [ ] **IPFS Refactoring**: Review and potentially refactor IPFS implementation
  - Current implementation uses `ipfs-http-client`
  - May want to switch to Helia (already installed)
  - Consider using Pinata SDK directly
  - Improve error handling and retry logic

- [ ] Advanced search and filtering
- [ ] Credential verification endpoint
- [ ] Webhook support for credential events
- [ ] Export credentials in various formats
- [ ] Schema marketplace/discovery
- [ ] Analytics dashboard

## Setup Instructions

### Prerequisites
- Node.js 20+
- PostgreSQL 16+
- XRPL Testnet account with funded wallet
- (Optional) IPFS provider credentials (Pinata, Web3.Storage, etc.)

### Installation

1. **Clone and Install Dependencies**
   ```bash
   npm install
   ```

2. **Database Setup**
   ```bash
   # Create database
   createdb xcs

   # Or using psql
   psql -U postgres
   CREATE DATABASE xcs;
   ```

3. **Environment Variables**
   ```bash
   cp .env.example .env
   ```

   Edit `.env`:
   ```env
   # Database
   DATABASE_URL=postgresql://user:12345678@localhost:5432/xcs

   # XRPL Configuration
   XRPL_SERVER=wss://s.altnet.rippletest.net:51233
   ISSUER_SEED=sXXXXXXXXXXXXXXXXXXXXXXXXXXXXX  # Your testnet wallet seed

   # IPFS Configuration (if using public storage)
   IPFS_PROVIDER=pinata
   PINATA_JWT=your_pinata_jwt_here
   IPFS_GATEWAY=https://gateway.pinata.cloud

   # Application
   BASE_URL=http://localhost:3000
   PORT=3000
   ```

4. **Generate and Run Database Migrations**
   ```bash
   # Generate migration from schema
   npm run db:generate

   # Push to database
   npm run db:push

   # Or use Drizzle Studio to inspect
   npm run db:studio
   ```

5. **Start Development Server**
   ```bash
   npm run dev
   ```

### Getting XRPL Testnet Wallet

If you don't have a testnet wallet:

```typescript
// Run this script once to generate a wallet
import { Client, Wallet } from 'xrpl'

const client = new Client('wss://s.altnet.rippletest.net:51233')
await client.connect()

// Generate new wallet
const wallet = Wallet.generate()
console.log('Address:', wallet.address)
console.log('Seed:', wallet.seed)  // Save this securely!

// Fund it from testnet faucet
const response = await client.fundWallet(wallet)
console.log('Funded:', response)

await client.disconnect()
```

Or use the XRPL Testnet Faucet: https://xrpl.org/xrp-testnet-faucet.html

## Development Workflow

### Creating a New Schema

1. Navigate to `/schemas/create`
2. Fill in schema details:
   - Name (required)
   - Description
   - Version (semantic versioning)
   - Public/Private toggle
3. Add fields with types and validation rules
4. Submit - schema will be created in DB and optionally on IPFS

### Issuing a Credential

1. Navigate to `/credentials/issue`
2. Select a schema
3. Enter subject XRPL address
4. Fill in credential data according to schema
5. Choose public (IPFS) or private storage
6. Submit - credential will be:
   - Validated against schema
   - Stored in DB and optionally IPFS
   - Created on-chain via XRPL CredentialCreate transaction
   - Subject can then accept it

### Accepting a Credential

1. Subject navigates to `/credentials/accept`
2. Views pending credentials
3. Clicks accept
4. Provides their wallet seed (for MVP)
5. XRPL CredentialAccept transaction is submitted

## API Reference

### Schemas

**Create Schema**
```
POST /api/schema/create
Body: {
  name: string
  description?: string
  version: string
  fields: SchemaField[]
  isPublic: boolean
  parentSchemaId?: string
}
```

**List Schemas**
```
POST /api/schema/list
Body: {
  creator?: string
  isPublic?: boolean
  search?: string
  limit?: number
  offset?: number
}
```

**Get Schema**
```
GET /api/schema?id={schemaId}
```

### Credentials

**Issue Credential**
```
POST /api/credential/issue
Body: {
  schemaId: string
  subject: string (XRPL address)
  data: object
  isPublic: boolean
  expiresAt?: string (ISO date)
}
```

**List Credentials**
```
POST /api/credential/list
Body: {
  issuer?: string
  subject?: string
  schemaId?: string
  accepted?: boolean
  revoked?: boolean
  limit?: number
  offset?: number
}
```

**Accept Credential**
```
POST /api/credential/accept
Body: {
  credentialId: string
  subjectSeed: string
}
```

**Revoke Credential**
```
POST /api/credential/revoke
Body: {
  credentialId: string
}
```

## Project File Structure

```
xrpl-credential-platform/
├── app/
│   ├── components/
│   │   ├── schema/
│   │   │   ├── SchemaForm.vue ✅
│   │   │   ├── SchemaCard.vue ❌
│   │   │   ├── SchemaList.vue ❌
│   │   │   └── SchemaVersionHistory.vue ❌
│   │   ├── credential/
│   │   │   ├── CredentialForm.vue ✅
│   │   │   ├── CredentialCard.vue ❌
│   │   │   ├── CredentialList.vue ❌
│   │   │   └── CredentialAcceptance.vue ✅
│   │   └── layout/
│   │       ├── AppHeader.vue ❌
│   │       └── AppFooter.vue ❌
│   ├── pages/ ❌ (needs to be created)
│   ├── layouts/
│   │   └── default.vue ❌
│   └── app.vue ⚠️ (needs update)
├── server/
│   ├── api/ ✅
│   ├── utils/ ⚠️ (mostly complete, some functions need implementation)
│   ├── db/
│   │   ├── schema.ts ✅
│   │   ├── index.ts ⚠️ (needs verification)
│   │   └── migrations/ ❌ (needs generation)
│   └── middleware/
│       └── error-handler.ts ❌
├── lib/
│   ├── types/
│   │   └── schema.ts ✅
│   └── constants.ts ❌
├── .env.example ✅
├── nuxt.config.ts ✅
├── drizzle.config.ts ✅
├── package.json ✅
└── README.md ❌

Legend:
✅ Complete
⚠️ Partial/Needs Review
❌ Not Started
```

## Key Implementation Notes

### W3C Verifiable Credentials

The system follows W3C VC 1.1 specification:
- `@context`: Standard W3C contexts
- `type`: VerifiableCredential + custom types
- `issuer`: XRPL address of issuer
- `credentialSubject`: Data validated against schema
- `credentialSchema`: Reference to schema (IPFS CID or internal ID)

### XRPL Integration

Uses XRPL Credentials Amendment (XRPL v2.0):
- `CredentialCreate`: Creates on-chain credential attestation
- `CredentialAccept`: Subject accepts credential
- `CredentialDelete`: Issuer revokes/deletes credential
- Credentials stored as hex-encoded types with URIs

### Data Flow

1. **Schema Creation**:
   Schema → Validate → Store DB → (If public) → Publish IPFS → Return

2. **Credential Issuance**:
   Data → Validate against Schema → Generate W3C VC → (If public) → Publish IPFS → Create XRPL Credential → Store DB → Return

3. **Credential Acceptance**:
   Request → Load Credential → Verify Subject → XRPL CredentialAccept → Update DB → Return

## Troubleshooting

### Database Connection Issues
- Ensure PostgreSQL is running: `pg_isready`
- Check credentials in `.env`
- Verify database exists: `psql -U user -l`

### XRPL Connection Issues
- Test network connectivity to testnet
- Verify issuer seed is valid
- Check wallet is funded (minimum 10 XRP)

### IPFS Issues
- Verify provider credentials (Pinata JWT)
- Check network connectivity
- Test with public gateway first

### Build Errors
- Clear `.nuxt` directory: `rm -rf .nuxt`
- Clear node_modules: `rm -rf node_modules && npm install`
- Check TypeScript errors: `npx nuxi typecheck`

## Contributing

When working on this project:
1. Backend first - ensure all APIs work
2. UI second - build components and pages
3. Bug fixes and polish last
4. Test each feature thoroughly
5. Follow the spec.md for requirements

## Resources

- [XRPL Docs](https://xrpl.org/)
- [W3C Verifiable Credentials](https://www.w3.org/TR/vc-data-model/)
- [Nuxt 4 Docs](https://nuxt.com/)
- [Drizzle ORM](https://orm.drizzle.team/)
- [Nuxt UI](https://ui.nuxt.com/)
