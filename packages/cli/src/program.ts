import {
  canonicalize,
  computePayloadSha256Hex,
  createHttpsPayloadUri,
  createIpfsRawPayloadUri,
  parseCredentialPayload,
  parseJsonStrict,
  validateCredentialPayload,
  validateSchema,
  verifyPayloadIntegrity,
  type JsonValue,
} from '@xcs-protocol/core'
import {
  buildCredentialAccept,
  buildCredentialCreate,
  buildCredentialDelete,
  buildSchemaRegistrationPayment,
  connectAndValidateNetwork,
  deriveSchemaUid,
  getTransactionStatus,
  MemoryOperationJournal,
  parseNetworkProfile,
  submitSignedTransaction,
  type NetworkProfile,
  type OperationJournal,
} from '@xcs-protocol/sdk'
import { Command } from 'commander'
import { Client } from 'xrpl'

import { CliError } from './errors.js'
import { readJsonFile, writeJson, type CliIo } from './io.js'
import { CompositeOperationJournal, JsonLinesOperationJournal } from './journal.js'

const VERIFICATION_REQUEST_TIMEOUT_MS = 10_000
const MAX_VERIFICATION_RESPONSE_BYTES = 1024 * 1024

export interface CliDependencies {
  readonly io: CliIo
  readonly createClient: (serverUrl: string) => Client
  readonly fetch: typeof globalThis.fetch
}

interface CommonProfileOptions {
  readonly profile: string
}

interface SchemaRegisterOptions extends CommonProfileOptions {
  readonly account: string
}

interface SchemaUidOptions extends CommonProfileOptions {
  readonly publisher: string
  readonly ledgerHash: string
  readonly ledgerIndex: string
  readonly transactionIndex: string
  readonly validatedLedger: true
}

interface CredentialIssueOptions {
  readonly issuer: string
  readonly subject: string
  readonly schema: string
  readonly uri: string
  readonly expiration?: string | undefined
}

interface CredentialAcceptOptions {
  readonly subject: string
  readonly issuer: string
  readonly schema: string
}

interface CredentialDeleteOptions {
  readonly account: string
  readonly issuer: string
  readonly subject: string
  readonly schema: string
}

interface CredentialVerifyOptions {
  readonly api: string
  readonly network: string
  readonly issuer: string
  readonly subject: string
  readonly schema: string
  readonly payload?: string | undefined
  readonly resolvePayload?: boolean | undefined
}

interface PayloadContextOptions {
  readonly issuer: string
  readonly subject: string
  readonly schema: string
  readonly schemaFile: string
}

interface PayloadBuildOptions extends PayloadContextOptions {
  readonly httpsUrl?: string | undefined
  readonly ipfs?: boolean | undefined
  readonly output?: string | undefined
}

interface PayloadCheckOptions extends PayloadContextOptions {
  readonly uri: string
}

interface TxSubmitOptions extends CommonProfileOptions {
  readonly server: string
  readonly file?: string | undefined
  readonly journal?: string | undefined
  readonly timeout: string
  readonly pollInterval: string
  readonly failHard?: boolean | undefined
}

interface TxStatusOptions extends CommonProfileOptions {
  readonly server: string
  readonly hash: string
  readonly lastLedgerSequence?: string | undefined
}

