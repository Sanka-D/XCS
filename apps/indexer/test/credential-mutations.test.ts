import { createIpfsRawPayloadUri } from '@xcs-protocol/core'
import { describe, expect, it } from 'vitest'

import {
  CREDENTIAL_ACCEPTED_FLAG,
  extractCredentialMutations,
} from '../src/credential-mutations.js'
import type { LedgerTransaction } from '../src/types.js'

const SCHEMA_UID = 'a'.repeat(64)
const OBJECT_ID = 'b'.repeat(64)
const TX_HASH = 'c'.repeat(64)
const ISSUER = 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh'
const SUBJECT = 'rLs1MzkFWCxTbuAHgjeTZK4fcCDDnf2KRv'

function transaction(
  affectedNode: Record<string, unknown>,
  tx: Record<string, unknown> = {
    TransactionType: 'CredentialCreate',
    Account: ISSUER,
  },
  result = 'tesSUCCESS',
): LedgerTransaction {
  return {
    hash: TX_HASH,
    transaction: tx,
    metadata: { TransactionResult: result, AffectedNodes: [affectedNode] },
    transactionIndex: 0,
  }
}

function credentialFields(overrides: Record<string, unknown> = {}) {
  return {
    Issuer: ISSUER,
    Subject: SUBJECT,
    CredentialType: SCHEMA_UID.toUpperCase(),
    URI: Buffer.from(createIpfsRawPayloadUri('example'), 'utf8').toString('hex').toUpperCase(),
    Flags: 0,
    ...overrides,
  }
}

describe('extractCredentialMutations', () => {
  it('extracts a native Credential creation for a known XCS schema', () => {
    const result = extractCredentialMutations(
      transaction({
        CreatedNode: {
          LedgerEntryType: 'Credential',
          LedgerIndex: OBJECT_ID.toUpperCase(),
          NewFields: credentialFields(),
        },
      }),
      1_000,
      new Set([SCHEMA_UID]),
    )

    expect(result).toEqual({
      malformedCredentialNodes: 0,
      mutations: [
        expect.objectContaining({
          eventType: 'created',
          schemaUid: SCHEMA_UID,
          ledgerObjectId: OBJECT_ID,
          accepted: false,
        }),
      ],
    })
  })

  it('extracts acceptance from a ModifiedNode', () => {
    const result = extractCredentialMutations(
      transaction(
        {
          ModifiedNode: {
            LedgerEntryType: 'Credential',
            LedgerIndex: OBJECT_ID,
            PreviousFields: { Flags: 0 },
            FinalFields: credentialFields({ Flags: CREDENTIAL_ACCEPTED_FLAG }),
          },
        },
        { TransactionType: 'CredentialAccept', Account: SUBJECT },
      ),
      1_000,
      new Set([SCHEMA_UID]),
    )

    expect(result.mutations[0]).toMatchObject({
      eventType: 'accepted',
      accepted: true,
    })
  })

  it('does not filter deletion effects from tec transactions', () => {
    const result = extractCredentialMutations(
      transaction(
        {
          DeletedNode: {
            LedgerEntryType: 'Credential',
            LedgerIndex: OBJECT_ID,
            FinalFields: credentialFields({ Expiration: 999 }),
          },
        },
        { TransactionType: 'CredentialAccept', Account: SUBJECT },
        'tecEXPIRED',
      ),
      1_000,
      new Set([SCHEMA_UID]),
    )

    expect(result.mutations[0]).toMatchObject({
      eventType: 'deleted',
      deletionCause: 'expired_cleanup',
    })
  })

  it('classifies AccountDelete independently from transaction success', () => {
    const result = extractCredentialMutations(
      transaction(
        {
          DeletedNode: {
            LedgerEntryType: 'Credential',
            LedgerIndex: OBJECT_ID,
            FinalFields: credentialFields({
              Flags: CREDENTIAL_ACCEPTED_FLAG,
              Expiration: 999,
            }),
          },
        },
        { TransactionType: 'AccountDelete', Account: SUBJECT },
      ),
      1_000,
      new Set([SCHEMA_UID]),
    )

    expect(result.mutations[0]?.deletionCause).toBe('account_deleted')
  })

  it('ignores native credentials whose type is not an indexed schema', () => {
    const result = extractCredentialMutations(
      transaction({
        CreatedNode: {
          LedgerEntryType: 'Credential',
          LedgerIndex: OBJECT_ID,
          NewFields: credentialFields(),
        },
      }),
      1_000,
      new Set(),
    )
    expect(result.mutations).toEqual([])
  })

  it('does not project a known schema as XCS without a supported integrity URI', () => {
    const result = extractCredentialMutations(
      transaction({
        CreatedNode: {
          LedgerEntryType: 'Credential',
          LedgerIndex: OBJECT_ID,
          NewFields: credentialFields({
            URI: Buffer.from('https://issuer.example/no-integrity-fragment', 'utf8').toString(
              'hex',
            ),
          }),
        },
      }),
      1_000,
      new Set([SCHEMA_UID]),
    )

    expect(result).toEqual({ mutations: [], malformedCredentialNodes: 1 })
  })
})
