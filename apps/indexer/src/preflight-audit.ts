import type { IndexerPreflightConfig } from './config.js'
import type { QuorumLedgerSourcePreflight } from './quorum-ledger-source.js'

export function createPreflightAudit(
  config: IndexerPreflightConfig,
  result: QuorumLedgerSourcePreflight,
) {
  return {
    ok: true as const,
    profileId: config.profile.profileId,
    profileSha256: config.profileSha256,
    registryPolicy: config.registryPolicy,
    databaseScope: config.databaseScope,
    networkId: result.networkId,
    activationLedger: {
      ledgerIndex: result.activationLedger.ledgerIndex,
      ledgerHash: result.activationLedger.ledgerHash,
      transactionRoot: result.activationLedger.transactionRoot,
    },
    sourceTips: result.tips,
    sources: result.sources,
  }
}
