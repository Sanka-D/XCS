import {
  computeSchemaUid,
  validateSchema,
  type NetworkProfile,
  type SchemaDefinition,
} from '@xcs-protocol/core'

import { assertBrowserE2eServerMode } from '../../../../app/utils/browserE2eMode'

const PROFILE_ID = 'xrpl-testnet-xcs-browser-e2e'
const ISSUER = 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh'
const SUBJECT = 'r9cZA1mLK5R5Am25ArfXFmqgNwjZgnfk59'
const LEDGER_HASH = 'cd'.repeat(32)
const SCHEMA: SchemaDefinition = {
  xcsVersion: '0.1',
  name: 'Course participation',
  description: 'Attests participation in one deterministic browser test course.',
  fields: {
    programId: { type: 'string' },
    completedAt: { type: 'string' },
  },
}
const SCHEMA_UID = computeSchemaUid({
  schema: validateSchema(SCHEMA),
  networkId: 1,
  ledgerHash: LEDGER_HASH,
  ledgerIndex: 100_001,
  transactionIndex: 1,
  publisher: ISSUER,
})
const PROFILE: NetworkProfile = {
  profileId: PROFILE_ID,
  xcsVersion: '0.1',
  networkId: 1,
  requiredAmendment: 'ab'.repeat(32).toUpperCase(),
  registryAddress: SUBJECT,
  registrationAmountDrops: '1',
  activationLedgerIndex: 1,
  activationLedgerHash: 'ef'.repeat(32),
}

function notFound(): never {
  throw createError({ statusCode: 404, statusMessage: 'Browser E2E API route not found' })
}

export default defineEventHandler((event) => {
  const config = useRuntimeConfig(event)
  assertBrowserE2eServerMode(config.browserE2eMode, config.public.browserE2eMode, import.meta.dev)
  if (config.browserE2eMode !== 'enabled') return notFound()

  const path = getRouterParam(event, 'path') ?? ''
  if (path === 'networks') return { items: [PROFILE] }

  if (path === `networks/${PROFILE_ID}/stats`) {
    return {
      network: PROFILE_ID,
      schemas: { total: 12, publishers: 4 },
      credentialGenerations: {
        total: 27,
        pending: 3,
        active: 20,
        expired: 2,
        deleted: 2,
      },
      checkpoint: {
        ledgerIndex: 100_001,
        ledgerHash: LEDGER_HASH,
        closeTime: 838_857_600,
        transactionRoot: 'cd'.repeat(32),
      },
    }
  }

  if (path === `networks/${PROFILE_ID}/search`) {
    return {
      items: [
        {
          type: 'schema',
          schemaUid: SCHEMA_UID,
          name: SCHEMA.name,
          description: SCHEMA.description,
          publisher: ISSUER,
          parentUid: null,
          supersedesUid: null,
          registrationTransactionHash: '56'.repeat(32),
          ledgerIndex: 100_001,
          transactionIndex: 1,
        },
      ],
      hasMore: false,
    }
  }

  if (path === `networks/${PROFILE_ID}/schemas/${SCHEMA_UID}`) {
    return {
      schemaUid: SCHEMA_UID,
      name: SCHEMA.name,
      description: SCHEMA.description,
      publisher: ISSUER,
      parentUid: null,
      supersedesUid: null,
      definition: SCHEMA,
      resolvedDefinition: { definition: SCHEMA, fields: SCHEMA.fields, lineage: [] },
      registrationTransactionHash: '56'.repeat(32),
      ledgerIndex: 100_001,
      transactionIndex: 1,
    }
  }

  return notFound()
})
