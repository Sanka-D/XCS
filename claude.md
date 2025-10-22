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

### 🚧 Needs Completion

#### Priority 1: Backend Tasks

1. **Database Setup**
   - [ ] Generate initial Drizzle migration from schema
   - [ ] Run migration to create tables
   - [ ] Add seed data script (optional, for testing)

2. **Missing Server Utilities**
   - [ ] Error handling utilities (`server/utils/errors.ts`)
     - Custom error classes
     - Error response formatting
   - [ ] Complete W3C VC utilities (`server/utils/w3c-vc.ts`)
     - Ensure `validateDataAgainstSchema` function exists
     - Ensure `generateW3CVC` function exists
     - Add proof generation (signature support)

3. **API Endpoint Fixes**
   - [ ] Review and fix missing imports (e.g., `eq` from drizzle-orm in some files)
   - [ ] Add health check endpoint (`/api/health.get.ts`)
   - [ ] Add proper error middleware (`server/middleware/error-handler.ts`)

4. **Database Connection**
   - [ ] Verify `server/db/index.ts` exports working db instance
   - [ ] Test connection with PostgreSQL

#### Priority 2: Frontend/UI Tasks

1. **Project Structure Fix**
   - [ ] Move components from `app/components/pages/` to proper `app/pages/` structure
   - [ ] Create proper page files:
     - `app/pages/index.vue` - Landing page
     - `app/pages/schemas/index.vue` - Browse schemas
     - `app/pages/schemas/create.vue` - Create schema
     - `app/pages/schemas/[id].vue` - Schema detail
     - `app/pages/credentials/index.vue` - Browse credentials
     - `app/pages/credentials/issue.vue` - Issue credential
     - `app/pages/credentials/[id].vue` - Credential detail
     - `app/pages/credentials/accept.vue` - Accept credentials
     - `app/pages/docs/index.vue` - Documentation
     - `app/pages/docs/w3c-guide.vue` - W3C VC guide

2. **Missing Components**
   - [ ] Schema Components
     - `SchemaCard.vue` - Display schema summary
     - `SchemaList.vue` - List of schemas with search/filter
     - `SchemaVersionHistory.vue` - Show version history
   - [ ] Credential Components
     - `CredentialCard.vue` - Display credential summary
     - `CredentialList.vue` - List of credentials with filters
   - [ ] Layout Components
     - `AppHeader.vue` - Navigation header
     - `AppFooter.vue` - Footer
   - [ ] UI Components (if not using Nuxt UI for all)
     - Verify Nuxt UI provides: Button, Input, Select, Card, Badge, Modal
     - Create custom components only if needed

3. **Layouts**
   - [ ] Create `app/layouts/default.vue` with header/footer
   - [ ] Update `app/app.vue` to use NuxtLayout and NuxtPage

4. **Page Integrations**
   - [ ] Wire up components to API endpoints using `useFetch` or `$fetch`
   - [ ] Add loading states and error handling
   - [ ] Add success notifications
   - [ ] Implement pagination for lists

#### Priority 3: Bug Fixes & Polish

1. **Code Quality**
   - [ ] Review all TypeScript errors
   - [ ] Add missing type imports
   - [ ] Fix any linting issues

2. **Error Handling**
   - [ ] Add comprehensive error handling to all API endpoints
   - [ ] Display user-friendly error messages in UI
   - [ ] Add validation error display in forms

3. **Testing**
   - [ ] Manual testing of all flows:
     - Create schema (private and public)
     - Issue credential (private and public)
     - Accept credential
     - Revoke credential
     - View schemas and credentials
   - [ ] Test XRPL integration on testnet
   - [ ] Test IPFS publishing and retrieval

4. **UX Improvements**
   - [ ] Add loading spinners
   - [ ] Add confirmation modals for destructive actions
   - [ ] Add form validation feedback
   - [ ] Improve mobile responsiveness

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
