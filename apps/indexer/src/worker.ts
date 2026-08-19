import { assertLedgerContinuity } from './continuity.js'
import { projectLedger } from './project-ledger.js'
import type {
  Checkpoint,
  IndexerRepository,
  LedgerSource,
  NetworkProfile,
  SchemaCatalogEntry,
} from './types.js'

export interface IndexerObserver {
  ledgerProcessed?(details: {
    ledgerIndex: number
    schemaEvents: number
    credentialEvents: number
    malformedCredentialNodes: number
  }): void
  caughtUp?(ledgerIndex: number): void
  failed?(error: unknown): void
}

export interface IndexerWorkerOptions {
  profile: NetworkProfile
  source: LedgerSource
  repository: IndexerRepository
  pollIntervalMs?: number
  batchSize?: number
  observer?: IndexerObserver
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true },
    )
  })
}

export class IndexerWorker {
  private readonly pollIntervalMs: number
  private readonly batchSize: number

  constructor(private readonly options: IndexerWorkerOptions) {
    this.pollIntervalMs = options.pollIntervalMs ?? 4_000
    this.batchSize = options.batchSize ?? 20
    if (!Number.isInteger(this.pollIntervalMs) || this.pollIntervalMs < 250) {
      throw new Error('pollIntervalMs must be an integer of at least 250ms')
    }
    if (!Number.isInteger(this.batchSize) || this.batchSize < 1 || this.batchSize > 100) {
      throw new Error('batchSize must be an integer between 1 and 100')
    }
  }

  async runOnce(): Promise<number> {
    const { profile, repository, source } = this.options
    let previous = await repository.getLastCheckpoint(profile.profileId)
    const catalogEntries = await repository.getSchemaCatalog(profile.profileId)
    const catalog = new Map<string, SchemaCatalogEntry>(
      catalogEntries.map((entry) => [entry.uid, entry]),
    )
    const validatedLedgerIndex = await source.getValidatedLedgerIndex()
    let nextLedgerIndex =
      previous === undefined ? profile.activationLedgerIndex : previous.ledgerIndex + 1
    let processed = 0
    const lastLedgerThisRun = Math.min(validatedLedgerIndex, nextLedgerIndex + this.batchSize - 1)

    while (nextLedgerIndex <= lastLedgerThisRun) {
      const ledger = await source.getLedger(nextLedgerIndex)
      assertLedgerContinuity(profile, previous, ledger)
      const projection = projectLedger(ledger, profile, catalog)
      const result = await repository.persistLedger(profile, projection)

      for (const registration of projection.schemaRegistrations) {
        if (registration.status !== 'accepted') continue
        catalog.set(registration.schemaUid, {
          uid: registration.schemaUid,
          definition: registration.definition,
          resolved: registration.resolved,
          publisher: registration.publisher,
          networkId: profile.networkId,
          ledgerIndex: ledger.ledgerIndex,
          transactionIndex: registration.transactionIndex,
          name: registration.definition.name,
          description: registration.definition.description,
          transactionHash: registration.transactionHash,
        })
      }

      previous = {
        ledgerIndex: ledger.ledgerIndex,
        ledgerHash: ledger.ledgerHash,
        parentHash: ledger.parentHash,
        closeTime: ledger.closeTime,
      } satisfies Checkpoint
      nextLedgerIndex += 1
      if (result === 'inserted') {
        processed += 1
        this.options.observer?.ledgerProcessed?.({
          ledgerIndex: ledger.ledgerIndex,
          schemaEvents: projection.schemaRegistrations.length,
          credentialEvents: projection.credentialMutations.length,
          malformedCredentialNodes: projection.malformedCredentialNodes,
        })
      }
    }

    if (nextLedgerIndex > validatedLedgerIndex) {
      this.options.observer?.caughtUp?.(previous?.ledgerIndex ?? validatedLedgerIndex)
    }
    return processed
  }

  async start(signal: AbortSignal): Promise<void> {
    const { source, profile } = this.options
    await source.connect()
    try {
      await source.assertAmendmentEnabled(profile.requiredAmendment)
      while (!signal.aborted) {
        try {
          await this.runOnce()
        } catch (error) {
          this.options.observer?.failed?.(error)
          throw error
        }
        await wait(this.pollIntervalMs, signal)
      }
    } finally {
      await source.disconnect()
    }
  }
}
