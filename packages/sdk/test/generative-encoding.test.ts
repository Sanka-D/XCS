import { canonicalize, decodeUtf8Hex, type JsonValue } from '@xcs-protocol/core'
import { encode, type Payment } from 'xrpl'
import { describe, expect, it } from 'vitest'

import {
  buildSchemaRegistrationPayment,
  credentialTypeToSchemaUid,
  MAX_XRPL_MEMO_BYTES,
  measureSchemaRegistrationMemoBytes,
  schemaUidToCredentialType,
  XcsSdkError,
} from '../src/index.js'

const ISSUER = 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh'
const REGISTRY = 'rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe'
const GENERATIVE_SEED = 0x5843_5301

const profile = {
  profileId: 'xrpl-testnet-xcs-v0.1',
  xcsVersion: '0.1' as const,
  networkId: 1,
  requiredAmendment: 'ab'.repeat(32),
  registryAddress: REGISTRY,
  registrationAmountDrops: '1' as const,
  activationLedgerIndex: 1,
  activationLedgerHash: 'cd'.repeat(32),
}

function xorshift32(seed = GENERATIVE_SEED): () => number {
  let state = seed >>> 0
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return state >>> 0
  }
}

function randomUid(next: () => number): string {
  return Array.from({ length: 32 }, () => (next() & 0xff).toString(16).padStart(2, '0')).join('')
}

function mixedHexCase(value: string, next: () => number): string {
  return Array.from(value, (character) => {
    if (!/[a-f]/u.test(character)) return character
    return (next() & 1) === 0 ? character : character.toUpperCase()
  }).join('')
}

function expectErrorCode(action: () => unknown, code: string): void {
  let error: unknown
  try {
    action()
  } catch (caught) {
    error = caught
  }
  expect(error).toMatchObject({ code })
}

function serializedMemoObjectBytes(transaction: Payment): number {
  const serializable: Payment = {
    ...transaction,
    Fee: '12',
    Sequence: 1,
    SigningPubKey: '',
  }
  const { Memos, ...withoutMemos } = serializable
  expect(Memos).toHaveLength(1)

  // rippled excludes the outer sfMemos header and STArray terminator.
  return (encode(serializable).length - encode(withoutMemos).length) / 2 - 2
}

function generatedSchema(index: number, next: () => number) {
  const unicode = ['é', 'Δ', '漢', '🏁', '🙂', 'ñ'][next() % 6] ?? 'é'
  const fieldCount = (next() % 6) + 1
  return {
    xcsVersion: '0.1' as const,
    name: `Course ${unicode} ${index}`,
    description: `Réussite ${unicode} — cohorte ${next() % 10_000}`,
    fields: Object.fromEntries(
      Array.from({ length: fieldCount }, (_, fieldIndex) => [
        `field_${fieldIndex}`,
        fieldIndex % 2 === 0
          ? { type: 'string' as const }
          : { type: 'uint' as const, optional: false },
      ]),
    ),
  }
}

function schemaAtMemoBoundary(targetBytes: number) {
  const fields = Object.fromEntries(
    Array.from({ length: 28 }, (_, index) => [
      `f${String(index).padStart(2, '0')}`,
      { type: 'string' as const },
    ]),
  )

  for (let fillerBytes = 1; fillerBytes <= 240; fillerBytes += 1) {
    const candidate = {
      xcsVersion: '0.1' as const,
      name: 'Épreuve 🏁',
      description: `Réussite 🏅 ${'d'.repeat(fillerBytes)}`,
      fields,
    }
    const canonical = canonicalize(candidate as unknown as JsonValue)
    if (measureSchemaRegistrationMemoBytes(canonical) === targetBytes) return candidate
  }

  throw new Error(`Unable to construct a ${targetBytes}-byte schema memo fixture`)
}

