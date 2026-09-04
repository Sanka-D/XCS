import {
  createHttpsPayloadUri,
  createIpfsPayloadUri,
  encodeCredentialPayload,
  encodeSchema,
  parseCredentialPayload,
  parseNetworkProfile,
  parsePayloadUri,
  parseSchema,
  verifyPayloadIntegrity,
  type JsonValue,
  type NetworkProfile,
  type SchemaDefinition,
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
  submitSignedTransaction,
  type OperationJournal,
} from '@xcs-protocol/sdk'
import { Command } from 'commander'
import { Client } from 'xrpl'

import { CliError } from './errors.js'
import { readJsonFile, writeJson, type CliIo } from './io.js'
import { CompositeOperationJournal, JsonLinesOperationJournal } from './journal.js'

const API_TIMEOUT_MS = 10_000
const MAX_API_RESPONSE_BYTES = 1024 * 1024

export interface CliDependencies {
  readonly io: CliIo
  readonly createClient: (serverUrl: string) => Client
  readonly fetch: typeof globalThis.fetch
}

interface ProfileOptions {
  readonly profile: string
}

interface PayloadOptions {
  readonly schemaFile: string
  readonly issuer: string
  readonly subject: string
  readonly schema: string
}

interface PayloadBuildOptions extends PayloadOptions {
  readonly httpsUrl?: string
  readonly ipfs?: boolean
  readonly output?: string
}

interface PayloadCheckOptions extends PayloadOptions {
  readonly uri: string
}

interface SubmitOptions extends ProfileOptions {
  readonly server: string
  readonly file?: string
  readonly journal?: string
  readonly timeout: string
  readonly pollInterval: string
  readonly failHard?: boolean
}

export function createProgram(dependencies: CliDependencies): Command {
  const { io } = dependencies
  const program = new Command()
    .name('xcs')
    .description('Build, inspect, and submit XCS operations')
    .version('0.1.0-alpha.1')
    .exitOverride()
    .showHelpAfterError()
    .configureOutput({
      writeOut: (value) => io.writeStdout(value),
      writeErr: (value) => io.writeStderr(value),
    })

  registerSchemaCommands(program, dependencies)
  registerPayloadCommands(program, dependencies)
  registerCredentialCommands(program, io)
  registerVerificationCommand(program, dependencies)
  registerTransactionCommands(program, dependencies)
  return program
}

function registerSchemaCommands(program: Command, dependencies: CliDependencies): void {
  const { io } = dependencies
  const schema = program.command('schema').description('Validate and register schemas')

  schema
    .command('validate')
    .argument('<schema-file>', 'schema JSON file')
    .action(async (schemaFile: string) => {
      const parsed = parseSchema(await readJsonFile(io, schemaFile))
      const bytes = encodeSchema(parsed)
      writeJson(io, {
        valid: true,
        schema: parsed,
        canonical: new TextDecoder().decode(bytes),
        byteLength: bytes.length,
      })
    })

  schema
    .command('register')
    .argument('<schema-file>', 'schema JSON file')
    .requiredOption('--profile <file>', 'network profile JSON')
    .requiredOption('--account <address>', 'publisher classic address')
    .action(async (schemaFile: string, options: ProfileOptions & { account: string }) => {
      const [schemaInput, profile] = await Promise.all([
        readJsonFile(io, schemaFile),
        readProfile(io, options.profile),
      ])
      writeJson(
        io,
        buildSchemaRegistrationPayment({
          publisher: options.account,
          profile,
          schema: schemaInput,
        }),
      )
    })

  schema
    .command('uid')
    .argument('<schema-file>', 'registered schema JSON file')
    .requiredOption('--profile <file>', 'network profile JSON')
    .requiredOption('--publisher <address>', 'publisher classic address')
    .requiredOption('--ledger-hash <hash>', 'validated ledger hash')
    .requiredOption('--ledger-index <number>', 'validated ledger index')
    .requiredOption('--transaction-index <number>', 'validated transaction index')
    .requiredOption('--validated-ledger', 'confirm that the ledger context is validated')
    .action(
      async (
        schemaFile: string,
        options: ProfileOptions & {
          publisher: string
          ledgerHash: string
          ledgerIndex: string
          transactionIndex: string
          validatedLedger: true
        },
      ) => {
        const [schemaInput, profile] = await Promise.all([
          readJsonFile(io, schemaFile),
          readProfile(io, options.profile),
        ])
        const ledgerIndex = nonNegativeInteger(options.ledgerIndex, 'ledger-index')
        if (ledgerIndex < profile.activationLedgerIndex) {
          throw new CliError(
            'XCS_CLI_INVALID_LEDGER_CONTEXT',
            'Registration predates this network profile.',
            2,
          )
        }
        writeJson(io, {
          schemaUid: deriveSchemaUid(schemaInput, {
            validated: options.validatedLedger,
            transactionResult: 'tesSUCCESS',
            networkId: profile.networkId,
            ledgerHash: options.ledgerHash,
            ledgerIndex,
            transactionIndex: nonNegativeInteger(options.transactionIndex, 'transaction-index'),
            publisher: options.publisher,
          }),
        })
      },
    )
}

