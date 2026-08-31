import { describe, expect, it } from 'vitest'

import {
  assertSchemaCatalogClosureWithinLimit,
  computeSchemaUid,
  MAX_SCHEMA_CATALOG_ENTRIES,
  parseSchemaCatalogBundle,
  resolveSchemaCatalogBundle,
  validateSchemaCatalogBundle,
  type NetworkProfile,
  type SchemaCatalogBundleV1,
  type SchemaCatalogEntryV1,
  type SchemaDefinition,
} from '../src/index.js'

const PUBLISHER = 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh'
const profile: NetworkProfile = {
  profileId: 'xrpl-testnet-xcs-v0.1-catalog-test',
  xcsVersion: '0.1',
  networkId: 1,
  requiredAmendment: 'AB'.repeat(32),
  registryAddress: PUBLISHER,
  registrationAmountDrops: '1',
  activationLedgerIndex: 9,
  activationLedgerHash: '09'.repeat(32),
}

function entry(
  definition: SchemaDefinition,
  ledgerIndex: number,
  transactionIndex: number,
): SchemaCatalogEntryV1 {
  const ledgerHash = ledgerIndex.toString(16).padStart(2, '0').repeat(32)
  return {
    uid: computeSchemaUid({
      networkId: profile.networkId,
      ledgerHash,
      ledgerIndex,
      transactionIndex,
      publisher: PUBLISHER,
      schema: definition,
    }),
    definition,
    publisher: PUBLISHER,
    ledgerIndex,
    ledgerHash,
    transactionIndex,
    transactionHash: transactionIndex.toString(16).padStart(64, '0'),
  }
}

function linearCatalog(size: number): SchemaCatalogBundleV1 {
  const schemas: SchemaCatalogEntryV1[] = []
  for (let index = 0; index < size; index += 1) {
    const previous = schemas.at(-1)
    schemas.push(
      entry(
        {
          xcsVersion: '0.1',
          name: `Course revision ${index}`,
          description: 'A bounded schema-catalog revision.',
          ...(previous === undefined ? {} : { supersedes: previous.uid }),
          fields: { courseId: { type: 'string' } },
        },
        10,
        index,
      ),
    )
  }
  return {
    format: 'xcs-schema-catalog/1',
    profile,
    targetUid: schemas.at(-1)!.uid,
    checkpoint: { ledgerIndex: 10, ledgerHash: '0a'.repeat(32) },
    schemas,
  }
}

function fixture(): SchemaCatalogBundleV1 {
  const previous = entry(
    {
      xcsVersion: '0.1',
      name: 'Previous course',
      description: 'The previous independent course schema.',
      fields: { previousCourseId: { type: 'string' } },
    },
    10,
    1,
  )
  const parent = entry(
    {
      xcsVersion: '0.1',
      name: 'Course',
      description: 'The reusable course schema.',
      fields: { courseId: { type: 'string' } },
    },
    10,
    2,
  )
  const target = entry(
    {
      xcsVersion: '0.1',
      name: 'Course completion',
      description: 'Confirms successful course completion.',
      extends: parent.uid,
      supersedes: previous.uid,
      fields: { completed: { type: 'bool' } },
    },
    11,
    0,
  )
  return {
    format: 'xcs-schema-catalog/1',
    profile,
    targetUid: target.uid,
    checkpoint: { ledgerIndex: 12, ledgerHash: '0c'.repeat(32) },
    schemas: [previous, parent, target],
  }
}

