import type {
  CredentialEventRow,
  CredentialGenerationRow,
  IndexerStatusRow,
  LedgerCheckpointRow,
  NetworkProfileRow,
  SchemaRow,
} from '@xcs-protocol/db'
import { afterEach, describe, expect, it } from 'vitest'

import { createApi } from '../src/app.js'
import type { ApiRepository } from '../src/types.js'
import { StaticTrustPolicy } from '../src/verification.js'

const UID = 'a'.repeat(64)
const TX_HASH = 'ab'.repeat(32)
const ISSUER = 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh'
const SUBJECT = 'rLs1MzkFWCxTbuAHgjeTZK4fcCDDnf2KRv'
const NOW = new Date('2026-08-19T00:00:00.000Z')
const NOW_RIPPLE = Math.floor(NOW.getTime() / 1_000) - 946_684_800

const network: NetworkProfileRow = {
  profileId: 'testnet',
  xcsVersion: '0.1',
  networkId: 1,
  requiredAmendment: 'b'.repeat(64),
  registryAddress: ISSUER,
  registrationAmountDrops: 1,
  activationLedgerIndex: 100,
  activationLedgerHash: 'c'.repeat(64),
  enabled: true,
  createdAt: NOW,
}
const checkpoint: LedgerCheckpointRow = {
  profileId: 'testnet',
  ledgerIndex: 100,
  ledgerHash: 'c'.repeat(64),
  parentHash: 'd'.repeat(64),
  closeTime: NOW_RIPPLE - 10,
  transactionCount: 0,
  transactionRoot: '1'.repeat(64),
  processedAt: NOW,
}
const readyStatus: IndexerStatusRow = {
  profileId: 'testnet',
  state: 'ready',
  primarySourceTip: 100,
  secondarySourceTip: 100,
  lastAgreedLedgerIndex: 100,
  lastAgreedLedgerHash: checkpoint.ledgerHash,
  errorCode: null,
  writerId: 'writer-1',
  writerEpoch: 1,
  leaseExpiresAt: new Date(NOW.getTime() + 60_000),
  updatedAt: NOW,
}
const generation: CredentialGenerationRow = {
  profileId: 'testnet',
  generationId: 'e'.repeat(64),
  ledgerObjectId: 'f'.repeat(64),
  issuer: ISSUER,
  subject: SUBJECT,
  schemaUid: UID,
  uriHex: null,
  expiration: null,
  accepted: true,
  createdLedgerIndex: 90,
  createdTransactionIndex: 0,
  lastLedgerIndex: 95,
  deletedLedgerIndex: null,
  deletionCause: null,
  createdAt: NOW,
  updatedAt: NOW,
}
const credentialEvent: CredentialEventRow = {
  profileId: 'testnet',
  transactionHash: TX_HASH,
  nodeIndex: 0,
  generationId: generation.generationId,
  ledgerObjectId: generation.ledgerObjectId,
  ledgerIndex: 95,
  ledgerHash: '3'.repeat(64),
  transactionIndex: 1,
  eventType: 'accepted',
  issuer: ISSUER,
  subject: SUBJECT,
  schemaUid: UID,
  uriHex: null,
  expiration: null,
  accepted: true,
  deletionCause: null,
  snapshot: {},
  recordedAt: NOW,
}
const credentialUrl = `/v1/networks/testnet/credentials/${ISSUER}/${SUBJECT}/${UID}`
const credentialEventsUrl = `${credentialUrl}/events`
const exactCredentialEventUrl = `${credentialEventsUrl}/${TX_HASH.toUpperCase()}`
const schemaUrl = `/v1/networks/testnet/schemas/${UID}`