export function createProgram(dependencies: CliDependencies): Command {
  const { io } = dependencies
  const program = new Command()
    .name('xcs')
    .description('XCS protocol command line interface')
    .version('0.1.0-alpha.1')
    .exitOverride()
    .showHelpAfterError()
    .configureOutput({
      writeOut: (value) => io.writeStdout(value),
      writeErr: (value) => io.writeStderr(value),
    })

  const schema = program.command('schema').description('Validate and register XCS schemas')
  schema
    .command('validate')
    .description('Validate a schema and print its canonical representation')
    .argument('<schema-file>', 'JSON schema file')
    .action(async (schemaFile: string) => {
      const input = await readJsonFile(io, schemaFile)
      const validated = validateSchema(input)
      const canonical = canonicalize(validated as unknown as JsonValue)
      writeJson(io, {
        valid: true,
        schema: validated,
        canonical,
        byteLength: new TextEncoder().encode(canonical).byteLength,
      })
    })

  schema
    .command('register')
    .description('Build an unsigned schema registration Payment')
    .argument('<schema-file>', 'JSON schema file')
    .requiredOption('--profile <file>', 'XCS network profile JSON')
    .requiredOption('--account <address>', 'publisher classic address')
    .action(async (schemaFile: string, options: SchemaRegisterOptions) => {
      const [schemaInput, profile] = await Promise.all([
        readJsonFile(io, schemaFile),
        readProfile(io, options.profile),
      ])
      const built = buildSchemaRegistrationPayment({
        publisher: options.account,
        profile,
        schema: schemaInput,
      })
      writeJson(io, built)
    })

  schema
    .command('uid')
    .description('Derive a schema UID from an explicitly validated ledger context')
    .argument('<schema-file>', 'the exact registered JSON schema file')
    .requiredOption('--profile <file>', 'XCS network profile JSON')
    .requiredOption('--publisher <address>', 'publisher classic address')
    .requiredOption('--ledger-hash <hash>', 'validated ledger hash')
    .requiredOption('--ledger-index <number>', 'validated ledger index')
    .requiredOption('--transaction-index <number>', 'transaction index from validated metadata')
    .requiredOption('--validated-ledger', 'assert that the supplied context is validated')
    .action(async (schemaFile: string, options: SchemaUidOptions) => {
      const [schemaInput, profile] = await Promise.all([
        readJsonFile(io, schemaFile),
        readProfile(io, options.profile),
      ])
      const ledgerIndex = parseNonNegativeInteger(options.ledgerIndex, 'ledger-index')
      if (ledgerIndex < profile.activationLedgerIndex) {
        throw new CliError(
          'XCS_CLI_INVALID_LEDGER_CONTEXT',
          'Registration ledger precedes this XCS network profile activation.',
          2,
          { activationLedgerIndex: profile.activationLedgerIndex, ledgerIndex },
        )
      }
      const uid = deriveSchemaUid(schemaInput, {
        validated: options.validatedLedger,
        transactionResult: 'tesSUCCESS',
        networkId: profile.networkId,
        ledgerHash: options.ledgerHash,
        ledgerIndex,
        transactionIndex: parseNonNegativeInteger(options.transactionIndex, 'transaction-index'),
        publisher: options.publisher,
      })
      writeJson(io, { schemaUid: uid })
    })

  const payload = program
    .command('payload')
    .description('Build and verify canonical XCS credential payloads')
  payload
    .command('build')
    .description('Build canonical payload bytes and their integrity-bound URI')
    .argument('<claims-file>', 'JSON object containing the public claims')
    .requiredOption('--schema-file <file>', 'registered XCS schema definition JSON')
    .requiredOption('--issuer <address>', 'issuer classic address')
    .requiredOption('--subject <address>', 'subject classic address')
    .requiredOption('--schema <uid>', '64-character XCS schema UID')
    .option('--https-url <url>', 'public HTTPS URL without an integrity fragment')
    .option('--ipfs', 'derive a raw CIDv1 IPFS URI instead of an HTTPS URI', false)
    .option('--output <file>', 'write exact canonical payload bytes without a trailing newline')
    .action(async (claimsFile: string, options: PayloadBuildOptions) => {
      assertOnePayloadLocation(options)
      const [claims, schemaInput] = await Promise.all([
        readJsonFile(io, claimsFile),
        readJsonFile(io, options.schemaFile),
      ])
      const schemaDefinition = validateStandalonePayloadSchema(schemaInput)
      const credentialPayload = validateCredentialPayload(
        {
          xcsVersion: '0.1',
          issuer: options.issuer,
          subject: options.subject,
          schema: options.schema.toLowerCase(),
          claims,
        },
        {
          issuer: options.issuer,
          subject: options.subject,
          schemaUid: options.schema.toLowerCase(),
          schema: schemaDefinition,
        },
      )
      const canonical = canonicalize(credentialPayload as JsonValue)
      const uri =
        options.httpsUrl === undefined
          ? createIpfsRawPayloadUri(canonical)
          : createHttpsPayloadUri(options.httpsUrl, canonical)
      if (options.output !== undefined) {
        await writeExactPayloadFile(io, options.output, canonical)
      }
      writeJson(io, {
        payload: credentialPayload,
        canonical,
        byteLength: new TextEncoder().encode(canonical).byteLength,
        sha256: computePayloadSha256Hex(canonical),
        uri,
        ...(options.output !== undefined ? { output: options.output } : {}),
      })
    })

  payload
    .command('check')
    .description('Validate canonical payload bytes and compare them with an integrity-bound URI')
    .argument('<payload-file>', 'canonical XCS credential payload file')
    .requiredOption('--schema-file <file>', 'registered XCS schema definition JSON')
    .requiredOption('--issuer <address>', 'issuer classic address')
    .requiredOption('--subject <address>', 'subject classic address')
    .requiredOption('--schema <uid>', '64-character XCS schema UID')
    .requiredOption('--uri <uri>', 'integrity-bound ipfs:// or https:// payload URI')
    .action(async (payloadFile: string, options: PayloadCheckOptions) => {
      const [content, schemaInput] = await Promise.all([
        readTextFile(io, payloadFile),
        readJsonFile(io, options.schemaFile),
      ])
      const schemaDefinition = validateStandalonePayloadSchema(schemaInput)
      const parsed = parseCredentialPayload(content, {
        issuer: options.issuer,
        subject: options.subject,
        schemaUid: options.schema.toLowerCase(),
        schema: schemaDefinition,
      })
      const integrity = verifyPayloadIntegrity(content, options.uri)
      if (integrity.status !== 'valid') {
        throw new CliError(
          'XCS_CLI_PAYLOAD_INTEGRITY',
          `Payload integrity check returned ${integrity.status}.`,
          5,
          { integrity },
        )
      }
      writeJson(io, {
        valid: true,
        payload: parsed,
        byteLength: new TextEncoder().encode(content).byteLength,
        sha256: computePayloadSha256Hex(content),
        uri: options.uri,
        integrity,
      })
    })

  const credential = program.command('credential').description('Manage native XRPL Credentials')
  credential
    .command('issue')
    .description('Build an unsigned CredentialCreate transaction')
    .requiredOption('--issuer <address>', 'issuer classic address')
    .requiredOption('--subject <address>', 'subject classic address')
    .requiredOption('--schema <uid>', '64-character XCS schema UID')
    .requiredOption('--uri <uri>', 'integrity-bound ipfs:// or https:// payload URI')
    .option(
      '--expiration <iso8601>',
      'optional ISO-8601 expiration; omit for a permanent credential',
    )
    .action((options: CredentialIssueOptions) => {
      writeJson(io, {
        transaction: buildCredentialCreate({
          issuer: options.issuer,
          subject: options.subject,
          schemaUid: options.schema,
          uri: options.uri,
          ...(options.expiration === undefined ? {} : { expiration: options.expiration }),
        }),
      })
    })

  credential
    .command('accept')
    .description('Build an unsigned CredentialAccept transaction')
    .requiredOption('--subject <address>', 'subject classic address')
    .requiredOption('--issuer <address>', 'issuer classic address')
    .requiredOption('--schema <uid>', '64-character XCS schema UID')
    .action((options: CredentialAcceptOptions) => {
      writeJson(io, {
        transaction: buildCredentialAccept({
          subject: options.subject,
          issuer: options.issuer,
          schemaUid: options.schema,
        }),
      })
    })

  credential
    .command('delete')
    .description('Build an unsigned CredentialDelete transaction')
    .requiredOption('--account <address>', 'submitting classic address')
    .requiredOption('--issuer <address>', 'issuer classic address')
    .requiredOption('--subject <address>', 'subject classic address')
    .requiredOption('--schema <uid>', '64-character XCS schema UID')
    .action((options: CredentialDeleteOptions) => {
      writeJson(io, {
        transaction: buildCredentialDelete({
          account: options.account,
          issuer: options.issuer,
          subject: options.subject,
          schemaUid: options.schema,
        }),
      })
    })

  credential
    .command('verify')
    .description('Request an exact credential verification from an XCS API')
    .requiredOption('--api <url>', 'XCS API base URL')
    .requiredOption('--network <profile-id>', 'network profile ID')
    .requiredOption('--issuer <address>', 'issuer classic address')
    .requiredOption('--subject <address>', 'subject classic address')
    .requiredOption('--schema <uid>', '64-character XCS schema UID')
    .option('--payload <file>', 'optional local credential payload JSON')
    .option('--resolve-payload', 'allow the API to resolve the on-chain URI', false)
    .action(async (options: CredentialVerifyOptions) => {
      if (options.payload !== undefined && options.resolvePayload === true) {
        throw new CliError(
          'XCS_CLI_VERIFY_INPUT',
          '--payload and --resolve-payload are mutually exclusive.',
          2,
        )
      }
      const payload =
        options.payload === undefined ? undefined : await readJsonFile(io, options.payload)
      const response = await requestVerification(dependencies, options, payload)
      writeJson(io, response)
      if (!isAcceptableVerification(response)) {
        throw new CliError(
          'XCS_CLI_VERIFICATION_NOT_VALID',
          'Credential verification did not produce a fully valid result.',
          5,
          { report: response },
        )
      }
    })

  const tx = program.command('tx').description('Submit and reconcile signed XRPL transactions')
  tx.command('submit')
    .description('Submit a signed blob read from stdin or an explicit file')
    .requiredOption('--server <url>', 'XRPL WebSocket endpoint')
    .requiredOption('--profile <file>', 'XCS network profile JSON')
    .option('--file <path>', 'signed transaction blob file; otherwise read stdin')
    .option('--journal <path>', 'append a sanitized JSONL operation journal')
    .option('--timeout <milliseconds>', 'maximum reconciliation time', '60000')
    .option('--poll-interval <milliseconds>', 'reconciliation polling interval', '1000')
    .option('--fail-hard', 'ask rippled not to relay a locally failed transaction', false)
    .action(async (options: TxSubmitOptions) => {
      const [profile, txBlob] = await Promise.all([
        readProfile(io, options.profile),
        readSignedBlob(io, options.file),
      ])
      const client = dependencies.createClient(options.server)
      const memoryJournal = new MemoryOperationJournal()
      const journal: OperationJournal =
        options.journal === undefined
          ? memoryJournal
          : new CompositeOperationJournal(
              memoryJournal,
              new JsonLinesOperationJournal(options.journal),
            )
      try {
        await connectAndValidateNetwork(client, profile)
        const result = await submitSignedTransaction(client, txBlob, {
          journal,
          failHard: options.failHard,
          timeoutMs: parsePositiveInteger(options.timeout, 'timeout'),
          pollIntervalMs: parsePositiveInteger(options.pollInterval, 'poll-interval'),
        })
        writeJson(io, { result, journal: memoryJournal.entries })
        if (result.status !== 'validated' || result.transactionResult !== 'tesSUCCESS') {
          throw new CliError(
            'XCS_CLI_TRANSACTION_NOT_VALIDATED',
            `Transaction ended with status ${result.status} and result ${result.transactionResult ?? 'unknown'}.`,
            4,
            { result },
          )
        }
      } finally {
        if (client.isConnected()) await client.disconnect()
      }
    })

  tx.command('status')
    .description('Look up a transaction by hash without submitting it')
    .requiredOption('--server <url>', 'XRPL WebSocket endpoint')
    .requiredOption('--profile <file>', 'XCS network profile JSON')
    .requiredOption('--hash <hash>', 'XRPL transaction hash')
    .option('--last-ledger-sequence <number>', 'detect an expired unvalidated transaction')
    .action(async (options: TxStatusOptions) => {
      const profile = await readProfile(io, options.profile)
      const client = dependencies.createClient(options.server)
      try {
        await connectAndValidateNetwork(client, profile)
        const status = await getTransactionStatus(
          client,
          options.hash,
          options.lastLedgerSequence === undefined
            ? undefined
            : parsePositiveInteger(options.lastLedgerSequence, 'last-ledger-sequence'),
        )
        writeJson(io, status)
      } finally {
        if (client.isConnected()) await client.disconnect()
      }
    })

  return program
}

