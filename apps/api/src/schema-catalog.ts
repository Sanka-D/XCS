import {
  resolveSchemaCatalogBundle,
  validateSchema,
  validateSchemaCatalogBundle,
  validateNetworkProfile,
  type NetworkProfile,
  type SchemaCatalogBundleV1,
} from '@xcs-protocol/core'
import type { LedgerCheckpointRow, NetworkProfileRow, SchemaRow } from '@xcs-protocol/db'

import { authoritativeResolvedSchema, SchemaProjectionInvalidError } from './schema-projection.js'
import type { SchemaProjectionEvidence } from './types.js'

function networkProfile(row: NetworkProfileRow): NetworkProfile {
  return validateNetworkProfile({
    profileId: row.profileId,
    xcsVersion: row.xcsVersion,
    networkId: row.networkId,
    requiredAmendment: row.requiredAmendment,
    registryAddress: row.registryAddress,
    registrationAmountDrops: String(row.registrationAmountDrops),
    activationLedgerIndex: row.activationLedgerIndex,
    activationLedgerHash: row.activationLedgerHash,
  })
}

function compareEvidence(left: SchemaProjectionEvidence, right: SchemaProjectionEvidence): number {
  if (left.schema.ledgerIndex !== right.schema.ledgerIndex) {
    return left.schema.ledgerIndex - right.schema.ledgerIndex
  }
  return left.schema.transactionIndex - right.schema.transactionIndex
}

export function authoritativeSchemaCatalogBundle(input: {
  network: NetworkProfileRow
  checkpoint: LedgerCheckpointRow
  target: SchemaRow
  evidence: readonly SchemaProjectionEvidence[]
}): SchemaCatalogBundleV1 {
  try {
    const expected = {
      profileId: input.network.profileId,
      networkId: input.network.networkId,
      activationLedgerIndex: input.network.activationLedgerIndex,
    }
    const evidence = [...input.evidence].sort(compareEvidence)
    for (const item of evidence) {
      authoritativeResolvedSchema(item.schema, evidence, {
        ...expected,
        schemaUid: item.schema.schemaUid,
      })
    }
    authoritativeResolvedSchema(input.target, evidence, {
      ...expected,
      schemaUid: input.target.schemaUid,
    })

    const bundle = validateSchemaCatalogBundle({
      format: 'xcs-schema-catalog/1',
      profile: networkProfile(input.network),
      targetUid: input.target.schemaUid,
      checkpoint: {
        ledgerIndex: input.checkpoint.ledgerIndex,
        ledgerHash: input.checkpoint.ledgerHash,
      },
      schemas: evidence.map(({ schema, registration }) => ({
        uid: schema.schemaUid,
        definition: validateSchema(schema.definition),
        publisher: schema.publisher,
        ledgerIndex: schema.ledgerIndex,
        ledgerHash: registration.ledgerHash,
        transactionIndex: schema.transactionIndex,
        transactionHash: schema.registrationTransactionHash,
      })),
    })
    return resolveSchemaCatalogBundle(bundle).bundle
  } catch (error) {
    if (error instanceof SchemaProjectionInvalidError) throw error
    throw new SchemaProjectionInvalidError({ cause: error })
  }
}
