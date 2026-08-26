import tr46 from 'tr46'

import { isClassicAddress } from './address.js'
import { canonicalize } from './canonicalize.js'
import { validateClaims } from './claims.js'
import { fail, XcsError } from './errors.js'
import { validateSchema } from './schema.js'
import { parseJsonStrict } from './strict-json.js'
import { sha256, sha256Hex } from './sha256.js'
import type {
  CredentialPayload,
  CredentialPayloadContext,
  JsonValue,
  ParsedPayloadUri,
  PayloadIntegrityResult,
  PayloadRetrievalEvidence,
  PayloadVerificationStatus,
} from './types.js'
import { bytesToHex, decodeUtf8, encodeUtf8 } from './utf8.js'

const MAX_PAYLOAD_BYTES = 1024 * 1024
const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567'
const PAYLOAD_KEYS = new Set(['xcsVersion', 'issuer', 'subject', 'schema', 'claims'])
const SCHEMA_UID = /^[0-9a-f]{64}$/
const INVALID_RAW_HTTPS_CHARACTER = /[\u0000-\u0020\u007f\\]/
const INVALID_NORMALIZED_HOST_ASCII = '/?#@:[]\\%<>^|`{}'
const CANONICAL_HTTPS_PATH_ASCII =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~!$&'()*+,;=:@/"
const CANONICAL_HTTPS_QUERY_ASCII =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~!$&()*+,;=:@/?'
const HTTPS_PREFIX = 'https://'
const IPV4_MAPPED_IPV6_HOST = /^\[::ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}\]$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function payloadSchemaFields(context: CredentialPayloadContext) {
  if ('definition' in context.schema && 'lineage' in context.schema) {
    return context.schema.fields
  }
  const definition = validateSchema(context.schema)
  if (definition.extends !== undefined) {
    return fail(
      'SCHEMA_PARENT_NOT_FOUND',
      'Cannot validate payload claims against an unresolved inherited schema',
      '$.extends',
    )
  }
  return definition.fields
}

