import type { Claims } from '../../lib/db/index.js'
import type { VerificationReport } from '../verification'

export interface RecipientCredential {
  profileId: string
  generationId: string
  schemaUid: string
  schemaName: string | null
  organizationId: string
  organizationName: string
  issuerAddress: string
  subjectAddress: string
  networkId: number
  visibility: 'public' | 'private'
  createdAt: string
  creationTransactionHash: string
  status: {
    state: 'pending' | 'active' | 'expired' | 'deleted' | 'unknown'
    accepted: boolean | null
    expiration: number | null
    deletedLedgerIndex: number | null
    deletionCause: string | null
  }
}
export interface RecipientInvitation {
  id: string
  organizationId: string
  organizationName: string
  profileId: string
  schemaUid: string
  schemaName: string | null
  claimedAt: string
  expiresAt: string
  revokedAt: string | null
  generationId: string | null
}
export interface RecipientNotification {
  id: string
  kind: 'issued' | 'revoked'
  profileId: string
  generationId: string
  organizationName: string
  createdAt: string
}
export interface RecipientWorkspace {
  invitations: RecipientInvitation[]
  credentials: RecipientCredential[]
  notifications: RecipientNotification[]
}
export interface RecipientCredentialDetail extends RecipientCredential {
  disclosure: { publicFields: string[]; fields: string[] }
  events: {
    transactionHash: string
    eventType: 'created' | 'accepted' | 'deleted'
    ledgerIndex: number
    deletionCause: string | null
  }[]
}
export interface Presentation {
  id: string
  profileId: string
  generationId: string
  scope: 'public' | 'full'
  verifierOrganizationId: string | null
  verifierOrganizationName: string | null
  createdAt: string
  revokedAt: string | null
}
export interface CreatePresentationInput {
  profileId: string
  generationId: string
  scope: 'public' | 'full'
  verifierOrganizationId?: string | null
}
export interface CreatedPresentation extends Presentation {
  token: string
  url: string
}
export interface RecipientPayload {
  scope: 'full'
  claims: Claims
  verification: VerificationReport
}
export interface ResolvedPresentation {
  presentation: Presentation
  credential: RecipientCredential
  scope: 'public' | 'full'
  claims: Claims
  verification: VerificationReport
  requiresAuthorization: boolean
}
export class RecipientError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(code)
  }
}
