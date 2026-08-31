import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import {
  canonicalize,
  computeSchemaUid,
  encodeUtf8,
  isClassicAddress,
  MAX_SCHEMA_CATALOG_ENTRIES,
  sha256Hex,
  validateSchema,
  type JsonValue,
  type VerificationReport,
} from '@xcs-protocol/core'
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify'
import { createHash, timingSafeEqual } from 'node:crypto'

import {
  assertCredentialGenerationEvidence,
  CREDENTIAL_DELETION_CAUSES,
  type CredentialGenerationEvidenceExpectation,
} from './credential-generation-evidence.js'
import { credentialGenerationState } from './credential-state.js'
import { DEFAULT_LEDGER_MAX_AGE_SECONDS, IndexerUnavailableError } from './ledger-freshness.js'
import {
  assertAuthoritativeLedgerEvidence,
  assertIndexerReady,
  publicIndexerStatus,
} from './indexer-status.js'
import {
  OperationalMetricsCollector,
  rateLimitMetric,
  renderPrometheusMetrics,
  type OperationalMetricsRepository,
} from './operational-metrics.js'
import {
  decodeSchemaCursor,
  decodeSchemaRegistrationCursor,
  encodeSchemaCursor,
  encodeSchemaRegistrationCursor,
} from './pagination.js'
import { DemoPinningService, PinningError } from './pinning.js'
import { authoritativeSchemaCatalogBundle } from './schema-catalog.js'
import {
  authoritativeResolvedSchema,
  SchemaProjectionInvalidError,
  schemaProjectionEvidenceUids,
} from './schema-projection.js'
import type { ApiRepository, PayloadResolver, TrustPolicy } from './types.js'
import {
  VerificationNetworkNotFoundError,
  verifyCredential,
  type VerifyRequest,
} from './verification.js'

const PROFILE_PATTERN = '^[a-z0-9][a-z0-9._-]{0,127}$'
const UID_PATTERN = '^[0-9a-f]{64}$'
const INPUT_HASH_PATTERN = '^[0-9A-Fa-f]{64}$'
const LOWERCASE_HASH = /^[0-9a-f]{64}$/u
const HEX_BYTES = /^(?:[0-9A-Fa-f]{2})*$/u
const REASON_CODE = /^[A-Z][A-Z0-9_]{0,127}$/u
const ADDRESS_PATTERN = '^r[1-9A-HJ-NP-Za-km-z]{24,34}$'
const CREDENTIAL_EVENT_HISTORY_LIMIT = 100
const CREDENTIAL_GENERATION_TIMELINE_LIMIT = 100
const EXACT_CREDENTIAL_EVENT_QUERY_LIMIT = 2
const DISCOVERY_SEARCH_DEFAULT_LIMIT = 20
const DISCOVERY_SEARCH_MAX_LIMIT = 50
const DISCOVERY_PAGE_DEFAULT_LIMIT = 20
const DISCOVERY_PAGE_MAX_LIMIT = 100
const MAX_NODE_INDEX = 2_147_483_647
const MAX_UINT32 = 4_294_967_295
const SEARCH_QUERY_CONTENT = /[\p{L}\p{N}]/u
const SEARCH_QUERY_CONTROL = /[\u0000-\u001f\u007f]/u
const INTERNAL_SSR_TOKEN = /^[A-Za-z0-9_-]{32,256}$/u
const INTERNAL_SSR_CLIENT_KEY = /^[0-9a-f]{64}$/u
const INTERNAL_SSR_TOKEN_HEADER = 'x-xcs-internal-token'
const INTERNAL_SSR_CLIENT_KEY_HEADER = 'x-xcs-client-key'
const INTERNAL_METRICS_TOKEN_HEADER = 'authorization'
const INTERNAL_METRICS_TOKEN = /^[A-Za-z0-9_-]{32,256}$/u
const errorResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['error', 'message'],
  properties: {
    error: { type: 'string' },
    message: { type: 'string' },
  },
} as const
const rateLimitResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['statusCode', 'error', 'message'],
  properties: {
    statusCode: { type: 'integer', const: 429 },
    error: { type: 'string' },
    message: { type: 'string' },
  },
} as const
const networkParamsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['network'],
  properties: { network: { type: 'string', pattern: PROFILE_PATTERN } },
} as const
const publicIndexerStatusSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['profileId', 'state', 'sourceTips', 'lastAgreedLedger', 'errorCode', 'updatedAt'],
  properties: {
    profileId: { type: 'string', pattern: PROFILE_PATTERN },
    state: { type: 'string', enum: ['starting', 'catching_up', 'ready', 'halted'] },
    sourceTips: {
      type: 'object',
      additionalProperties: false,
      required: ['primary', 'secondary'],
      properties: {
        primary: { type: 'integer', nullable: true, minimum: 0, maximum: 4_294_967_295 },
        secondary: { type: 'integer', nullable: true, minimum: 0, maximum: 4_294_967_295 },
      },
    },
    lastAgreedLedger: {
      anyOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['index', 'hash'],
          properties: {
            index: { type: 'integer', minimum: 0, maximum: 4_294_967_295 },
            hash: { type: 'string', pattern: UID_PATTERN },
          },
        },
        { type: 'null' },
      ],
    },
    errorCode: {
      type: 'string',
      nullable: true,
      pattern: '^[A-Z][A-Z0-9_]{0,63}$',
    },
    updatedAt: { type: 'string', format: 'date-time' },
  },
} as const
const publicCredentialEventSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'transactionHash',
    'nodeIndex',
    'generationId',
    'ledgerIndex',
    'ledgerHash',
    'transactionIndex',
    'eventType',
    'issuer',
    'subject',
    'schemaUid',
    'accepted',
    'deletionCause',
  ],
  properties: {
    transactionHash: { type: 'string', pattern: UID_PATTERN },
    nodeIndex: { type: 'integer', minimum: 0 },
    generationId: { type: 'string', pattern: UID_PATTERN },
    ledgerIndex: { type: 'integer', minimum: 0, maximum: 4_294_967_295 },
    ledgerHash: { type: 'string', pattern: UID_PATTERN },
    transactionIndex: { type: 'integer', minimum: 0 },
    eventType: { type: 'string', enum: ['created', 'accepted', 'deleted'] },
    issuer: { type: 'string', pattern: ADDRESS_PATTERN },
    subject: { type: 'string', pattern: ADDRESS_PATTERN },
    schemaUid: { type: 'string', pattern: UID_PATTERN },
    accepted: { type: 'boolean' },
    deletionCause: {
      anyOf: [
        {
          type: 'string',
          enum: [
            'issuer_revoked',
            'subject_rejected',
            'subject_removed',
            'expired_cleanup',
            'account_deleted',
            'self_deleted',
          ],
        },
        { type: 'null' },
      ],
    },
  },
} as const
const credentialEventHistoryResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: { ...publicCredentialEventSchema, additionalProperties: true },
    },
  },
} as const
const exactCredentialEventResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['transactionHash', 'event'],
  properties: {
    transactionHash: { type: 'string', pattern: UID_PATTERN },
    event: { anyOf: [publicCredentialEventSchema, { type: 'null' }] },
  },
} as const
const publicSchemaRegistrationSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'status',
    'publisher',
    'ledgerIndex',
    'ledgerHash',
    'transactionIndex',
    'schemaUid',
    'schemaDigestHex',
    'reasonCode',
  ],
  properties: {
    status: { type: 'string', enum: ['accepted', 'rejected'] },
    publisher: { type: 'string', pattern: ADDRESS_PATTERN },
    ledgerIndex: { type: 'integer', minimum: 0, maximum: 4_294_967_295 },
    ledgerHash: { type: 'string', pattern: UID_PATTERN },
    transactionIndex: { type: 'integer', minimum: 0 },
    schemaUid: { anyOf: [{ type: 'string', pattern: UID_PATTERN }, { type: 'null' }] },
    schemaDigestHex: { anyOf: [{ type: 'string', pattern: UID_PATTERN }, { type: 'null' }] },
    reasonCode: { anyOf: [{ type: 'string', minLength: 1, maxLength: 128 }, { type: 'null' }] },
  },
} as const
const exactSchemaRegistrationResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['transactionHash', 'registration'],
  properties: {
    transactionHash: { type: 'string', pattern: UID_PATTERN },
    registration: { anyOf: [publicSchemaRegistrationSchema, { type: 'null' }] },
  },
} as const

const publicCheckpointSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['ledgerIndex', 'ledgerHash', 'closeTime', 'transactionRoot'],
  properties: {
    ledgerIndex: { type: 'integer', minimum: 0, maximum: 4_294_967_295 },
    ledgerHash: { type: 'string', pattern: UID_PATTERN },
    closeTime: { type: 'integer', minimum: 0, maximum: 4_294_967_295 },
    transactionRoot: { type: 'string', pattern: UID_PATTERN },
  },
} as const

const networkReadinessResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['profileId', 'status', 'checkpoint'],
  properties: {
    profileId: { type: 'string', pattern: PROFILE_PATTERN },
    status: { type: 'string', enum: ['ready'] },
    checkpoint: publicCheckpointSchema,
  },
} as const

const publicSchemaSummarySchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaUid',
    'publisher',
    'name',
    'description',
    'parentUid',
    'supersedesUid',
    'registrationTransactionHash',
    'ledgerIndex',
    'transactionIndex',
  ],
  properties: {
    schemaUid: { type: 'string', pattern: UID_PATTERN },
    publisher: { type: 'string', pattern: ADDRESS_PATTERN },
    name: { type: 'string' },
    description: { type: 'string' },
    parentUid: { anyOf: [{ type: 'string', pattern: UID_PATTERN }, { type: 'null' }] },
    supersedesUid: { anyOf: [{ type: 'string', pattern: UID_PATTERN }, { type: 'null' }] },
    registrationTransactionHash: { type: 'string', pattern: UID_PATTERN },
    ledgerIndex: { type: 'integer', minimum: 0, maximum: 4_294_967_295 },
    transactionIndex: { type: 'integer', minimum: 0 },
  },
} as const

const xcsFieldDescriptorSchema = {
  $id: 'XcsFieldDescriptor',
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['type'],
      properties: {
        type: { type: 'string', enum: ['string', 'bool', 'uint', 'int', 'bytes', 'address'] },
        optional: { type: 'boolean' },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'items'],
      properties: {
        type: { type: 'string', const: 'array' },
        optional: { type: 'boolean' },
        items: { $ref: 'XcsFieldDescriptor#' },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'fields'],
      properties: {
        type: { type: 'string', const: 'object' },
        optional: { type: 'boolean' },
        fields: {
          type: 'object',
          minProperties: 1,
          additionalProperties: { $ref: 'XcsFieldDescriptor#' },
        },
      },
    },
  ],
} as const