function hasValidRawHttpsEnvelope(uri: string): boolean {
  if (!uri.startsWith(HTTPS_PREFIX) || INVALID_RAW_HTTPS_CHARACTER.test(uri)) return false
  const remainder = uri.slice(HTTPS_PREFIX.length)
  const delimiterIndex = remainder.search(/[/?#]/)
  const authority = delimiterIndex === -1 ? remainder : remainder.slice(0, delimiterIndex)
  return authority.length > 0 && !authority.includes('@')
}

function normalizeHttpsPortSuffix(portSuffix: string): string | undefined {
  if (portSuffix === '') return ''
  if (!/^:\d*$/.test(portSuffix)) return undefined
  const digits = portSuffix.slice(1)
  if (digits === '') return ''
  let port = 0
  for (const digit of digits) {
    port = port * 10 + Number(digit)
    if (port > 65535) return undefined
  }
  return port === 443 ? '' : `:${String(port)}`
}

function hasInvalidNormalizedHostCharacter(host: string): boolean {
  for (const character of host) {
    const codePoint = character.codePointAt(0) ?? 0
    if (
      codePoint <= 0x20 ||
      codePoint === 0x7f ||
      INVALID_NORMALIZED_HOST_ASCII.includes(character)
    ) {
      return true
    }
  }
  return false
}

function normalizeHttpsAuthority(uri: string): string | undefined {
  const remainder = uri.slice(HTTPS_PREFIX.length)
  const delimiterIndex = remainder.search(/[/?#]/)
  const authority = delimiterIndex === -1 ? remainder : remainder.slice(0, delimiterIndex)
  const suffix = delimiterIndex === -1 ? '' : remainder.slice(delimiterIndex)

  if (authority.startsWith('[')) {
    const closingBracket = authority.indexOf(']')
    if (closingBracket === -1 || authority.includes('%')) return undefined
    const portSuffix = authority.slice(closingBracket + 1)
    const normalizedPort = normalizeHttpsPortSuffix(portSuffix)
    if (normalizedPort === undefined) return undefined
    try {
      const addressUrl = new URL(`${HTTPS_PREFIX}${authority}/`)
      if (IPV4_MAPPED_IPV6_HOST.test(addressUrl.hostname)) return undefined
      return `${HTTPS_PREFIX}${addressUrl.hostname}${normalizedPort}${suffix}`
    } catch {
      return undefined
    }
  }
  if ([...authority].filter((character) => character === ':').length > 1) return undefined

  const portSeparator = authority.lastIndexOf(':')
  const host = portSeparator === -1 ? authority : authority.slice(0, portSeparator)
  const portSuffix = portSeparator === -1 ? '' : authority.slice(portSeparator)
  const normalizedPort = normalizeHttpsPortSuffix(portSuffix)
  if (normalizedPort === undefined) return undefined

  let decodedHost: string
  try {
    decodedHost = decodeURIComponent(host)
  } catch {
    return undefined
  }
  const asciiHost = tr46.toASCII(decodedHost, {
    checkBidi: true,
    checkHyphens: false,
    checkJoiners: true,
    transitionalProcessing: false,
    useSTD3ASCIIRules: false,
    verifyDNSLength: false,
  })
  if (asciiHost === null || asciiHost === '' || hasInvalidNormalizedHostCharacter(asciiHost)) {
    return undefined
  }
  try {
    const hostUrl = new URL(`${HTTPS_PREFIX}${asciiHost}${normalizedPort}/`)
    return `${HTTPS_PREFIX}${hostUrl.host}${suffix}`
  } catch {
    return undefined
  }
}

function hasCanonicalHttpsComponent(value: string, allowedAscii: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] ?? ''
    if (character === '%') {
      const escape = value.slice(index + 1, index + 3)
      if (!/^[0-9A-Fa-f]{2}$/.test(escape)) return false
      index += 2
    } else if (!allowedAscii.includes(character)) {
      return false
    }
  }
  return true
}

function canonicalHttpsFetchUrl(normalizedUri: string): string | undefined {
  const fragmentIndex = normalizedUri.indexOf('#')
  if (fragmentIndex === -1) return undefined
  const withoutFragment = normalizedUri.slice(0, fragmentIndex)
  const remainder = withoutFragment.slice(HTTPS_PREFIX.length)
  const resourceIndex = remainder.search(/[/?]/)
  const authority = resourceIndex === -1 ? remainder : remainder.slice(0, resourceIndex)
  const resource = resourceIndex === -1 ? '' : remainder.slice(resourceIndex)
  const queryIndex = resource.indexOf('?')
  const path = queryIndex === -1 ? resource : resource.slice(0, queryIndex)
  const query = queryIndex === -1 ? undefined : resource.slice(queryIndex + 1)

  if (
    !hasCanonicalHttpsComponent(path, CANONICAL_HTTPS_PATH_ASCII) ||
    (query !== undefined && !hasCanonicalHttpsComponent(query, CANONICAL_HTTPS_QUERY_ASCII)) ||
    path.split('/').some((segment) => {
      const normalizedDots = segment.replaceAll(/%2e/gi, '.')
      return normalizedDots === '.' || normalizedDots === '..'
    })
  ) {
    return undefined
  }
  return `${HTTPS_PREFIX}${authority}${path === '' ? '/' : path}${
    query === undefined ? '' : `?${query}`
  }`
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

  const normalizedUri = normalizeHttpsAuthority(uri)
  if (normalizedUri === undefined) {
    return fail('PAYLOAD_URI_INVALID', 'HTTPS authority is invalid', '$uri')
  }
  const fetchUrl = canonicalHttpsFetchUrl(normalizedUri)
  if (fetchUrl === undefined) {
    return fail('PAYLOAD_URI_INVALID', 'HTTPS path or query is not canonical', '$uri')
  }

  let parsed: URL
  try {
    parsed = new URL(normalizedUri)
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
  return { kind: 'https', uri, fetchUrl, digestHex }
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

export function classifyCredentialPayload(
  retrieval: PayloadRetrievalEvidence,
  uri: string,
  context: CredentialPayloadContext,
): PayloadVerificationStatus {
  try {
    inspectPayloadUri(uri)
  } catch (error) {
    if (error instanceof XcsError) return 'invalid'
    throw error
  }

  if (retrieval.status === 'unavailable') return 'unavailable'

  try {
    const integrity = verifyPayloadIntegrity(retrieval.content, uri)
    if (integrity.status === 'tampered') return 'tampered'
    if (integrity.status === 'invalid_uri') return 'invalid'
    parseCredentialPayload(retrieval.content, context)
    return 'valid'
  } catch (error) {
    if (error instanceof XcsError) return 'invalid'
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
    claims: validateClaims(input.claims, payloadSchemaFields(context)),
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
