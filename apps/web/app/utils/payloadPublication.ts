export interface PayloadPublicationProof {
  readonly canonicalPayload: string
  readonly credentialUri: string
}

export function payloadPublicationMatches(
  proof: PayloadPublicationProof | null,
  canonicalPayload: string,
  credentialUri: string,
): boolean {
  return (
    proof !== null &&
    canonicalPayload.length > 0 &&
    credentialUri.length > 0 &&
    proof.canonicalPayload === canonicalPayload &&
    proof.credentialUri === credentialUri
  )
}
