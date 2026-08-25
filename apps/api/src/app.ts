import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import { isClassicAddress, type VerificationReport } from '@xcs-protocol/core'
import Fastify, { type FastifyInstance } from 'fastify'

import { DEFAULT_LEDGER_MAX_AGE_SECONDS, IndexerUnavailableError } from './ledger-freshness.js'
import {
  assertAuthoritativeLedgerEvidence,
  assertIndexerReady,
  publicIndexerStatus,
} from './indexer-status.js'
import { decodeSchemaCursor, encodeSchemaCursor } from './pagination.js'
import { DemoPinningService, PinningError } from './pinning.js'
import type { ApiRepository, PayloadResolver, TrustPolicy } from './types.js'
import {
  VerificationNetworkNotFoundError,
  verifyCredential,
  type VerifyRequest,
} from './verification.js'

const PROFILE_PATTERN = '^[a-z0-9][a-z0-9._-]{0,127}$'
const UID_PATTERN = '^[0-9a-f]{64}$'
const INPUT_HASH_PATTERN = '^[0-9A-Fa-f]{64}$'
const ADDRESS_PATTERN = '^r[1-9A-HJ-NP-Za-km-z]{24,34}$'
const CREDENTIAL_EVENT_HISTORY_LIMIT = 100
const EXACT_CREDENTIAL_EVENT_QUERY_LIMIT = 2
const errorResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['error', 'message'],
  properties: {
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
    'eventType',
    'issuer',
    'subject',
    'schemaUid',
    'deletionCause',
  ],
  properties: {
    transactionHash: { type: 'string', pattern: UID_PATTERN },
    nodeIndex: { type: 'integer', minimum: 0 },
    generationId: {
      anyOf: [{ type: 'string', pattern: UID_PATTERN }, { type: 'null' }],
    },
    ledgerIndex: { type: 'integer', minimum: 0, maximum: 4_294_967_295 },
    eventType: { type: 'string', enum: ['created', 'accepted', 'deleted'] },
    issuer: { type: 'string', pattern: ADDRESS_PATTERN },
    subject: { type: 'string', pattern: ADDRESS_PATTERN },
    schemaUid: { type: 'string', pattern: UID_PATTERN },
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
const exactCredentialEventResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['transactionHash', 'event'],
  properties: {
    transactionHash: { type: 'string', pattern: UID_PATTERN },
    event: { anyOf: [publicCredentialEventSchema, { type: 'null' }] },
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

function credentialState(
  generation: NonNullable<Awaited<ReturnType<ApiRepository['getCredential']>>>,
  closeTime: number | undefined,
): VerificationReport['onChain'] {
  if (generation.deletedLedgerIndex !== null) return 'deleted'
  if (
    generation.expiration !== null &&
    closeTime !== undefined &&
    generation.expiration <= closeTime
  ) {
    return 'expired'
  }
  return generation.accepted ? 'active' : 'pending'
}

function publicCredentialEvent(
  row: Awaited<ReturnType<ApiRepository['getCredentialEvents']>>[number],
) {
  return {
    transactionHash: row.transactionHash,
    nodeIndex: row.nodeIndex,
    generationId: row.generationId,
    ledgerIndex: row.ledgerIndex,
    eventType: row.eventType,
    issuer: row.issuer,
    subject: row.subject,
    schemaUid: row.schemaUid,
    deletionCause: row.deletionCause,
  }
}

export interface CreateApiOptions {
  repository: ApiRepository
  resolver: PayloadResolver
  trustPolicy: TrustPolicy
  logger?: boolean
  allowedOrigins?: string[]
  globalRateLimit?: number
  verifyRateLimit?: number
  pinningService?: DemoPinningService
  readinessMaxLedgerAgeSeconds?: number
  now?: () => Date
}

export async function createApi(options: CreateApiOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 1024 * 1024,
    ajv: {
      customOptions: {
        removeAdditional: false,
        coerceTypes: false,
        allErrors: false,
      },
    },
  })

  await app.register(cors, {
    origin: options.allowedOrigins ?? ['http://localhost:3000'],
    methods: ['GET', 'POST'],
    credentials: false,
  })
  await app.register(rateLimit, {
    global: true,
    max: options.globalRateLimit ?? 100,
    timeWindow: '1 minute',
  })

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
  ) {
    const checkpoint = await repository.getLatestCheckpoint(profileId)
    const evidence = {
      expectedProfileId: profileId,
      status,
      checkpoint,
      now,
      maxLedgerAgeSeconds,
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

  app.get('/health/live', async () => ({ status: 'ok' }))
  app.get('/health', async () => ({ status: 'ok' }))
  app.get('/health/ready', async (_request, reply) => {
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
            await requireAuthoritativeCheckpoint(repository, network.profileId, status, now)
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
        response: { 404: errorResponseSchema, 503: errorResponseSchema },
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
        await requireAuthoritativeCheckpoint(
          repository,
          request.params.network,
          status,
          now,
          schema === undefined ? [] : [schema.ledgerIndex],
        )
        if (schema === undefined) {
          return reply.code(404).send({ error: 'SCHEMA_NOT_FOUND', message: 'Schema not found' })
        }
        return schema
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
        response: { 503: errorResponseSchema },
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
        await requireAuthoritativeCheckpoint(
          repository,
          request.params.network,
          status,
          now,
          rows.map((row) => row.ledgerIndex),
        )
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
        response: { 404: errorResponseSchema, 503: errorResponseSchema },
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
          generation === undefined ? [] : [generation.lastLedgerIndex],
        )
        if (generation === undefined) {
          return reply
            .code(404)
            .send({ error: 'CREDENTIAL_NOT_FOUND', message: 'Credential not found' })
        }
        return {
          ...generation,
          state: credentialState(generation, checkpoint.closeTime),
        }
      })
    },
  )

  app.get<{ Params: CredentialParams }>(
    '/v1/networks/:network/credentials/:issuer/:subject/:schemaUid/events',
    {
      schema: {
        params: credentialParamsSchema,
        response: { 413: errorResponseSchema, 503: errorResponseSchema },
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
        )
        if (items.length > CREDENTIAL_EVENT_HISTORY_LIMIT) {
          return reply.code(413).send({
            error: 'CREDENTIAL_EVENT_HISTORY_LIMIT_EXCEEDED',
            message: `Credential event history exceeds ${CREDENTIAL_EVENT_HISTORY_LIMIT} items`,
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
        )
        if (items.length > 1) {
          return reply.code(503).send({
            error: 'CREDENTIAL_EVENT_AMBIGUOUS',
            message: 'Multiple indexed events match the exact transaction and credential tuple',
          })
        }
        return {
          transactionHash,
          event: items[0] === undefined ? null : publicCredentialEvent(items[0]),
        }
      })
    },
  )

  app.post<{ Body: VerifyRequest }>(
    '/v1/verify',
    {
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
        response: { 404: errorResponseSchema, 503: errorResponseSchema },
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
        resolver: options.resolver,
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