class RouteRepository implements ApiRepository {
  async withConsistentSnapshot<T>(callback: (repository: ApiRepository) => Promise<T>): Promise<T> {
    return callback(this)
  }
  async getDatabaseTime() {
    return NOW
  }
  async ping() {}
  async listNetworks() {
    return [network]
  }
  async getNetwork(profileId: string) {
    return profileId === 'testnet' ? network : undefined
  }
  async getIndexerStatus(): Promise<IndexerStatusRow | undefined> {
    return readyStatus
  }
  async getLatestCheckpoint(): Promise<LedgerCheckpointRow | undefined> {
    return checkpoint
  }
  async getSchema(): Promise<SchemaRow | undefined> {
    return undefined
  }
  async listSchemas(): Promise<SchemaRow[]> {
    return []
  }
  async getCredential(): Promise<CredentialGenerationRow | undefined> {
    return undefined
  }
  async getCredentialEvents(
    _input: Parameters<ApiRepository['getCredentialEvents']>[0],
  ): Promise<CredentialEventRow[]> {
    return []
  }
  async getCredentialEventsByTransaction(
    _input: Parameters<ApiRepository['getCredentialEventsByTransaction']>[0],
  ): Promise<CredentialEventRow[]> {
    return []
  }
}

const apps: Awaited<ReturnType<typeof createApi>>[] = []
async function app() {
  const instance = await createApi({
    repository: new RouteRepository(),
    resolver: { resolve: async () => new Uint8Array() },
    trustPolicy: new StaticTrustPolicy(),
    now: () => NOW,
  })
  apps.push(instance)
  return instance
}

async function configuredApp(overrides: Partial<Parameters<typeof createApi>[0]>) {
  const instance = await createApi({
    repository: new RouteRepository(),
    resolver: { resolve: async () => new Uint8Array() },
    trustPolicy: new StaticTrustPolicy(),
    now: () => NOW,
    ...overrides,
  })
  apps.push(instance)
  return instance
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((instance) => instance.close()))
})

