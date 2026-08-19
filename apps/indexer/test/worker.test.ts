import { describe, expect, it } from 'vitest'

import { IndexerWorker } from '../src/worker.js'
import type {
  Checkpoint,
  IndexerRepository,
  LedgerProjection,
  LedgerSource,
  NetworkProfile,
  SchemaCatalogEntry,
  ValidatedLedger,
} from '../src/types.js'

const profile: NetworkProfile = {
  profileId: 'test',
  xcsVersion: '0.1',
  networkId: 1,
  requiredAmendment: 'f'.repeat(64),
  registryAddress: 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh',
  registrationAmountDrops: '1',
  activationLedgerIndex: 100,
  activationLedgerHash: 'a'.repeat(64),
}

function hash(index: number): string {
  return index === 100 ? 'a'.repeat(64) : index.toString(16).padStart(64, '0')
}

class MemoryRepository implements IndexerRepository {
  checkpoint: Checkpoint | undefined
  readonly persisted: number[] = []
  async getLastCheckpoint() {
    return this.checkpoint
  }
  async getSchemaCatalog(): Promise<SchemaCatalogEntry[]> {
    return []
  }
  async persistLedger(_profile: NetworkProfile, projection: LedgerProjection) {
    this.persisted.push(projection.ledger.ledgerIndex)
    this.checkpoint = {
      ledgerIndex: projection.ledger.ledgerIndex,
      ledgerHash: projection.ledger.ledgerHash,
      parentHash: projection.ledger.parentHash,
      closeTime: projection.ledger.closeTime,
    }
    return 'inserted' as const
  }
}

class MemorySource implements LedgerSource {
  async connect() {}
  async disconnect() {}
  async assertAmendmentEnabled() {}
  async getValidatedLedgerIndex() {
    return 103
  }
  async getLedger(ledgerIndex: number): Promise<ValidatedLedger> {
    return {
      ledgerIndex,
      ledgerHash: hash(ledgerIndex),
      parentHash: ledgerIndex === 100 ? '0'.repeat(64) : hash(ledgerIndex - 1),
      closeTime: 1_000 + ledgerIndex,
      transactions: [],
    }
  }
}

describe('IndexerWorker batching', () => {
  it('processes at most the configured number of ledgers per run', async () => {
    const repository = new MemoryRepository()
    let caughtUp = false
    const worker = new IndexerWorker({
      profile,
      repository,
      source: new MemorySource(),
      batchSize: 2,
      observer: { caughtUp: () => (caughtUp = true) },
    })
    await expect(worker.runOnce()).resolves.toBe(2)
    expect(repository.persisted).toEqual([100, 101])
    expect(caughtUp).toBe(false)
    await expect(worker.runOnce()).resolves.toBe(2)
    expect(repository.persisted).toEqual([100, 101, 102, 103])
    await expect(worker.runOnce()).resolves.toBe(0)
    expect(repository.persisted).toEqual([100, 101, 102, 103])
    expect(caughtUp).toBe(true)
  })
})