const xcsFieldsSchema = {
  type: 'object',
  minProperties: 1,
  additionalProperties: { $ref: 'XcsFieldDescriptor#' },
} as const

const xcsSchemaDefinitionSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['xcsVersion', 'name', 'description', 'fields'],
  properties: {
    xcsVersion: { type: 'string', const: '0.1' },
    name: { type: 'string', minLength: 1 },
    description: { type: 'string', minLength: 1 },
    extends: { type: 'string', pattern: UID_PATTERN },
    supersedes: { type: 'string', pattern: UID_PATTERN },
    fields: xcsFieldsSchema,
  },
} as const

const schemaCatalogResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['format', 'profile', 'targetUid', 'checkpoint', 'schemas'],
  properties: {
    format: { type: 'string', const: 'xcs-schema-catalog/1' },
    profile: {
      type: 'object',
      additionalProperties: false,
      required: [
        'profileId',
        'xcsVersion',
        'networkId',
        'requiredAmendment',
        'registryAddress',
        'registrationAmountDrops',
        'activationLedgerIndex',
        'activationLedgerHash',
      ],
      properties: {
        profileId: { type: 'string', pattern: PROFILE_PATTERN },
        xcsVersion: { type: 'string', const: '0.1' },
        networkId: { type: 'integer', minimum: 0, maximum: MAX_UINT32 },
        requiredAmendment: { type: 'string', pattern: '^[0-9A-F]{64}$' },
        registryAddress: { type: 'string', pattern: ADDRESS_PATTERN },
        registrationAmountDrops: { type: 'string', const: '1' },
        activationLedgerIndex: { type: 'integer', minimum: 1, maximum: MAX_UINT32 },
        activationLedgerHash: { type: 'string', pattern: UID_PATTERN },
      },
    },
    targetUid: { type: 'string', pattern: UID_PATTERN },
    checkpoint: {
      type: 'object',
      additionalProperties: false,
      required: ['ledgerIndex', 'ledgerHash'],
      properties: {
        ledgerIndex: { type: 'integer', minimum: 1, maximum: MAX_UINT32 },
        ledgerHash: { type: 'string', pattern: UID_PATTERN },
      },
    },
    schemas: {
      type: 'array',
      minItems: 1,
      maxItems: MAX_SCHEMA_CATALOG_ENTRIES,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'uid',
          'definition',
          'publisher',
          'ledgerIndex',
          'ledgerHash',
          'transactionIndex',
          'transactionHash',
        ],
        properties: {
          uid: { type: 'string', pattern: UID_PATTERN },
          definition: xcsSchemaDefinitionSchema,
          publisher: { type: 'string', pattern: ADDRESS_PATTERN },
          ledgerIndex: { type: 'integer', minimum: 1, maximum: MAX_UINT32 },
          ledgerHash: { type: 'string', pattern: UID_PATTERN },
          transactionIndex: { type: 'integer', minimum: 0, maximum: MAX_UINT32 },
          transactionHash: { type: 'string', pattern: UID_PATTERN },
        },
      },
    },
  },
} as const

const publicSchemaRowSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'profileId',
    ...publicSchemaSummarySchema.required,
    'definition',
    'resolvedDefinition',
    'registeredAt',
  ],
  properties: {
    profileId: { type: 'string', pattern: PROFILE_PATTERN },
    ...publicSchemaSummarySchema.properties,
    definition: xcsSchemaDefinitionSchema,
    resolvedDefinition: {
      type: 'object',
      additionalProperties: false,
      required: ['definition', 'fields', 'lineage'],
      properties: {
        definition: xcsSchemaDefinitionSchema,
        fields: xcsFieldsSchema,
        lineage: { type: 'array', items: { type: 'string', pattern: UID_PATTERN } },
      },
    },
    registeredAt: { type: 'string', format: 'date-time' },
  },
} as const

const schemaListResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: { type: 'array', items: publicSchemaRowSchema },
    nextCursor: { type: 'string', minLength: 1, maxLength: 512 },
  },
} as const

const credentialStateSchema = {
  type: 'string',
  enum: ['pending', 'active', 'expired', 'deleted'],
} as const

const publicCredentialGenerationSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'generationId',
    'ledgerObjectId',
    'issuer',
    'subject',
    'schemaUid',
    'uriHex',
    'expiration',
    'accepted',
    'createdLedgerIndex',
    'createdTransactionIndex',
    'lastLedgerIndex',
    'deletedLedgerIndex',
    'deletionCause',
  ],
  properties: {
    generationId: { type: 'string', pattern: UID_PATTERN },
    ledgerObjectId: { type: 'string', pattern: UID_PATTERN },
    issuer: { type: 'string', pattern: ADDRESS_PATTERN },
    subject: { type: 'string', pattern: ADDRESS_PATTERN },
    schemaUid: { type: 'string', pattern: UID_PATTERN },
    uriHex: { anyOf: [{ type: 'string', pattern: '^(?:[0-9A-Fa-f]{2})*$' }, { type: 'null' }] },
    expiration: {
      anyOf: [{ type: 'integer', minimum: 0, maximum: 4_294_967_295 }, { type: 'null' }],
    },
    accepted: { type: 'boolean' },
    createdLedgerIndex: { type: 'integer', minimum: 0, maximum: 4_294_967_295 },
    createdTransactionIndex: { type: 'integer', minimum: 0 },
    lastLedgerIndex: { type: 'integer', minimum: 0, maximum: 4_294_967_295 },
    deletedLedgerIndex: {
      anyOf: [{ type: 'integer', minimum: 0, maximum: 4_294_967_295 }, { type: 'null' }],
    },
    deletionCause: {
      anyOf: [
        {
          type: 'string',
          enum: [
            'issuer_revoked',
            'subject_rejected',
            'subject_removed',
            'expired_cleanup',
            'account_deleted',
            'self_deleted',
          ],
        },
        { type: 'null' },
      ],
    },
  },
} as const

const exactCredentialResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'profileId',
    ...publicCredentialGenerationSchema.required,
    'createdAt',
    'updatedAt',
    'state',
  ],
  properties: {
    profileId: { type: 'string', pattern: PROFILE_PATTERN },
    ...publicCredentialGenerationSchema.properties,
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
    state: credentialStateSchema,
  },
} as const

const verificationResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['onChain', 'schema', 'payload', 'issuerTrust'],
  properties: {
    onChain: {
      type: 'string',
      enum: ['pending', 'active', 'expired', 'deleted', 'not_found'],
    },
    schema: { type: 'string', enum: ['valid', 'invalid', 'unknown'] },
    payload: {
      type: 'string',
      enum: ['valid', 'unavailable', 'tampered', 'invalid', 'not_checked'],
    },
    issuerTrust: { type: 'string', enum: ['trusted', 'untrusted', 'unknown'] },
    generationId: { type: 'string', pattern: UID_PATTERN },
  },
} as const

const publicCredentialGenerationSummarySchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'generationId',
    'issuer',
    'subject',
    'schemaUid',
    'state',
    'createdLedgerIndex',
    'lastLedgerIndex',
  ],
  properties: {
    generationId: { type: 'string', pattern: UID_PATTERN },
    issuer: { type: 'string', pattern: ADDRESS_PATTERN },
    subject: { type: 'string', pattern: ADDRESS_PATTERN },
    schemaUid: { type: 'string', pattern: UID_PATTERN },
    state: credentialStateSchema,
    createdLedgerIndex: { type: 'integer', minimum: 0, maximum: 4_294_967_295 },
    lastLedgerIndex: { type: 'integer', minimum: 0, maximum: 4_294_967_295 },
  },
} as const

const publicTransactionSummarySchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'transactionHash',
    'ledgerIndex',
    'ledgerHash',
    'transactionIndex',
    'registrationStatus',
    'credentialEventCount',
  ],
  properties: {
    transactionHash: { type: 'string', pattern: UID_PATTERN },
    ledgerIndex: { type: 'integer', minimum: 0, maximum: 4_294_967_295 },
    ledgerHash: { type: 'string', pattern: UID_PATTERN },
    transactionIndex: { type: 'integer', minimum: 0 },
    registrationStatus: {
      anyOf: [{ type: 'string', enum: ['accepted', 'rejected'] }, { type: 'null' }],
    },
    credentialEventCount: { type: 'integer', minimum: 0 },
  },
} as const

const discoveryStatsResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['network', 'schemas', 'credentialGenerations', 'checkpoint'],
  properties: {
    network: { type: 'string', pattern: PROFILE_PATTERN },
    schemas: {
      type: 'object',
      additionalProperties: false,
      required: ['total', 'publishers'],
      properties: {
        total: { type: 'integer', minimum: 0 },
        publishers: { type: 'integer', minimum: 0 },
      },
    },
    credentialGenerations: {
      type: 'object',
      additionalProperties: false,
      required: ['total', 'pending', 'active', 'expired', 'deleted'],
      properties: {
        total: { type: 'integer', minimum: 0 },
        pending: { type: 'integer', minimum: 0 },
        active: { type: 'integer', minimum: 0 },
        expired: { type: 'integer', minimum: 0 },
        deleted: { type: 'integer', minimum: 0 },
      },
    },
    checkpoint: publicCheckpointSchema,
  },
} as const

const discoverySearchResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['items', 'hasMore'],
  properties: {
    items: {
      type: 'array',
      items: {
        anyOf: [
          {
            type: 'object',
            additionalProperties: false,
            required: ['type', ...publicSchemaSummarySchema.required],
            properties: {
              type: { type: 'string', const: 'schema' },
              ...publicSchemaSummarySchema.properties,
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['type', ...publicCredentialGenerationSummarySchema.required],
            properties: {
              type: { type: 'string', const: 'credential_generation' },
              ...publicCredentialGenerationSummarySchema.properties,
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['type', ...publicTransactionSummarySchema.required],
            properties: {
              type: { type: 'string', const: 'transaction' },
              ...publicTransactionSummarySchema.properties,
            },
          },
        ],
      },
    },
    hasMore: { type: 'boolean' },
  },
} as const

const publicSchemaActivityItemSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['transactionHash', ...publicSchemaRegistrationSchema.required],
  properties: {
    transactionHash: { type: 'string', pattern: UID_PATTERN },
    ...publicSchemaRegistrationSchema.properties,
  },
} as const

const discoveryActivityResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: { type: 'array', items: publicSchemaActivityItemSchema },
    nextCursor: { type: 'string' },
  },
} as const

const credentialGenerationResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['generation', 'state', 'timeline'],
  properties: {
    generation: publicCredentialGenerationSchema,
    state: credentialStateSchema,
    timeline: { type: 'array', items: publicCredentialEventSchema },
  },
} as const

const transactionResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'transactionHash',
    'ledgerIndex',
    'ledgerHash',
    'transactionIndex',
    'registration',
    'credentialEvents',
  ],
  properties: {
    transactionHash: { type: 'string', pattern: UID_PATTERN },
    ledgerIndex: { type: 'integer', minimum: 0, maximum: 4_294_967_295 },
    ledgerHash: { type: 'string', pattern: UID_PATTERN },
    transactionIndex: { type: 'integer', minimum: 0 },
    registration: { anyOf: [publicSchemaRegistrationSchema, { type: 'null' }] },
    credentialEvents: {
      type: 'object',
      additionalProperties: false,
      required: ['items'],
      properties: {
        items: { type: 'array', items: publicCredentialEventSchema },
        nextCursor: { type: 'string', pattern: '^[0-9]+$' },
      },
    },
  },
} as const

function publicNetwork(row: Awaited<ReturnType<ApiRepository['listNetworks']>>[number]) {
  return {
    profileId: row.profileId,
    xcsVersion: row.xcsVersion,
    networkId: row.networkId,
    requiredAmendment: row.requiredAmendment,
    registryAddress: row.registryAddress,
    registrationAmountDrops: String(row.registrationAmountDrops),
    activationLedgerIndex: row.activationLedgerIndex,
    activationLedgerHash: row.activationLedgerHash,
  }
}

function invalidIndexerEvidence(
  message = 'The indexed evidence is incomplete or inconsistent.',
): never {
  throw new IndexerUnavailableError('INDEXER_EVIDENCE_INVALID', message)
}

function publicSchemaSummary(row: NonNullable<Awaited<ReturnType<ApiRepository['getSchema']>>>) {
  return {
    schemaUid: row.schemaUid,
    publisher: row.publisher,
    name: row.name,
    description: row.description,
    parentUid: row.parentUid,
    supersedesUid: row.supersedesUid,
    registrationTransactionHash: row.registrationTransactionHash,
    ledgerIndex: row.ledgerIndex,
    transactionIndex: row.transactionIndex,
  }
}

function publicCredentialGeneration(
  generation: NonNullable<Awaited<ReturnType<ApiRepository['getCredential']>>>,
  expected: CredentialGenerationEvidenceExpectation,
) {
  assertCredentialGenerationEvidence(generation, expected)
  return {
    generationId: generation.generationId,
    ledgerObjectId: generation.ledgerObjectId,
    issuer: generation.issuer,
    subject: generation.subject,
    schemaUid: generation.schemaUid,
    uriHex: generation.uriHex,
    expiration: generation.expiration,
    accepted: generation.accepted,
    createdLedgerIndex: generation.createdLedgerIndex,
    createdTransactionIndex: generation.createdTransactionIndex,
    lastLedgerIndex: generation.lastLedgerIndex,
    deletedLedgerIndex: generation.deletedLedgerIndex,
    deletionCause: generation.deletionCause,
  }
}

function publicDiscoveryStats(stats: Awaited<ReturnType<ApiRepository['getDiscoveryStats']>>): {
  schemas: { total: number; publishers: number }
  credentialGenerations: {
    total: number
    pending: number
    active: number
    expired: number
    deleted: number
  }
  projectionLedgerIndexes: number[]
} {
  const schemaCounts = [stats.schemas.total, stats.schemas.publishers]
  const credentialCounts = [
    stats.credentialGenerations.total,
    stats.credentialGenerations.pending,
    stats.credentialGenerations.active,
    stats.credentialGenerations.expired,
    stats.credentialGenerations.deleted,
    stats.credentialGenerations.invalidEvidence,
  ]
  const validCounts = [...schemaCounts, ...credentialCounts].every(
    (value) => Number.isSafeInteger(value) && value >= 0,
  )
  const schemaLedgerShape =
    stats.schemas.total === 0
      ? stats.schemas.minimumLedgerIndex === null && stats.schemas.maximumLedgerIndex === null
      : Number.isSafeInteger(stats.schemas.minimumLedgerIndex) &&
        Number.isSafeInteger(stats.schemas.maximumLedgerIndex) &&
        stats.schemas.minimumLedgerIndex! <= stats.schemas.maximumLedgerIndex!
  const credentialLedgerShape =
    stats.credentialGenerations.total === 0
      ? stats.credentialGenerations.minimumCreatedLedgerIndex === null &&
        stats.credentialGenerations.maximumLastLedgerIndex === null
      : Number.isSafeInteger(stats.credentialGenerations.minimumCreatedLedgerIndex) &&
        Number.isSafeInteger(stats.credentialGenerations.maximumLastLedgerIndex) &&
        stats.credentialGenerations.minimumCreatedLedgerIndex! <=
          stats.credentialGenerations.maximumLastLedgerIndex!
  if (
    !validCounts ||
    stats.schemas.publishers > stats.schemas.total ||
    stats.credentialGenerations.invalidEvidence !== 0 ||
    stats.credentialGenerations.pending +
      stats.credentialGenerations.active +
      stats.credentialGenerations.expired +
      stats.credentialGenerations.deleted !==
      stats.credentialGenerations.total ||
    !schemaLedgerShape ||
    !credentialLedgerShape
  ) {
    return invalidIndexerEvidence(
      'The indexed discovery aggregates are incomplete or inconsistent.',
    )
  }
  return {
    schemas: {
      total: stats.schemas.total,
      publishers: stats.schemas.publishers,
    },
    credentialGenerations: {
      total: stats.credentialGenerations.total,
      pending: stats.credentialGenerations.pending,
      active: stats.credentialGenerations.active,
      expired: stats.credentialGenerations.expired,
      deleted: stats.credentialGenerations.deleted,
    },
    projectionLedgerIndexes: [
      stats.schemas.minimumLedgerIndex,
      stats.schemas.maximumLedgerIndex,
      stats.credentialGenerations.minimumCreatedLedgerIndex,
      stats.credentialGenerations.maximumLastLedgerIndex,
    ].filter((value): value is number => value !== null),
  }
}

function publicCredentialEvent(
  row: Awaited<ReturnType<ApiRepository['getCredentialEvents']>>[number],
  expected: {
    readonly transactionHash: string
    readonly issuer: string
    readonly subject: string
    readonly schemaUid: string
    readonly activationLedgerIndex: number
    readonly generationId?: string
    readonly ledgerIndex?: number
    readonly ledgerHash?: string
    readonly transactionIndex?: number
  },
) {
  const validEventShape =
    row.transactionHash === expected.transactionHash &&
    row.issuer === expected.issuer &&
    row.subject === expected.subject &&
    row.schemaUid === expected.schemaUid &&
    (expected.generationId === undefined || row.generationId === expected.generationId) &&
    (expected.ledgerIndex === undefined || row.ledgerIndex === expected.ledgerIndex) &&
    (expected.ledgerHash === undefined || row.ledgerHash === expected.ledgerHash) &&
    (expected.transactionIndex === undefined ||
      row.transactionIndex === expected.transactionIndex) &&
    LOWERCASE_HASH.test(row.transactionHash) &&
    typeof row.generationId === 'string' &&
    LOWERCASE_HASH.test(row.generationId) &&
    LOWERCASE_HASH.test(row.ledgerObjectId) &&
    LOWERCASE_HASH.test(row.ledgerHash) &&
    LOWERCASE_HASH.test(row.schemaUid) &&
    isClassicAddress(row.issuer) &&
    isClassicAddress(row.subject) &&
    Number.isSafeInteger(row.nodeIndex) &&
    row.nodeIndex >= 0 &&
    row.nodeIndex <= MAX_NODE_INDEX &&
    Number.isSafeInteger(row.ledgerIndex) &&
    row.ledgerIndex >= expected.activationLedgerIndex &&
    row.ledgerIndex <= MAX_UINT32 &&
    Number.isSafeInteger(row.transactionIndex) &&
    row.transactionIndex >= 0 &&
    row.transactionIndex <= MAX_NODE_INDEX &&
    (row.uriHex === null || HEX_BYTES.test(row.uriHex)) &&
    (row.expiration === null ||
      (Number.isSafeInteger(row.expiration) &&
        row.expiration >= 0 &&
        row.expiration <= MAX_UINT32)) &&
    (row.eventType === 'created' || row.eventType === 'accepted' || row.eventType === 'deleted') &&
    (row.eventType === 'deleted'
      ? typeof row.deletionCause === 'string' && CREDENTIAL_DELETION_CAUSES.has(row.deletionCause)
      : row.deletionCause === null) &&
    (row.eventType !== 'created' ||
      (row.generationId === row.transactionHash &&
        row.accepted === (row.issuer === row.subject))) &&
    (row.eventType !== 'accepted' || row.accepted === true)
  if (!validEventShape) {
    throw new IndexerUnavailableError(
      'INDEXER_EVIDENCE_INVALID',
      'The indexed credential event evidence is incomplete or inconsistent.',
    )
  }
  return {
    transactionHash: row.transactionHash,
    nodeIndex: row.nodeIndex,
    generationId: row.generationId,
    ledgerIndex: row.ledgerIndex,
    ledgerHash: row.ledgerHash,
    transactionIndex: row.transactionIndex,
    eventType: row.eventType,
    issuer: row.issuer,
    subject: row.subject,
    schemaUid: row.schemaUid,
    accepted: row.accepted,
    deletionCause: row.deletionCause,
  }
}

function invalidSchemaRegistrationEvidence(): never {
  throw new IndexerUnavailableError(
    'INDEXER_EVIDENCE_INVALID',
    'The indexed schema registration evidence is incomplete or inconsistent.',
  )
}

function publicSchemaRegistration(
  row: NonNullable<Awaited<ReturnType<ApiRepository['getSchemaRegistrationByTransaction']>>>,
  network: { readonly networkId: number; readonly activationLedgerIndex: number },
  expectedTransactionHash: string,
) {
  if (
    row.transactionHash !== expectedTransactionHash ||
    !isClassicAddress(row.publisher) ||
    !Number.isSafeInteger(row.ledgerIndex) ||
    row.ledgerIndex < network.activationLedgerIndex ||
    row.ledgerIndex > 4_294_967_295 ||
    !LOWERCASE_HASH.test(row.ledgerHash) ||
    !Number.isSafeInteger(row.transactionIndex) ||
    row.transactionIndex < 0
  ) {
    return invalidSchemaRegistrationEvidence()
  }
  const common = {
    status: row.status,
    publisher: row.publisher,
    ledgerIndex: row.ledgerIndex,
    ledgerHash: row.ledgerHash,
    transactionIndex: row.transactionIndex,
  }

  if (row.status === 'accepted') {
    if (
      row.schemaUid === null ||
      !LOWERCASE_HASH.test(row.schemaUid) ||
      row.reasonCode !== null ||
      row.memoJson === null
    ) {
      return invalidSchemaRegistrationEvidence()
    }
    try {
      const canonicalMemoJson = canonicalize(row.memoJson as JsonValue)
      const schema = validateSchema(row.memoJson)
      const computedSchemaUid = computeSchemaUid({
        schema,
        networkId: network.networkId,
        ledgerHash: row.ledgerHash,
        ledgerIndex: row.ledgerIndex,
        transactionIndex: row.transactionIndex,
        publisher: row.publisher,
      })
      if (computedSchemaUid !== row.schemaUid) return invalidSchemaRegistrationEvidence()
      return {
        ...common,
        status: 'accepted' as const,
        schemaUid: row.schemaUid,
        schemaDigestHex: sha256Hex(encodeUtf8(canonicalMemoJson)),
        reasonCode: null,
      }
    } catch {
      return invalidSchemaRegistrationEvidence()
    }
  }

  if (row.status === 'rejected') {
    if (row.schemaUid !== null || row.reasonCode === null || !REASON_CODE.test(row.reasonCode)) {
      return invalidSchemaRegistrationEvidence()
    }
    return {
      ...common,
      status: 'rejected' as const,
      schemaUid: null,
      schemaDigestHex: null,
      reasonCode: row.reasonCode,
    }
  }

  return invalidSchemaRegistrationEvidence()
}