function registerPayloadCommands(program: Command, dependencies: CliDependencies): void {
  const { io } = dependencies
  const payload = program.command('payload').description('Build and verify credential payloads')

  payload
    .command('build')
    .argument('<claims-file>', 'claims JSON file')
    .requiredOption('--schema-file <file>', 'standalone schema JSON file')
    .requiredOption('--issuer <address>', 'issuer classic address')
    .requiredOption('--subject <address>', 'subject classic address')
    .requiredOption('--schema <uid>', 'schema UID')
    .option('--https-url <url>', 'public HTTPS URL without a fragment')
    .option('--ipfs', 'derive an IPFS URI', false)
    .option('--output <file>', 'write the exact payload bytes')
    .action(async (claimsFile: string, options: PayloadBuildOptions) => {
      requireOnePayloadLocation(options)
      const [claims, schema] = await Promise.all([
        readJsonFile(io, claimsFile),
        readStandaloneSchema(io, options.schemaFile),
      ])
      const encoded = encodeCredentialPayload(claims, credentialContext(options, schema))
      const uri =
        options.httpsUrl === undefined
          ? createIpfsPayloadUri(encoded.bytes)
          : createHttpsPayloadUri(options.httpsUrl, encoded.bytes)
      if (options.output !== undefined) await writeFile(io, options.output, encoded.json)
      writeJson(io, {
        payload: encoded.payload,
        canonical: encoded.json,
        byteLength: encoded.bytes.length,
        sha256: parsePayloadUri(uri).digestHex,
        uri,
        ...(options.output === undefined ? {} : { output: options.output }),
      })
    })

  payload
    .command('check')
    .argument('<payload-file>', 'canonical payload JSON file')
    .requiredOption('--schema-file <file>', 'standalone schema JSON file')
    .requiredOption('--issuer <address>', 'issuer classic address')
    .requiredOption('--subject <address>', 'subject classic address')
    .requiredOption('--schema <uid>', 'schema UID')
    .requiredOption('--uri <uri>', 'integrity-bound payload URI')
    .action(async (payloadFile: string, options: PayloadCheckOptions) => {
      const [content, schema] = await Promise.all([
        readFile(io, payloadFile),
        readStandaloneSchema(io, options.schemaFile),
      ])
      const integrity = verifyPayloadIntegrity(content, options.uri)
      if (!integrity.valid) {
        throw new CliError('XCS_CLI_PAYLOAD_INTEGRITY', 'Payload digest does not match URI.', 5, {
          integrity,
        })
      }
      writeJson(io, {
        valid: true,
        payload: parseCredentialPayload(content, credentialContext(options, schema)),
        byteLength: new TextEncoder().encode(content).length,
        sha256: integrity.actualDigestHex,
        uri: options.uri,
      })
    })
}

