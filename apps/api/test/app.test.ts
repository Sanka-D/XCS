import type {
  CredentialEventRow,
  CredentialGenerationRow,
  LedgerCheckpointRow,
  NetworkProfileRow,
  SchemaRow,
} from '@xcs-protocol/db'
import { afterEach, describe, expect, it } from 'vitest'

import { createApi } from '../src/app.js'
import type { ApiRepository } from '../src/types.js'
import { StaticTrustPolicy } from '../src/verification.js'

const UID = 'a'.repeat(64)
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
  processedAt: NOW,
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
const credentialUrl = `/v1/networks/testnet/credentials/${ISSUER}/${SUBJECT}/${UID}`

class RouteRepository implements ApiRepository {
  async ping() {}
  async listNetworks() {
    return [network]
  }
  async getNetwork(profileId: string) {
    return profileId === 'testnet' ? network : undefined
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
  async getCredentialEvents(): Promise<CredentialEventRow[]> {
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
