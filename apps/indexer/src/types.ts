import type {
  NetworkProfile,
  RegisteredSchema,
  ResolvedSchema,
  SchemaDefinition,
} from '@xcs-protocol/core'

export type { NetworkProfile, RegisteredSchema, ResolvedSchema, SchemaDefinition }

export interface LedgerTransaction {
  hash: string
  transaction: Record<string, unknown>
  metadata: Record<string, unknown>
  transactionIndex: number
}

export interface ValidatedLedger {
  ledgerIndex: number
  ledgerHash: string
  parentHash: string
  closeTime: number
  transactions: LedgerTransaction[]
}

export type SchemaRegistrationResult =
  | {
      status: 'accepted'
      transactionHash: string
      transactionIndex: number
      publisher: string
      schemaUid: string
      definition: SchemaDefinition
      resolved: ResolvedSchema
    }
  | {
      status: 'rejected'
      transactionHash: string
      transactionIndex: number
      publisher: string
      reasonCode: string
      memoJson?: unknown
    }

export type CredentialEventType = 'created' | 'accepted' | 'deleted'

export type CredentialDeletionCause =
  | 'issuer_revoked'
  | 'subject_rejected'
  | 'subject_removed'
  | 'expired_cleanup'
  | 'account_deleted'
  | 'self_deleted'

export interface CredentialMutation {
  transactionHash: string
  transactionIndex: number
  nodeIndex: number
  ledgerObjectId: string
  eventType: CredentialEventType
  issuer: string
  subject: string
  schemaUid: string
  uriHex?: string
  expiration?: number
  accepted: boolean
  deletionCause?: CredentialDeletionCause
  snapshot: Record<string, unknown>
}

export interface ExtractedCredentialMutations {
  mutations: CredentialMutation[]
  malformedCredentialNodes: number
}

export interface LedgerProjection {
  ledger: ValidatedLedger
  schemaRegistrations: SchemaRegistrationResult[]
  credentialMutations: CredentialMutation[]
  malformedCredentialNodes: number
}

export interface Checkpoint {
  ledgerIndex: number
  ledgerHash: string
  parentHash: string
  closeTime: number
}

export interface SchemaCatalogEntry extends RegisteredSchema {
  resolved: ResolvedSchema
  description: string
  name: string
  transactionHash: string
}

export interface IndexerRepository {
  getLastCheckpoint(profileId: string): Promise<Checkpoint | undefined>
  getSchemaCatalog(profileId: string): Promise<SchemaCatalogEntry[]>
  persistLedger(
    profile: NetworkProfile,
    projection: LedgerProjection,
  ): Promise<'inserted' | 'already_processed'>
}

export interface LedgerSource {
  connect(): Promise<void>
  disconnect(): Promise<void>
  assertAmendmentEnabled(amendmentId: string): Promise<void>
  getValidatedLedgerIndex(): Promise<number>
  getLedger(ledgerIndex: number): Promise<ValidatedLedger>
}