function registerCredentialCommands(program: Command, io: CliIo): void {
  const credential = program.command('credential').description('Build XRPL Credential transactions')

  credential
    .command('issue')
    .requiredOption('--issuer <address>')
    .requiredOption('--subject <address>')
    .requiredOption('--schema <uid>')
    .requiredOption('--uri <uri>')
    .option('--expiration <iso8601>')
    .action(
      (options: {
        issuer: string
        subject: string
        schema: string
        uri: string
        expiration?: string
      }) => {
        writeJson(io, {
          transaction: buildCredentialCreate({
            issuer: options.issuer,
            subject: options.subject,
            schemaUid: options.schema,
            uri: options.uri,
            ...(options.expiration === undefined ? {} : { expiration: options.expiration }),
          }),
        })
      },
    )

  credential
    .command('accept')
    .requiredOption('--subject <address>')
    .requiredOption('--issuer <address>')
    .requiredOption('--schema <uid>')
    .action((options: { subject: string; issuer: string; schema: string }) => {
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
    .requiredOption('--account <address>')
    .requiredOption('--issuer <address>')
    .requiredOption('--subject <address>')
    .requiredOption('--schema <uid>')
    .action((options: { account: string; issuer: string; subject: string; schema: string }) => {
      writeJson(io, {
        transaction: buildCredentialDelete({
          account: options.account,
          issuer: options.issuer,
          subject: options.subject,
          schemaUid: options.schema,
        }),
      })
    })
}

function registerVerificationCommand(program: Command, dependencies: CliDependencies): void {
  program
    .command('verify')
    .requiredOption('--api <url>')
    .requiredOption('--network <profile-id>')
    .requiredOption('--issuer <address>')
    .requiredOption('--subject <address>')
    .requiredOption('--schema <uid>')
    .option('--payload <file>')
    .option('--resolve-payload', 'allow the API to retrieve the payload', false)
    .action(
      async (options: {
        api: string
        network: string
        issuer: string
        subject: string
        schema: string
        payload?: string
        resolvePayload?: boolean
      }) => {
        if (options.payload !== undefined && options.resolvePayload === true) {
          throw new CliError(
            'XCS_CLI_VERIFY_INPUT',
            'Choose local or remote payload resolution.',
            2,
          )
        }
        const localPayload =
          options.payload === undefined
            ? undefined
            : await readJsonFile(dependencies.io, options.payload)
        const report = await requestJson(dependencies, options.api, 'v1/verify', {
          network: options.network,
          issuer: options.issuer,
          subject: options.subject,
          schemaUid: options.schema,
          ...(localPayload === undefined ? {} : { payload: localPayload }),
          ...(options.resolvePayload === true ? { resolvePayload: true } : {}),
        })
        writeJson(dependencies.io, report)
        if (!isSuccessfulVerification(report)) {
          throw new CliError(
            'XCS_CLI_VERIFICATION_NOT_VALID',
            'Credential is not fully valid.',
            5,
            { report: asDetails(report) },
          )
        }
      },
    )
}

function registerTransactionCommands(program: Command, dependencies: CliDependencies): void {
  const { io } = dependencies
  const transaction = program.command('tx').description('Submit and reconcile transactions')

  transaction
    .command('submit')
    .requiredOption('--server <url>')
    .requiredOption('--profile <file>')
    .option('--file <path>', 'signed blob file; otherwise read stdin')
    .option('--journal <path>', 'append a sanitized JSONL journal')
    .option('--timeout <milliseconds>', 'maximum reconciliation time', '60000')
    .option('--poll-interval <milliseconds>', 'polling interval', '1000')
    .option('--fail-hard', 'ask rippled not to relay a locally failed transaction', false)
    .action(async (options: SubmitOptions) => {
      const [profile, txBlob] = await Promise.all([
        readProfile(io, options.profile),
        readSignedBlob(io, options.file),
      ])
      const client = dependencies.createClient(websocketEndpoint(options.server))
      const memory = new MemoryOperationJournal()
      const journal: OperationJournal =
        options.journal === undefined
          ? memory
          : new CompositeOperationJournal(memory, new JsonLinesOperationJournal(options.journal))
      try {
        await connectAndValidateNetwork(client, profile)
        const result = await submitSignedTransaction(client, txBlob, {
          journal,
          failHard: options.failHard,
          timeoutMs: positiveInteger(options.timeout, 'timeout'),
          pollIntervalMs: positiveInteger(options.pollInterval, 'poll-interval'),
        })
        writeJson(io, { result, journal: memory.entries })
        if (result.status !== 'validated' || result.transactionResult !== 'tesSUCCESS') {
          throw new CliError(
            'XCS_CLI_TRANSACTION_NOT_VALIDATED',
            'Transaction was not validated.',
            4,
            {
              result,
            },
          )
        }
      } finally {
        if (client.isConnected()) await client.disconnect()
      }
    })

  transaction
    .command('status')
    .requiredOption('--server <url>')
    .requiredOption('--profile <file>')
    .requiredOption('--hash <hash>')
    .option('--last-ledger-sequence <number>')
    .action(
      async (
        options: ProfileOptions & {
          server: string
          hash: string
          lastLedgerSequence?: string
        },
      ) => {
        const profile = await readProfile(io, options.profile)
        const client = dependencies.createClient(websocketEndpoint(options.server))
        try {
          await connectAndValidateNetwork(client, profile)
          writeJson(
            io,
            await getTransactionStatus(
              client,
              options.hash,
              options.lastLedgerSequence === undefined
                ? undefined
                : positiveInteger(options.lastLedgerSequence, 'last-ledger-sequence'),
            ),
          )
        } finally {
          if (client.isConnected()) await client.disconnect()
        }
      },
    )
}

async function readProfile(io: CliIo, path: string): Promise<NetworkProfile> {
  return parseNetworkProfile(await readJsonFile(io, path))
}

async function readStandaloneSchema(io: CliIo, path: string): Promise<SchemaDefinition> {
  const schema = parseSchema(await readJsonFile(io, path))
  if (schema.extends !== undefined) {
    throw new CliError(
      'XCS_CLI_SCHEMA_INPUT',
      'Payload commands require resolved fields for inherited schemas.',
      2,
    )
  }
  return schema
}

function credentialContext(options: PayloadOptions, schema: SchemaDefinition) {
  return {
    issuer: options.issuer,
    subject: options.subject,
    schemaUid: options.schema.toLowerCase(),
    fields: schema.fields,
  }
}

async function readFile(io: CliIo, path: string): Promise<string> {
  try {
    return await io.readTextFile(path)
  } catch (cause) {
    throw new CliError('XCS_CLI_FILE_READ', `Cannot read ${path}.`, 2, {
      cause: cause instanceof Error ? cause.message : String(cause),
    })
  }
}

async function writeFile(io: CliIo, path: string, value: string): Promise<void> {
  try {
    await io.writeTextFile(path, value)
  } catch (cause) {
    throw new CliError('XCS_CLI_FILE_WRITE', `Cannot write ${path}.`, 2, {
      cause: cause instanceof Error ? cause.message : String(cause),
    })
  }
}

async function readSignedBlob(io: CliIo, path?: string): Promise<string> {
  if (path === undefined && io.stdinIsTerminal) {
    throw new CliError('XCS_CLI_SIGNED_BLOB_REQUIRED', 'Provide --file or pipe a signed blob.', 2)
  }
  const value = path === undefined ? await io.readStdin() : await readFile(io, path)
  const trimmed = value.trim()
  if (trimmed === '') {
    throw new CliError('XCS_CLI_SIGNED_BLOB_REQUIRED', 'Signed blob input is empty.', 2)
  }
  return trimmed
}

async function requestJson(
  dependencies: CliDependencies,
  api: string,
  path: string,
  body: JsonValue,
): Promise<unknown> {
  const endpoint = apiEndpoint(api, path)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS)
  let response: Response
  let bytes: Uint8Array
  try {
    response = await dependencies.fetch(endpoint, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify(body),
      redirect: 'error',
      signal: controller.signal,
    })
    bytes = await readBoundedResponse(response)
  } catch (cause) {
    if (cause instanceof CliError) throw cause
    throw new CliError('XCS_CLI_NETWORK', 'Cannot reach the XCS API.', 3, {
      cause: cause instanceof Error ? cause.message : String(cause),
    })
  } finally {
    clearTimeout(timeout)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    throw new CliError('XCS_CLI_API_RESPONSE', 'XCS API returned invalid JSON.', 3)
  }
  if (!response.ok) {
    throw new CliError('XCS_CLI_API_RESPONSE', `XCS API returned HTTP ${response.status}.`, 3, {
      response: asDetails(parsed),
    })
  }
  return parsed
}

