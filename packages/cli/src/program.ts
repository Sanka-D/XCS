import {
  canonicalize,
  computePayloadSha256Hex,
  createHttpsPayloadUri,
  createIpfsRawPayloadUri,
  parseSchemaCatalogBundle,
  parseCredentialPayload,
  parseJsonStrict,
  parseVerificationReport,
  resolveSchemaCatalogBundle,
  sha256Hex,
  validateCredentialPayload,
  validateSchema,
  verifyPayloadIntegrity,
  type JsonValue,
  type ResolvedSchema,
  type SchemaDefinition,
} from '@xcs-protocol/core'
import {
  assertPreparedEnvelopeMatchesProfile,
  assertReadinessAdvancesPreparedCheckpoint,
  assertSignedBlobMatchesPrepared,
  assertTransactionNotExpired,
  assertXcsTransactionSemantics,
  autofillXcsTransaction,
  bindPreparedTransactionContext,
  buildCredentialAccept,
  buildCredentialCreate,
  buildCredentialDelete,
  buildSchemaRegistrationPayment,
  connectAndValidateNetwork,
  createPreparedTransactionEnvelope,
  deriveSchemaUid,
  getTransactionStatus,
  MemoryOperationJournal,
  parseAuthoritativeReadiness,
  parseNetworkProfile,
  submitSignedTransaction,
  verifyNetworkProfileActivation,
  type NetworkProfile,
  type OperationJournal,
  type PreparedXcsTransactionEnvelope,
} from '@xcs-protocol/sdk'
import { Command } from 'commander'
import { Client, type SubmittableTransaction } from 'xrpl'

import { CliError } from './errors.js'
import { readJsonFile, writeJson, type CliIo } from './io.js'
import { CompositeOperationJournal, JsonLinesOperationJournal } from './journal.js'

const API_REQUEST_TIMEOUT_MS = 10_000
const MAX_API_RESPONSE_BYTES = 1024 * 1024
// A compact bundle at every normative maximum (256 schemas, 256 optional
// descriptors per schema, maximum strings and relation metadata) stays below
// 8 MiB. Catalog calls get this separate cap; all other API calls remain 1 MiB.
const MAX_SCHEMA_CATALOG_RESPONSE_BYTES = 8 * 1024 * 1024

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

interface SchemaCatalogOptions {
  readonly api: string
  readonly network: string
  readonly schema: string
  readonly output: string
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
  readonly schemaFile?: string | undefined
  readonly catalog?: string | undefined
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
  readonly api?: string | undefined
  readonly file?: string | undefined
  readonly prepared?: string | undefined
  readonly journal?: string | undefined
  readonly timeout: string
  readonly pollInterval: string
  readonly failHard?: boolean | undefined
}

interface TxPrepareOptions extends CommonProfileOptions {
  readonly server: string
  readonly api: string
  readonly output: string
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

  schema
    .command('catalog')
    .description('Download and validate a complete inherited-schema catalog')
    .requiredOption('--api <url>', 'XCS API base URL')
    .requiredOption('--network <profile-id>', 'network profile ID')
    .requiredOption('--schema <uid>', 'target 64-character XCS schema UID')
    .requiredOption('--output <file>', 'write the validated catalog JSON')
    .action(async (options: SchemaCatalogOptions) => {
      const { catalog, resolved } = await requestSchemaCatalog(
        dependencies,
        options.api,
        options.network,
        options.schema,
      )
      await writeExactJsonFile(io, options.output, catalog)
      writeJson(io, {
        valid: true,
        validationScope: 'internal-consistency',
        xrplRegistrationVerified: false,
        evidenceSource: 'configured-api',
        output: options.output,
        profileId: catalog.profile.profileId,
        targetUid: catalog.targetUid,
        checkpoint: catalog.checkpoint,
        schemaCount: catalog.schemas.length,
        lineage: resolved.resolvedTarget.lineage,
      })
    })