async function readProfile(io: CliIo, path: string): Promise<NetworkProfile> {
  return parseNetworkProfile(await readJsonFile(io, path))
}

async function readSignedBlob(io: CliIo, path?: string): Promise<string> {
  if (path === undefined && io.stdinIsTerminal) {
    throw new CliError(
      'XCS_CLI_SIGNED_BLOB_REQUIRED',
      'Pipe a signed blob on stdin or provide --file. Inline blob arguments are intentionally unsupported.',
      2,
    )
  }
  let input: string
  try {
    input = path === undefined ? await io.readStdin() : await io.readTextFile(path)
  } catch (error) {
    throw new CliError('XCS_CLI_FILE_READ', 'Cannot read the signed blob input.', 2, {
      cause: error instanceof Error ? error.message : String(error),
    })
  }
  const trimmed = input.trim()
  if (trimmed.length === 0) {
    throw new CliError('XCS_CLI_SIGNED_BLOB_REQUIRED', 'Signed blob input is empty.', 2)
  }
  return trimmed
}

async function readTextFile(io: CliIo, path: string): Promise<string> {
  try {
    return await io.readTextFile(path)
  } catch (error) {
    throw new CliError('XCS_CLI_FILE_READ', `Cannot read ${path}.`, 2, {
      cause: error instanceof Error ? error.message : String(error),
    })
  }
}

