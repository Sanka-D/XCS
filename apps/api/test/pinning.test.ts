import {
  canonicalize,
  type CredentialPayload,
  type JsonValue,
  type ResolvedSchema,
} from '@xcs-protocol/core'
import type {
  CredentialEventRow,
  CredentialGenerationRow,
  DemoPinRow,
  LedgerCheckpointRow,
  NetworkProfileRow,
  PinChallengeRow,
  SchemaRow,
} from '@xcs-protocol/db'
import { describe, expect, it } from 'vitest'

import { DemoPinningService, PinningError } from '../src/pinning.js'
import type { ApiRepository, ContentPinStore, PinningRepository } from '../src/types.js'

const NOW = new Date('2026-08-19T00:00:00.000Z')
const ISSUER = 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh'
const SUBJECT = 'rLs1MzkFWCxTbuAHgjeTZK4fcCDDnf2KRv'
const UID = 'a'.repeat(64)
const PUBLIC_KEY = `ED${'0'.repeat(64)}`
const SIGNATURE = '0'.repeat(128)

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
  ledgerIndex: 1,
  transactionIndex: 0,
  registeredAt: NOW,
}
const network: NetworkProfileRow = {
  profileId: 'testnet',
  xcsVersion: '0.1',
  networkId: 1,
  requiredAmendment: 'c'.repeat(64),
  registryAddress: ISSUER,
  registrationAmountDrops: 1,
  activationLedgerIndex: 1,
  activationLedgerHash: 'd'.repeat(64),
  enabled: true,
  createdAt: NOW,
}

class FakeApiRepository implements ApiRepository {
  constructor(private readonly configuredNetwork: NetworkProfileRow = network) {}

