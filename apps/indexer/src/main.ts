import { createDatabaseClient } from '@xcs-protocol/db'

import { loadIndexerConfig } from './config.js'
import { PostgresIndexerRepository } from './repository.js'
import { QuorumLedgerSource } from './quorum-ledger-source.js'
import { sourceErrorCode } from './source-errors.js'
import { IndexerWorker } from './worker.js'
import { XrplLedgerSource } from './xrpl-source.js'

const config = await loadIndexerConfig()
const database = createDatabaseClient(config.databaseUrl)
const controller = new AbortController()

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => controller.abort())
}

const worker = new IndexerWorker({
  profile: config.profile,
  repository: new PostgresIndexerRepository(database.db),
  source: new QuorumLedgerSource(
    new XrplLedgerSource(config.xrplRpcUrlPrimary, 'primary'),
    new XrplLedgerSource(config.xrplRpcUrlSecondary, 'secondary'),
  ),
  pollIntervalMs: config.pollIntervalMs,
  leaseDurationMs: config.leaseDurationMs,
  batchSize: config.batchSize,
  observer: {
    ledgerProcessed: (event) =>
      console.info(JSON.stringify({ event: 'ledger_processed', ...event })),
    caughtUp: (ledgerIndex) => console.info(JSON.stringify({ event: 'caught_up', ledgerIndex })),
    failed: (error) =>
      console.error(
        JSON.stringify({
          event: 'indexer_failed',
          code: sourceErrorCode(error),
        }),
      ),
  },
})

try {
  await worker.start(controller.signal)
} finally {
  await database.close()
}
