import {
  canonicalize,
  createHttpsPayloadUri,
  type CredentialPayload,
  type ResolvedSchema,
} from '@xcs-protocol/core'
import type {
  CredentialEventRow,
  CredentialGenerationRow,
  IndexerStatusRow,
  LedgerCheckpointRow,
  NetworkProfileRow,
  SchemaRow,
} from '@xcs-protocol/db'
import { describe, expect, it } from 'vitest'

import { DisabledPayloadResolver, PayloadUnavailableError } from '../src/payload-resolver.js'
import type { ApiRepository, PayloadResolver } from '../src/types.js'
import { StaticTrustPolicy, verifyCredential } from '../src/verification.js'

const UID = 'a'.repeat(64)
const ISSUER = 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh'
const SUBJECT = 'rLs1MzkFWCxTbuAHgjeTZK4fcCDDnf2KRv'
const NOW = new Date('2026-08-19T00:00:00.000Z')
const NOW_RIPPLE = Math.floor(NOW.getTime() / 1_000) - 946_684_800
const FRESHNESS = {
  now: () => NOW,
  maxLedgerAgeSeconds: 120,
} as const

const payload: CredentialPayload = {
  xcsVersion: '0.1',
  issuer: ISSUER,
  subject: SUBJECT,
  schema: UID,
  claims: { programId: 'xrpl-101' },
}
const payloadText = canonicalize(payload)
const uri = createHttpsPayloadUri('https://issuer.example/credential.json', payloadText)

const resolved: ResolvedSchema = {
  definition: {
    xcsVersion: '0.1',
    name: 'Completion',
    description: 'Course completion',
    fields: { programId: { type: 'string' } },
  },
  fields: { programId: { type: 'string' } },
  lineage: [],
}

const schema: SchemaRow = {
  profileId: 'testnet',
  schemaUid: UID,
  publisher: ISSUER,
  name: 'Completion',
  description: 'Course completion',
  parentUid: null,
  supersedesUid: null,
  definition: resolved.definition as unknown as Record<string, unknown>,
  resolvedDefinition: resolved as unknown as Record<string, unknown>,
  registrationTransactionHash: 'b'.repeat(64),
  ledgerIndex: 100,
  transactionIndex: 0,
  registeredAt: NOW,
}

const generation: CredentialGenerationRow = {
  profileId: 'testnet',
  generationId: 'c'.repeat(64),
  ledgerObjectId: 'd'.repeat(64),
  issuer: ISSUER,
  subject: SUBJECT,
  schemaUid: UID,
  uriHex: Buffer.from(uri, 'utf8').toString('hex'),
  expiration: null,
  accepted: true,
  createdLedgerIndex: 101,
  createdTransactionIndex: 0,
  lastLedgerIndex: 102,
  deletedLedgerIndex: null,
  deletionCause: null,
  createdAt: NOW,
  updatedAt: NOW,
}

const checkpoint: LedgerCheckpointRow = {
  profileId: 'testnet',
  ledgerIndex: 102,
  ledgerHash: 'e'.repeat(64),
  parentHash: 'f'.repeat(64),
  closeTime: NOW_RIPPLE - 10,
  transactionCount: 0,
  transactionRoot: '1'.repeat(64),
  processedAt: NOW,
}
const readyStatus: IndexerStatusRow = {
  profileId: 'testnet',
  state: 'ready',
  primarySourceTip: 102,
  secondarySourceTip: 102,
  lastAgreedLedgerIndex: 102,
  lastAgreedLedgerHash: checkpoint.ledgerHash,
  errorCode: null,
  writerId: 'writer-1',
  writerEpoch: 1,
  leaseExpiresAt: new Date(NOW.getTime() + 60_000),
  updatedAt: NOW,
}
const network: NetworkProfileRow = {
  profileId: 'testnet',
  xcsVersion: '0.1',
  networkId: 1,
  requiredAmendment: '2'.repeat(64),
  registryAddress: ISSUER,
  registrationAmountDrops: 1,
  activationLedgerIndex: 1,
  activationLedgerHash: '3'.repeat(64),
  enabled: true,
  createdAt: NOW,
}

class VerificationRepository implements ApiRepository {
  snapshotCalls = 0

  constructor(
    private readonly credential: CredentialGenerationRow | undefined,
    private readonly schemaRow: SchemaRow | undefined,
    private readonly checkpointRow: LedgerCheckpointRow | null = checkpoint,
    private readonly statusRow: IndexerStatusRow | null = readyStatus,
  ) {}

