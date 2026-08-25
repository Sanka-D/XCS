import { isClassicAddress } from './address.js'
import { canonicalize } from './canonicalize.js'
import { validateClaims } from './claims.js'
import { fail, XcsError } from './errors.js'
import { parseJsonStrict } from './strict-json.js'
import { sha256, sha256Hex } from './sha256.js'
import type {
  CredentialPayload,
  CredentialPayloadContext,
  JsonValue,
  ParsedPayloadUri,
  PayloadIntegrityResult,
} from './types.js'
import { bytesToHex, decodeUtf8, encodeUtf8 } from './utf8.js'

const MAX_PAYLOAD_BYTES = 1024 * 1024
const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567'
const PAYLOAD_KEYS = new Set(['xcsVersion', 'issuer', 'subject', 'schema', 'claims'])
const SCHEMA_UID = /^[0-9a-f]{64}$/
const INVALID_RAW_HTTPS_CHARACTER = /[\u0000-\u0020\u007f\\]/
const HTTPS_PREFIX = 'https://'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasValidRawHttpsEnvelope(uri: string): boolean {
  if (!uri.startsWith(HTTPS_PREFIX) || INVALID_RAW_HTTPS_CHARACTER.test(uri)) return false
  const remainder = uri.slice(HTTPS_PREFIX.length)
  const delimiterIndex = remainder.search(/[/?#]/)
  const authority = delimiterIndex === -1 ? remainder : remainder.slice(0, delimiterIndex)
  return authority.length > 0 && !authority.includes('@')
}

function decodeBase32(value: string): Uint8Array | undefined {
  let bits = 0
  let accumulator = 0
  const bytes: number[] = []
  for (const character of value) {
    const digit = BASE32_ALPHABET.indexOf(character)
    if (digit < 0) return undefined
    accumulator = (accumulator << 5) | digit
    bits += 5
    if (bits >= 8) {
      bits -= 8
      bytes.push((accumulator >>> bits) & 0xff)
      accumulator &= (1 << bits) - 1
    }
  }
  if (bits > 0 && accumulator !== 0) return undefined
  return Uint8Array.from(bytes)
}

function encodeBase32(bytes: Uint8Array): string {
  let bits = 0
  let accumulator = 0
  let result = ''
  for (const byte of bytes) {
    accumulator = (accumulator << 8) | byte
    bits += 8
    while (bits >= 5) {
      bits -= 5
      result += BASE32_ALPHABET[(accumulator >>> bits) & 31]
      accumulator &= (1 << bits) - 1
    }
  }
  if (bits > 0) result += BASE32_ALPHABET[(accumulator << (5 - bits)) & 31]
  return result
}

function contentBytes(content: string | Uint8Array): Uint8Array {
  const bytes = typeof content === 'string' ? encodeUtf8(content) : content
  if (!(bytes instanceof Uint8Array)) {
    return fail('PAYLOAD_INVALID', 'Payload content must be UTF-8 text or bytes', '$payload')
  }
  if (bytes.length > MAX_PAYLOAD_BYTES) {
    return fail('PAYLOAD_INVALID', 'Payload exceeds the 1 MiB limit', '$payload', {
      size: bytes.length,
    })
  }
  return bytes
}

export function computePayloadSha256Hex(content: string | Uint8Array): string {
  return sha256Hex(contentBytes(content))
}

export function inspectPayloadUri(uri: string): ParsedPayloadUri {
  if (typeof uri !== 'string' || encodeUtf8(uri).length < 1 || encodeUtf8(uri).length > 256) {
    return fail('PAYLOAD_URI_INVALID', 'Payload URI must contain 1 to 256 UTF-8 bytes', '$uri')
  }

  const ipfs = /^ipfs:\/\/(b[a-z2-7]+)$/.exec(uri)
  if (ipfs !== null) {
    const cid = ipfs[1] ?? ''
    const decoded = decodeBase32(cid.slice(1))
    if (
      decoded === undefined ||
      decoded.length !== 36 ||
      cid.length !== 59 ||
      encodeBase32(decoded) !== cid.slice(1) ||
      decoded[0] !== 0x01 ||
      decoded[1] !== 0x55 ||
      decoded[2] !== 0x12 ||
      decoded[3] !== 0x20
    ) {
      return fail(
        'PAYLOAD_URI_INVALID',
        'IPFS URI must contain a CIDv1 raw sha2-256 CID in lowercase base32',
        '$uri',
      )
    }
    return {
      kind: 'ipfs',
      uri,
      cid,
      digestHex: bytesToHex(decoded.subarray(4)),
    }
  }

  if (!hasValidRawHttpsEnvelope(uri)) {
    return fail(
      'PAYLOAD_URI_INVALID',
      'HTTPS URI must use literal https://, a non-empty authority without userinfo, and no raw ASCII whitespace, control, or backslash',
      '$uri',
    )
  }

  let parsed: URL
  try {
    parsed = new URL(uri)
  } catch (cause) {
    return fail('PAYLOAD_URI_INVALID', 'Payload URI is not a valid URL', '$uri', {
      cause: String(cause),
    })
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    !/^#xcs-sha256=[0-9a-f]{64}$/.test(parsed.hash)
  ) {
    return fail(
      'PAYLOAD_URI_INVALID',
      'HTTPS URI must have no credentials and end in #xcs-sha256=<lowercase-sha256>',
      '$uri',
    )
  }
  const digestHex = parsed.hash.slice('#xcs-sha256='.length)
  parsed.hash = ''
  return { kind: 'https', uri, fetchUrl: parsed.toString(), digestHex }
}

export function createHttpsPayloadUri(baseUrl: string, content: string | Uint8Array): string {
  let url: URL
  try {
    url = new URL(baseUrl)
  } catch (cause) {
    return fail('PAYLOAD_URI_INVALID', 'HTTPS base URL is invalid', '$url', {
      cause: String(cause),
    })
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.hash !== '') {
    return fail(
      'PAYLOAD_URI_INVALID',
      'HTTPS base URL must use https, contain no credentials, and have no fragment',
      '$url',
    )
  }
  url.hash = `xcs-sha256=${computePayloadSha256Hex(content)}`
  const result = url.toString()
  inspectPayloadUri(result)
  return result
}

export function createIpfsRawPayloadUri(content: string | Uint8Array): string {
  const digest = sha256(contentBytes(content))
  const cidBytes = Uint8Array.from([0x01, 0x55, 0x12, 0x20, ...digest])
  const uri = `ipfs://b${encodeBase32(cidBytes)}`
  inspectPayloadUri(uri)
  return uri
}

export function verifyPayloadIntegrity(
  content: string | Uint8Array,
  uri: string,
): PayloadIntegrityResult {
  const bytes = contentBytes(content)
  const actualDigestHex = sha256Hex(bytes)
  try {
    const parsed = inspectPayloadUri(uri)
    return {
      status: parsed.digestHex === actualDigestHex ? 'valid' : 'tampered',
      expectedDigestHex: parsed.digestHex,
      actualDigestHex,
    }
  } catch (error) {
    if (error instanceof XcsError && error.code === 'PAYLOAD_URI_INVALID') {
      return { status: 'invalid_uri', actualDigestHex }
    }
    throw error
  }
}

export function validateCredentialPayload(
  input: unknown,
  context: CredentialPayloadContext,
): CredentialPayload {
  if (!isRecord(input)) return fail('PAYLOAD_INVALID', 'Credential payload must be an object', '$')
  for (const key of Object.keys(input)) {
    if (!PAYLOAD_KEYS.has(key)) {
      return fail('PAYLOAD_INVALID', `Unknown payload property ${key}`, `$.${key}`)
    }
  }
  if (input.xcsVersion !== '0.1') {
    return fail('PAYLOAD_INVALID', 'Payload xcsVersion must be 0.1', '$.xcsVersion')
  }
  if (
    typeof input.issuer !== 'string' ||
    !isClassicAddress(input.issuer) ||
    input.issuer !== context.issuer
  ) {
    return fail('PAYLOAD_INVALID', 'Payload issuer does not match the credential', '$.issuer')
  }
  if (
    typeof input.subject !== 'string' ||
    !isClassicAddress(input.subject) ||
    input.subject !== context.subject
  ) {
    return fail('PAYLOAD_INVALID', 'Payload subject does not match the credential', '$.subject')
  }
  if (
    typeof input.schema !== 'string' ||
    !SCHEMA_UID.test(input.schema) ||
    input.schema !== context.schemaUid
  ) {
    return fail('PAYLOAD_INVALID', 'Payload schema does not match CredentialType', '$.schema')
  }
  return {
    xcsVersion: '0.1',
    issuer: input.issuer,
    subject: input.subject,
    schema: input.schema,
    claims: validateClaims(input.claims, context.schema),
  }
}

export function parseCredentialPayload(
  content: string | Uint8Array,
  context: CredentialPayloadContext,
): CredentialPayload {
  const bytes = contentBytes(content)
  const text = decodeUtf8(bytes)
  const parsed = parseJsonStrict(text)
  const payload = validateCredentialPayload(parsed, context)
  const canonical = canonicalize(payload as JsonValue)
  if (canonical !== text) {
    return fail(
      'PAYLOAD_INVALID',
      'Credential payload bytes are not RFC 8785 canonical JSON',
      '$payload',
    )
  }
  return payload
}
