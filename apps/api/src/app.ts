import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import { isClassicAddress, type VerificationReport } from '@xcs-protocol/core'
import Fastify, { type FastifyInstance } from 'fastify'

import {
  assertFreshLedgerCheckpoint,
  DEFAULT_LEDGER_MAX_AGE_SECONDS,
  evaluateLedgerCheckpointFreshness,
  IndexerUnavailableError,
} from './ledger-freshness.js'
import { decodeSchemaCursor, encodeSchemaCursor } from './pagination.js'
import { DemoPinningService, PinningError } from './pinning.js'
import type { ApiRepository, PayloadResolver, TrustPolicy } from './types.js'
import { verifyCredential, type VerifyRequest } from './verification.js'

const PROFILE_PATTERN = '^[a-z0-9][a-z0-9._-]{0,127}$'
const UID_PATTERN = '^[0-9a-f]{64}$'
const ADDRESS_PATTERN = '^r[1-9A-HJ-NP-Za-km-z]{24,34}$'
const errorResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['error', 'message'],
  properties: {
    error: { type: 'string' },
    message: { type: 'string' },
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

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof PinningError) {
      reply.code(error.statusCode).send({ error: error.code, message: error.code })
      return
    }
    if (error instanceof IndexerUnavailableError) {
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
      const networks = await options.repository.listNetworks()
      const checkpoints = await Promise.all(
        networks.map((network) => options.repository.getLatestCheckpoint(network.profileId)),
      )
      if (networks.length === 0 || checkpoints.some((checkpoint) => checkpoint === undefined)) {
        return reply.code(503).send({ status: 'not_ready', reason: 'indexer_not_initialized' })
      }
      const now = options.now?.() ?? new Date()
      const maxAge = options.readinessMaxLedgerAgeSeconds ?? DEFAULT_LEDGER_MAX_AGE_SECONDS
      if (
        checkpoints.some(
          (checkpoint) =>
            evaluateLedgerCheckpointFreshness(checkpoint?.closeTime, now, maxAge) !== 'fresh',
        )
      ) {
        return reply.code(503).send({ status: 'not_ready', reason: 'indexer_stale' })
      }
      return { status: 'ready' }
    } catch {
      return reply.code(503).send({ status: 'not_ready', reason: 'database_unavailable' })
    }
  })

  app.get('/v1/networks', async () => ({
    items: (await options.repository.listNetworks()).map(publicNetwork),
  }))

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
        response: { 404: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const network = await options.repository.getNetwork(request.params.network)
      if (network === undefined) {
        return reply.code(404).send({ error: 'NETWORK_NOT_FOUND', message: 'Network not found' })
      }
      const schema = await options.repository.getSchema(request.params.network, request.params.uid)
      if (schema === undefined) {
        return reply.code(404).send({ error: 'SCHEMA_NOT_FOUND', message: 'Schema not found' })
      }
      return schema
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
          properties: { network: { type: 'string', pattern: PROFILE_PATTERN } },
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
      },
    },
    async (request, reply) => {
      const network = await options.repository.getNetwork(request.params.network)
      if (network === undefined) {
        return reply.code(404).send({ error: 'NETWORK_NOT_FOUND', message: 'Network not found' })
      }
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
      const rows = await options.repository.listSchemas({
        profileId: request.params.network,
        ...(request.query.publisher === undefined ? {} : { publisher: request.query.publisher }),
        ...(cursor === undefined ? {} : { cursor }),
        limit,
      })
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
      const network = await options.repository.getNetwork(request.params.network)
      if (network === undefined) {
        return reply.code(404).send({ error: 'NETWORK_NOT_FOUND', message: 'Network not found' })
      }
      const [generation, checkpoint] = await Promise.all([
        options.repository.getCredential({
          profileId: request.params.network,
          issuer: request.params.issuer,
          subject: request.params.subject,
          schemaUid: request.params.schemaUid,
        }),
        options.repository.getLatestCheckpoint(request.params.network),
      ])
      assertFreshLedgerCheckpoint(
        checkpoint?.closeTime,
        options.now?.() ?? new Date(),
        options.readinessMaxLedgerAgeSeconds ?? DEFAULT_LEDGER_MAX_AGE_SECONDS,
      )
      if (generation === undefined) {
        return reply
          .code(404)
          .send({ error: 'CREDENTIAL_NOT_FOUND', message: 'Credential not found' })
      }
      return {
        ...generation,
        state: credentialState(generation, checkpoint?.closeTime),
      }
    },
  )

  app.get<{ Params: CredentialParams }>(
    '/v1/networks/:network/credentials/:issuer/:subject/:schemaUid/events',
    { schema: { params: credentialParamsSchema } },
    async (request, reply) => {
      if (!isClassicAddress(request.params.issuer) || !isClassicAddress(request.params.subject)) {
        return reply.code(400).send({
          error: 'ADDRESS_INVALID',
          message: 'issuer and subject must be valid XRPL classic addresses',
        })
      }
      const network = await options.repository.getNetwork(request.params.network)
      if (network === undefined) {
        return reply.code(404).send({ error: 'NETWORK_NOT_FOUND', message: 'Network not found' })
      }
      return {
        items: await options.repository.getCredentialEvents({
          profileId: request.params.network,
          issuer: request.params.issuer,
          subject: request.params.subject,
          schemaUid: request.params.schemaUid,
        }),
      }
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
        response: { 503: errorResponseSchema },
      },
    },
    async (request, reply) => {
      if (!isClassicAddress(request.body.issuer) || !isClassicAddress(request.body.subject)) {
        return reply.code(400).send({
          error: 'ADDRESS_INVALID',
          message: 'issuer and subject must be valid XRPL classic addresses',
        })
      }
      const network = await options.repository.getNetwork(request.body.network)
      if (network === undefined) {
        return reply.code(404).send({ error: 'NETWORK_NOT_FOUND', message: 'Network not found' })
      }
      return verifyCredential(request.body, {
        repository: options.repository,
        resolver: options.resolver,
        trustPolicy: options.trustPolicy,
        maxLedgerAgeSeconds: options.readinessMaxLedgerAgeSeconds ?? DEFAULT_LEDGER_MAX_AGE_SECONDS,
        now: options.now ?? (() => new Date()),
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