  async withConsistentSnapshot<T>(callback: (repository: ApiRepository) => Promise<T>): Promise<T> {
    this.snapshotCalls += 1
    return callback(this)
  }
  async getDatabaseTime() {
    return NOW
  }
  async ping() {}
  async listNetworks(): Promise<NetworkProfileRow[]> {
    return []
  }
  async getNetwork(profileId: string): Promise<NetworkProfileRow | undefined> {
    return profileId === network.profileId ? network : undefined
  }
  async getIndexerStatus() {
    return this.statusRow ?? undefined
  }
  async getLatestCheckpoint() {
    return this.checkpointRow ?? undefined
  }
  async getSchema() {
    return this.schemaRow
  }
  async listSchemas(): Promise<SchemaRow[]> {
    return []
  }
  async getCredential() {
    return this.credential
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

const neverResolver: PayloadResolver = {
  resolve: async () => {
    throw new Error('resolver should not be called')
  },
}

const request = {
  network: 'testnet',
  issuer: ISSUER,
  subject: SUBJECT,
  schemaUid: UID,
}

describe('verifyCredential', () => {
  it('reads projections and authority evidence from one repository snapshot', async () => {
    const repository = new VerificationRepository(generation, schema)

    await verifyCredential(request, {
      repository,
      resolver: neverResolver,
      trustPolicy: new StaticTrustPolicy(),
      ...FRESHNESS,
    })

    expect(repository.snapshotCalls).toBe(1)
  })

  it('rejects a missing network from inside the same repository snapshot', async () => {
    const repository = new VerificationRepository(generation, schema)

    await expect(
      verifyCredential(
        { ...request, network: 'missing' },
        {
          repository,
          resolver: neverResolver,
          trustPolicy: new StaticTrustPolicy(),
          ...FRESHNESS,
        },
      ),
    ).rejects.toMatchObject({ code: 'NETWORK_NOT_FOUND', statusCode: 404 })
    expect(repository.snapshotCalls).toBe(1)
  })

  it('reports independent on-chain, schema, payload and trust results', async () => {
    await expect(
      verifyCredential(
        { ...request, payload },
        {
          repository: new VerificationRepository(generation, schema),
          resolver: neverResolver,
          trustPolicy: new StaticTrustPolicy({ trusted: [ISSUER] }),
          ...FRESHNESS,
        },
      ),
    ).resolves.toEqual({
      onChain: 'active',
      schema: 'valid',
      payload: 'valid',
      issuerTrust: 'trusted',
      generationId: generation.generationId,
    })
  })

  it('distinguishes a valid payload whose digest was changed', async () => {
    const changed = {
      ...payload,
      claims: { programId: 'different' },
    }
    const report = await verifyCredential(
      { ...request, payload: changed },
      {
        repository: new VerificationRepository(generation, schema),
        resolver: neverResolver,
        trustPolicy: new StaticTrustPolicy(),
        ...FRESHNESS,
      },
    )
    expect(report.payload).toBe('tampered')
  })

  it('reports an unreachable resolved payload as unavailable', async () => {
    const report = await verifyCredential(
      { ...request, resolvePayload: true },
      {
        repository: new VerificationRepository(generation, schema),
        resolver: {
          resolve: async () => {
            throw new PayloadUnavailableError('offline')
          },
        },
        trustPolicy: new StaticTrustPolicy(),
        ...FRESHNESS,
      },
    )
    expect(report.payload).toBe('unavailable')
  })

  it('fails closed without network access when server-side fetching is disabled', async () => {
    const report = await verifyCredential(
      { ...request, resolvePayload: true },
      {
        repository: new VerificationRepository(generation, schema),
        resolver: new DisabledPayloadResolver(),
        trustPolicy: new StaticTrustPolicy(),
        ...FRESHNESS,
      },
    )
    expect(report.payload).toBe('unavailable')
  })

  it('reports not_found without collapsing the other dimensions', async () => {
    const report = await verifyCredential(request, {
      repository: new VerificationRepository(undefined, schema),
      resolver: neverResolver,
      trustPolicy: new StaticTrustPolicy(),
      ...FRESHNESS,
    })
    expect(report).toMatchObject({
      onChain: 'not_found',
      schema: 'valid',
      payload: 'not_checked',
      issuerTrust: 'unknown',
    })
  })

  it.each([
    ['stale', NOW_RIPPLE - 121],
    ['too far in the future', NOW_RIPPLE + 31],
  ])('fails closed when the indexed proof is %s', async (_label, closeTime) => {
    const repository = new VerificationRepository(generation, schema, {
      ...checkpoint,
      closeTime,
    })
    await expect(
      verifyCredential(
        { ...request, resolvePayload: true },
        {
          repository,
          resolver: neverResolver,
          trustPolicy: new StaticTrustPolicy(),
          ...FRESHNESS,
        },
      ),
    ).rejects.toMatchObject({ code: 'INDEXER_STALE', statusCode: 503 })
  })

  it('fails closed when the indexer has no checkpoint', async () => {
    await expect(
      verifyCredential(request, {
        repository: new VerificationRepository(generation, schema, null),
        resolver: neverResolver,
        trustPolicy: new StaticTrustPolicy(),
        ...FRESHNESS,
      }),
    ).rejects.toMatchObject({ code: 'INDEXER_NOT_INITIALIZED', statusCode: 503 })
  })

  it.each([
    ['missing', null, 'INDEXER_STATUS_UNAVAILABLE'],
    ['starting', { ...readyStatus, state: 'starting' as const }, 'INDEXER_NOT_READY'],
    ['catching up', { ...readyStatus, state: 'catching_up' as const }, 'INDEXER_NOT_READY'],
    [
      'halted',
      { ...readyStatus, state: 'halted' as const, errorCode: 'LEDGER_SOURCE_DIVERGENCE' },
      'INDEXER_HALTED',
    ],
  ])('fails closed before verification when durable status is %s', async (_label, status, code) => {
    const repository = new VerificationRepository(generation, schema, checkpoint, status)
    await expect(
      verifyCredential(request, {
        repository,
        resolver: neverResolver,
        trustPolicy: new StaticTrustPolicy(),
        ...FRESHNESS,
      }),
    ).rejects.toMatchObject({ code, statusCode: 503 })
  })
})
