import type { NetworkProfile, ResolvedSchema, SchemaDefinition } from '@xcs-protocol/core'
import type { VerificationDimensions } from '~/utils/credentialReview'
import { exactCredentialEventPath, exactCredentialPath } from '~/utils/transactions'

export interface ApiSchemaSummary {
  uid: string
  name: string
  description: string
  publisher: string
  valid: boolean
}

export interface ApiSchemaDetail extends ApiSchemaSummary {
  definition: SchemaDefinition
  resolved: ResolvedSchema
}

interface SchemaRow {
  schemaUid: string
  name: string
  description: string
  publisher: string
  definition: SchemaDefinition
  resolvedDefinition: ResolvedSchema
}

export type VerificationResponse = VerificationDimensions

export function useXcsApi() {
  const config = useRuntimeConfig()
  const baseURL = import.meta.server ? config.apiBaseUrl : config.public.apiBaseUrl

  function listNetworks() {
    return $fetch<{ items: NetworkProfile[] }>('/v1/networks', { baseURL })
  }

  async function getActiveNetworkProfile(): Promise<NetworkProfile> {
    const response = await listNetworks()
    const configuredProfileId = config.public.profileId.trim()
    const candidates = configuredProfileId
      ? response.items.filter((profile) => profile.profileId === configuredProfileId)
      : response.items.filter((profile) => profile.networkId === 1)

    if (candidates.length === 0) throw new Error('NETWORK_PROFILE_UNAVAILABLE')
    if (candidates.length > 1) throw new Error('NETWORK_PROFILE_AMBIGUOUS')
    const profile = candidates[0]!
    if (profile.networkId !== 1) throw new Error('ALPHA_REQUIRES_XRPL_TESTNET')
    return profile
  }

  async function resolveNetworkId(network?: string): Promise<string> {
    if (network) return network
    return (await getActiveNetworkProfile()).profileId
  }

  async function listSchemas(network?: string) {
    const profileId = await resolveNetworkId(network)
    const response = await $fetch<{ items: SchemaRow[]; nextCursor?: string }>(
      `/v1/networks/${encodeURIComponent(profileId)}/schemas`,
      { baseURL },
    )
    return {
      items: response.items.map((row) => ({
        uid: row.schemaUid,
        name: row.name,
        description: row.description,
        publisher: row.publisher,
        valid: true,
      })),
      ...(response.nextCursor ? { nextCursor: response.nextCursor } : {}),
    }
  }

  async function getSchema(uid: string, network?: string): Promise<ApiSchemaDetail> {
    const profileId = await resolveNetworkId(network)
    const row = await $fetch<SchemaRow>(
      `/v1/networks/${encodeURIComponent(profileId)}/schemas/${encodeURIComponent(uid.toLowerCase())}`,
      { baseURL },
    )
    return {
      uid: row.schemaUid,
      name: row.name,
      description: row.description,
      publisher: row.publisher,
      valid: true,
      definition: row.definition,
      resolved: row.resolvedDefinition,
    }
  }

  function verify(
    input: {
      issuer: string
      subject: string
      schemaUid: string
      resolvePayload?: boolean
      payload?: unknown
    },
    network?: string,
  ) {
    return resolveNetworkId(network).then((profileId) =>
      $fetch<VerificationResponse>('/v1/verify', {
        baseURL,
        method: 'POST',
        body: { network: profileId, ...input, schemaUid: input.schemaUid.toLowerCase() },
      }),
    )
  }

  async function getCredential(
    issuer: string,
    subject: string,
    schemaUid: string,
    network?: string,
  ) {
    const profileId = await resolveNetworkId(network)
    return $fetch<unknown>(exactCredentialPath(profileId, issuer, subject, schemaUid), {
      baseURL,
    })
  }

  async function getCredentialEventByTransaction(
    issuer: string,
    subject: string,
    schemaUid: string,
    transactionHash: string,
    network?: string,
  ) {
    const profileId = await resolveNetworkId(network)
    return $fetch<unknown>(
      exactCredentialEventPath(profileId, issuer, subject, schemaUid, transactionHash),
      {
        baseURL,
        timeout: 5_000,
      },
    )
  }

  return {
    listNetworks,
    getActiveNetworkProfile,
    listSchemas,
    getSchema,
    getCredential,
    getCredentialEventByTransaction,
    verify,
  }
}