async function readBoundedResponse(response: Response): Promise<Uint8Array> {
  const contentLength = Number(response.headers.get('content-length') ?? 0)
  if (Number.isFinite(contentLength) && contentLength > MAX_API_RESPONSE_BYTES) {
    throw new CliError('XCS_CLI_API_RESPONSE', 'XCS API response exceeds 1 MiB.', 3)
  }
  if (response.body === null) return new Uint8Array()

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    length += value.length
    if (length > MAX_API_RESPONSE_BYTES) {
      await reader.cancel()
      throw new CliError('XCS_CLI_API_RESPONSE', 'XCS API response exceeds 1 MiB.', 3)
    }
    chunks.push(value)
  }

  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  return bytes
}

function isSuccessfulVerification(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const report = value as Record<string, unknown>
  return report.onChain === 'active' && report.schema === 'valid' && report.payload === 'valid'
}

function asDetails(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : { value }
}

function requireOnePayloadLocation(options: PayloadBuildOptions): void {
  if ((options.httpsUrl === undefined) === (options.ipfs !== true)) {
    throw new CliError(
      'XCS_CLI_PAYLOAD_LOCATION',
      'Choose exactly one of --https-url or --ipfs.',
      2,
    )
  }
}

function positiveInteger(value: string, name: string): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new CliError('XCS_CLI_INVALID_NUMBER', `${name} must be a positive integer.`, 2)
  }
  return parsed
}