  const payload = program
    .command('payload')
    .description('Build and verify canonical XCS credential payloads')
  payload
    .command('build')
    .description('Build canonical payload bytes and their integrity-bound URI')
    .argument('<claims-file>', 'JSON object containing the public claims')
    .option('--schema-file <file>', 'standalone registered XCS schema definition JSON')
    .option('--catalog <file>', 'validated schema catalog for inherited schemas')
    .requiredOption('--issuer <address>', 'issuer classic address')
    .requiredOption('--subject <address>', 'subject classic address')
    .requiredOption('--schema <uid>', '64-character XCS schema UID')
    .option('--https-url <url>', 'public HTTPS URL without an integrity fragment')
    .option('--ipfs', 'derive a raw CIDv1 IPFS URI instead of an HTTPS URI', false)
    .option('--output <file>', 'write exact canonical payload bytes without a trailing newline')
    .action(async (claimsFile: string, options: PayloadBuildOptions) => {
      assertOnePayloadLocation(options)
      const [claims, schemaDefinition] = await Promise.all([
        readJsonFile(io, claimsFile),
        readPayloadSchema(io, options),
      ])
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
    .option('--schema-file <file>', 'standalone registered XCS schema definition JSON')
    .option('--catalog <file>', 'validated schema catalog for inherited schemas')
    .requiredOption('--issuer <address>', 'issuer classic address')
    .requiredOption('--subject <address>', 'subject classic address')
    .requiredOption('--schema <uid>', '64-character XCS schema UID')
    .requiredOption('--uri <uri>', 'integrity-bound ipfs:// or https:// payload URI')
    .action(async (payloadFile: string, options: PayloadCheckOptions) => {
      const [content, schemaDefinition] = await Promise.all([
        readTextFile(io, payloadFile),
        readPayloadSchema(io, options),
      ])
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
  tx.command('prepare')
    .description('Autofill and bind an unsigned XCS transaction for offline wallet review')
    .argument('<transaction-file>', 'unsigned transaction JSON or builder output')
    .requiredOption('--server <url>', 'history-capable XRPL WebSocket endpoint')
    .requiredOption('--profile <file>', 'exact XCS network profile JSON')
    .requiredOption('--api <url>', 'authoritative XCS API base URL')
    .requiredOption('--output <file>', 'write the prepared transaction envelope')
    .action(async (transactionFile: string, options: TxPrepareOptions) => {
      const serverUrl = websocketEndpoint(options.server)
      apiEndpoint(options.api, '')
      const [{ profile, sha256 }, transactionInput] = await Promise.all([
        readProfileWithDigest(io, options.profile),
        readJsonFile(io, transactionFile),
      ])
      const transaction = extractUnsignedTransaction(transactionInput)
      const semantics = assertXcsTransactionSemantics(transaction, profile)
      const catalog =
        'schemaUid' in semantics
          ? (
              await requestSchemaCatalog(
                dependencies,
                options.api,
                profile.profileId,
                semantics.schemaUid,
              )
            ).catalog
          : undefined
      const readiness = await requestReadiness(dependencies, options.api, profile.profileId)
      if (readiness.profileId !== profile.profileId) {
        throw new CliError(
          'XCS_CLI_API_RESPONSE',
          'Authoritative readiness belongs to a different network profile.',
          3,
        )
      }
      if (catalog !== undefined) {
        if (
          canonicalize(catalog.profile as unknown as JsonValue) !==
          canonicalize(profile as unknown as JsonValue)
        ) {
          throw new CliError(
            'XCS_CLI_API_RESPONSE',
            'Schema catalog is bound to different network profile fields.',
            3,
          )
        }
        if (
          catalog.checkpoint.ledgerIndex > readiness.checkpoint.ledgerIndex ||
          (catalog.checkpoint.ledgerIndex === readiness.checkpoint.ledgerIndex &&
            catalog.checkpoint.ledgerHash !== readiness.checkpoint.ledgerHash)
        ) {
          throw new CliError(
            'XCS_CLI_API_RESPONSE',
            'Authoritative readiness does not cover the schema catalog checkpoint.',
            3,
          )
        }
      }
      const contextBoundTransaction = bindPreparedTransactionContext({
        transaction,
        profile,
        profileSha256: sha256,
        checkpoint: readiness.checkpoint,
      })

      const client = dependencies.createClient(serverUrl)
      try {
        await verifyNetworkProfileActivation(client, profile)
        const prepared = await autofillXcsTransaction(client, contextBoundTransaction)
        const envelope = createPreparedTransactionEnvelope({
          profile,
          profileSha256: sha256,
          checkpoint: readiness.checkpoint,
          transaction: prepared.transaction,
        })
        await writeExactJsonFile(io, options.output, envelope)
        writeJson(io, { preparedTransaction: envelope, output: options.output })
      } finally {
        if (client.isConnected()) await client.disconnect()
      }
    })

  tx.command('submit')
    .description('Submit a signed blob read from stdin or an explicit file')
    .requiredOption('--server <url>', 'XRPL WebSocket endpoint')
    .requiredOption('--profile <file>', 'XCS network profile JSON')
    .option('--prepared <file>', 'prepared transaction envelope reviewed before signing')
    .option('--api <url>', 'authoritative XCS API required with --prepared')
    .option('--file <path>', 'signed transaction blob file; otherwise read stdin')
    .option('--journal <path>', 'append a sanitized JSONL operation journal')
    .option('--timeout <milliseconds>', 'maximum reconciliation time', '60000')
    .option('--poll-interval <milliseconds>', 'reconciliation polling interval', '1000')
    .option('--fail-hard', 'ask rippled not to relay a locally failed transaction', false)
    .action(async (options: TxSubmitOptions) => {
      const serverUrl = websocketEndpoint(options.server)
      const timeoutMs = parsePositiveInteger(options.timeout, 'timeout')
      const pollIntervalMs = parsePositiveInteger(options.pollInterval, 'poll-interval')
      if ((options.prepared === undefined) !== (options.api === undefined)) {
        throw new CliError(
          'XCS_CLI_PREPARED_INPUT',
          '--prepared and --api must be provided together.',
          2,
        )
      }
      if (options.api !== undefined) apiEndpoint(options.api, '')
      const [{ profile, sha256 }, txBlob, envelopeInput] = await Promise.all([
        readProfileWithDigest(io, options.profile),
        readSignedBlob(io, options.file),
        options.prepared === undefined ? undefined : readJsonFile(io, options.prepared),
      ])
      let envelope: PreparedXcsTransactionEnvelope | undefined
      let preparedLastLedgerSequence: number | undefined
      if (envelopeInput !== undefined) {
        if (options.api === undefined) {
          throw new CliError(
            'XCS_CLI_PREPARED_INPUT',
            '--api is required with a prepared transaction.',
            2,
          )
        }
        envelope = assertPreparedEnvelopeMatchesProfile(envelopeInput, profile, sha256)
        preparedLastLedgerSequence = assertSignedBlobMatchesPrepared(
          envelope,
          txBlob,
        ).lastLedgerSequence
      }
      const client = dependencies.createClient(serverUrl)
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
          timeoutMs,
          pollIntervalMs,
          beforeSubmit:
            envelope === undefined ||
            options.api === undefined ||
            preparedLastLedgerSequence === undefined
              ? undefined
              : async () => {
                  const readiness = await requestReadiness(
                    dependencies,
                    options.api as string,
                    profile.profileId,
                  )
                  if (readiness.profileId !== profile.profileId) {
                    throw new CliError(
                      'XCS_CLI_API_RESPONSE',
                      'Authoritative readiness belongs to a different network profile.',
                      3,
                    )
                  }
                  assertReadinessAdvancesPreparedCheckpoint(envelope, readiness)
                  await assertTransactionNotExpired(client, preparedLastLedgerSequence)
                },
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
      const serverUrl = websocketEndpoint(options.server)
      const lastLedgerSequence =
        options.lastLedgerSequence === undefined
          ? undefined
          : parsePositiveInteger(options.lastLedgerSequence, 'last-ledger-sequence')
      const profile = await readProfile(io, options.profile)
      const client = dependencies.createClient(serverUrl)
      try {
        await connectAndValidateNetwork(client, profile)
        const status = await getTransactionStatus(client, options.hash, lastLedgerSequence)
        writeJson(io, status)
      } finally {
        if (client.isConnected()) await client.disconnect()
      }
    })

  return program
}

async function readProfile(io: CliIo, path: string): Promise<NetworkProfile> {
  return (await readProfileWithDigest(io, path)).profile
}

async function readProfileWithDigest(
  io: CliIo,
  path: string,
): Promise<{ readonly profile: NetworkProfile; readonly sha256: string }> {
  const contents = await readTextFile(io, path)
  return {
    profile: parseNetworkProfile(parseJsonStrict(contents)),
    sha256: sha256Hex(new TextEncoder().encode(contents)),
  }
}

function extractUnsignedTransaction(input: JsonValue): SubmittableTransaction {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new CliError(
      'XCS_CLI_PREPARED_INPUT',
      'Transaction input must be a JSON object or builder output containing transaction.',
      2,
    )
  }
  const wrapper = input as Record<string, JsonValue>
  const candidate = Object.hasOwn(wrapper, 'transaction') ? wrapper.transaction : wrapper
  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
    throw new CliError(
      'XCS_CLI_PREPARED_INPUT',
      'Transaction input does not contain a transaction object.',
      2,
    )
  }
  const transaction = candidate as Record<string, JsonValue>
  if (
    typeof transaction.TransactionType !== 'string' ||
    !new Set(['Payment', 'CredentialCreate', 'CredentialAccept', 'CredentialDelete']).has(
      transaction.TransactionType,
    )
  ) {
    throw new CliError(
      'XCS_CLI_PREPARED_INPUT',
      'Transaction input is not a supported XCS transaction type.',
      2,
    )
  }
  if (
    Object.hasOwn(transaction, 'TxnSignature') ||
    Object.hasOwn(transaction, 'Signers') ||
    Object.hasOwn(transaction, 'SigningPubKey')
  ) {
    throw new CliError(
      'XCS_CLI_PREPARED_INPUT',
      'Transaction preparation accepts unsigned transactions only.',
      2,
    )
  }
  return transaction as unknown as SubmittableTransaction
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

async function writeExactJsonFile(io: CliIo, path: string, value: unknown): Promise<void> {
  try {
    await io.writeTextFile(path, `${JSON.stringify(value, null, 2)}\n`)
  } catch (error) {
    throw new CliError('XCS_CLI_FILE_WRITE', `Cannot write ${path}.`, 2, {
      cause: error instanceof Error ? error.message : String(error),
    })
  }
}

async function readPayloadSchema(
  io: CliIo,
  options: PayloadContextOptions,
): Promise<SchemaDefinition | ResolvedSchema> {
  if ((options.schemaFile === undefined) === (options.catalog === undefined)) {
    throw new CliError(
      'XCS_CLI_SCHEMA_INPUT',
      'Choose exactly one schema source: --schema-file or --catalog.',
      2,
    )
  }
  if (options.catalog !== undefined) {
    const bundle = parseSchemaCatalogBundle(await readTextFile(io, options.catalog))
    if (bundle.targetUid !== options.schema.toLowerCase()) {
      throw new CliError(
        'XCS_CLI_SCHEMA_CATALOG_REQUIRED',
        'Schema catalog target does not match --schema.',
        2,
        { targetUid: bundle.targetUid, schemaUid: options.schema.toLowerCase() },
      )
    }
    return resolveSchemaCatalogBundle(bundle).resolvedTarget
  }
  if (options.schemaFile === undefined) {
    throw new CliError('XCS_CLI_SCHEMA_INPUT', '--schema-file is required.', 2)
  }
  return validateStandalonePayloadSchema(await readJsonFile(io, options.schemaFile))
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
): Promise<ReturnType<typeof parseVerificationReport>> {
  const endpoint = apiEndpoint(options.api, 'v1/verify')
  const controller = new AbortController()
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, API_REQUEST_TIMEOUT_MS)
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
    text = await readBoundedApiResponse(response)
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
  try {
    return parseVerificationReport(body)
  } catch (error) {
    throw new CliError(
      'XCS_CLI_API_RESPONSE',
      'XCS API returned an invalid verification report.',
      3,
      { cause: error instanceof Error ? error.message : String(error) },
    )
  }
}

async function requestReadiness(dependencies: CliDependencies, api: string, profileId: string) {
  const body = await requestApiJson(
    dependencies,
    `v1/networks/${encodeURIComponent(profileId)}/readiness`,
    api,
  )
  try {
    return parseAuthoritativeReadiness(body)
  } catch (error) {
    throw new CliError(
      'XCS_CLI_API_RESPONSE',
      'XCS API returned an invalid authoritative readiness response.',
      3,
      { cause: error instanceof Error ? error.message : String(error) },
    )
  }
}

async function requestSchemaCatalog(
  dependencies: CliDependencies,
  api: string,
  profileId: string,
  schemaUid: string,
): Promise<{
  readonly catalog: ReturnType<typeof parseSchemaCatalogBundle>
  readonly resolved: ReturnType<typeof resolveSchemaCatalogBundle>
}> {
  const normalizedUid = schemaUid.toLowerCase()
  const body = await requestApiJson(
    dependencies,
    `v1/networks/${encodeURIComponent(profileId)}/schemas/${encodeURIComponent(
      normalizedUid,
    )}/catalog`,
    api,
    MAX_SCHEMA_CATALOG_RESPONSE_BYTES,
  )
  let catalog: ReturnType<typeof parseSchemaCatalogBundle>
  let resolved: ReturnType<typeof resolveSchemaCatalogBundle>
  try {
    catalog = parseSchemaCatalogBundle(JSON.stringify(body))
    resolved = resolveSchemaCatalogBundle(catalog)
  } catch (error) {
    throw new CliError('XCS_CLI_API_RESPONSE', 'XCS API returned an invalid schema catalog.', 3, {
      cause: error instanceof Error ? error.message : String(error),
    })
  }
  if (catalog.profile.profileId !== profileId || catalog.targetUid !== normalizedUid) {
    throw new CliError(
      'XCS_CLI_API_RESPONSE',
      'XCS API schema catalog does not match the requested network and schema.',
      3,
    )
  }
  return { catalog, resolved }
}

async function requestApiJson(
  dependencies: CliDependencies,
  path: string,
  api: string,
  maxResponseBytes = MAX_API_RESPONSE_BYTES,
): Promise<unknown> {
  const endpoint = apiEndpoint(api, path)
  const controller = new AbortController()
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, API_REQUEST_TIMEOUT_MS)
  let response: Response
  let text: string
  try {
    response = await dependencies.fetch(endpoint, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        'cache-control': 'no-cache',
        pragma: 'no-cache',
      },
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
    })
    text = await readBoundedApiResponse(response, maxResponseBytes)
  } catch (error) {
    if (error instanceof CliError) throw error
    throw new CliError(
      'XCS_CLI_NETWORK',
      timedOut ? 'The XCS API request timed out.' : 'Cannot reach the XCS API.',
      3,
      { cause: error instanceof Error ? error.message : String(error) },
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
    throw new CliError('XCS_CLI_API_RESPONSE', `XCS API returned HTTP ${response.status}.`, 3, {
      response: body,
    })
  }
  return body
}