  async ping() {}
  async listNetworks() {
    return [this.configuredNetwork]
  }
  async getNetwork(profileId: string) {
    return profileId === 'testnet' ? this.configuredNetwork : undefined
  }
  async getLatestCheckpoint(): Promise<LedgerCheckpointRow | undefined> {
    return undefined
  }
  async getSchema(_profileId: string, uid: string) {
    return uid === UID ? schema : undefined
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

class FakePinningRepository implements PinningRepository {
  challenge: PinChallengeRow | undefined
  pin: DemoPinRow | undefined
  deletedChallenges = 0
  attempts = 0
  async createChallenge(input: Parameters<PinningRepository['createChallenge']>[0]) {
    this.challenge = { ...input, usedAt: null, createdAt: NOW }
    return this.challenge
  }
  async getChallenge() {
    return this.challenge
  }
  async reservePin(input: Parameters<PinningRepository['reservePin']>[0]) {
    if (this.challenge?.usedAt !== null) throw new PinningError('CHALLENGE_USED', 409)
    if (this.challenge === undefined) throw new PinningError('CHALLENGE_NOT_FOUND', 404)
    if (this.attempts >= input.dailyLimit) {
      throw new PinningError('WALLET_QUOTA_EXCEEDED', 429)
    }
    this.attempts += 1
    this.challenge.usedAt = input.now
    this.pin = {
      pinId: input.pinId,
      challengeId: input.challengeId,
      profileId: input.profileId,
      wallet: input.wallet,
      requesterIpHash: input.requesterIpHash,
      cid: input.cid,
      byteLength: input.byteLength,
      status: 'pending',
      failureCode: null,
      expiresAt: input.expiresAt,
      unpinnedAt: null,
      createdAt: input.now,
      updatedAt: input.now,
    }
    return this.pin
  }
  async markPinned(_pinId: string, now: Date) {
    if (this.pin !== undefined) {
      this.pin.status = 'pinned'
      this.pin.updatedAt = now
    }
  }
  async markFailed(_pinId: string, failureCode: string, now: Date) {
    if (this.pin !== undefined) {
      this.pin.status = 'failed'
      this.pin.failureCode = failureCode
      this.pin.updatedAt = now
    }
  }
  async findExpiredPins(): Promise<DemoPinRow[]> {
    return []
  }
  async hasOtherActivePin(): Promise<boolean> {
    return false
  }
  async markUnpinned() {}
  async deleteExpiredUnreferencedChallenges() {
    this.deletedChallenges += 1
    return 1
  }
}

class FakeStore implements ContentPinStore {
  cid: string | undefined
  constructor(private readonly fail = false) {}
  async putRaw(_content: Uint8Array, expectedCid: string) {
    if (this.fail) throw new Error('Kubo unavailable')
    this.cid = expectedCid
  }
  async unpin() {}
}

function service(options: { storeFails?: boolean; networkId?: number } = {}) {
  const repository = new FakePinningRepository()
  const store = new FakeStore(options.storeFails)
  return {
    repository,
    store,
    service: new DemoPinningService({
      repository,
      apiRepository: new FakeApiRepository({ ...network, networkId: options.networkId ?? 1 }),
      store,
      ipHashSecret: 'x'.repeat(32),
      enabledNetworks: new Set(['testnet']),
      now: () => new Date(NOW),
      verifyWalletSignature: () => true,
    }),
  }
}

function validPayloadBase64(): string {
  const payload: CredentialPayload = {
    xcsVersion: '0.1',
    issuer: ISSUER,
    subject: SUBJECT,
    schema: UID,
    claims: { programId: 'xrpl-101' },
  }
  return Buffer.from(canonicalize(payload as JsonValue)).toString('base64')
}

describe('demo pinning', () => {
  it('refuses pinning on a non-Testnet network even if it is configured', async () => {
    const fixture = service({ networkId: 0 })
    await expect(
      fixture.service.createChallenge({
        network: 'testnet',
        wallet: ISSUER,
        ipAddress: '203.0.113.42',
      }),
    ).rejects.toMatchObject({ code: 'PINNING_NETWORK_DISABLED', statusCode: 404 })
  })

  it('stores only an HMAC of the requester IP in a one-shot challenge', async () => {
    const fixture = service()
    const challenge = await fixture.service.createChallenge({
      network: 'testnet',
      wallet: ISSUER,
      ipAddress: '203.0.113.42',
    })
    expect(challenge.message).toContain(`wallet:${ISSUER}`)
    expect(fixture.repository.challenge?.requesterIpHash).toMatch(/^[0-9a-f]{64}$/)
    expect(fixture.repository.challenge?.requesterIpHash).not.toContain('203.0.113.42')
  })

  it('pins canonical payload bytes as a CIDv1 raw block for 90 days', async () => {
    const fixture = service()
    const challenge = await fixture.service.createChallenge({
      network: 'testnet',
      wallet: ISSUER,
      ipAddress: '203.0.113.42',
    })
    const result = await fixture.service.pin({
      network: 'testnet',
      wallet: ISSUER,
      challengeId: challenge.challengeId,
      publicKey: PUBLIC_KEY,
      signature: SIGNATURE,
      payloadBase64: validPayloadBase64(),
      ipAddress: '203.0.113.42',
    })
    expect(result.uri).toMatch(/^ipfs:\/\/b[a-z2-7]+$/)
    expect(fixture.store.cid).toBe(result.cid)
    expect(fixture.repository.pin?.status).toBe('pinned')
    expect(Date.parse(result.expiresAt) - NOW.getTime()).toBe(90 * 24 * 60 * 60 * 1_000)
  })

  it('rejects a payload over the 64 KiB demo limit before storage', async () => {
    const fixture = service()
    const challenge = await fixture.service.createChallenge({
      network: 'testnet',
      wallet: ISSUER,
      ipAddress: '203.0.113.42',
    })
    await expect(
      fixture.service.pin({
        network: 'testnet',
        wallet: ISSUER,
        challengeId: challenge.challengeId,
        publicKey: PUBLIC_KEY,
        signature: SIGNATURE,
        payloadBase64: Buffer.alloc(65 * 1024, 1).toString('base64'),
        ipAddress: '203.0.113.42',
      }),
    ).rejects.toMatchObject({ code: 'PAYLOAD_SIZE_INVALID', statusCode: 413 })
  })

  it('runs bounded expired-challenge cleanup from the pin janitor', async () => {
    const fixture = service()
    await fixture.service.unpinExpired()
    expect(fixture.repository.deletedChallenges).toBe(1)
  })

  it('counts failed Kubo writes toward the daily attempt quota', async () => {
    const fixture = service({ storeFails: true })
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const challenge = await fixture.service.createChallenge({
        network: 'testnet',
        wallet: ISSUER,
        ipAddress: '203.0.113.42',
      })
      await expect(
        fixture.service.pin({
          network: 'testnet',
          wallet: ISSUER,
          challengeId: challenge.challengeId,
          publicKey: PUBLIC_KEY,
          signature: SIGNATURE,
          payloadBase64: validPayloadBase64(),
          ipAddress: '203.0.113.42',
        }),
      ).rejects.toMatchObject({ code: 'PIN_STORE_UNAVAILABLE' })
    }

    const challenge = await fixture.service.createChallenge({
      network: 'testnet',
      wallet: ISSUER,
      ipAddress: '203.0.113.42',
    })
    await expect(
      fixture.service.pin({
        network: 'testnet',
        wallet: ISSUER,
        challengeId: challenge.challengeId,
        publicKey: PUBLIC_KEY,
        signature: SIGNATURE,
        payloadBase64: validPayloadBase64(),
        ipAddress: '203.0.113.42',
      }),
    ).rejects.toMatchObject({ code: 'WALLET_QUOTA_EXCEEDED', statusCode: 429 })
  })
})
