import { assertTransactionOrdering } from './continuity.js'
import { extractCredentialMutations } from './credential-mutations.js'
import { interpretSchemaRegistration } from './registration.js'
import type {
  LedgerProjection,
  NetworkProfile,
  SchemaCatalogEntry,
  ValidatedLedger,
} from './types.js'

export function projectLedger(
  ledger: ValidatedLedger,
  profile: NetworkProfile,
  initialCatalog: ReadonlyMap<string, SchemaCatalogEntry>,
): LedgerProjection {
  assertTransactionOrdering(ledger)
  const catalog = new Map(initialCatalog)
  const schemaRegistrations: LedgerProjection['schemaRegistrations'] = []
  const credentialMutations: LedgerProjection['credentialMutations'] = []
  let malformedCredentialNodes = 0

  for (const transaction of ledger.transactions) {
    const registration = interpretSchemaRegistration(transaction, ledger, profile, catalog)
    if (registration !== undefined) {
      schemaRegistrations.push(registration)
      if (registration.status === 'accepted') {
        catalog.set(registration.schemaUid, {
          uid: registration.schemaUid,
          definition: registration.definition,
          resolved: registration.resolved,
          publisher: registration.publisher,
          networkId: profile.networkId,
          ledgerIndex: ledger.ledgerIndex,
          transactionIndex: transaction.transactionIndex,
          name: registration.definition.name,
          description: registration.definition.description,
          transactionHash: transaction.hash,
        })
      }
    }

    const extracted = extractCredentialMutations(
      transaction,
      ledger.closeTime,
      new Set(catalog.keys()),
    )
    credentialMutations.push(...extracted.mutations)
    malformedCredentialNodes += extracted.malformedCredentialNodes
  }

  return {
    ledger,
    schemaRegistrations,
    credentialMutations,
    malformedCredentialNodes,
  }
}