function apiEndpoint(api: string, path: string): URL {
  let endpoint: URL
  try {
    endpoint = new URL(path, ensureTrailingSlash(api))
  } catch {
    throw new CliError('XCS_CLI_API_INPUT', '--api must be an absolute HTTP(S) URL.', 2)
  }
  const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]'])
  if (
    endpoint.protocol !== 'https:' &&
    !(endpoint.protocol === 'http:' && loopbackHosts.has(endpoint.hostname))
  ) {
    throw new CliError(
      'XCS_CLI_API_INPUT',
      '--api must use HTTPS; HTTP is accepted only for a loopback self-hosted service.',
      2,
    )
  }
  if (endpoint.username !== '' || endpoint.password !== '') {
    throw new CliError('XCS_CLI_API_INPUT', '--api must not contain embedded credentials.', 2)
  }
  return endpoint
}

async function readBoundedApiResponse(
  response: Response,
  maxBytes = MAX_API_RESPONSE_BYTES,
): Promise<string> {
  const limitLabel = `${maxBytes / (1024 * 1024)} MiB`
  const contentLength = response.headers.get('content-length')
  if (contentLength !== null) {
    if (!/^[0-9]+$/u.test(contentLength)) {
      throw new CliError('XCS_CLI_API_RESPONSE', 'XCS API returned an invalid Content-Length.', 3)
    }
    if (Number(contentLength) > maxBytes) {
      throw new CliError(
        'XCS_CLI_API_RESPONSE',
        `XCS API response exceeds the ${limitLabel} limit.`,
        3,
      )
    }
  }

  if (response.body === null) {
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > maxBytes) {
      throw new CliError(
        'XCS_CLI_API_RESPONSE',
        `XCS API response exceeds the ${limitLabel} limit.`,
        3,
      )
    }
    return decodeApiResponse(bytes)
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let byteLength = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      byteLength += next.value.byteLength
      if (byteLength > maxBytes) {
        await reader.cancel('XCS_CLI_API_RESPONSE_TOO_LARGE').catch(() => undefined)
        throw new CliError(
          'XCS_CLI_API_RESPONSE',
          `XCS API response exceeds the ${limitLabel} limit.`,
          3,
        )
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
  return decodeApiResponse(bytes)
}

function decodeApiResponse(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  } catch {
    throw new CliError('XCS_CLI_API_RESPONSE', 'XCS API response is not valid UTF-8.', 3)
  }
}