function publicTransactionProjection(
  projection: Awaited<ReturnType<ApiRepository['getTransactionProjectionSummary']>>,
  network: { readonly networkId: number; readonly activationLedgerIndex: number },
  expectedTransactionHash: string,
) {
  if (
    !Number.isSafeInteger(projection.credentialEventCount) ||
    projection.credentialEventCount < 0 ||
    (projection.credentialEventCount === 0) !== (projection.firstCredentialEvent === undefined)
  ) {
    return invalidIndexerEvidence('The indexed transaction summary is incomplete or inconsistent.')
  }
  const registration =
    projection.registration === undefined
      ? null
      : publicSchemaRegistration(projection.registration, network, expectedTransactionHash)
  const firstCredentialEvent =
    projection.firstCredentialEvent === undefined
      ? null
      : publicCredentialEvent(projection.firstCredentialEvent, {
          transactionHash: expectedTransactionHash,
          issuer: projection.firstCredentialEvent.issuer,
          subject: projection.firstCredentialEvent.subject,
          schemaUid: projection.firstCredentialEvent.schemaUid,
          activationLedgerIndex: network.activationLedgerIndex,
        })
  if (registration === null && firstCredentialEvent === null) return null

  const coordinate = registration ?? firstCredentialEvent!
  if (
    registration !== null &&
    firstCredentialEvent !== null &&
    (registration.ledgerIndex !== firstCredentialEvent.ledgerIndex ||
      registration.ledgerHash !== firstCredentialEvent.ledgerHash ||
      registration.transactionIndex !== firstCredentialEvent.transactionIndex)
  ) {
    return invalidIndexerEvidence('The indexed transaction coordinates are inconsistent.')
  }
  return {
    transactionHash: expectedTransactionHash,
    ledgerIndex: coordinate.ledgerIndex,
    ledgerHash: coordinate.ledgerHash,
    transactionIndex: coordinate.transactionIndex,
    registration,
    registrationStatus: registration?.status ?? null,
    credentialEventCount: projection.credentialEventCount,
  }
}

function publicCredentialTimeline(
  rows: readonly Awaited<ReturnType<ApiRepository['getCredentialEventsByGeneration']>>[number][],
  generation: NonNullable<Awaited<ReturnType<ApiRepository['getCredentialGenerationById']>>>,
  activationLedgerIndex: number,
) {
  if (rows.length === 0 || rows.length > CREDENTIAL_GENERATION_TIMELINE_LIMIT) {
    return invalidIndexerEvidence('The indexed credential timeline is incomplete or inconsistent.')
  }
  const items = rows.map((row) =>
    publicCredentialEvent(row, {
      transactionHash: row.transactionHash,
      issuer: generation.issuer,
      subject: generation.subject,
      schemaUid: generation.schemaUid,
      generationId: generation.generationId,
      activationLedgerIndex,
    }),
  )
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!
    const previous = rows[index - 1]
    if (
      row.ledgerObjectId !== generation.ledgerObjectId ||
      row.uriHex !== generation.uriHex ||
      row.expiration !== generation.expiration ||
      (previous !== undefined &&
        (row.ledgerIndex < previous.ledgerIndex ||
          (row.ledgerIndex === previous.ledgerIndex &&
            row.transactionIndex < previous.transactionIndex) ||
          (row.ledgerIndex === previous.ledgerIndex &&
            row.transactionIndex === previous.transactionIndex &&
            row.nodeIndex <= previous.nodeIndex)))
    ) {
      return invalidIndexerEvidence(
        'The indexed credential timeline is incomplete or inconsistent.',
      )
    }
  }
  const created = rows.filter((row) => row.eventType === 'created')
  const accepted = rows.filter((row) => row.eventType === 'accepted')
  const deleted = rows.filter((row) => row.eventType === 'deleted')
  const first = rows[0]!
  const last = rows.at(-1)!
  if (
    created.length !== 1 ||
    first.eventType !== 'created' ||
    first.transactionHash !== generation.generationId ||
    first.ledgerIndex !== generation.createdLedgerIndex ||
    first.transactionIndex !== generation.createdTransactionIndex ||
    accepted.length > 1 ||
    deleted.length > 1 ||
    deleted.some((row) => row.accepted !== generation.accepted) ||
    last.ledgerIndex !== generation.lastLedgerIndex ||
    generation.accepted !== (first.accepted || accepted.length === 1) ||
    (generation.deletedLedgerIndex === null
      ? deleted.length !== 0
      : deleted.length !== 1 ||
        last.eventType !== 'deleted' ||
        last.ledgerIndex !== generation.deletedLedgerIndex ||
        last.deletionCause !== generation.deletionCause)
  ) {
    return invalidIndexerEvidence('The indexed credential timeline is incomplete or inconsistent.')
  }
  return items
}

export interface CreateApiOptions {
  repository: ApiRepository
  resolver: PayloadResolver
  trustPolicy: TrustPolicy
  logger?: boolean
  allowedOrigins?: string[]
  globalRateLimit?: number
  internalSsrToken?: string
  trustedProxyCidrs?: string[]
  verifyRateLimit?: number
  pinningService?: DemoPinningService
  operationalMetrics?: {
    token: string
    repository: OperationalMetricsRepository
    observePayloadResolver?: boolean
  }
  readinessMaxLedgerAgeSeconds?: number
  now?: () => Date
}

function singleHeader(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name]
  return typeof value === 'string' ? value : undefined
}

function tokensMatch(expected: string, presented: string | undefined): boolean {
  const expectedDigest = createHash('sha256').update(expected, 'utf8').digest()
  const presentedDigest = createHash('sha256')
    .update(presented ?? '', 'utf8')
    .digest()
  return presented !== undefined && timingSafeEqual(expectedDigest, presentedDigest)
}

function rateLimitKey(request: FastifyRequest, internalSsrToken: string | undefined): string {
  if (internalSsrToken !== undefined) {
    const presentedToken = singleHeader(request, INTERNAL_SSR_TOKEN_HEADER)
    const clientKey = singleHeader(request, INTERNAL_SSR_CLIENT_KEY_HEADER)
    if (
      tokensMatch(internalSsrToken, presentedToken) &&
      clientKey !== undefined &&
      INTERNAL_SSR_CLIENT_KEY.test(clientKey)
    ) {
      return `ssr:${clientKey}`
    }
  }
  return `ip:${request.ip}`
}

const DEFAULT_BODY_LIMIT_BYTES = 1024 * 1024
// The protocol limit applies to the canonical payload itself. The verification
// envelope also carries the network and credential tuple, so it needs a small,
// bounded transport allowance above that payload limit.
const VERIFY_BODY_LIMIT_BYTES = DEFAULT_BODY_LIMIT_BYTES + 64 * 1024

