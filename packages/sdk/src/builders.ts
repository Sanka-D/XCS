import {
  canonicalize,
  computeSchemaUid,
  encodeUtf8Hex,
  iso8601ToRippleTime,
  validateSchema,
  type JsonValue,
  type NetworkProfile,
  type SchemaDefinition,
} from '@xcs-protocol/core'
import type { CredentialAccept, CredentialCreate, CredentialDelete, Payment } from 'xrpl'

import {
  assertMemoFits,
  schemaUidToCredentialType,
  uriToCredentialHex,
  XCS_SCHEMA_MEMO_FORMAT,
  XCS_SCHEMA_MEMO_TYPE,
} from './encoding.js'
import { XcsSdkError } from './errors.js'
import { assertClassicAddress, parseNetworkProfile } from './network.js'

export interface BuildSchemaRegistrationInput {
  readonly publisher: string
  readonly profile: NetworkProfile
  readonly schema: unknown
}

export interface BuiltSchemaRegistration {
  readonly transaction: Payment
  readonly schema: SchemaDefinition
  readonly canonicalSchema: string
}

export interface ValidatedSchemaRegistrationContext {
  readonly validated: true
  readonly transactionResult: 'tesSUCCESS'
  readonly networkId: number
  readonly ledgerHash: string
  readonly ledgerIndex: number
  readonly transactionIndex: number
  readonly publisher: string
}

export interface BuildCredentialCreateInput {
  readonly issuer: string
  readonly subject: string
  readonly schemaUid: string
  readonly uri: string
  readonly expiration?: string
}

export interface BuildCredentialAcceptInput {
  readonly subject: string
  readonly issuer: string
  readonly schemaUid: string
}

export interface BuildCredentialDeleteInput {
  readonly account: string
  readonly issuer: string
  readonly subject: string
  readonly schemaUid: string
}

export type UnsignedXcsTransaction =
  Payment | CredentialCreate | CredentialAccept | CredentialDelete

export function buildSchemaRegistrationPayment(
  input: BuildSchemaRegistrationInput,
): BuiltSchemaRegistration {
  const profile = parseNetworkProfile(input.profile)
  assertClassicAddress(input.publisher, 'publisher')
  const schema = validateSchema(input.schema)
  const canonicalSchema = canonicalize(schema as unknown as JsonValue)
  assertMemoFits(canonicalSchema)

  return {
    transaction: {
      TransactionType: 'Payment',
      Account: input.publisher,
      Destination: profile.registryAddress,
      Amount: profile.registrationAmountDrops,
      Memos: [
        {
          Memo: {
            MemoType: encodeUtf8Hex(XCS_SCHEMA_MEMO_TYPE),
            MemoFormat: encodeUtf8Hex(XCS_SCHEMA_MEMO_FORMAT),
            MemoData: encodeUtf8Hex(canonicalSchema),
          },
        },
      ],
    },
    schema,
    canonicalSchema,
  }
}

export function deriveSchemaUid(
  schemaInput: unknown,
  context: ValidatedSchemaRegistrationContext,
): string {
  if (context.validated !== true || context.transactionResult !== 'tesSUCCESS') {
    throw new XcsSdkError(
      'XCS_SDK_INVALID_VALIDATED_CONTEXT',
      'A schema UID can only be derived from a validated tesSUCCESS registration.',
    )
  }
  assertClassicAddress(context.publisher, 'publisher')
  const schema = validateSchema(schemaInput)

  return computeSchemaUid({
    schema,
    networkId: context.networkId,
    ledgerHash: context.ledgerHash,
    ledgerIndex: context.ledgerIndex,
    transactionIndex: context.transactionIndex,
    publisher: context.publisher,
  })
}

export function buildCredentialCreate(input: BuildCredentialCreateInput): CredentialCreate {
  assertClassicAddress(input.issuer, 'issuer')
  assertClassicAddress(input.subject, 'subject')

  const transaction: CredentialCreate = {
    TransactionType: 'CredentialCreate',
    Account: input.issuer,
    Subject: input.subject,
    CredentialType: schemaUidToCredentialType(input.schemaUid),
    URI: uriToCredentialHex(input.uri),
  }

  if (input.expiration !== undefined) {
    transaction.Expiration = iso8601ToRippleTime(input.expiration)
  }

  return transaction
}

export function buildCredentialAccept(input: BuildCredentialAcceptInput): CredentialAccept {
  assertClassicAddress(input.subject, 'subject')
  assertClassicAddress(input.issuer, 'issuer')

  return {
    TransactionType: 'CredentialAccept',
    Account: input.subject,
    Issuer: input.issuer,
    CredentialType: schemaUidToCredentialType(input.schemaUid),
  }
}

export function buildCredentialDelete(input: BuildCredentialDeleteInput): CredentialDelete {
  assertClassicAddress(input.account, 'account')
  assertClassicAddress(input.issuer, 'issuer')
  assertClassicAddress(input.subject, 'subject')

  const transaction: CredentialDelete = {
    TransactionType: 'CredentialDelete',
    Account: input.account,
    CredentialType: schemaUidToCredentialType(input.schemaUid),
  }

  if (input.account !== input.issuer) {
    transaction.Issuer = input.issuer
  }
  if (input.account !== input.subject) {
    transaction.Subject = input.subject
  }

  if (transaction.Issuer === undefined && transaction.Subject === undefined) {
    // XRPL permits self-issued credentials, but CredentialDelete still requires
    // at least one of Issuer or Subject even when all three accounts are equal.
    transaction.Subject = input.subject
  }

  return transaction
}