function nonNegativeInteger(value: string, name: string): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new CliError('XCS_CLI_INVALID_NUMBER', `${name} must be a non-negative integer.`, 2)
  }
  return parsed
}

function apiEndpoint(api: string, path: string): URL {
  const endpoint = parseUrl(path, api.endsWith('/') ? api : `${api}/`, '--api')
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)
  if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && loopback)) {
    throw new CliError('XCS_CLI_API_INPUT', '--api must use HTTPS or loopback HTTP.', 2)
  }
  if (endpoint.username !== '' || endpoint.password !== '') {
    throw new CliError('XCS_CLI_API_INPUT', '--api cannot contain credentials.', 2)
  }
  return endpoint
}

function websocketEndpoint(input: string): string {
  const endpoint = parseUrl(input, undefined, '--server')
  const loopback =
    endpoint.hostname === 'localhost' ||
    endpoint.hostname === '[::1]' ||
    /^127(?:\.[0-9]{1,3}){3}$/u.test(endpoint.hostname)
  if (endpoint.protocol !== 'wss:' && !(endpoint.protocol === 'ws:' && loopback)) {
    throw new CliError('XCS_CLI_SERVER_INPUT', '--server must use WSS or loopback WS.', 2)
  }
  if (endpoint.username !== '' || endpoint.password !== '' || endpoint.hash !== '') {
    throw new CliError('XCS_CLI_SERVER_INPUT', '--server contains forbidden URL components.', 2)
  }
  return endpoint.toString()
}

function parseUrl(value: string, base: string | undefined, option: string): URL {
  if (value.trim() !== value) {
    throw new CliError('XCS_CLI_USAGE', `${option} cannot contain surrounding whitespace.`, 2)
  }
  try {
    return base === undefined ? new URL(value) : new URL(value, base)
  } catch {
    throw new CliError('XCS_CLI_USAGE', `${option} must be an absolute URL.`, 2)
  }
}