async function writeExactPayloadFile(io: CliIo, path: string, content: string): Promise<void> {
  try {
    await io.writeTextFile(path, content)
  } catch (error) {
    throw new CliError('XCS_CLI_FILE_WRITE', `Cannot write ${path}.`, 2, {
      cause: error instanceof Error ? error.message : String(error),
    })
  }
}

function validateStandalonePayloadSchema(input: JsonValue) {
  const schema = validateSchema(input)
  if (schema.extends !== undefined) {
    throw new CliError(
      'XCS_CLI_SCHEMA_CATALOG_REQUIRED',
      'Payload commands require a fully standalone schema; inherited schemas need a resolved catalog.',
      2,
      { extends: schema.extends },
    )
  }
  return schema
}

function assertOnePayloadLocation(options: PayloadBuildOptions): void {
  if ((options.httpsUrl === undefined) === (options.ipfs !== true)) {
    throw new CliError(
      'XCS_CLI_PAYLOAD_LOCATION',
      'Choose exactly one payload location: --https-url or --ipfs.',
      2,
    )
  }
}

async function requestVerification(
  dependencies: CliDependencies,
  options: CredentialVerifyOptions,
  payload: JsonValue | undefined,
): Promise<unknown> {
  let endpoint: URL
  try {
    endpoint = new URL('v1/verify', ensureTrailingSlash(options.api))
  } catch {
    throw new CliError('XCS_CLI_VERIFY_INPUT', '--api must be an absolute HTTP(S) URL.', 2)
  }
  const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]'])
  if (
    endpoint.protocol !== 'https:' &&
    !(endpoint.protocol === 'http:' && loopbackHosts.has(endpoint.hostname))
  ) {
    throw new CliError(
      'XCS_CLI_VERIFY_INPUT',
      '--api must use HTTPS; HTTP is accepted only for a loopback self-hosted service.',
      2,
    )
  }
  const controller = new AbortController()
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, VERIFICATION_REQUEST_TIMEOUT_MS)
  let response: Response
  let text: string
  try {
    response = await dependencies.fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      redirect: 'error',
      signal: controller.signal,
      body: JSON.stringify({
        network: options.network,
        issuer: options.issuer,
        subject: options.subject,
        schemaUid: options.schema,
        ...(payload === undefined ? {} : { payload }),
        ...(options.resolvePayload === true ? { resolvePayload: true } : {}),
      }),
    })
    text = await readBoundedVerificationResponse(response)
  } catch (error) {
    if (error instanceof CliError) throw error
    throw new CliError(
      'XCS_CLI_NETWORK',
      timedOut
        ? 'The XCS verification API request timed out.'
        : 'Cannot reach the XCS verification API.',
      3,
      {
        cause: error instanceof Error ? error.message : String(error),
      },
    )
  } finally {
    clearTimeout(timeout)
  }

  let body: unknown
  try {
    body = parseJsonStrict(text)
  } catch {
    throw new CliError(
      'XCS_CLI_API_RESPONSE',
      `XCS API returned non-JSON content with HTTP ${response.status}.`,
      3,
    )
  }
  if (!response.ok) {
    const apiErrorCode =
      typeof body === 'object' &&
      body !== null &&
      typeof (body as { error?: unknown }).error === 'string'
        ? (body as { error: string }).error
        : undefined
    const indexerUnavailableCodes = new Set([
      'INDEXER_STALE',
      'INDEXER_NOT_INITIALIZED',
      'INDEXER_STATUS_UNAVAILABLE',
      'INDEXER_NOT_READY',
      'INDEXER_HALTED',
      'INDEXER_LEASE_EXPIRED',
      'INDEXER_EVIDENCE_INVALID',
    ])
    if (response.status === 503 && apiErrorCode && indexerUnavailableCodes.has(apiErrorCode)) {
      throw new CliError(
        'XCS_CLI_INDEXER_UNAVAILABLE',
        'The XCS API cannot provide a fresh indexed proof.',
        3,
        { response: body },
      )
    }
    throw new CliError('XCS_CLI_API_RESPONSE', `XCS API returned HTTP ${response.status}.`, 3, {
      response: body,
    })
  }
  return body
}

