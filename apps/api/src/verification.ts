import {
  canonicalize,
  decodeUtf8Hex,
  parseCredentialPayload,
  validateCredentialPayload,
  validateSchema,
  verifyPayloadIntegrity,
  XcsError,
  type JsonValue,
  type ResolvedSchema,
  type VerificationReport,
} from '@xcs-protocol/core'
import type { CredentialGenerationRow, SchemaRow } from '@xcs-protocol/db'

import { DEFAULT_LEDGER_MAX_AGE_SECONDS } from './ledger-freshness.js'
import { assertAuthoritativeLedgerEvidence, assertIndexerReady } from './indexer-status.js'
import { PayloadUnavailableError } from './payload-resolver.js'
import type { ApiRepository, PayloadResolver, TrustPolicy } from './types.js'

export interface VerifyRequest {
  network: string
  issuer: string
  subject: string
  schemaUid: string
  payload?: unknown
  resolvePayload?: boolean
}

export class VerificationNetworkNotFoundError extends Error {
  readonly code = 'NETWORK_NOT_FOUND'
  readonly statusCode = 404

  constructor() {
    super('Network not found')
    this.name = 'VerificationNetworkNotFoundError'
  }
}

function onChainStatus(
  generation: CredentialGenerationRow | undefined,
  closeTime: number | undefined,
): VerificationReport['onChain'] {
  if (generation === undefined) return 'not_found'
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

function resolvedSchema(row: SchemaRow): ResolvedSchema {
  validateSchema(row.definition)
  const value: unknown = row.resolvedDefinition
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Resolved schema projection is invalid')
  }
  const candidate = value as Partial<ResolvedSchema>
  if (
    typeof candidate.definition !== 'object' ||
    candidate.definition === null ||
    typeof candidate.fields !== 'object' ||
    candidate.fields === null ||
    !Array.isArray(candidate.lineage)
  ) {
    throw new Error('Resolved schema projection is invalid')
  }
  return candidate as ResolvedSchema
}

function decodeCredentialUri(generation: CredentialGenerationRow): string | undefined {
  if (generation.uriHex === null) return undefined
  try {
    return decodeUtf8Hex(generation.uriHex)
  } catch {
    return undefined
  }
}

async function payloadStatus(input: {
  request: VerifyRequest
  generation: CredentialGenerationRow | undefined
  schema: ResolvedSchema | undefined
  resolver: PayloadResolver
}): Promise<VerificationReport['payload']> {
  const { request, generation, schema, resolver } = input
  if (request.payload === undefined && request.resolvePayload !== true) return 'not_checked'
  if (generation === undefined || schema === undefined) return 'invalid'
  const uri = decodeCredentialUri(generation)
  if (uri === undefined) return 'invalid'

  const context = {
    issuer: request.issuer,
    subject: request.subject,
    schemaUid: request.schemaUid,
    schema,
  }

  try {
    let content: string | Uint8Array
    if (request.payload !== undefined) {
      const validated = validateCredentialPayload(request.payload, context)
      content = canonicalize(validated as JsonValue)
    } else {
      content = await resolver.resolve(uri)
      parseCredentialPayload(content, context)
    }
    const integrity = verifyPayloadIntegrity(content, uri)
    if (integrity.status === 'tampered') return 'tampered'
    if (integrity.status === 'invalid_uri') return 'invalid'
    return 'valid'
  } catch (error) {
    if (error instanceof PayloadUnavailableError) return 'unavailable'
    if (error instanceof XcsError) return 'invalid'
    return 'invalid'
  }
}

export async function verifyCredential(
  request: VerifyRequest,
  dependencies: {
    repository: ApiRepository
    resolver: PayloadResolver
    trustPolicy: TrustPolicy
    maxLedgerAgeSeconds?: number
    now?: () => Date
  },
): Promise<VerificationReport> {
  const { generation, schemaRow, checkpoint } =
    await dependencies.repository.withConsistentSnapshot(async (repository) => {
      const network = await repository.getNetwork(request.network)
      if (network === undefined) throw new VerificationNetworkNotFoundError()

      const now = dependencies.now?.() ?? (await repository.getDatabaseTime())
      const status = await repository.getIndexerStatus(request.network)
      assertIndexerReady(status, now)

      const [generation, schemaRow] = await Promise.all([
        repository.getCredential({
          profileId: request.network,
          issuer: request.issuer,
          subject: request.subject,
          schemaUid: request.schemaUid,
        }),
        repository.getSchema(request.network, request.schemaUid),
      ])
      const checkpoint = await repository.getLatestCheckpoint(request.network)
      const evidence = {
        expectedProfileId: request.network,
        status,
        checkpoint,
        now,
        maxLedgerAgeSeconds: dependencies.maxLedgerAgeSeconds ?? DEFAULT_LEDGER_MAX_AGE_SECONDS,
        projectionLedgerIndexes: [
          ...(generation === undefined ? [] : [generation.lastLedgerIndex]),
          ...(schemaRow === undefined ? [] : [schemaRow.ledgerIndex]),
        ],
      }
      assertAuthoritativeLedgerEvidence(evidence)
      return { generation, schemaRow, checkpoint: evidence.checkpoint }
    })

  let schema: ResolvedSchema | undefined
  let schemaStatus: VerificationReport['schema'] = 'unknown'
  if (schemaRow !== undefined) {
    try {
      schema = resolvedSchema(schemaRow)
      schemaStatus = 'valid'
    } catch {
      schemaStatus = 'invalid'
    }
  }

  const report: VerificationReport = {
    onChain: onChainStatus(generation, checkpoint.closeTime),
    schema: schemaStatus,
    payload: await payloadStatus({ request, generation, schema, resolver: dependencies.resolver }),
    issuerTrust: dependencies.trustPolicy.evaluate(request.issuer),
    ...(generation === undefined ? {} : { generationId: generation.generationId }),
  }
  return report
}

export class StaticTrustPolicy implements TrustPolicy {
  private readonly trusted: ReadonlySet<string>
  private readonly untrusted: ReadonlySet<string>

  constructor(input: { trusted?: Iterable<string>; untrusted?: Iterable<string> } = {}) {
    this.trusted = new Set(input.trusted ?? [])
    this.untrusted = new Set(input.untrusted ?? [])
  }

  evaluate(issuer: string): 'trusted' | 'untrusted' | 'unknown' {
    if (this.untrusted.has(issuer)) return 'untrusted'
    if (this.trusted.has(issuer)) return 'trusted'
    return 'unknown'
  }
}