describe('schema catalog bundles', () => {
  it('strictly parses, recomputes UIDs and resolves the target lineage', () => {
    const bundle = fixture()
    const parsed = parseSchemaCatalogBundle(JSON.stringify(bundle))
    const resolved = resolveSchemaCatalogBundle(parsed)

    expect(resolved.target.uid).toBe(bundle.targetUid)
    expect(resolved.resolvedTarget.lineage).toEqual([bundle.schemas[1]!.uid])
    expect(Object.keys(resolved.resolvedTarget.fields).sort()).toEqual(['completed', 'courseId'])
    expect(resolved.bundle.profile.requiredAmendment).toBe('AB'.repeat(32))
  })

  it('rejects duplicate JSON keys and unknown bundle properties', () => {
    const serialized = JSON.stringify(fixture())
    expect(() =>
      parseSchemaCatalogBundle(serialized.replace('{', '{"format":"xcs-schema-catalog/1",')),
    ).toThrowError(expect.objectContaining({ code: 'JSON_DUPLICATE_KEY' }))

    expect(() => validateSchemaCatalogBundle({ ...fixture(), extra: true })).toThrowError(
      expect.objectContaining({ code: 'SCHEMA_CATALOG_INVALID', path: '$.extra' }),
    )
  })

  it('rejects tampered UIDs, incomplete order and unrelated entries', () => {
    const tampered = fixture()
    tampered.schemas[2] = { ...tampered.schemas[2]!, uid: 'ff'.repeat(32) }
    tampered.targetUid = 'ff'.repeat(32)
    expect(() => validateSchemaCatalogBundle(tampered)).toThrowError(
      expect.objectContaining({ code: 'SCHEMA_CATALOG_INVALID', path: '$.schemas[2].uid' }),
    )

    const reversed = fixture()
    reversed.schemas = [reversed.schemas[1]!, reversed.schemas[0]!, reversed.schemas[2]!]
    expect(() => validateSchemaCatalogBundle(reversed)).toThrowError(
      expect.objectContaining({ code: 'SCHEMA_CATALOG_INVALID', path: '$.schemas[1]' }),
    )

    const unrelated = fixture()
    const standalone = entry(
      {
        xcsVersion: '0.1',
        name: 'Unrelated',
        description: 'This schema is outside the target relation graph.',
        fields: { value: { type: 'string' } },
      },
      10,
      3,
    )
    unrelated.schemas.splice(2, 0, standalone)
    expect(() => validateSchemaCatalogBundle(unrelated)).toThrowError(
      expect.objectContaining({ code: 'SCHEMA_CATALOG_INVALID', path: '$.schemas' }),
    )
  })

  it('binds schema ledgers to the profile activation and checkpoint hashes', () => {
    const activationBundle = fixture()
    const activation = activationBundle.schemas[0]!
    activation.ledgerIndex = profile.activationLedgerIndex
    activation.ledgerHash = 'ff'.repeat(32)
    expect(() => validateSchemaCatalogBundle(activationBundle)).toThrowError(
      expect.objectContaining({
        code: 'SCHEMA_CATALOG_INVALID',
        path: '$.schemas[0].ledgerHash',
      }),
    )

    const checkpointBundle = fixture()
    checkpointBundle.checkpoint = {
      ledgerIndex: checkpointBundle.schemas[2]!.ledgerIndex,
      ledgerHash: 'ff'.repeat(32),
    }
    expect(() => validateSchemaCatalogBundle(checkpointBundle)).toThrowError(
      expect.objectContaining({
        code: 'SCHEMA_CATALOG_INVALID',
        path: '$.schemas[2].ledgerHash',
      }),
    )

    const forkedLedger = fixture()
    forkedLedger.schemas[1] = {
      ...forkedLedger.schemas[1]!,
      ledgerHash: 'ff'.repeat(32),
    }
    forkedLedger.schemas[1]!.uid = computeSchemaUid({
      networkId: profile.networkId,
      ledgerHash: forkedLedger.schemas[1]!.ledgerHash,
      ledgerIndex: forkedLedger.schemas[1]!.ledgerIndex,
      transactionIndex: forkedLedger.schemas[1]!.transactionIndex,
      publisher: PUBLISHER,
      schema: forkedLedger.schemas[1]!.definition,
    })
    expect(() => validateSchemaCatalogBundle(forkedLedger)).toThrowError(
      expect.objectContaining({
        code: 'SCHEMA_CATALOG_INVALID',
        path: '$.schemas[1].ledgerHash',
      }),
    )
  })

  it('accepts 256 unique closure entries, rejects 257 and stays below the CLI response bound', () => {
    const maximum = linearCatalog(MAX_SCHEMA_CATALOG_ENTRIES)
    expect(validateSchemaCatalogBundle(maximum).schemas).toHaveLength(MAX_SCHEMA_CATALOG_ENTRIES)
    expect(new TextEncoder().encode(JSON.stringify(maximum)).length).toBeLessThan(1_048_576)

    expect(() =>
      validateSchemaCatalogBundle(linearCatalog(MAX_SCHEMA_CATALOG_ENTRIES + 1)),
    ).toThrowError(
      expect.objectContaining({
        code: 'SCHEMA_CATALOG_LIMIT_EXCEEDED',
        path: '$.schemas',
      }),
    )
  })

  it('counts a shared relation ancestor only once', () => {
    const definitions = new Map<string, { definition: SchemaDefinition }>()
    let previousUid: string | undefined
    for (let index = 0; index < MAX_SCHEMA_CATALOG_ENTRIES - 3; index += 1) {
      const uid = (index + 1).toString(16).padStart(64, '0')
      definitions.set(uid, {
        definition: {
          xcsVersion: '0.1',
          name: `Shared revision ${index}`,
          description: 'A shared supersedes ancestor.',
          ...(previousUid === undefined ? {} : { supersedes: previousUid }),
          fields: { courseId: { type: 'string' } },
        },
      })
      previousUid = uid
    }
    const parentUid = 'fe'.repeat(32)
    const supersededUid = 'ff'.repeat(32)
    definitions.set(parentUid, {
      definition: {
        xcsVersion: '0.1',
        name: 'Shared parent',
        description: 'Extends one shared history.',
        supersedes: previousUid!,
        fields: { parent: { type: 'string' } },
      },
    })
    definitions.set(supersededUid, {
      definition: {
        xcsVersion: '0.1',
        name: 'Shared predecessor',
        description: 'Supersedes the same shared history.',
        supersedes: previousUid!,
        fields: { predecessor: { type: 'string' } },
      },
    })

    expect(() =>
      assertSchemaCatalogClosureWithinLimit(
        {
          xcsVersion: '0.1',
          name: 'Shared target',
          description: 'Combines two branches with shared history.',
          extends: parentUid,
          supersedes: supersededUid,
          fields: { target: { type: 'string' } },
        },
        (uid) => definitions.get(uid),
      ),
    ).not.toThrow()
  })
})
