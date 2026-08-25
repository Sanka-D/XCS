import type {
  CredentialEventRow,
  CredentialGenerationRow,
  DemoPinRow,
  IndexerStatusRow,
  LedgerCheckpointRow,
  NetworkProfileRow,
  PinChallengeRow,
  SchemaRow,
} from '@xcs-protocol/db'

export interface SchemaCursor {
  ledgerIndex: number
  transactionIndex: number
  schemaUid: string
}

export interface SchemaPage {
  items: SchemaRow[]
  nextCursor?: string
}

export interface ApiRepository {
  withConsistentSnapshot<T>(callback: (repository: ApiRepository) => Promise<T>): Promise<T>
  getDatabaseTime(): Promise<Date>
  ping(): Promise<void>
  listNetworks(): Promise<NetworkProfileRow[]>
  getNetwork(profileId: string): Promise<NetworkProfileRow | undefined>
  getIndexerStatus(profileId: string): Promise<IndexerStatusRow | undefined>
  getLatestCheckpoint(profileId: string): Promise<LedgerCheckpointRow | undefined>
  getSchema(profileId: string, schemaUid: string): Promise<SchemaRow | undefined>
  listSchemas(input: {
    profileId: string
    publisher?: string
    cursor?: SchemaCursor
    limit: number
  }): Promise<SchemaRow[]>
  getCredential(input: {
    profileId: string
    issuer: string
    subject: string
    schemaUid: string
  }): Promise<CredentialGenerationRow | undefined>
  getCredentialEvents(input: {
    profileId: string
    issuer: string
    subject: string
    schemaUid: string
    limit: number
  }): Promise<CredentialEventRow[]>
  getCredentialEventsByTransaction(input: {
    profileId: string
    transactionHash: string
    issuer: string
    subject: string
    schemaUid: string
    limit: number
  }): Promise<CredentialEventRow[]>
}

export interface PayloadResolver {
  resolve(uri: string): Promise<Uint8Array>
}

export interface TrustPolicy {
  evaluate(issuer: string): 'trusted' | 'untrusted' | 'unknown'
}

export interface PinningRepository {
  createChallenge(input: {
    challengeId: string
    profileId: string
    wallet: string
    requesterIpHash: string
    message: string
    expiresAt: Date
  }): Promise<PinChallengeRow>
  getChallenge(challengeId: string): Promise<PinChallengeRow | undefined>
  reservePin(input: {
    pinId: string
    challengeId: string
    profileId: string
    wallet: string
    requesterIpHash: string
    cid: string
    byteLength: number
    expiresAt: Date
    now: Date
    dailyLimit: number
  }): Promise<DemoPinRow>
  markPinned(pinId: string, now: Date): Promise<void>
  markFailed(pinId: string, failureCode: string, now: Date): Promise<void>
  findExpiredPins(now: Date, limit: number): Promise<DemoPinRow[]>
  hasOtherActivePin(cid: string, excludingPinId: string, now: Date): Promise<boolean>
  markUnpinned(pinId: string, now: Date): Promise<void>
  deleteExpiredUnreferencedChallenges(now: Date, limit: number): Promise<number>
}

export interface ContentPinStore {
  putRaw(content: Uint8Array, expectedCid: string): Promise<void>
  unpin(cid: string): Promise<void>
}