async function readBoundedVerificationResponse(response: Response): Promise<string> {
  const contentLength = response.headers.get('content-length')
  if (contentLength !== null) {
    if (!/^[0-9]+$/u.test(contentLength)) {
      throw new CliError('XCS_CLI_API_RESPONSE', 'XCS API returned an invalid Content-Length.', 3)
    }
    if (Number(contentLength) > MAX_VERIFICATION_RESPONSE_BYTES) {
      throw new CliError('XCS_CLI_API_RESPONSE', 'XCS API response exceeds the 1 MiB limit.', 3)
    }
  }

  if (response.body === null) {
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > MAX_VERIFICATION_RESPONSE_BYTES) {
      throw new CliError('XCS_CLI_API_RESPONSE', 'XCS API response exceeds the 1 MiB limit.', 3)
    }
    return new TextDecoder().decode(bytes)
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let byteLength = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      byteLength += next.value.byteLength
      if (byteLength > MAX_VERIFICATION_RESPONSE_BYTES) {
        await reader.cancel('XCS_CLI_API_RESPONSE_TOO_LARGE').catch(() => undefined)
        throw new CliError('XCS_CLI_API_RESPONSE', 'XCS API response exceeds the 1 MiB limit.', 3)
      }
      chunks.push(next.value)
    }
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

function isAcceptableVerification(input: unknown): boolean {
  if (typeof input !== 'object' || input === null) return false
  const report = input as Record<string, unknown>
  return report.onChain === 'active' && report.schema === 'valid' && report.payload === 'valid'
}

function parsePositiveInteger(value: string, field: string): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new CliError('XCS_CLI_INVALID_NUMBER', `${field} must be a positive safe integer.`, 2)
  }
  return parsed
}

function parseNonNegativeInteger(value: string, field: string): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new CliError('XCS_CLI_INVALID_NUMBER', `${field} must be a non-negative safe integer.`, 2)
  }
  return parsed
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`
}
