import { isClassicAddress } from './address.js'
import { fail } from './errors.js'
import { validateNetworkProfile } from './network.js'
import { resolveSchema, validateSchema } from './schema.js'
import { parseJsonStrict } from './strict-json.js'
import type {
  RegisteredSchema,
  ResolvedSchema,
  ResolvedSchemaCatalogBundleV1,
  SchemaCatalogBundleV1,
  SchemaCatalogCheckpointV1,
  SchemaCatalogEntryV1,
} from './types.js'
import { computeSchemaUid } from './uid.js'

/** Maximum number of unique schemas in one target's combined relation closure. */
export const MAX_SCHEMA_CATALOG_ENTRIES = 256

const BUNDLE_KEYS = new Set(['format', 'profile', 'targetUid', 'checkpoint', 'schemas'])
const CHECKPOINT_KEYS = new Set(['ledgerIndex', 'ledgerHash'])
const ENTRY_KEYS = new Set([
  'uid',
  'definition',
  'publisher',
  'ledgerIndex',
  'ledgerHash',
  'transactionIndex',
  'transactionHash',
])
const LOWERCASE_HASH = /^[0-9a-f]{64}$/u

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isUint32(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 0xffff_ffff
}

function normalizeUint32(value: number): number {
  return value === 0 ? 0 : value
}

function requireObject(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) {
    return fail('SCHEMA_CATALOG_INVALID', 'Expected an object', path)
  }
  return value
}

function assertOnlyKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      fail('SCHEMA_CATALOG_INVALID', `Unknown catalog property ${key}`, `${path}.${key}`)
    }
  }
}

function requireLowercaseHash(value: unknown, path: string): string {
  if (typeof value !== 'string' || !LOWERCASE_HASH.test(value)) {
    return fail('SCHEMA_CATALOG_INVALID', 'Expected a lowercase 32-byte hexadecimal hash', path)
  }
  return value
}

function validateCheckpoint(
  input: unknown,
  activationLedgerIndex: number,
  activationLedgerHash: string,
): SchemaCatalogCheckpointV1 {
  const value = requireObject(input, '$.checkpoint')
  assertOnlyKeys(value, CHECKPOINT_KEYS, '$.checkpoint')
  if (!isUint32(value.ledgerIndex) || value.ledgerIndex < activationLedgerIndex) {
    return fail(
      'SCHEMA_CATALOG_INVALID',
      'checkpoint ledgerIndex must be a uint32 at or after profile activation',
      '$.checkpoint.ledgerIndex',
    )
  }
  const ledgerIndex = normalizeUint32(value.ledgerIndex)
  const ledgerHash = requireLowercaseHash(value.ledgerHash, '$.checkpoint.ledgerHash')
  if (ledgerIndex === activationLedgerIndex && ledgerHash !== activationLedgerHash) {
    return fail(
      'SCHEMA_CATALOG_INVALID',
      'Activation checkpoint hash does not match the network profile',
      '$.checkpoint.ledgerHash',
    )
  }
  return { ledgerIndex, ledgerHash }
}

function compareCoordinates(
  left: Pick<SchemaCatalogEntryV1, 'ledgerIndex' | 'transactionIndex'>,
  right: Pick<SchemaCatalogEntryV1, 'ledgerIndex' | 'transactionIndex'>,
): number {
  return left.ledgerIndex === right.ledgerIndex
    ? left.transactionIndex - right.transactionIndex
    : left.ledgerIndex - right.ledgerIndex
}