function isAcceptableVerification(report: ReturnType<typeof parseVerificationReport>): boolean {
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

function websocketEndpoint(input: string): string {
  if (input.trim() !== input) {
    throw new CliError(
      'XCS_CLI_SERVER_INPUT',
      '--server must not contain surrounding whitespace.',
      2,
    )
  }
  let endpoint: URL
  try {
    endpoint = new URL(input)
  } catch {
    throw new CliError('XCS_CLI_SERVER_INPUT', '--server must be an absolute WebSocket URL.', 2)
  }
  if (endpoint.username !== '' || endpoint.password !== '') {
    throw new CliError('XCS_CLI_SERVER_INPUT', '--server must not contain embedded credentials.', 2)
  }
  if (endpoint.hash !== '') {
    throw new CliError('XCS_CLI_SERVER_INPUT', '--server must not contain a URL fragment.', 2)
  }
  const loopback =
    endpoint.hostname === 'localhost' ||
    endpoint.hostname === '[::1]' ||
    /^127(?:\.[0-9]{1,3}){3}$/u.test(endpoint.hostname)
  if (endpoint.protocol !== 'wss:' && !(endpoint.protocol === 'ws:' && loopback)) {
    throw new CliError(
      'XCS_CLI_SERVER_INPUT',
      '--server must use WSS; WS is accepted only for a loopback self-hosted server.',
      2,
    )
  }
  return endpoint.toString()
}
