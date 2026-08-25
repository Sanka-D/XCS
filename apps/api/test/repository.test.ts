import {
  schemaEvents,
  schemas,
  type SchemaEventRow,
  type SchemaRow,
  type XcsDatabase,
} from '@xcs-protocol/db'
import { describe, expect, it, vi } from 'vitest'

import { PostgresApiRepository } from '../src/repository.js'

const NOW = new Date('2026-08-24T12:00:00.000Z')
const schemaRegistration: SchemaEventRow = {
  profileId: 'testnet',
  transactionHash: 'a'.repeat(64),
  ledgerIndex: 100,
  ledgerHash: 'b'.repeat(64),
  transactionIndex: 0,
  publisher: 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh',
  status: 'accepted',
  reasonCode: null,
  schemaUid: 'c'.repeat(64),
  memoJson: {},
  recordedAt: NOW,
}
const schemaRow: SchemaRow = {
  profileId: 'testnet',
  schemaUid: schemaRegistration.schemaUid!,
  publisher: schemaRegistration.publisher,
  name: 'Course',
  description: 'Course schema',
  parentUid: null,
  supersedesUid: null,
  definition: {},
  resolvedDefinition: {},
  registrationTransactionHash: schemaRegistration.transactionHash,
  ledgerIndex: schemaRegistration.ledgerIndex,
  transactionIndex: schemaRegistration.transactionIndex,
  registeredAt: NOW,
}

describe('PostgresApiRepository authority reads', () => {
  it('runs callbacks in a read-only repeatable-read transaction and uses database time', async () => {
    const execute = vi.fn(async () => [{ now: NOW }])
    const transactionDatabase = { execute } as unknown as XcsDatabase
    const transaction = vi.fn(
      async <T>(
        callback: (database: XcsDatabase) => Promise<T>,
        _config: { isolationLevel: string; accessMode: string },
      ) => callback(transactionDatabase),
    )
    const repository = new PostgresApiRepository({ transaction } as unknown as XcsDatabase)

    const observedAt = await repository.withConsistentSnapshot((snapshot) =>
      snapshot.getDatabaseTime(),
    )

    expect(observedAt).toEqual(NOW)
    expect(transaction).toHaveBeenCalledOnce()
    expect(transaction.mock.calls[0]?.[1]).toEqual({
      isolationLevel: 'repeatable read',
      accessMode: 'read only',
    })
    expect(execute).toHaveBeenCalledOnce()
  })

  it('looks up schema registration evidence by its unique profile and transaction key', async () => {
    const limit = vi.fn(async () => [schemaRegistration])
    const where = vi.fn(() => ({ limit }))
    const from = vi.fn(() => ({ where }))
    const select = vi.fn(() => ({ from }))
    const repository = new PostgresApiRepository({ select } as unknown as XcsDatabase)

    await expect(
      repository.getSchemaRegistrationByTransaction({
        profileId: 'testnet',
        transactionHash: schemaRegistration.transactionHash,
      }),
    ).resolves.toEqual(schemaRegistration)

    expect(from).toHaveBeenCalledWith(schemaEvents)
    expect(where).toHaveBeenCalledOnce()
    expect(limit).toHaveBeenCalledWith(1)
  })

  it('loads schema rows and their exact registration events for one UID set', async () => {
    const result = [{ schema: schemaRow, registration: schemaRegistration }]
    const where = vi.fn(async () => result)
    const innerJoin = vi.fn((_table: unknown, _condition: unknown) => ({ where }))
    const from = vi.fn(() => ({ innerJoin }))
    const select = vi.fn(() => ({ from }))
    const repository = new PostgresApiRepository({ select } as unknown as XcsDatabase)

    await expect(
      repository.getSchemaProjectionEvidence({
        profileId: 'testnet',
        schemaUids: [schemaRow.schemaUid],
      }),
    ).resolves.toEqual(result)

    expect(select).toHaveBeenCalledWith({ schema: schemas, registration: schemaEvents })
    expect(from).toHaveBeenCalledWith(schemas)
    expect(innerJoin.mock.calls[0]?.[0]).toBe(schemaEvents)
    expect(where).toHaveBeenCalledOnce()
  })
})