function validateEntry(
  input: unknown,
  index: number,
  profile: SchemaCatalogBundleV1['profile'],
  checkpoint: SchemaCatalogCheckpointV1,
): SchemaCatalogEntryV1 {
  const path = `$.schemas[${index}]`
  const value = requireObject(input, path)
  assertOnlyKeys(value, ENTRY_KEYS, path)
  const uid = requireLowercaseHash(value.uid, `${path}.uid`)
  const ledgerHash = requireLowercaseHash(value.ledgerHash, `${path}.ledgerHash`)
  const transactionHash = requireLowercaseHash(value.transactionHash, `${path}.transactionHash`)
  if (typeof value.publisher !== 'string' || !isClassicAddress(value.publisher)) {
    return fail(
      'SCHEMA_CATALOG_INVALID',
      'publisher must be a checksummed XRPL classic address',
      `${path}.publisher`,
    )
  }
  if (
    !isUint32(value.ledgerIndex) ||
    value.ledgerIndex < profile.activationLedgerIndex ||
    value.ledgerIndex > checkpoint.ledgerIndex
  ) {
    return fail(
      'SCHEMA_CATALOG_INVALID',
      'ledgerIndex must fall between profile activation and the authoritative checkpoint',
      `${path}.ledgerIndex`,
    )
  }
  if (!isUint32(value.transactionIndex)) {
    return fail(
      'SCHEMA_CATALOG_INVALID',
      'transactionIndex must be a uint32',
      `${path}.transactionIndex`,
    )
  }
  const ledgerIndex = normalizeUint32(value.ledgerIndex)
  const transactionIndex = normalizeUint32(value.transactionIndex)
  if (
    ledgerIndex === profile.activationLedgerIndex &&
    ledgerHash !== profile.activationLedgerHash
  ) {
    return fail(
      'SCHEMA_CATALOG_INVALID',
      'Schema ledger hash does not match the profile activation anchor',
      `${path}.ledgerHash`,
    )
  }
  if (ledgerIndex === checkpoint.ledgerIndex && ledgerHash !== checkpoint.ledgerHash) {
    return fail(
      'SCHEMA_CATALOG_INVALID',
      'Schema ledger hash does not match the authoritative checkpoint',
      `${path}.ledgerHash`,
    )
  }

  const definition = validateSchema(value.definition)
  const computedUid = computeSchemaUid({
    networkId: profile.networkId,
    ledgerHash,
    ledgerIndex,
    transactionIndex,
    publisher: value.publisher,
    schema: definition,
  })
  if (computedUid !== uid) {
    return fail(
      'SCHEMA_CATALOG_INVALID',
      'Schema UID does not match its normalized definition and ledger coordinates',
      `${path}.uid`,
      { expected: computedUid, actual: uid },
    )
  }

  return {
    uid,
    definition,
    publisher: value.publisher,
    ledgerIndex,
    ledgerHash,
    transactionIndex,
    transactionHash,
  }
}

function referencedUids(entry: SchemaCatalogEntryV1): string[] {
  const result: string[] = []
  if (entry.definition.extends !== undefined) result.push(entry.definition.extends)
  if (entry.definition.supersedes !== undefined) result.push(entry.definition.supersedes)
  return result
}

/**
 * Enforce the bound while constructing a portable catalog closure.
 *
 * The candidate itself counts as one entry. Shared ancestors reached through
 * both `extends` and `supersedes` count only once.
 */
export function assertSchemaCatalogClosureWithinLimit(
  candidate: SchemaCatalogEntryV1['definition'],
  getSchema: (uid: string) => Pick<RegisteredSchema, 'definition'> | undefined,
): void {
  const seen = new Set<string>()
  const pending = [candidate.extends, candidate.supersedes].filter(
    (uid): uid is string => uid !== undefined,
  )

  while (pending.length > 0) {
    const uid = pending.pop()!
    if (seen.has(uid)) continue
    seen.add(uid)
    if (seen.size + 1 > MAX_SCHEMA_CATALOG_ENTRIES) {
      fail(
        'SCHEMA_CATALOG_LIMIT_EXCEEDED',
        `Schema relation closure exceeds ${MAX_SCHEMA_CATALOG_ENTRIES} entries`,
        '$.schemas',
        { limit: MAX_SCHEMA_CATALOG_ENTRIES },
      )
    }
    const entry = getSchema(uid)
    if (entry === undefined) {
      fail('SCHEMA_CATALOG_INVALID', 'Schema relation closure is incomplete', '$.schemas', { uid })
    }
    if (entry.definition.extends !== undefined) pending.push(entry.definition.extends)
    if (entry.definition.supersedes !== undefined) pending.push(entry.definition.supersedes)
  }
}

