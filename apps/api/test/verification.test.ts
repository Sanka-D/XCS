import {
  canonicalize,
  createHttpsPayloadUri,
  type CredentialPayload,
  type ResolvedSchema,
} from '@xcs-protocol/core'
import type {
  CredentialEventRow,
  CredentialGenerationRow,
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
  processedAt: NOW,
}

class VerificationRepository implements ApiRepository {
  constructor(
    private readonly credential: CredentialGenerationRow | undefined,
    private readonly schemaRow: SchemaRow | undefined,
    private readonly checkpointRow: LedgerCheckpointRow | null = checkpoint,
  ) {}

  async ping() {}
  async listNetworks(): Promise<NetworkProfileRow[]> {
    return []
  }
  async getNetwork(): Promise<NetworkProfileRow | undefined> {
    return undefined
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
  async getCredentialEvents(): Promise<CredentialEventRow[]> {
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
})
