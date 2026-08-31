import { canonicalize, type JsonValue } from '@xcs-protocol/core'
import { describe, expect, it } from 'vitest'

import { interpretSchemaRegistration } from '../src/registration.js'
import type { LedgerTransaction, NetworkProfile, SchemaDefinition } from '../src/types.js'

const REGISTRY = 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh'
const PUBLISHER = 'rLs1MzkFWCxTbuAHgjeTZK4fcCDDnf2KRv'
const HASH = 'a'.repeat(64)
const AMENDMENT = 'b'.repeat(64)

const profile: NetworkProfile = {
  profileId: 'test',
  xcsVersion: '0.1',
  networkId: 1,
  requiredAmendment: AMENDMENT,
  registryAddress: REGISTRY,
  registrationAmountDrops: '1',
  activationLedgerIndex: 100,
  activationLedgerHash: HASH,
}

const schema: SchemaDefinition = {
  xcsVersion: '0.1',
  name: 'Course completion',
  description: 'A compact completion attestation.',
  fields: {
    programId: { type: 'string' },
    completedAt: { type: 'string' },
  },
}

function hex(value: string): string {
  return Buffer.from(value, 'utf8').toString('hex').toUpperCase()
}

function payment(
  overrides: Record<string, unknown> = {},
  memoJson: JsonValue = schema as unknown as JsonValue,
): LedgerTransaction {
  return {
    hash: 'c'.repeat(64),
    transactionIndex: 0,
    transaction: {
      TransactionType: 'Payment',
      Account: PUBLISHER,
      Destination: REGISTRY,
      Amount: '1',
      Memos: [
        {
          Memo: {
            MemoType: hex('xcs:schema_register'),
            MemoFormat: hex('application/json'),
            MemoData: hex(canonicalize(memoJson)),
          },
        },
      ],
      ...overrides,
    },
    metadata: { TransactionResult: 'tesSUCCESS', AffectedNodes: [] },
  }
}

describe('interpretSchemaRegistration', () => {
  it('accepts the exact successful registration envelope', () => {
    const result = interpretSchemaRegistration(
      payment(),
      { ledgerHash: HASH, ledgerIndex: 100 },
      profile,
      new Map(),
    )

    expect(result).toMatchObject({
      status: 'accepted',
      publisher: PUBLISHER,
      schemaUid: expect.stringMatching(/^[0-9a-f]{64}$/),
    })
  })

  it('keeps the exact canonical memo while normalizing optional false for the schema UID', () => {
    const memoJson = {
      ...schema,
      fields: {
        programId: { type: 'string', optional: false },
        completedAt: { type: 'string' },
      },
    } as unknown as JsonValue
    const result = interpretSchemaRegistration(
      payment({}, memoJson),
      { ledgerHash: HASH, ledgerIndex: 100 },
      profile,
      new Map(),
    )

    expect(result).toMatchObject({
      status: 'accepted',
      memoJson,
      definition: {
        fields: {
          programId: { type: 'string' },
          completedAt: { type: 'string' },
        },
      },
    })
  })

  it.each([
    ['wrong amount', { Amount: '2' }],
    ['path payment', { Paths: [] }],
    ['partial payment', { Flags: 0x0002_0000 }],
  ])('ignores a non-exact envelope: %s', (_name, override) => {
    expect(
      interpretSchemaRegistration(
        payment(override),
        { ledgerHash: HASH, ledgerIndex: 100 },
        profile,
        new Map(),
      ),
    ).toBeUndefined()
  })

  it('ignores an unsuccessful payment even if the memo matches', () => {
    const candidate = payment()
    candidate.metadata.TransactionResult = 'tecUNFUNDED_PAYMENT'
    expect(
      interpretSchemaRegistration(
        candidate,
        { ledgerHash: HASH, ledgerIndex: 100 },
        profile,
        new Map(),
      ),
    ).toBeUndefined()
  })

  it('rejects non-canonical JSON after the envelope matched', () => {
    const candidate = payment()
    const memo = (candidate.transaction.Memos as Array<{ Memo: Record<string, unknown> }>)[0]?.Memo
    if (memo === undefined) throw new Error('fixture memo missing')
    memo.MemoData = hex(JSON.stringify(schema, null, 2))

    expect(
      interpretSchemaRegistration(
        candidate,
        { ledgerHash: HASH, ledgerIndex: 100 },
        profile,
        new Map(),
      ),
    ).toMatchObject({ status: 'rejected', reasonCode: 'REGISTRATION_NOT_CANONICAL' })
  })

  it('keeps a UTF-8 BOM visible in every schema memo field', () => {
    const memoType = payment()
    const memoTypeFields = (
      memoType.transaction.Memos as Array<{ Memo: Record<string, unknown> }>
    )[0]!.Memo
    memoTypeFields.MemoType = hex(`\uFEFFxcs:schema_register`)
    expect(
      interpretSchemaRegistration(
        memoType,
        { ledgerHash: HASH, ledgerIndex: 100 },
        profile,
        new Map(),
      ),
    ).toBeUndefined()

    const memoFormat = payment()
    const memoFormatFields = (
      memoFormat.transaction.Memos as Array<{ Memo: Record<string, unknown> }>
    )[0]!.Memo
    memoFormatFields.MemoFormat = hex(`\uFEFFapplication/json`)
    expect(
      interpretSchemaRegistration(
        memoFormat,
        { ledgerHash: HASH, ledgerIndex: 100 },
        profile,
        new Map(),
      ),
    ).toMatchObject({ status: 'rejected', reasonCode: 'REGISTRATION_MEMO_FORMAT' })

    const memoData = payment()
    const memoDataFields = (
      memoData.transaction.Memos as Array<{ Memo: Record<string, unknown> }>
    )[0]!.Memo
    memoDataFields.MemoData = hex(`\uFEFF${canonicalize(schema as unknown as JsonValue)}`)
    expect(
      interpretSchemaRegistration(
        memoData,
        { ledgerHash: HASH, ledgerIndex: 100 },
        profile,
        new Map(),
      ),
    ).toMatchObject({ status: 'rejected', reasonCode: 'JSON_INVALID' })
  })
})
