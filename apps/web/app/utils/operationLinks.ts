const HASH = /^[0-9a-f]{64}$/i
const INVALID_ROUTE_QUERY_VALUE = '__XCS_INVALID_QUERY_VALUE__'

/** Preserves malformed or repeated link constraints as fail-closed values instead of omitting them. */
export function singleRouteQueryValue(input: unknown): string {
  if (input === undefined) return ''
  return typeof input === 'string' && input.length > 0 ? input : INVALID_ROUTE_QUERY_VALUE
}

function normalizedHash(value: string, errorCode: string): string {
  if (!HASH.test(value)) throw new Error(errorCode)
  return value.toLowerCase()
}

function queryPath(path: string, query: Record<string, string>): string {
  return `${path}?${new URLSearchParams(query).toString()}`
}

export function buildCredentialAcceptLink(input: {
  readonly profileId: string
  readonly issuer: string
  readonly schemaUid: string
  readonly generationId: string
}): string {
  return queryPath('/accept', {
    profile: input.profileId,
    issuer: input.issuer,
    schema: normalizedHash(input.schemaUid, 'ACCEPT_LINK_SCHEMA_UID_INVALID'),
    generation: normalizedHash(input.generationId, 'ACCEPT_LINK_GENERATION_INVALID'),
  })
}

export function buildCredentialVerifyLink(input: {
  readonly profileId: string
  readonly issuer: string
  readonly subject: string
  readonly schemaUid: string
  readonly generationId: string
}): string {
  return queryPath('/verify', {
    profile: input.profileId,
    issuer: input.issuer,
    subject: input.subject,
    schema: normalizedHash(input.schemaUid, 'VERIFY_LINK_SCHEMA_UID_INVALID'),
    generation: normalizedHash(input.generationId, 'VERIFY_LINK_GENERATION_INVALID'),
  })
}

export function assertLinkProfile(
  expectedProfileId: string | undefined,
  actualProfileId: string,
): void {
  if (expectedProfileId !== undefined && expectedProfileId !== actualProfileId) {
    throw new Error('CREDENTIAL_LINK_PROFILE_MISMATCH')
  }
}

export function assertLinkGeneration(
  expectedGenerationId: string | undefined,
  actualGenerationId: string,
): void {
  if (
    expectedGenerationId !== undefined &&
    normalizedHash(expectedGenerationId, 'CREDENTIAL_LINK_GENERATION_INVALID') !==
      normalizedHash(actualGenerationId, 'CREDENTIAL_GENERATION_ID_INVALID')
  ) {
    throw new Error('CREDENTIAL_LINK_GENERATION_MISMATCH')
  }
}