/** Validate and normalize an already-decoded schema catalog bundle. */
export function validateSchemaCatalogBundle(input: unknown): SchemaCatalogBundleV1 {
  const value = requireObject(input, '$')
  assertOnlyKeys(value, BUNDLE_KEYS, '$')
  if (value.format !== 'xcs-schema-catalog/1') {
    return fail('SCHEMA_CATALOG_INVALID', 'Unsupported schema catalog format', '$.format')
  }
  const profile = validateNetworkProfile(value.profile)
  const targetUid = requireLowercaseHash(value.targetUid, '$.targetUid')
  const checkpoint = validateCheckpoint(
    value.checkpoint,
    profile.activationLedgerIndex,
    profile.activationLedgerHash,
  )
  if (!Array.isArray(value.schemas) || value.schemas.length === 0) {
    return fail(
      'SCHEMA_CATALOG_INVALID',
      'schemas must be a non-empty topologically ordered array',
      '$.schemas',
    )
  }
  if (value.schemas.length > MAX_SCHEMA_CATALOG_ENTRIES) {
    return fail(
      'SCHEMA_CATALOG_LIMIT_EXCEEDED',
      `schemas must contain at most ${MAX_SCHEMA_CATALOG_ENTRIES} entries`,
      '$.schemas',
      { limit: MAX_SCHEMA_CATALOG_ENTRIES, actual: value.schemas.length },
    )
  }

  const schemas: SchemaCatalogEntryV1[] = []
  const byUid = new Map<string, SchemaCatalogEntryV1>()
  const transactionHashes = new Set<string>()
  for (const [index, rawEntry] of value.schemas.entries()) {
    const entry = validateEntry(rawEntry, index, profile, checkpoint)
    if (byUid.has(entry.uid)) {
      return fail('SCHEMA_CATALOG_INVALID', 'Duplicate schema UID', `$.schemas[${index}].uid`)
    }
    if (transactionHashes.has(entry.transactionHash)) {
      return fail(
        'SCHEMA_CATALOG_INVALID',
        'Duplicate schema registration transaction hash',
        `$.schemas[${index}].transactionHash`,
      )
    }
    const previous = schemas.at(-1)
    if (previous !== undefined && compareCoordinates(previous, entry) >= 0) {
      return fail(
        'SCHEMA_CATALOG_INVALID',
        'schemas must be strictly ordered by ledger and transaction index',
        `$.schemas[${index}]`,
      )
    }
    if (
      previous !== undefined &&
      previous.ledgerIndex === entry.ledgerIndex &&
      previous.ledgerHash !== entry.ledgerHash
    ) {
      return fail(
        'SCHEMA_CATALOG_INVALID',
        'Schemas at the same ledger index must share one ledger hash',
        `$.schemas[${index}].ledgerHash`,
      )
    }
    for (const relationUid of referencedUids(entry)) {
      if (!byUid.has(relationUid)) {
        return fail(
          'SCHEMA_CATALOG_INVALID',
          'Every schema relation must reference an earlier catalog entry',
          `$.schemas[${index}]`,
          { uid: relationUid },
        )
      }
    }
    schemas.push(entry)
    byUid.set(entry.uid, entry)
    transactionHashes.add(entry.transactionHash)
  }

  if (schemas.at(-1)?.uid !== targetUid) {
    return fail(
      'SCHEMA_CATALOG_INVALID',
      'targetUid must identify the final catalog entry',
      '$.targetUid',
    )
  }

  const reachable = new Set<string>()
  const pending = [targetUid]
  while (pending.length > 0) {
    const uid = pending.pop()!
    if (reachable.has(uid)) continue
    reachable.add(uid)
    const entry = byUid.get(uid)!
    pending.push(...referencedUids(entry))
  }
  if (reachable.size !== schemas.length) {
    return fail(
      'SCHEMA_CATALOG_INVALID',
      'Catalog contains a schema unrelated to targetUid',
      '$.schemas',
    )
  }

  return { format: 'xcs-schema-catalog/1', profile, targetUid, checkpoint, schemas }
}

/** Strictly parse JSON text and validate its complete schema catalog. */
export function parseSchemaCatalogBundle(text: string): SchemaCatalogBundleV1 {
  return validateSchemaCatalogBundle(parseJsonStrict(text))
}

/** Resolve every relation in a validated catalog and return its target schema. */
export function resolveSchemaCatalogBundle(
  input: SchemaCatalogBundleV1,
): ResolvedSchemaCatalogBundleV1 {
  const bundle = validateSchemaCatalogBundle(input)
  const registered = new Map<string, RegisteredSchema>()
  let resolvedTarget: ResolvedSchema | undefined

  for (const entry of bundle.schemas) {
    const registration: RegisteredSchema = {
      uid: entry.uid,
      definition: entry.definition,
      publisher: entry.publisher,
      networkId: bundle.profile.networkId,
      ledgerIndex: entry.ledgerIndex,
      transactionIndex: entry.transactionIndex,
    }
    const resolved = resolveSchema(entry.definition, {
      networkId: bundle.profile.networkId,
      publisher: entry.publisher,
      ledgerIndex: entry.ledgerIndex,
      transactionIndex: entry.transactionIndex,
      getSchema: (uid) => registered.get(uid),
    })
    registered.set(entry.uid, registration)
    if (entry.uid === bundle.targetUid) resolvedTarget = resolved
  }

  if (resolvedTarget === undefined) {
    return fail('SCHEMA_CATALOG_INVALID', 'Catalog target could not be resolved', '$.targetUid')
  }
  return {
    bundle,
    target: bundle.schemas[bundle.schemas.length - 1]!,
    resolvedTarget,
  }
}
