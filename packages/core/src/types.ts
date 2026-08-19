export type JsonPrimitive = string | number | boolean | null

export type JsonValue = JsonPrimitive | JsonObject | JsonValue[]

export interface JsonObject {
  [key: string]: JsonValue
}

export interface NetworkProfile {
  profileId: string
  xcsVersion: '0.1'
  networkId: number
  requiredAmendment: string
  registryAddress: string
  registrationAmountDrops: '1'
  activationLedgerIndex: number
  activationLedgerHash: string
}

interface FieldBase {
  optional?: boolean
}

export type ScalarFieldType = 'string' | 'bool' | 'uint' | 'int' | 'bytes' | 'address'

export interface ScalarFieldDescriptor extends FieldBase {
  type: ScalarFieldType
}

export interface ArrayFieldDescriptor extends FieldBase {
  type: 'array'
  items: FieldDescriptor
}

export interface ObjectFieldDescriptor extends FieldBase {
  type: 'object'
  fields: Record<string, FieldDescriptor>
}

export type FieldDescriptor = ScalarFieldDescriptor | ArrayFieldDescriptor | ObjectFieldDescriptor

export interface SchemaDefinition {
  xcsVersion: '0.1'
  name: string
  description: string
  extends?: string
  supersedes?: string
  fields: Record<string, FieldDescriptor>
}

export interface RegisteredSchema {
  uid: string
  definition: SchemaDefinition
  publisher: string
  networkId: number
  ledgerIndex: number
  transactionIndex: number
}

export interface SchemaResolutionContext {
  networkId: number
  publisher: string
  ledgerIndex: number
  transactionIndex: number
  getSchema: (uid: string) => RegisteredSchema | undefined
}

export interface ResolvedSchema {
  definition: SchemaDefinition
  fields: Record<string, FieldDescriptor>
  /** Parent UIDs ordered from the root to the direct parent. */
  lineage: string[]
}

export interface SchemaUidInput {
  networkId: number
  ledgerHash: string
  ledgerIndex: number
  transactionIndex: number
  publisher: string
  schema: SchemaDefinition
}

export interface CredentialPayload extends JsonObject {
  xcsVersion: '0.1'
  issuer: string
  subject: string
  schema: string
  claims: JsonObject
}

export interface CredentialPayloadContext {
  issuer: string
  subject: string
  schemaUid: string
  schema: ResolvedSchema | Record<string, FieldDescriptor>
}

export type OnChainVerificationStatus = 'pending' | 'active' | 'expired' | 'deleted' | 'not_found'

export interface VerificationReport {
  onChain: OnChainVerificationStatus
  schema: 'valid' | 'invalid' | 'unknown'
  payload: 'valid' | 'unavailable' | 'tampered' | 'invalid' | 'not_checked'
  issuerTrust: 'trusted' | 'untrusted' | 'unknown'
  generationId?: string
}

export interface IpfsPayloadUri {
  kind: 'ipfs'
  uri: string
  cid: string
  digestHex: string
}

export interface HttpsPayloadUri {
  kind: 'https'
  uri: string
  fetchUrl: string
  digestHex: string
}

export type ParsedPayloadUri = IpfsPayloadUri | HttpsPayloadUri

export interface PayloadIntegrityResult {
  status: 'valid' | 'tampered' | 'invalid_uri'
  expectedDigestHex?: string
  actualDigestHex: string
}