export async function createApi(options: CreateApiOptions): Promise<FastifyInstance> {
  if (
    options.internalSsrToken !== undefined &&
    !INTERNAL_SSR_TOKEN.test(options.internalSsrToken)
  ) {
    throw new Error('internalSsrToken must be 32 to 256 URL-safe random characters')
  }
  if (
    options.operationalMetrics !== undefined &&
    !INTERNAL_METRICS_TOKEN.test(options.operationalMetrics.token)
  ) {
    throw new Error('operationalMetrics.token must be 32 to 256 URL-safe random characters')
  }
  if (
    options.operationalMetrics !== undefined &&
    options.internalSsrToken === options.operationalMetrics.token
  ) {
    throw new Error('operationalMetrics.token must be distinct from internalSsrToken')
  }
  const metricsCollector =
    options.operationalMetrics === undefined
      ? undefined
      : new OperationalMetricsCollector(
          options.now,
          options.readinessMaxLedgerAgeSeconds ?? DEFAULT_LEDGER_MAX_AGE_SECONDS,
        )
  const payloadResolver =
    metricsCollector !== undefined && options.operationalMetrics?.observePayloadResolver === true
      ? metricsCollector.observePayloadResolver(options.resolver)
      : options.resolver
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: DEFAULT_BODY_LIMIT_BYTES,
    trustProxy:
      options.trustedProxyCidrs === undefined || options.trustedProxyCidrs.length === 0
        ? false
        : options.trustedProxyCidrs,
    ajv: {
      customOptions: {
        removeAdditional: false,
        coerceTypes: false,
        allErrors: false,
      },
    },
  })
  app.addSchema(xcsFieldDescriptorSchema)

  await app.register(cors, {
    origin: options.allowedOrigins ?? ['http://localhost:3000'],
    methods: ['GET', 'POST'],
    credentials: false,
  })
  await app.register(rateLimit, {
    global: true,
    max: options.globalRateLimit ?? 100,
    timeWindow: '1 minute',
    keyGenerator: (request) => rateLimitKey(request, options.internalSsrToken),
  })
  if (metricsCollector !== undefined) {
    app.addHook('onResponse', async (request, reply) => {
      if (reply.statusCode === 429) {
        metricsCollector.recordRateLimited(rateLimitMetric(request.routeOptions.url))
      }
    })
  }

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'XCS reference read API',
        version: '0.1.0-alpha.1',
      },
    },
  })
  await app.register(swaggerUi, { routePrefix: '/documentation' })

  const maxLedgerAgeSeconds = options.readinessMaxLedgerAgeSeconds ?? DEFAULT_LEDGER_MAX_AGE_SECONDS

  async function authoritativeTime(repository: ApiRepository): Promise<Date> {
    return options.now?.() ?? repository.getDatabaseTime()
  }

  async function preflightAuthoritativeRead(
    repository: ApiRepository,
    profileId: string,
    now: Date,
  ) {
    const status = await repository.getIndexerStatus(profileId)
    assertIndexerReady(status, now)
    return status
  }

  async function requireAuthoritativeCheckpoint(
    repository: ApiRepository,
    profileId: string,
    status: NonNullable<Awaited<ReturnType<ApiRepository['getIndexerStatus']>>>,
    now: Date,
    projectionLedgerIndexes: readonly number[] = [],
    minimumLedgerIndex = 0,
  ) {
    const checkpoint = await repository.getLatestCheckpoint(profileId)
    const evidence = {
      expectedProfileId: profileId,
      status,
      checkpoint,
      now,
      maxLedgerAgeSeconds,
      minimumLedgerIndex,
      projectionLedgerIndexes,
    }
    assertAuthoritativeLedgerEvidence(evidence)
    return evidence.checkpoint
  }

  function readinessReason(error: IndexerUnavailableError): string {
    switch (error.code) {
      case 'INDEXER_STATUS_UNAVAILABLE':
        return 'indexer_status_unavailable'
      case 'INDEXER_HALTED':
        return 'indexer_halted'
      case 'INDEXER_NOT_READY':
        return 'indexer_not_ready'
      case 'INDEXER_LEASE_EXPIRED':
        return 'indexer_lease_expired'
      case 'INDEXER_NOT_INITIALIZED':
        return 'indexer_not_initialized'
      case 'INDEXER_STALE':
        return 'indexer_stale'
      case 'INDEXER_EVIDENCE_INVALID':
        return 'indexer_evidence_invalid'
    }
  }

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof PinningError) {
      reply.code(error.statusCode).send({ error: error.code, message: error.code })
      return
    }
    if (error instanceof SchemaProjectionInvalidError) {
      reply.code(error.statusCode).send({ error: error.code, message: error.message })
      return
    }
    if (error instanceof IndexerUnavailableError) {
      reply.code(error.statusCode).send({ error: error.code, message: error.message })
      return
    }
    if (error instanceof VerificationNetworkNotFoundError) {
      reply.code(error.statusCode).send({ error: error.code, message: error.message })
      return
    }
    const candidate =
      typeof error === 'object' && error !== null
        ? (error as { validation?: unknown; statusCode?: number; message?: string })
        : {}
    const validation = candidate.validation !== undefined
    const statusCode = validation ? 400 : (candidate.statusCode ?? 500)
    reply.code(statusCode).send({
      error: validation
        ? 'VALIDATION_ERROR'
        : statusCode >= 500
          ? 'INTERNAL_ERROR'
          : 'REQUEST_ERROR',
      message:
        statusCode >= 500 ? 'Internal server error' : (candidate.message ?? 'Invalid request'),
    })
  })

  app.get('/health/live', { config: { rateLimit: false } }, async (_request, reply) => {
    reply.header('cache-control', 'no-store')
    return { status: 'ok' }
  })
  app.get('/health', { config: { rateLimit: false } }, async (_request, reply) => {
    reply.header('cache-control', 'no-store')
    return { status: 'ok' }
  })
  app.get('/health/ready', { config: { rateLimit: false } }, async (_request, reply) => {
    reply.header('cache-control', 'no-store')
    try {
      await options.repository.ping()
      return await options.repository.withConsistentSnapshot(async (repository) => {
        const networks = await repository.listNetworks()
        if (networks.length === 0) {
          return reply.code(503).send({ status: 'not_ready', reason: 'indexer_not_initialized' })
        }
        const now = await authoritativeTime(repository)
        for (const network of networks) {
          try {
            const status = await preflightAuthoritativeRead(repository, network.profileId, now)
            await requireAuthoritativeCheckpoint(
              repository,
              network.profileId,
              status,
              now,
              [],
              network.activationLedgerIndex,
            )
          } catch (error) {
            if (error instanceof IndexerUnavailableError) {
              return reply.code(503).send({ status: 'not_ready', reason: readinessReason(error) })
            }
            throw error
          }
        }
        return { status: 'ready' }
      })
    } catch {
      return reply.code(503).send({ status: 'not_ready', reason: 'database_unavailable' })
    }
  })

  if (options.operationalMetrics !== undefined && metricsCollector !== undefined) {
    app.get(
      '/internal/metrics',
      {
        config: { rateLimit: false },
        schema: { hide: true },
      },
      async (request, reply) => {
        reply.header('cache-control', 'no-store')
        const authorization = singleHeader(request, INTERNAL_METRICS_TOKEN_HEADER)
        const presentedToken = authorization?.startsWith('Bearer ')
          ? authorization.slice('Bearer '.length)
          : undefined
        if (!tokensMatch(options.operationalMetrics!.token, presentedToken)) {
          return reply
            .code(401)
            .header('www-authenticate', 'Bearer realm="xcs-metrics"')
            .send({ error: 'UNAUTHORIZED', message: 'Authentication required' })
        }
        return metricsCollector.collect(options.operationalMetrics!.repository)
      },
    )
    app.get(
      '/internal/metrics/prometheus',
      {
        config: { rateLimit: false },
        schema: { hide: true },
      },
      async (request, reply) => {
        reply.header('cache-control', 'no-store')
        const authorization = singleHeader(request, INTERNAL_METRICS_TOKEN_HEADER)
        const presentedToken = authorization?.startsWith('Bearer ')
          ? authorization.slice('Bearer '.length)
          : undefined
        if (!tokensMatch(options.operationalMetrics!.token, presentedToken)) {
          return reply
            .code(401)
            .header('www-authenticate', 'Bearer realm="xcs-metrics"')
            .send({ error: 'UNAUTHORIZED', message: 'Authentication required' })
        }
        const metrics = await metricsCollector.collect(options.operationalMetrics!.repository)
        return reply
          .type('application/openmetrics-text; version=1.0.0; charset=utf-8')
          .send(renderPrometheusMetrics(metrics))
      },
    )
  }

  app.get('/v1/networks', async () => ({
    items: (await options.repository.listNetworks()).map(publicNetwork),
  }))

  app.get<{ Params: { network: string } }>(
    '/v1/networks/:network/status',
    {
      schema: {
        params: networkParamsSchema,
        response: {
          200: publicIndexerStatusSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const network = await options.repository.getNetwork(request.params.network)
      if (network === undefined) {
        return reply.code(404).send({ error: 'NETWORK_NOT_FOUND', message: 'Network not found' })
      }
      const status = await options.repository.getIndexerStatus(request.params.network)
      if (status === undefined) {
        return reply
          .code(404)
          .send({ error: 'INDEXER_STATUS_NOT_FOUND', message: 'Indexer status not found' })
      }
      return publicIndexerStatus(status)
    },
  )

  app.get<{ Params: { network: string } }>(
    '/v1/networks/:network/readiness',
    {
      schema: {
        params: networkParamsSchema,
        response: {
          200: networkReadinessResponseSchema,
          400: errorResponseSchema,
          404: errorResponseSchema,
          429: rateLimitResponseSchema,
          503: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
      onSend: async (_request, reply, payload) => {
        reply.header('cache-control', 'private, no-store')
        return payload
      },
    },
    async (request, reply) =>
      options.repository.withConsistentSnapshot(async (repository) => {
        const network = await repository.getNetwork(request.params.network)
        if (network === undefined) {
          return reply.code(404).send({ error: 'NETWORK_NOT_FOUND', message: 'Network not found' })
        }
        const now = await authoritativeTime(repository)
        const status = await preflightAuthoritativeRead(repository, request.params.network, now)
        const checkpoint = await requireAuthoritativeCheckpoint(
          repository,
          request.params.network,
          status,
          now,
          [],
          network.activationLedgerIndex,
        )
        return {
          profileId: request.params.network,
          status: 'ready' as const,
          checkpoint: {
            ledgerIndex: checkpoint.ledgerIndex,
            ledgerHash: checkpoint.ledgerHash,
            closeTime: checkpoint.closeTime,
            transactionRoot: checkpoint.transactionRoot,
          },
        }
      }),
  )

  app.get<{ Params: { network: string } }>(
    '/v1/networks/:network/stats',
    {
      schema: {
        params: networkParamsSchema,
        response: {
          200: discoveryStatsResponseSchema,
          400: errorResponseSchema,
          404: errorResponseSchema,
          503: errorResponseSchema,
        },
      },
    },
    async (request, reply) =>
      options.repository.withConsistentSnapshot(async (repository) => {
        const network = await repository.getNetwork(request.params.network)
        if (network === undefined) {
          return reply.code(404).send({ error: 'NETWORK_NOT_FOUND', message: 'Network not found' })
        }
        const now = await authoritativeTime(repository)
        const status = await preflightAuthoritativeRead(repository, request.params.network, now)
        const checkpoint = await requireAuthoritativeCheckpoint(
          repository,
          request.params.network,
          status,
          now,
          [],
          network.activationLedgerIndex,
        )
        const stats = publicDiscoveryStats(
          await repository.getDiscoveryStats({
            profileId: request.params.network,
            checkpointCloseTime: checkpoint.closeTime,
          }),
        )
        assertAuthoritativeLedgerEvidence({
          expectedProfileId: request.params.network,
          status,
          checkpoint,
          now,
          maxLedgerAgeSeconds,
          minimumLedgerIndex: network.activationLedgerIndex,
          projectionLedgerIndexes: stats.projectionLedgerIndexes,
        })
        return {
          network: request.params.network,
          schemas: stats.schemas,
          credentialGenerations: stats.credentialGenerations,
          checkpoint: {
            ledgerIndex: checkpoint.ledgerIndex,
            ledgerHash: checkpoint.ledgerHash,
            closeTime: checkpoint.closeTime,
            transactionRoot: checkpoint.transactionRoot,
          },
        }
      }),
  )

  app.get<{
    Params: { network: string }
    Querystring: { q: string; limit?: string }
  }>(
    '/v1/networks/:network/search',
    {
      schema: {
        params: networkParamsSchema,
        querystring: {
          type: 'object',
          additionalProperties: false,
          required: ['q'],
          properties: {
            q: { type: 'string', minLength: 2, maxLength: 128 },
            limit: { type: 'string', pattern: '^(?:[1-9]|[1-4][0-9]|50)$' },
          },
        },
        response: {
          200: discoverySearchResponseSchema,
          400: errorResponseSchema,
          404: errorResponseSchema,
          503: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const query = request.query.q
      if (
        query !== query.trim() ||
        SEARCH_QUERY_CONTROL.test(query) ||
        !SEARCH_QUERY_CONTENT.test(query)
      ) {
        return reply.code(400).send({
          error: 'SEARCH_QUERY_INVALID',
          message: 'q must be trimmed text containing at least one letter or number',
        })
      }
      const limit = Number(request.query.limit ?? DISCOVERY_SEARCH_DEFAULT_LIMIT)
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > DISCOVERY_SEARCH_MAX_LIMIT) {
        return reply.code(400).send({ error: 'LIMIT_INVALID', message: 'Invalid limit' })
      }
      const hashCandidate = query.toLowerCase()
      const normalizedHash = LOWERCASE_HASH.test(hashCandidate) ? hashCandidate : undefined
      const publisher = normalizedHash === undefined && isClassicAddress(query) ? query : undefined

      return options.repository.withConsistentSnapshot(async (repository) => {
        const network = await repository.getNetwork(request.params.network)
        if (network === undefined) {
          return reply.code(404).send({ error: 'NETWORK_NOT_FOUND', message: 'Network not found' })
        }
        const now = await authoritativeTime(repository)
        const status = await preflightAuthoritativeRead(repository, request.params.network, now)

        if (normalizedHash !== undefined) {
          const [schema, generation, transactionProjection] = await Promise.all([
            repository.getSchema(request.params.network, normalizedHash),
            repository.getCredentialGenerationById({
              profileId: request.params.network,
              generationId: normalizedHash,
            }),
            repository.getTransactionProjectionSummary({
              profileId: request.params.network,
              transactionHash: normalizedHash,
            }),
          ])
          const generationTimeline =
            generation === undefined
              ? []
              : await repository.getCredentialEventsByGeneration({
                  profileId: request.params.network,
                  generationId: normalizedHash,
                  limit: CREDENTIAL_GENERATION_TIMELINE_LIMIT + 1,
                })
          const schemaEvidence =
            schema === undefined
              ? []
              : await repository.getSchemaProjectionEvidence({
                  profileId: request.params.network,
                  schemaUids: schemaProjectionEvidenceUids([schema], request.params.network),
                })
          const checkpoint = await requireAuthoritativeCheckpoint(
            repository,
            request.params.network,
            status,
            now,
            [
              ...schemaEvidence.map((item) => item.schema.ledgerIndex),
              ...(generation === undefined
                ? []
                : [generation.createdLedgerIndex, generation.lastLedgerIndex]),
              ...generationTimeline.map((row) => row.ledgerIndex),
              ...(transactionProjection.registration === undefined
                ? []
                : [transactionProjection.registration.ledgerIndex]),
              ...(transactionProjection.firstCredentialEvent === undefined
                ? []
                : [transactionProjection.firstCredentialEvent.ledgerIndex]),
            ],
            network.activationLedgerIndex,
          )
          const items: Array<Record<string, unknown>> = []
          if (schema !== undefined) {
            authoritativeResolvedSchema(schema, schemaEvidence, {
              profileId: request.params.network,
              schemaUid: schema.schemaUid,
              networkId: network.networkId,
              activationLedgerIndex: network.activationLedgerIndex,
            })
            items.push({ type: 'schema', ...publicSchemaSummary(schema) })
          }
          if (generation !== undefined) {
            const publicGeneration = publicCredentialGeneration(generation, {
              profileId: request.params.network,
              activationLedgerIndex: network.activationLedgerIndex,
              checkpointLedgerIndex: checkpoint.ledgerIndex,
              generationId: normalizedHash,
            })
            publicCredentialTimeline(generationTimeline, generation, network.activationLedgerIndex)
            items.push({
              type: 'credential_generation',
              generationId: publicGeneration.generationId,
              issuer: publicGeneration.issuer,
              subject: publicGeneration.subject,
              schemaUid: publicGeneration.schemaUid,
              state: credentialGenerationState(generation, checkpoint.closeTime),
              createdLedgerIndex: publicGeneration.createdLedgerIndex,
              lastLedgerIndex: publicGeneration.lastLedgerIndex,
            })
          }
          const transaction = publicTransactionProjection(
            transactionProjection,
            network,
            normalizedHash,
          )
          if (transaction !== null) {
            items.push({
              type: 'transaction',
              transactionHash: transaction.transactionHash,
              ledgerIndex: transaction.ledgerIndex,
              ledgerHash: transaction.ledgerHash,
              transactionIndex: transaction.transactionIndex,
              registrationStatus: transaction.registrationStatus,
              credentialEventCount: transaction.credentialEventCount,
            })
          }
          return { items: items.slice(0, limit), hasMore: items.length > limit }
        }

        const rows = await repository.searchSchemas({
          profileId: request.params.network,
          ...(publisher === undefined ? { query } : { publisher }),
          limit,
        })
        if (rows.length > limit + 1) {
          return invalidIndexerEvidence('The indexed schema search page exceeds its query bound.')
        }
        const schemaEvidence = await repository.getSchemaProjectionEvidence({
          profileId: request.params.network,
          schemaUids: schemaProjectionEvidenceUids(rows, request.params.network),
        })
        await requireAuthoritativeCheckpoint(
          repository,
          request.params.network,
          status,
          now,
          schemaEvidence.map((item) => item.schema.ledgerIndex),
          network.activationLedgerIndex,
        )
        for (const row of rows) {
          authoritativeResolvedSchema(row, schemaEvidence, {
            profileId: request.params.network,
            schemaUid: row.schemaUid,
            networkId: network.networkId,
            activationLedgerIndex: network.activationLedgerIndex,
          })
        }
        return {
          items: rows.slice(0, limit).map((row) => ({
            type: 'schema' as const,
            ...publicSchemaSummary(row),
          })),
          hasMore: rows.length > limit,
        }
      })
    },
  )

  app.get<{
    Params: { network: string }
    Querystring: { cursor?: string; limit?: string }
  }>(
    '/v1/networks/:network/activity',
    {
      schema: {
        params: networkParamsSchema,
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            cursor: { type: 'string', minLength: 1, maxLength: 512 },
            limit: { type: 'string', pattern: '^(?:[1-9]|[1-9][0-9]|100)$' },
          },
        },
        response: {
          200: discoveryActivityResponseSchema,
          400: errorResponseSchema,
          404: errorResponseSchema,
          503: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      let cursor
      try {
        cursor =
          request.query.cursor === undefined
            ? undefined
            : decodeSchemaRegistrationCursor(request.query.cursor)
      } catch {
        return reply.code(400).send({ error: 'CURSOR_INVALID', message: 'Invalid cursor' })
      }
      const limit = Number(request.query.limit ?? DISCOVERY_PAGE_DEFAULT_LIMIT)
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > DISCOVERY_PAGE_MAX_LIMIT) {
        return reply.code(400).send({ error: 'LIMIT_INVALID', message: 'Invalid limit' })
      }
      return options.repository.withConsistentSnapshot(async (repository) => {
        const network = await repository.getNetwork(request.params.network)
        if (network === undefined) {
          return reply.code(404).send({ error: 'NETWORK_NOT_FOUND', message: 'Network not found' })
        }
        const now = await authoritativeTime(repository)
        const status = await preflightAuthoritativeRead(repository, request.params.network, now)
        const rows = await repository.listSchemaRegistrations({
          profileId: request.params.network,
          ...(cursor === undefined ? {} : { cursor }),
          limit,
        })
        if (rows.length > limit + 1) {
          return invalidIndexerEvidence('The indexed schema activity page exceeds its query bound.')
        }
        await requireAuthoritativeCheckpoint(
          repository,
          request.params.network,
          status,
          now,
          rows.map((row) => row.ledgerIndex),
          network.activationLedgerIndex,
        )
        const registrations = rows.map((row) => ({
          transactionHash: row.transactionHash,
          ...publicSchemaRegistration(row, network, row.transactionHash),
        }))
        const hasNext = registrations.length > limit
        const items = hasNext ? registrations.slice(0, limit) : registrations
        const last = items.at(-1)
        return {
          items,
          ...(hasNext && last !== undefined
            ? {
                nextCursor: encodeSchemaRegistrationCursor({
                  ledgerIndex: last.ledgerIndex,
                  transactionIndex: last.transactionIndex,
                  transactionHash: last.transactionHash,
                }),
              }
            : {}),
        }
      })
    },
  )

  app.get<{ Params: { network: string; generationId: string } }>(
    '/v1/networks/:network/credential-generations/:generationId',
    {
      schema: {
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['network', 'generationId'],
          properties: {
            network: { type: 'string', pattern: PROFILE_PATTERN },
            generationId: { type: 'string', pattern: INPUT_HASH_PATTERN },
          },
        },
        response: {
          200: credentialGenerationResponseSchema,
          400: errorResponseSchema,
          404: errorResponseSchema,
          503: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const generationId = request.params.generationId.toLowerCase()
      return options.repository.withConsistentSnapshot(async (repository) => {
        const network = await repository.getNetwork(request.params.network)
        if (network === undefined) {
          return reply.code(404).send({ error: 'NETWORK_NOT_FOUND', message: 'Network not found' })
        }
        const now = await authoritativeTime(repository)
        const status = await preflightAuthoritativeRead(repository, request.params.network, now)
        const generation = await repository.getCredentialGenerationById({
          profileId: request.params.network,
          generationId,
        })
        const timeline =
          generation === undefined
            ? []
            : await repository.getCredentialEventsByGeneration({
                profileId: request.params.network,
                generationId,
                limit: CREDENTIAL_GENERATION_TIMELINE_LIMIT + 1,
              })
        const checkpoint = await requireAuthoritativeCheckpoint(
          repository,
          request.params.network,
          status,
          now,
          [
            ...(generation === undefined
              ? []
              : [generation.createdLedgerIndex, generation.lastLedgerIndex]),
            ...timeline.map((row) => row.ledgerIndex),
          ],
          network.activationLedgerIndex,
        )
        if (generation === undefined) {
          return reply.code(404).send({
            error: 'CREDENTIAL_GENERATION_NOT_FOUND',
            message: 'Credential generation not found',
          })
        }
        const publicGeneration = publicCredentialGeneration(generation, {
          profileId: request.params.network,
          activationLedgerIndex: network.activationLedgerIndex,
          checkpointLedgerIndex: checkpoint.ledgerIndex,
          generationId,
        })
        return {
          generation: publicGeneration,
          state: credentialGenerationState(generation, checkpoint.closeTime),
          timeline: publicCredentialTimeline(timeline, generation, network.activationLedgerIndex),
        }
      })
    },
  )

  app.get<{
    Params: { network: string; transactionHash: string }
    Querystring: { cursor?: string; limit?: string }
  }>(
    '/v1/networks/:network/transactions/:transactionHash',
    {
      schema: {
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['network', 'transactionHash'],
          properties: {
            network: { type: 'string', pattern: PROFILE_PATTERN },
            transactionHash: { type: 'string', pattern: INPUT_HASH_PATTERN },
          },
        },
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            cursor: { type: 'string', pattern: '^(?:0|[1-9][0-9]{0,9})$' },
            limit: { type: 'string', pattern: '^(?:[1-9]|[1-9][0-9]|100)$' },
          },
        },
        response: {
          200: transactionResponseSchema,
          400: errorResponseSchema,
          404: errorResponseSchema,
          503: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const transactionHash = request.params.transactionHash.toLowerCase()
      const afterNodeIndex =
        request.query.cursor === undefined ? undefined : Number(request.query.cursor)
      if (
        afterNodeIndex !== undefined &&
        (!Number.isSafeInteger(afterNodeIndex) ||
          afterNodeIndex < 0 ||
          afterNodeIndex > MAX_NODE_INDEX)
      ) {
        return reply.code(400).send({ error: 'CURSOR_INVALID', message: 'Invalid cursor' })
      }
      const limit = Number(request.query.limit ?? DISCOVERY_PAGE_DEFAULT_LIMIT)
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > DISCOVERY_PAGE_MAX_LIMIT) {
        return reply.code(400).send({ error: 'LIMIT_INVALID', message: 'Invalid limit' })
      }
      return options.repository.withConsistentSnapshot(async (repository) => {
        const network = await repository.getNetwork(request.params.network)
        if (network === undefined) {
          return reply.code(404).send({ error: 'NETWORK_NOT_FOUND', message: 'Network not found' })
        }
        const now = await authoritativeTime(repository)
        const status = await preflightAuthoritativeRead(repository, request.params.network, now)
        const projection = await repository.getTransactionProjectionSummary({
          profileId: request.params.network,
          transactionHash,
        })
        const rows =
          projection.credentialEventCount === 0
            ? []
            : await repository.getCredentialEventsByTransactionPage({
                profileId: request.params.network,
                transactionHash,
                ...(afterNodeIndex === undefined ? {} : { afterNodeIndex }),
                limit,
              })
        if (rows.length > limit + 1) {
          return invalidIndexerEvidence(
            'The indexed transaction event page exceeds its query bound.',
          )
        }
        await requireAuthoritativeCheckpoint(
          repository,
          request.params.network,
          status,
          now,
          [
            ...(projection.registration === undefined ? [] : [projection.registration.ledgerIndex]),
            ...(projection.firstCredentialEvent === undefined
              ? []
              : [projection.firstCredentialEvent.ledgerIndex]),
            ...rows.map((row) => row.ledgerIndex),
          ],
          network.activationLedgerIndex,
        )
        const transaction = publicTransactionProjection(projection, network, transactionHash)
        if (transaction === null) {
          return reply
            .code(404)
            .send({ error: 'TRANSACTION_NOT_FOUND', message: 'Transaction not found' })
        }
        const publicEvents = rows.map((row) =>
          publicCredentialEvent(row, {
            transactionHash,
            issuer: row.issuer,
            subject: row.subject,
            schemaUid: row.schemaUid,
            activationLedgerIndex: network.activationLedgerIndex,
            ledgerIndex: transaction.ledgerIndex,
            ledgerHash: transaction.ledgerHash,
            transactionIndex: transaction.transactionIndex,
          }),
        )
        const hasNext = publicEvents.length > limit
        const items = hasNext ? publicEvents.slice(0, limit) : publicEvents
        const last = items.at(-1)
        return {
          transactionHash,
          ledgerIndex: transaction.ledgerIndex,
          ledgerHash: transaction.ledgerHash,
          transactionIndex: transaction.transactionIndex,
          registration: transaction.registration,
          credentialEvents: {
            items,
            ...(hasNext && last !== undefined ? { nextCursor: String(last.nodeIndex) } : {}),
          },
        }
      })
    },
  )

  app.get<{
    Params: { network: string; uid: string }
  }>(
    '/v1/networks/:network/schemas/:uid/catalog',
    {
      schema: {
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['network', 'uid'],
          properties: {
            network: { type: 'string', pattern: PROFILE_PATTERN },
            uid: { type: 'string', pattern: UID_PATTERN },
          },
        },
        response: {
          200: schemaCatalogResponseSchema,
          400: errorResponseSchema,
          404: errorResponseSchema,
          429: rateLimitResponseSchema,
          503: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
      onSend: async (_request, reply, payload) => {
        reply.header('cache-control', 'no-store')
        return payload
      },
    },
    async (request, reply) =>
      options.repository.withConsistentSnapshot(async (repository) => {
        const network = await repository.getNetwork(request.params.network)
        if (network === undefined) {
          return reply.code(404).send({ error: 'NETWORK_NOT_FOUND', message: 'Network not found' })
        }
        const now = await authoritativeTime(repository)
        const status = await preflightAuthoritativeRead(repository, request.params.network, now)
        const target = await repository.getSchema(request.params.network, request.params.uid)
        const evidence =
          target === undefined
            ? []
            : await repository.getSchemaCatalogEvidence({
                profileId: request.params.network,
                targetUid: request.params.uid,
              })
        const checkpoint = await requireAuthoritativeCheckpoint(
          repository,
          request.params.network,
          status,
          now,
          evidence.map((item) => item.schema.ledgerIndex),
          network.activationLedgerIndex,
        )
        if (target === undefined) {
          return reply.code(404).send({ error: 'SCHEMA_NOT_FOUND', message: 'Schema not found' })
        }
        return authoritativeSchemaCatalogBundle({ network, checkpoint, target, evidence })
      }),
  )

  app.get<{
    Params: { network: string; uid: string }
  }>(
    '/v1/networks/:network/schemas/:uid',
    {
      schema: {
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['network', 'uid'],
          properties: {
            network: { type: 'string', pattern: PROFILE_PATTERN },
            uid: { type: 'string', pattern: UID_PATTERN },
          },
        },
        response: {
          200: publicSchemaRowSchema,
          404: errorResponseSchema,
          503: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      return options.repository.withConsistentSnapshot(async (repository) => {
        const network = await repository.getNetwork(request.params.network)
        if (network === undefined) {
          return reply.code(404).send({ error: 'NETWORK_NOT_FOUND', message: 'Network not found' })
        }
        const now = await authoritativeTime(repository)
        const status = await preflightAuthoritativeRead(repository, request.params.network, now)
        const schema = await repository.getSchema(request.params.network, request.params.uid)
        const schemaEvidence =
          schema === undefined
            ? []
            : await repository.getSchemaProjectionEvidence({
                profileId: request.params.network,
                schemaUids: schemaProjectionEvidenceUids([schema], request.params.network),
              })
        await requireAuthoritativeCheckpoint(
          repository,
          request.params.network,
          status,
          now,
          schemaEvidence.map((item) => item.schema.ledgerIndex),
          network.activationLedgerIndex,
        )
        if (schema === undefined) {
          return reply.code(404).send({ error: 'SCHEMA_NOT_FOUND', message: 'Schema not found' })
        }
        authoritativeResolvedSchema(schema, schemaEvidence, {
          profileId: request.params.network,
          schemaUid: request.params.uid,
          networkId: network.networkId,
          activationLedgerIndex: network.activationLedgerIndex,
        })
        return schema
      })
    },
  )

  const schemaRegistrationParamsSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['network', 'transactionHash'],
    properties: {
      network: { type: 'string', pattern: PROFILE_PATTERN },
      transactionHash: { type: 'string', pattern: INPUT_HASH_PATTERN },
    },
  } as const

  app.get<{ Params: { network: string; transactionHash: string } }>(
    '/v1/networks/:network/schema-registrations/:transactionHash',
    {
      schema: {
        params: schemaRegistrationParamsSchema,
        response: {
          200: exactSchemaRegistrationResponseSchema,
          400: errorResponseSchema,
          404: errorResponseSchema,
          503: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const transactionHash = request.params.transactionHash.toLowerCase()
      return options.repository.withConsistentSnapshot(async (repository) => {
        const network = await repository.getNetwork(request.params.network)
        if (network === undefined) {
          return reply.code(404).send({ error: 'NETWORK_NOT_FOUND', message: 'Network not found' })
        }
        const now = await authoritativeTime(repository)
        const status = await preflightAuthoritativeRead(repository, request.params.network, now)
        const registration = await repository.getSchemaRegistrationByTransaction({
          profileId: request.params.network,
          transactionHash,
        })
        await requireAuthoritativeCheckpoint(
          repository,
          request.params.network,
          status,
          now,
          registration === undefined ? [] : [registration.ledgerIndex],
          network.activationLedgerIndex,
        )
        return {
          transactionHash,
          registration:
            registration === undefined
              ? null
              : publicSchemaRegistration(registration, network, transactionHash),
        }
      })
    },
  )

  app.get<{
    Params: { network: string }
    Querystring: { publisher?: string; cursor?: string; limit?: string }
  }>(
    '/v1/networks/:network/schemas',
    {
      schema: {
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['network'],
          properties: networkParamsSchema.properties,
        },
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            publisher: { type: 'string', pattern: ADDRESS_PATTERN },
            cursor: { type: 'string', minLength: 1, maxLength: 512 },
            limit: { type: 'string', pattern: '^(?:[1-9]|[1-9][0-9]|100)$' },
          },
        },
        response: { 200: schemaListResponseSchema, 503: errorResponseSchema },
      },
    },
    async (request, reply) => {
      if (request.query.publisher !== undefined && !isClassicAddress(request.query.publisher)) {
        return reply
          .code(400)
          .send({ error: 'ADDRESS_INVALID', message: 'publisher must be a valid classic address' })
      }
      let cursor
      try {
        cursor =
          request.query.cursor === undefined ? undefined : decodeSchemaCursor(request.query.cursor)
      } catch {
        return reply.code(400).send({ error: 'CURSOR_INVALID', message: 'Invalid cursor' })
      }
      const limit = Number(request.query.limit ?? '20')
      return options.repository.withConsistentSnapshot(async (repository) => {
        const network = await repository.getNetwork(request.params.network)
        if (network === undefined) {
          return reply.code(404).send({ error: 'NETWORK_NOT_FOUND', message: 'Network not found' })
        }
        const now = await authoritativeTime(repository)
        const status = await preflightAuthoritativeRead(repository, request.params.network, now)
        const rows = await repository.listSchemas({
          profileId: request.params.network,
          ...(request.query.publisher === undefined ? {} : { publisher: request.query.publisher }),
          ...(cursor === undefined ? {} : { cursor }),
          limit,
        })
        const schemaEvidence = await repository.getSchemaProjectionEvidence({
          profileId: request.params.network,
          schemaUids: schemaProjectionEvidenceUids(rows, request.params.network),
        })
        await requireAuthoritativeCheckpoint(
          repository,
          request.params.network,
          status,
          now,
          schemaEvidence.map((item) => item.schema.ledgerIndex),
          network.activationLedgerIndex,
        )
        for (const row of rows) {
          authoritativeResolvedSchema(row, schemaEvidence, {
            profileId: request.params.network,
            schemaUid: row.schemaUid,
            networkId: network.networkId,
            activationLedgerIndex: network.activationLedgerIndex,
          })
        }
        const hasNext = rows.length > limit
        const items = hasNext ? rows.slice(0, limit) : rows
        const last = items.at(-1)
        return {
          items,
          ...(hasNext && last !== undefined
            ? {
                nextCursor: encodeSchemaCursor({
                  ledgerIndex: last.ledgerIndex,
                  transactionIndex: last.transactionIndex,
                  schemaUid: last.schemaUid,
                }),
              }
            : {}),
        }
      })
    },
  )

  const credentialParamsSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['network', 'issuer', 'subject', 'schemaUid'],
    properties: {
      network: { type: 'string', pattern: PROFILE_PATTERN },
      issuer: { type: 'string', pattern: ADDRESS_PATTERN },
      subject: { type: 'string', pattern: ADDRESS_PATTERN },
      schemaUid: { type: 'string', pattern: UID_PATTERN },
    },
  } as const
  type CredentialParams = {
    network: string
    issuer: string
    subject: string
    schemaUid: string
  }

  app.get<{ Params: CredentialParams }>(
    '/v1/networks/:network/credentials/:issuer/:subject/:schemaUid',
    {
      schema: {
        params: credentialParamsSchema,
        response: {
          200: exactCredentialResponseSchema,
          404: errorResponseSchema,
          503: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!isClassicAddress(request.params.issuer) || !isClassicAddress(request.params.subject)) {
        return reply.code(400).send({
          error: 'ADDRESS_INVALID',
          message: 'issuer and subject must be valid XRPL classic addresses',
        })
      }
      return options.repository.withConsistentSnapshot(async (repository) => {
        const network = await repository.getNetwork(request.params.network)
        if (network === undefined) {
          return reply.code(404).send({ error: 'NETWORK_NOT_FOUND', message: 'Network not found' })
        }
        const now = await authoritativeTime(repository)
        const status = await preflightAuthoritativeRead(repository, request.params.network, now)
        const generation = await repository.getCredential({
          profileId: request.params.network,
          issuer: request.params.issuer,
          subject: request.params.subject,
          schemaUid: request.params.schemaUid,
        })
        const checkpoint = await requireAuthoritativeCheckpoint(
          repository,
          request.params.network,
          status,
          now,
          generation === undefined
            ? []
            : [generation.createdLedgerIndex, generation.lastLedgerIndex],
          network.activationLedgerIndex,
        )
        if (generation === undefined) {
          return reply
            .code(404)
            .send({ error: 'CREDENTIAL_NOT_FOUND', message: 'Credential not found' })
        }
        const publicGeneration = publicCredentialGeneration(generation, {
          profileId: request.params.network,
          activationLedgerIndex: network.activationLedgerIndex,
          checkpointLedgerIndex: checkpoint.ledgerIndex,
          issuer: request.params.issuer,
          subject: request.params.subject,
          schemaUid: request.params.schemaUid,
        })
        return {
          profileId: generation.profileId,
          ...publicGeneration,
          createdAt: generation.createdAt,
          updatedAt: generation.updatedAt,
          state: credentialGenerationState(generation, checkpoint.closeTime),
        }
      })
    },
  )

  app.get<{ Params: CredentialParams }>(
    '/v1/networks/:network/credentials/:issuer/:subject/:schemaUid/events',
    {
      schema: {
        params: credentialParamsSchema,
        response: {
          200: credentialEventHistoryResponseSchema,
          413: errorResponseSchema,
          503: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!isClassicAddress(request.params.issuer) || !isClassicAddress(request.params.subject)) {
        return reply.code(400).send({
          error: 'ADDRESS_INVALID',
          message: 'issuer and subject must be valid XRPL classic addresses',
        })
      }
      return options.repository.withConsistentSnapshot(async (repository) => {
        const network = await repository.getNetwork(request.params.network)
        if (network === undefined) {
          return reply.code(404).send({ error: 'NETWORK_NOT_FOUND', message: 'Network not found' })
        }
        const now = await authoritativeTime(repository)
        const status = await preflightAuthoritativeRead(repository, request.params.network, now)
        const items = await repository.getCredentialEvents({
          profileId: request.params.network,
          issuer: request.params.issuer,
          subject: request.params.subject,
          schemaUid: request.params.schemaUid,
          limit: CREDENTIAL_EVENT_HISTORY_LIMIT + 1,
        })
        await requireAuthoritativeCheckpoint(
          repository,
          request.params.network,
          status,
          now,
          items.map((item) => item.ledgerIndex),
          network.activationLedgerIndex,
        )
        if (items.length > CREDENTIAL_EVENT_HISTORY_LIMIT) {
          return reply.code(413).send({
            error: 'CREDENTIAL_EVENT_HISTORY_LIMIT_EXCEEDED',
            message: `Credential event history exceeds ${CREDENTIAL_EVENT_HISTORY_LIMIT} items`,
          })
        }
        for (const item of items) {
          publicCredentialEvent(item, {
            transactionHash: item.transactionHash,
            issuer: request.params.issuer,
            subject: request.params.subject,
            schemaUid: request.params.schemaUid,
            activationLedgerIndex: network.activationLedgerIndex,
          })
        }
        return {
          items,
        }
      })
    },
  )

  const credentialEventParamsSchema = {
    type: 'object',
    additionalProperties: false,
    required: [...credentialParamsSchema.required, 'transactionHash'],
    properties: {
      ...credentialParamsSchema.properties,
      transactionHash: { type: 'string', pattern: INPUT_HASH_PATTERN },
    },
  } as const
  type CredentialEventParams = CredentialParams & { transactionHash: string }

  app.get<{ Params: CredentialEventParams }>(
    '/v1/networks/:network/credentials/:issuer/:subject/:schemaUid/events/:transactionHash',
    {
      schema: {
        params: credentialEventParamsSchema,
        response: {
          200: exactCredentialEventResponseSchema,
          400: errorResponseSchema,
          404: errorResponseSchema,
          503: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!isClassicAddress(request.params.issuer) || !isClassicAddress(request.params.subject)) {
        return reply.code(400).send({
          error: 'ADDRESS_INVALID',
          message: 'issuer and subject must be valid XRPL classic addresses',
        })
      }
      const transactionHash = request.params.transactionHash.toLowerCase()
      return options.repository.withConsistentSnapshot(async (repository) => {
        const network = await repository.getNetwork(request.params.network)
        if (network === undefined) {
          return reply.code(404).send({ error: 'NETWORK_NOT_FOUND', message: 'Network not found' })
        }
        const now = await authoritativeTime(repository)
        const status = await preflightAuthoritativeRead(repository, request.params.network, now)
        const items = await repository.getCredentialEventsByTransaction({
          profileId: request.params.network,
          transactionHash,
          issuer: request.params.issuer,
          subject: request.params.subject,
          schemaUid: request.params.schemaUid,
          limit: EXACT_CREDENTIAL_EVENT_QUERY_LIMIT,
        })
        await requireAuthoritativeCheckpoint(
          repository,
          request.params.network,
          status,
          now,
          items.map((item) => item.ledgerIndex),
          network.activationLedgerIndex,
        )
        if (items.length > 1) {
          return reply.code(503).send({
            error: 'CREDENTIAL_EVENT_AMBIGUOUS',
            message: 'Multiple indexed events match the exact transaction and credential tuple',
          })
        }
        return {
          transactionHash,
          event:
            items[0] === undefined
              ? null
              : publicCredentialEvent(items[0], {
                  transactionHash,
                  issuer: request.params.issuer,
                  subject: request.params.subject,
                  schemaUid: request.params.schemaUid,
                  activationLedgerIndex: network.activationLedgerIndex,
                }),
        }
      })
    },
  )

  app.post<{ Body: VerifyRequest }>(
    '/v1/verify',
    {
      bodyLimit: VERIFY_BODY_LIMIT_BYTES,
      config: {
        rateLimit: { max: options.verifyRateLimit ?? 20, timeWindow: '1 minute' },
      },
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['network', 'issuer', 'subject', 'schemaUid'],
          properties: {
            network: { type: 'string', pattern: PROFILE_PATTERN },
            issuer: { type: 'string', pattern: ADDRESS_PATTERN },
            subject: { type: 'string', pattern: ADDRESS_PATTERN },
            schemaUid: { type: 'string', pattern: UID_PATTERN },
            payload: { type: 'object' },
            resolvePayload: { type: 'boolean' },
          },
          not: { required: ['payload', 'resolvePayload'] },
        },
        response: {
          200: verificationResponseSchema,
          404: errorResponseSchema,
          503: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!isClassicAddress(request.body.issuer) || !isClassicAddress(request.body.subject)) {
        return reply.code(400).send({
          error: 'ADDRESS_INVALID',
          message: 'issuer and subject must be valid XRPL classic addresses',
        })
      }
      return verifyCredential(request.body, {
        repository: options.repository,
        resolver: payloadResolver,
        trustPolicy: options.trustPolicy,
        maxLedgerAgeSeconds: options.readinessMaxLedgerAgeSeconds ?? DEFAULT_LEDGER_MAX_AGE_SECONDS,
        ...(options.now === undefined ? {} : { now: options.now }),
      })
    },
  )

  if (options.pinningService !== undefined) {
    app.post<{ Body: { network: string; wallet: string } }>(
      '/v1/pinning/challenges',
      {
        schema: {
          body: {
            type: 'object',
            additionalProperties: false,
            required: ['network', 'wallet'],
            properties: {
              network: { type: 'string', pattern: PROFILE_PATTERN },
              wallet: { type: 'string', pattern: ADDRESS_PATTERN },
            },
          },
        },
        config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      },
      async (request) =>
        options.pinningService!.createChallenge({
          network: request.body.network,
          wallet: request.body.wallet,
          ipAddress: request.ip,
        }),
    )

    app.post<{
      Body: {
        network: string
        wallet: string
        challengeId: string
        publicKey: string
        signature: string
        payloadBase64: string
      }
    }>(
      '/v1/pinning/pins',
      {
        schema: {
          body: {
            type: 'object',
            additionalProperties: false,
            required: [
              'network',
              'wallet',
              'challengeId',
              'publicKey',
              'signature',
              'payloadBase64',
            ],
            properties: {
              network: { type: 'string', pattern: PROFILE_PATTERN },
              wallet: { type: 'string', pattern: ADDRESS_PATTERN },
              challengeId: { type: 'string', pattern: UID_PATTERN },
              publicKey: {
                type: 'string',
                pattern: '^(?:ED[0-9A-Fa-f]{64}|0[23][0-9A-Fa-f]{64})$',
              },
              signature: { type: 'string', pattern: '^[0-9A-Fa-f]{128,144}$' },
              payloadBase64: { type: 'string', minLength: 4, maxLength: 90_000 },
            },
          },
          response: { 503: errorResponseSchema },
        },
        config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      },
      async (request) =>
        options.pinningService!.pin({
          ...request.body,
          ipAddress: request.ip,
        }),
    )
  }

  return app
}