describe('read API', () => {
  it('exposes liveness and indexer readiness separately', async () => {
    const instance = await app()
    expect((await instance.inject({ method: 'GET', url: '/health/live' })).statusCode).toBe(200)
    expect((await instance.inject({ method: 'GET', url: '/health/ready' })).statusCode).toBe(200)
  })

  it.each([
    ['missing', undefined, 'indexer_status_unavailable'],
    ['starting', { ...readyStatus, state: 'starting' as const }, 'indexer_not_ready'],
    ['catching up', { ...readyStatus, state: 'catching_up' as const }, 'indexer_not_ready'],
    [
      'halted',
      { ...readyStatus, state: 'halted' as const, errorCode: 'LEDGER_SOURCE_DIVERGENCE' },
      'indexer_halted',
    ],
  ])('fails readiness when durable status is %s', async (_label, status, reason) => {
    const repository = new RouteRepository()
    repository.getIndexerStatus = async () => status
    const instance = await configuredApp({ repository })
    const response = await instance.inject({ method: 'GET', url: '/health/ready' })
    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({ status: 'not_ready', reason })
  })

  it('exposes a public DTO for durable indexer status and documents it in OpenAPI', async () => {
    const instance = await app()
    const response = await instance.inject({ method: 'GET', url: '/v1/networks/testnet/status' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      profileId: 'testnet',
      state: 'ready',
      sourceTips: { primary: 100, secondary: 100 },
      lastAgreedLedger: { index: 100, hash: checkpoint.ledgerHash },
      errorCode: null,
      updatedAt: NOW.toISOString(),
    })

    const operation = instance.swagger().paths?.['/v1/networks/{network}/status']?.get
    expect(operation?.responses).toHaveProperty('200')
    expect(operation?.responses).toHaveProperty('404')
    expect(JSON.stringify(instance.swagger())).not.toContain('"type":["integer","null"]')
    expect(response.json()).not.toHaveProperty('writerId')
    expect(response.json()).not.toHaveProperty('writerEpoch')

    const paths = instance.swagger().paths
    expect(paths?.['/v1/networks/{network}/schemas/{uid}']?.get?.responses).toHaveProperty('503')
    expect(paths?.['/v1/networks/{network}/schemas']?.get?.responses).toHaveProperty('503')
    expect(
      paths?.['/v1/networks/{network}/credentials/{issuer}/{subject}/{schemaUid}/events']?.get
        ?.responses,
    ).toHaveProperty('503')
    expect(paths?.['/v1/verify']?.post?.responses).toHaveProperty('503')
    expect(paths?.['/v1/verify']?.post?.responses).toHaveProperty('404')
  })

  it('keeps public network and status endpoints available while authoritative reads are halted', async () => {
    const repository = new RouteRepository()
    repository.getIndexerStatus = async () => ({
      ...readyStatus,
      state: 'halted',
      errorCode: 'SOURCE_DIVERGENCE',
      writerId: null,
      leaseExpiresAt: null,
    })
    const instance = await configuredApp({ repository })

    expect((await instance.inject({ method: 'GET', url: '/health/live' })).statusCode).toBe(200)
    expect((await instance.inject({ method: 'GET', url: '/v1/networks' })).statusCode).toBe(200)
    const statusResponse = await instance.inject({
      method: 'GET',
      url: '/v1/networks/testnet/status',
    })
    expect(statusResponse.statusCode).toBe(200)
    expect(statusResponse.json()).toMatchObject({ state: 'halted', errorCode: 'SOURCE_DIVERGENCE' })
  })

  it('does not invent a public status before the indexer writes one', async () => {
    const repository = new RouteRepository()
    repository.getIndexerStatus = async () => undefined
    const instance = await configuredApp({ repository })
    const response = await instance.inject({ method: 'GET', url: '/v1/networks/testnet/status' })
    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({
      error: 'INDEXER_STATUS_NOT_FOUND',
      message: 'Indexer status not found',
    })
  })

  it('fails readiness when the last indexed ledger is stale', async () => {
    const repository = new RouteRepository()
    repository.getLatestCheckpoint = async () => ({
      ...checkpoint,
      closeTime: NOW_RIPPLE - 121,
    })
    const instance = await configuredApp({
      repository,
      readinessMaxLedgerAgeSeconds: 120,
    })
    const response = await instance.inject({ method: 'GET', url: '/health/ready' })
    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({ status: 'not_ready', reason: 'indexer_stale' })
  })

  it('fails readiness when the last indexed ledger is implausibly in the future', async () => {
    const repository = new RouteRepository()
    repository.getLatestCheckpoint = async () => ({
      ...checkpoint,
      closeTime: NOW_RIPPLE + 31,
    })
    const instance = await configuredApp({ repository })
    const response = await instance.inject({ method: 'GET', url: '/health/ready' })
    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({ status: 'not_ready', reason: 'indexer_stale' })
  })

  it.each([
    ['stale', NOW_RIPPLE - 121],
    ['implausibly in the future', NOW_RIPPLE + 31],
  ])('refuses verification when the indexed proof is %s', async (_label, closeTime) => {
    const repository = new RouteRepository()
    repository.getLatestCheckpoint = async () => ({ ...checkpoint, closeTime })
    const instance = await configuredApp({
      repository,
      readinessMaxLedgerAgeSeconds: 120,
    })
    const response = await instance.inject({
      method: 'POST',
      url: '/v1/verify',
      payload: { network: 'testnet', issuer: ISSUER, subject: SUBJECT, schemaUid: UID },
    })
    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({
      error: 'INDEXER_STALE',
      message: 'The indexed ledger checkpoint is stale or has an invalid timestamp.',
    })
  })

  it('refuses verification until the indexer has a checkpoint', async () => {
    const repository = new RouteRepository()
    repository.getLatestCheckpoint = async () => undefined
    const instance = await configuredApp({ repository })
    const response = await instance.inject({
      method: 'POST',
      url: '/v1/verify',
      payload: { network: 'testnet', issuer: ISSUER, subject: SUBJECT, schemaUid: UID },
    })
    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({
      error: 'INDEXER_NOT_INITIALIZED',
      message: 'The indexer has not produced a ledger checkpoint for this network.',
    })
  })

  it('returns an exact credential state only from a fresh checkpoint', async () => {
    const repository = new RouteRepository()
    repository.getCredential = async () => generation
    const instance = await configuredApp({ repository })
    const response = await instance.inject({ method: 'GET', url: credentialUrl })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      generationId: generation.generationId,
      state: 'active',
    })
  })

  it('serves every authoritative credential read from the repository snapshot', async () => {
    const repository = new RouteRepository()
    const snapshot = new RouteRepository()
    let snapshotCalls = 0
    snapshot.getCredential = async () => generation
    repository.withConsistentSnapshot = async (callback) => {
      snapshotCalls += 1
      return callback(snapshot)
    }
    repository.getNetwork = async () => {
      throw new Error('authoritative read escaped the snapshot')
    }
    repository.getIndexerStatus = async () => {
      throw new Error('authoritative read escaped the snapshot')
    }
    repository.getLatestCheckpoint = async () => {
      throw new Error('authoritative read escaped the snapshot')
    }
    repository.getCredential = async () => {
      throw new Error('authoritative read escaped the snapshot')
    }

    const instance = await configuredApp({ repository })
    const response = await instance.inject({ method: 'GET', url: credentialUrl })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      generationId: generation.generationId,
      state: 'active',
    })
    expect(snapshotCalls).toBe(1)
  })

  it('looks up one exact transaction event inside the authoritative snapshot', async () => {
    const repository = new RouteRepository()
    const snapshot = new RouteRepository()
    let snapshotCalls = 0
    let lookup: Parameters<ApiRepository['getCredentialEventsByTransaction']>[0] | undefined
    snapshot.getCredentialEvents = async () => {
      throw new Error('full event history must not be read')
    }
    snapshot.getCredentialEventsByTransaction = async (input) => {
      lookup = input
      return [credentialEvent]
    }
    repository.withConsistentSnapshot = async (callback) => {
      snapshotCalls += 1
      return callback(snapshot)
    }
    repository.getNetwork = async () => {
      throw new Error('exact event read escaped the snapshot')
    }
    repository.getCredentialEventsByTransaction = async () => {
      throw new Error('exact event read escaped the snapshot')
    }

    const instance = await configuredApp({ repository })
    const response = await instance.inject({ method: 'GET', url: exactCredentialEventUrl })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      transactionHash: TX_HASH,
      event: {
        transactionHash: TX_HASH,
        nodeIndex: 0,
        generationId: generation.generationId,
        ledgerIndex: 95,
        eventType: 'accepted',
        issuer: ISSUER,
        subject: SUBJECT,
        schemaUid: UID,
        deletionCause: null,
      },
    })
    expect(lookup).toEqual({
      profileId: 'testnet',
      transactionHash: TX_HASH,
      issuer: ISSUER,
      subject: SUBJECT,
      schemaUid: UID,
      limit: 2,
    })
    expect(snapshotCalls).toBe(1)

    const operation =
      instance.swagger().paths?.[
        '/v1/networks/{network}/credentials/{issuer}/{subject}/{schemaUid}/events/{transactionHash}'
      ]?.get
    expect(operation?.responses).toHaveProperty('200')
    expect(operation?.responses).toHaveProperty('400')
    expect(operation?.responses).toHaveProperty('404')
    expect(operation?.responses).toHaveProperty('503')
  })

  it('returns an explicit empty exact lookup and fails closed on ambiguous event rows', async () => {
    const repository = new RouteRepository()
    const instance = await configuredApp({ repository })
    const missing = await instance.inject({ method: 'GET', url: exactCredentialEventUrl })
    expect(missing.statusCode).toBe(200)
    expect(missing.json()).toEqual({ transactionHash: TX_HASH, event: null })

    repository.getCredentialEventsByTransaction = async () => [
      credentialEvent,
      { ...credentialEvent, nodeIndex: 1 },
    ]
    const ambiguous = await instance.inject({ method: 'GET', url: exactCredentialEventUrl })
    expect(ambiguous.statusCode).toBe(503)
    expect(ambiguous.json()).toMatchObject({ error: 'CREDENTIAL_EVENT_AMBIGUOUS' })

    const malformed = await instance.inject({
      method: 'GET',
      url: `${credentialEventsUrl}/not-a-hash`,
    })
    expect(malformed.statusCode).toBe(400)
  })

  it('bounds the legacy credential event history without silently truncating it', async () => {
    const repository = new RouteRepository()
    let requestedLimit: number | undefined
    repository.getCredentialEvents = async (input) => {
      requestedLimit = input.limit
      return Array.from({ length: input.limit }, (_, nodeIndex) => ({
        ...credentialEvent,
        nodeIndex,
      }))
    }
    const instance = await configuredApp({ repository })
    const response = await instance.inject({ method: 'GET', url: credentialEventsUrl })

    expect(requestedLimit).toBe(101)
    expect(response.statusCode).toBe(413)
    expect(response.json()).toMatchObject({ error: 'CREDENTIAL_EVENT_HISTORY_LIMIT_EXCEEDED' })
    expect(
      instance.swagger().paths?.[
        '/v1/networks/{network}/credentials/{issuer}/{subject}/{schemaUid}/events'
      ]?.get?.responses,
    ).toHaveProperty('413')
  })

  it('uses PostgreSQL time to reject an expired writer lease in production mode', async () => {
    const repository = new RouteRepository()
    repository.getCredential = async () => generation
    repository.getDatabaseTime = async () => new Date(readyStatus.leaseExpiresAt!.getTime() + 1)
    const instance = await createApi({
      repository,
      resolver: { resolve: async () => new Uint8Array() },
      trustPolicy: new StaticTrustPolicy(),
    })
    apps.push(instance)

    const [credentialResponse, verificationResponse] = await Promise.all([
      instance.inject({ method: 'GET', url: credentialUrl }),
      instance.inject({
        method: 'POST',
        url: '/v1/verify',
        payload: { network: 'testnet', issuer: ISSUER, subject: SUBJECT, schemaUid: UID },
      }),
    ])

    for (const response of [credentialResponse, verificationResponse]) {
      expect(response.statusCode).toBe(503)
      expect(response.json()).toMatchObject({ error: 'INDEXER_LEASE_EXPIRED' })
    }
  })

  it.each([
    [undefined, 'INDEXER_STATUS_UNAVAILABLE'],
    [{ ...readyStatus, state: 'starting' as const }, 'INDEXER_NOT_READY'],
    [{ ...readyStatus, state: 'catching_up' as const }, 'INDEXER_NOT_READY'],
    [
      { ...readyStatus, state: 'halted' as const, errorCode: 'LEDGER_PARENT_MISMATCH' },
      'INDEXER_HALTED',
    ],
  ])(
    'refuses authoritative routes immediately for durable status %#',
    async (status, errorCode) => {
      const repository = new RouteRepository()
      repository.getCredential = async () => generation
      repository.getIndexerStatus = async () => status
      const instance = await configuredApp({ repository })

      const [credentialResponse, verificationResponse] = await Promise.all([
        instance.inject({ method: 'GET', url: credentialUrl }),
        instance.inject({
          method: 'POST',
          url: '/v1/verify',
          payload: { network: 'testnet', issuer: ISSUER, subject: SUBJECT, schemaUid: UID },
        }),
      ])
      for (const response of [credentialResponse, verificationResponse]) {
        expect(response.statusCode).toBe(503)
        expect(response.json()).toMatchObject({ error: errorCode })
        expect(JSON.stringify(response.json())).not.toContain('LEDGER_PARENT_MISMATCH')
      }
    },
  )

  it('rejects every ledger-derived route before reading projections when the lease is unavailable', async () => {
    const repository = new RouteRepository()
    let projectionReads = 0
    repository.getIndexerStatus = async () => undefined
    repository.getLatestCheckpoint = async () => {
      projectionReads += 1
      return checkpoint
    }
    repository.getSchema = async () => {
      projectionReads += 1
      return undefined
    }
    repository.listSchemas = async () => {
      projectionReads += 1
      return []
    }
    repository.getCredential = async () => {
      projectionReads += 1
      return generation
    }
    repository.getCredentialEvents = async () => {
      projectionReads += 1
      return []
    }
    repository.getCredentialEventsByTransaction = async () => {
      projectionReads += 1
      return []
    }
    const instance = await configuredApp({ repository })

    const responses = await Promise.all([
      instance.inject({ method: 'GET', url: schemaUrl }),
      instance.inject({ method: 'GET', url: '/v1/networks/testnet/schemas' }),
      instance.inject({ method: 'GET', url: credentialUrl }),
      instance.inject({ method: 'GET', url: credentialEventsUrl }),
      instance.inject({ method: 'GET', url: exactCredentialEventUrl }),
      instance.inject({
        method: 'POST',
        url: '/v1/verify',
        payload: { network: 'testnet', issuer: ISSUER, subject: SUBJECT, schemaUid: UID },
      }),
    ])
    expect(responses.map((response) => response.statusCode)).toEqual([503, 503, 503, 503, 503, 503])
    expect(projectionReads).toBe(0)
  })

  it('refuses an exact event that is ahead of the authoritative checkpoint', async () => {
    const repository = new RouteRepository()
    repository.getCredentialEventsByTransaction = async () => [
      { ...credentialEvent, ledgerIndex: checkpoint.ledgerIndex + 1 },
    ]
    const instance = await configuredApp({ repository })
    const response = await instance.inject({ method: 'GET', url: exactCredentialEventUrl })

    expect(response.statusCode).toBe(503)
    expect(response.json()).toMatchObject({ error: 'INDEXER_EVIDENCE_INVALID' })
  })

  it.each([
    [
      'expired lease',
      { status: { ...readyStatus, leaseExpiresAt: NOW }, checkpoint },
      'INDEXER_LEASE_EXPIRED',
    ],
    [
      'checkpoint mismatch',
      {
        status: {
          ...readyStatus,
          primarySourceTip: 101,
          secondarySourceTip: 101,
          lastAgreedLedgerIndex: 101,
          lastAgreedLedgerHash: '2'.repeat(64),
        },
        checkpoint,
      },
      'INDEXER_EVIDENCE_INVALID',
    ],
    [
      'missing transaction root',
      { status: readyStatus, checkpoint: { ...checkpoint, transactionRoot: null } },
      'INDEXER_EVIDENCE_INVALID',
    ],
  ])('fails closed on %s', async (_label, evidence, errorCode) => {
    const repository = new RouteRepository()
    repository.getCredential = async () => generation
    repository.getIndexerStatus = async () => evidence.status
    repository.getLatestCheckpoint = async () => evidence.checkpoint
    const instance = await configuredApp({ repository })
    const response = await instance.inject({ method: 'GET', url: credentialUrl })
    expect(response.statusCode).toBe(503)
    expect(response.json()).toMatchObject({ error: errorCode })
  })

  it.each([
    [
      'missing',
      undefined,
      'INDEXER_NOT_INITIALIZED',
      'The indexer has not produced a ledger checkpoint for this network.',
    ],
    [
      'stale',
      { ...checkpoint, closeTime: NOW_RIPPLE - 121 },
      'INDEXER_STALE',
      'The indexed ledger checkpoint is stale or has an invalid timestamp.',
    ],
    [
      'invalid',
      { ...checkpoint, closeTime: -1 },
      'INDEXER_STALE',
      'The indexed ledger checkpoint is stale or has an invalid timestamp.',
    ],
    [
      'implausibly in the future',
      { ...checkpoint, closeTime: NOW_RIPPLE + 31 },
      'INDEXER_STALE',
      'The indexed ledger checkpoint is stale or has an invalid timestamp.',
    ],
  ] as const)(
    'refuses to serve an exact credential state when its checkpoint is %s',
    async (_label, checkpointValue, error, message) => {
      const repository = new RouteRepository()
      repository.getCredential = async () => generation
      repository.getLatestCheckpoint = async () => checkpointValue
      const instance = await configuredApp({
        repository,
        readinessMaxLedgerAgeSeconds: 120,
      })
      const response = await instance.inject({ method: 'GET', url: credentialUrl })
      expect(response.statusCode).toBe(503)
      expect(response.json()).toEqual({ error, message })
    },
  )

  it('rejects additional verification properties', async () => {
    const instance = await app()
    const response = await instance.inject({
      method: 'POST',
      url: '/v1/verify',
      payload: {
        network: 'testnet',
        issuer: ISSUER,
        subject: SUBJECT,
        schemaUid: UID,
        unexpected: true,
      },
    })
    expect(response.statusCode).toBe(400)
  })

  it('requires exact credential identifiers and has no account-wide list', async () => {
    const instance = await app()
    const response = await instance.inject({
      method: 'GET',
      url: `/v1/networks/testnet/credentials/${ISSUER}`,
    })
    expect(response.statusCode).toBe(404)
  })

  it('returns the four verification dimensions', async () => {
    const instance = await app()
    const response = await instance.inject({
      method: 'POST',
      url: '/v1/verify',
      payload: { network: 'testnet', issuer: ISSUER, subject: SUBJECT, schemaUid: UID },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      onChain: 'not_found',
      schema: 'unknown',
      payload: 'not_checked',
      issuerTrust: 'unknown',
    })
  })

  it('checks verification network membership inside the authoritative snapshot', async () => {
    const repository = new RouteRepository()
    const snapshot = new RouteRepository()
    let snapshotCalls = 0
    repository.withConsistentSnapshot = async (callback) => {
      snapshotCalls += 1
      return callback(snapshot)
    }
    repository.getNetwork = async () => {
      throw new Error('verification network read escaped the snapshot')
    }
    const instance = await configuredApp({ repository })

    const response = await instance.inject({
      method: 'POST',
      url: '/v1/verify',
      payload: { network: 'testnet', issuer: ISSUER, subject: SUBJECT, schemaUid: UID },
    })

    expect(response.statusCode).toBe(200)
    expect(snapshotCalls).toBe(1)
  })

  it('returns 404 when verification targets a network absent from the snapshot', async () => {
    const instance = await app()
    const response = await instance.inject({
      method: 'POST',
      url: '/v1/verify',
      payload: { network: 'missing', issuer: ISSUER, subject: SUBJECT, schemaUid: UID },
    })

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: 'NETWORK_NOT_FOUND', message: 'Network not found' })
  })

  it('emits CORS headers only for an explicitly allowed origin', async () => {
    const instance = await configuredApp({
      allowedOrigins: ['http://localhost:3000'],
    })
    const allowed = await instance.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'http://localhost:3000' },
    })
    const denied = await instance.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://attacker.example' },
    })
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:3000')
    expect(denied.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('rate limits verification independently from the global budget', async () => {
    const instance = await configuredApp({
      globalRateLimit: 100,
      verifyRateLimit: 1,
    })
    const payload = {
      network: 'testnet',
      issuer: ISSUER,
      subject: SUBJECT,
      schemaUid: UID,
    }
    expect((await instance.inject({ method: 'POST', url: '/v1/verify', payload })).statusCode).toBe(
      200,
    )
    expect((await instance.inject({ method: 'POST', url: '/v1/verify', payload })).statusCode).toBe(
      429,
    )
  })

  it('keeps demo pinning routes absent unless explicitly configured', async () => {
    const instance = await app()
    const response = await instance.inject({
      method: 'POST',
      url: '/v1/pinning/challenges',
      payload: { network: 'testnet', wallet: ISSUER },
    })
    expect(response.statusCode).toBe(404)
  })
})
