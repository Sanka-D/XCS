export { isClassicAddress } from './address.js'
export { canonicalize } from './canonicalize.js'
export { validateClaims } from './claims.js'
export { XCS_ERROR_CODES, XcsError, type XcsErrorCode } from './errors.js'
export { validateNetworkProfile } from './network.js'
export {
  assertSchemaCatalogClosureWithinLimit,
  MAX_SCHEMA_CATALOG_ENTRIES,
  parseSchemaCatalogBundle,
  resolveSchemaCatalogBundle,
  validateSchemaCatalogBundle,
} from './schema-catalog.js'
export { parseVerificationReport } from './verification-report.js'
export { projectCredentialLifecycle } from './lifecycle.js'
export {
  classifyCredentialPayload,
  computePayloadSha256Hex,
  createHttpsPayloadUri,
  createIpfsRawPayloadUri,
  inspectPayloadUri,
  parseCredentialPayload,
  validateCredentialPayload,
  verifyPayloadIntegrity,
} from './payload.js'
export {
  iso8601ToRippleTime,
  RIPPLE_EPOCH_UNIX_SECONDS,
  rippleTimeToIso8601,
  rippleTimeToUnixSeconds,
  unixSecondsToRippleTime,
} from './ripple-time.js'
export { resolveSchema, validateSchema } from './schema.js'
export { sha256, sha256Hex } from './sha256.js'
export { parseJsonStrict } from './strict-json.js'
export type {
  ArrayFieldDescriptor,
  CredentialPayload,
  CredentialPayloadContext,
  CredentialLifecycleInput,
  CredentialLifecycleState,
  FieldDescriptor,
  HttpsPayloadUri,
  IpfsPayloadUri,
  JsonObject,
  JsonPrimitive,
  JsonValue,
  NetworkProfile,
  ObjectFieldDescriptor,
  OnChainVerificationStatus,
  ParsedPayloadUri,
  PayloadIntegrityResult,
  PayloadRetrievalEvidence,
  PayloadVerificationStatus,
  RegisteredSchema,
  ResolvedSchema,
  ScalarFieldDescriptor,
  ScalarFieldType,
  SchemaCatalogBundleV1,
  SchemaCatalogCheckpointV1,
  SchemaCatalogEntryV1,
  SchemaDefinition,
  SchemaResolutionContext,
  SchemaUidInput,
  ResolvedSchemaCatalogBundleV1,
  VerificationReport,
} from './types.js'
export {
  bytesToHex,
  decodeUtf8,
  decodeUtf8Hex,
  encodeUtf8,
  encodeUtf8Hex,
  hexToBytes,
} from './utf8.js'
export { computeSchemaUid } from './uid.js'