describe('generative SDK encoding', () => {
  it('round-trips 256 generated schema UIDs through native CredentialType bytes', () => {
    const next = xorshift32()

    for (let index = 0; index < 256; index += 1) {
      const schemaUid = randomUid(next)
      const credentialType = schemaUidToCredentialType(schemaUid)

      expect(credentialType).toBe(schemaUid.toUpperCase())
      expect(credentialTypeToSchemaUid(credentialType)).toBe(schemaUid)
      expect(credentialTypeToSchemaUid(mixedHexCase(schemaUid, next))).toBe(schemaUid)
    }
  })

  it('rejects every malformed UID form with the stable SDK error code', () => {
    const invalidSchemaUids = [
      '',
      'a'.repeat(63),
      'a'.repeat(65),
      'A'.repeat(64),
      'g'.repeat(64),
      ` ${'a'.repeat(64)}`,
      `0x${'a'.repeat(64)}`,
    ]
    const invalidCredentialTypes = [
      '',
      'a'.repeat(63),
      'a'.repeat(65),
      'g'.repeat(64),
      ` ${'a'.repeat(64)}`,
      `0x${'a'.repeat(64)}`,
    ]

    for (const schemaUid of invalidSchemaUids) {
      expectErrorCode(() => schemaUidToCredentialType(schemaUid), 'XCS_SDK_INVALID_SCHEMA_UID')
    }
    for (const credentialType of invalidCredentialTypes) {
      expectErrorCode(() => credentialTypeToSchemaUid(credentialType), 'XCS_SDK_INVALID_SCHEMA_UID')
    }
  })

  it('preserves generated Unicode schemas in canonical memo bytes and exact XRPL accounting', () => {
    const next = xorshift32()

    for (let index = 0; index < 128; index += 1) {
      const built = buildSchemaRegistrationPayment({
        publisher: ISSUER,
        profile,
        schema: generatedSchema(index, next),
      })
      const memo = built.transaction.Memos?.[0]?.Memo

      expect(decodeUtf8Hex(memo?.MemoData ?? '')).toBe(built.canonicalSchema)
      expect(built.canonicalSchema).toBe(canonicalize(built.schema as unknown as JsonValue))
      expect(built.memoByteLength).toBe(serializedMemoObjectBytes(built.transaction))
      expect(built.memoByteLength).toBe(measureSchemaRegistrationMemoBytes(built.canonicalSchema))
      expect(built.memoByteLength).toBeLessThanOrEqual(MAX_XRPL_MEMO_BYTES)
    }
  })

  it('applies schema text limits to UTF-8 bytes rather than JavaScript code units', () => {
    const exact = buildSchemaRegistrationPayment({
      publisher: ISSUER,
      profile,
      schema: {
        xcsVersion: '0.1',
        name: '🏁'.repeat(16),
        description: 'é'.repeat(128),
        fields: { completed: { type: 'bool' } },
      },
    })

    expect(new TextEncoder().encode(exact.schema.name)).toHaveLength(64)
    expect(new TextEncoder().encode(exact.schema.description)).toHaveLength(256)
    expectErrorCode(
      () =>
        buildSchemaRegistrationPayment({
          publisher: ISSUER,
          profile,
          schema: {
            xcsVersion: '0.1',
            name: `${'🏁'.repeat(16)}a`,
            description: 'valid',
            fields: { completed: { type: 'bool' } },
          },
        }),
      'SCHEMA_INVALID',
    )
    expectErrorCode(
      () =>
        buildSchemaRegistrationPayment({
          publisher: ISSUER,
          profile,
          schema: {
            xcsVersion: '0.1',
            name: 'valid',
            description: `${'é'.repeat(128)}a`,
            fields: { completed: { type: 'bool' } },
          },
        }),
      'SCHEMA_INVALID',
    )
    expectErrorCode(
      () =>
        buildSchemaRegistrationPayment({
          publisher: ISSUER,
          profile,
          schema: {
            xcsVersion: '0.1',
            name: `invalid${String.fromCharCode(0xd800)}`,
            description: 'valid',
            fields: { completed: { type: 'bool' } },
          },
        }),
      'UTF8_INVALID',
    )
  })

  it('accepts exactly 1,024 serialized memo bytes and rejects 1,025', () => {
    const exactSchema = schemaAtMemoBoundary(MAX_XRPL_MEMO_BYTES)
    const built = buildSchemaRegistrationPayment({
      publisher: ISSUER,
      profile,
      schema: exactSchema,
    })

    expect(built.memoByteLength).toBe(MAX_XRPL_MEMO_BYTES)
    expect(serializedMemoObjectBytes(built.transaction)).toBe(MAX_XRPL_MEMO_BYTES)

    const oversizedSchema = schemaAtMemoBoundary(MAX_XRPL_MEMO_BYTES + 1)
    let error: unknown
    try {
      buildSchemaRegistrationPayment({ publisher: ISSUER, profile, schema: oversizedSchema })
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(XcsSdkError)
    expect(error).toMatchObject({
      code: 'XCS_SDK_MEMO_TOO_LARGE',
      details: {
        byteLength: MAX_XRPL_MEMO_BYTES + 1,
        maxByteLength: MAX_XRPL_MEMO_BYTES,
      },
    })
  })
})
