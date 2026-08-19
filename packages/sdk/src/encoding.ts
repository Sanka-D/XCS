import { decodeUtf8Hex, encodeUtf8Hex, inspectPayloadUri } from '@xcs-protocol/core'
import { encode, type Payment } from 'xrpl'

import { XcsSdkError } from './errors.js'

export const XCS_SCHEMA_MEMO_TYPE = 'xcs:schema_register'
export const XCS_SCHEMA_MEMO_FORMAT = 'application/json'
export const MAX_XRPL_MEMO_BYTES = 1_024
export const MAX_CREDENTIAL_URI_BYTES = 256

const SCHEMA_UID_PATTERN = /^[0-9a-f]{64}$/u
const CREDENTIAL_TYPE_PATTERN = /^[0-9a-fA-F]{64}$/u
const HEX_PATTERN = /^(?:[0-9a-fA-F]{2})+$/u

export function schemaUidToCredentialType(schemaUid: string): string {
  if (!SCHEMA_UID_PATTERN.test(schemaUid)) {
    throw new XcsSdkError(
      'XCS_SDK_INVALID_SCHEMA_UID',
      'Schema UID must be exactly 32 bytes represented by 64 lowercase hexadecimal characters.',
      { schemaUid },
    )
  }

  return schemaUid.toUpperCase()
}

export function credentialTypeToSchemaUid(credentialType: string): string {
  if (!CREDENTIAL_TYPE_PATTERN.test(credentialType)) {
    throw new XcsSdkError(
      'XCS_SDK_INVALID_SCHEMA_UID',
      'CredentialType must contain exactly 32 bytes of hexadecimal data.',
      { credentialType },
    )
  }

  return credentialType.toLowerCase()
}

export function uriToCredentialHex(uri: string): string {
  const bytes = new TextEncoder().encode(uri)
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_CREDENTIAL_URI_BYTES) {
    throw new XcsSdkError(
      'XCS_SDK_INVALID_URI',
      `Credential URI must contain between 1 and ${MAX_CREDENTIAL_URI_BYTES} UTF-8 bytes.`,
      { byteLength: bytes.byteLength },
    )
  }

  inspectPayloadUri(uri)

  return encodeUtf8Hex(uri)
}

export function credentialHexToUri(uriHex: string): string {
  if (!HEX_PATTERN.test(uriHex)) {
    throw new XcsSdkError('XCS_SDK_INVALID_URI', 'Credential URI is not valid hexadecimal.')
  }

  const uri = decodeUtf8Hex(uriHex)
  uriToCredentialHex(uri)
  return uri
}

export function assertMemoFits(canonicalSchema: string): void {
  const base: Payment = {
    TransactionType: 'Payment',
    Account: 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh',
    Destination: 'r9cZA1mLK5R5Am25ArfXFmqgNwjZgnfk59',
    Amount: '1',
    Fee: '12',
    Sequence: 1,
    SigningPubKey: '',
  }
  const withMemo: Payment = {
    ...base,
    Memos: [
      {
        Memo: {
          MemoType: encodeUtf8Hex(XCS_SCHEMA_MEMO_TYPE),
          MemoFormat: encodeUtf8Hex(XCS_SCHEMA_MEMO_FORMAT),
          MemoData: encodeUtf8Hex(canonicalSchema),
        },
      },
    ],
  }
  const byteLength = (encode(withMemo).length - encode(base).length) / 2

  if (byteLength > MAX_XRPL_MEMO_BYTES) {
    throw new XcsSdkError(
      'XCS_SDK_MEMO_TOO_LARGE',
      `XCS schema memo content exceeds the ${MAX_XRPL_MEMO_BYTES}-byte XRPL limit.`,
      { byteLength, maxByteLength: MAX_XRPL_MEMO_BYTES },
    )
  }
}
