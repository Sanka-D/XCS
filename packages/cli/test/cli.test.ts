import {
  canonicalize,
  computeSchemaUid,
  createHttpsPayloadUri,
  sha256Hex,
  validateSchema,
  type JsonValue,
} from '@xcs-protocol/core'
import {
  bindPreparedTransactionContext,
  buildCredentialCreate,
  buildSchemaRegistrationPayment,
  createPreparedTransactionEnvelope,
} from '@xcs-protocol/sdk'
import { Wallet, type Client } from 'xrpl'
import { describe, expect, it, vi } from 'vitest'

import { createProgram, runCli, type CliIo } from '../src/index.js'

const ISSUER = 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh'
const SUBJECT = 'r9cZA1mLK5R5Am25ArfXFmqgNwjZgnfk59'
const UID = '12'.repeat(32)
const REGISTRY = 'rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe'
const TEST_WALLET = Wallet.fromEntropy(Uint8Array.from({ length: 16 }, (_, index) => index + 1))
const schema = {
  xcsVersion: '0.1',
  name: 'Course completion',
  description: 'Successful completion of a course.',
  fields: { programId: { type: 'string' } },
}
const profile = {
  profileId: 'xrpl-testnet-xcs-v0.1',
  xcsVersion: '0.1',
  networkId: 1,
  requiredAmendment: 'AB'.repeat(32),
  registryAddress: REGISTRY,
  registrationAmountDrops: '1',
  activationLedgerIndex: 1,
  activationLedgerHash: 'CD'.repeat(32),
} as const

const readinessCheckpoint = {
  ledgerIndex: 100,
  ledgerHash: '34'.repeat(32),
  closeTime: 800_000_000,
  transactionRoot: '56'.repeat(32),
}

function preparedRegistrationFixture() {
  const profileText = JSON.stringify(profile)
  const profileSha256 = sha256Hex(new TextEncoder().encode(profileText))
  const transaction = bindPreparedTransactionContext({
    transaction: {
      ...buildSchemaRegistrationPayment({ publisher: ISSUER, profile, schema }).transaction,
      Fee: '12',
      Sequence: 1,
      LastLedgerSequence: 120,
    },
    profile,
    profileSha256,
    checkpoint: readinessCheckpoint,
  })
  const envelope = createPreparedTransactionEnvelope({
    profile,
    profileSha256,
    checkpoint: readinessCheckpoint,
    transaction,
  })
  return { profileText, transaction, envelope, txBlob: TEST_WALLET.sign(transaction).tx_blob }
}

function schemaCatalogFixture() {
  const definition = validateSchema(schema)
  const ledgerHash = '78'.repeat(32)
  const uid = computeSchemaUid({
    networkId: profile.networkId,
    ledgerHash,
    ledgerIndex: 10,
    transactionIndex: 2,
    publisher: ISSUER,
    schema: definition,
  })
  return {
    uid,
    bundle: {
      format: 'xcs-schema-catalog/1',
      profile,
      targetUid: uid,
      checkpoint: { ledgerIndex: 10, ledgerHash },
      schemas: [
        {
          uid,
          definition,
          publisher: ISSUER,
          ledgerIndex: 10,
          ledgerHash,
          transactionIndex: 2,
          transactionHash: '90'.repeat(32),
        },
      ],
    },
  }
}

let cachedMaximumSchemaCatalog:
  | { readonly uid: string; readonly bundle: Record<string, unknown>; readonly text: string }
  | undefined

function maximumSchemaCatalogFixture() {
  if (cachedMaximumSchemaCatalog !== undefined) return cachedMaximumSchemaCatalog

  const fields = Object.fromEntries(
    Array.from({ length: 256 }, (_, index) => [
      `f${index.toString(36).padStart(63, 'a')}`,
      { type: 'address', optional: true },
    ]),
  )
  const schemas: Array<Record<string, unknown>> = []
  let previousUid: string | undefined
  for (let index = 0; index < 256; index += 1) {
    const ledgerIndex = 10 + index
    const ledgerHash = (0x1_000 + index).toString(16).padStart(64, '0')
    const definition = validateSchema({
      xcsVersion: '0.1',
      name: '"'.repeat(64),
      description: '\\'.repeat(256),
      ...(previousUid === undefined ? {} : { supersedes: previousUid }),
      fields,
    })
    const uid = computeSchemaUid({
      networkId: profile.networkId,
      ledgerHash,
      ledgerIndex,
      transactionIndex: 0,
      publisher: ISSUER,
      schema: definition,
    })
    schemas.push({
      uid,
      definition,
      publisher: ISSUER,
      ledgerIndex,
      ledgerHash,
      transactionIndex: 0,
      transactionHash: (0x5_000 + index).toString(16).padStart(64, '0'),
    })
    previousUid = uid
  }
  if (previousUid === undefined) throw new Error('Maximum schema catalog fixture is empty')
  const checkpointLedgerIndex = 10 + schemas.length - 1
  const checkpointLedgerHash = (0x1_000 + schemas.length - 1).toString(16).padStart(64, '0')
  const bundle = {
    format: 'xcs-schema-catalog/1',
    profile,
    targetUid: previousUid,
    checkpoint: {
      ledgerIndex: checkpointLedgerIndex,
      ledgerHash: checkpointLedgerHash,
    },
    schemas,
  }
  cachedMaximumSchemaCatalog = { uid: previousUid, bundle, text: JSON.stringify(bundle) }
  return cachedMaximumSchemaCatalog
}

function inheritedSchemaCatalogFixture() {
  const rootLedgerHash = '71'.repeat(32)
  const root = validateSchema({
    xcsVersion: '0.1',
    name: 'Course identity',
    description: 'Identifies the completed course.',
    fields: { courseId: { type: 'string' } },
  })
  const rootUid = computeSchemaUid({
    networkId: profile.networkId,
    ledgerHash: rootLedgerHash,
    ledgerIndex: 10,
    transactionIndex: 1,
    publisher: ISSUER,
    schema: root,
  })
  const childLedgerHash = '72'.repeat(32)
  const child = validateSchema({
    xcsVersion: '0.1',
    name: 'Course result',
    description: 'Adds the public course result.',
    extends: rootUid,
    fields: { passed: { type: 'bool' } },
  })
  const childUid = computeSchemaUid({
    networkId: profile.networkId,
    ledgerHash: childLedgerHash,
    ledgerIndex: 11,
    transactionIndex: 1,
    publisher: ISSUER,
    schema: child,
  })
  return {
    childUid,
    bundle: {
      format: 'xcs-schema-catalog/1',
      profile,
      targetUid: childUid,
      checkpoint: { ledgerIndex: 11, ledgerHash: childLedgerHash },
      schemas: [
        {
          uid: rootUid,
          definition: root,
          publisher: ISSUER,
          ledgerIndex: 10,
          ledgerHash: rootLedgerHash,
          transactionIndex: 1,
          transactionHash: '73'.repeat(32),
        },
        {
          uid: childUid,
          definition: child,
          publisher: ISSUER,
          ledgerIndex: 11,
          ledgerHash: childLedgerHash,
          transactionIndex: 1,
          transactionHash: '74'.repeat(32),
        },
      ],
    },
  }
}

function memoryIo(files: Record<string, string> = {}): {
  io: CliIo
  stdout: string[]
  stderr: string[]
  writtenFiles: Record<string, string>
} {
  const stdout: string[] = []
  const stderr: string[] = []
  const writtenFiles: Record<string, string> = {}
  return {
    stdout,
    stderr,
    writtenFiles,
    io: {
      stdinIsTerminal: true,
      readStdin: async () => '',
      readTextFile: async (path) => {
        const contents = files[path]
        if (contents === undefined) throw new Error('not found')
        return contents
      },
      writeTextFile: async (path, value) => {
        writtenFiles[path] = value
      },
      writeStdout: (value) => stdout.push(value),
      writeStderr: (value) => stderr.push(value),
    },
  }
}

describe('xcs CLI', () => {
  it('exposes every planned command without key-management flags', () => {
    const { io } = memoryIo()
    const program = createProgram({
      io,
      createClient: () => {
        throw new Error('not used')
      },
      fetch: async () => Promise.resolve(new Response()),
    })
    const commands = Object.fromEntries(
      program.commands.map((command) => [
        command.name(),
        command.commands.map((child) => child.name()),
      ]),
    )
    expect(commands).toEqual({
      schema: ['validate', 'register', 'uid', 'catalog'],
      payload: ['build', 'check'],
      credential: ['issue', 'accept', 'delete', 'verify'],
      tx: ['prepare', 'submit', 'status'],
    })
    expect(program.helpInformation()).not.toMatch(/seed|private-key/u)
  })

  it('validates, registers, and derives UIDs only with validated ledger evidence', async () => {
    const files = {
      'schema.json': JSON.stringify(schema),
      'profile.json': JSON.stringify(profile),
    }

    const validation = memoryIo(files)
    await expect(
      runCli(['node', 'xcs', 'schema', 'validate', 'schema.json'], { io: validation.io }),
    ).resolves.toBe(0)
    expect(JSON.parse(validation.stdout[0] ?? '{}')).toMatchObject({ valid: true, schema })

    const registration = memoryIo(files)
    await expect(
      runCli(
        [
          'node',
          'xcs',
          'schema',
          'register',
          'schema.json',
          '--profile',
          'profile.json',
          '--account',
          ISSUER,
        ],
        { io: registration.io },
      ),
    ).resolves.toBe(0)
    expect(JSON.parse(registration.stdout[0] ?? '{}')).toMatchObject({
      transaction: { TransactionType: 'Payment', Amount: '1', Destination: REGISTRY },
      memoByteLength: expect.any(Number),
    })

    const uid = memoryIo(files)
    await expect(
      runCli(
        [
          'node',
          'xcs',
          'schema',
          'uid',
          'schema.json',
          '--profile',
          'profile.json',
          '--publisher',
          ISSUER,
          '--ledger-hash',
          '34'.repeat(32),
          '--ledger-index',
          '10',
          '--transaction-index',
          '2',
          '--validated-ledger',
        ],
        { io: uid.io },
      ),
    ).resolves.toBe(0)
    expect(JSON.parse(uid.stdout[0] ?? '{}').schemaUid).toMatch(/^[0-9a-f]{64}$/u)
  })

  it('downloads, validates, resolves, and writes a schema catalog', async () => {
    const fixture = schemaCatalogFixture()
    const captured = memoryIo()
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      Promise.resolve(
        new Response(JSON.stringify(fixture.bundle), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )

    const code = await runCli(
      [
        'node',
        'xcs',
        'schema',
        'catalog',
        '--api',
        'https://xcs.example/base',
        '--network',
        profile.profileId,
        '--schema',
        fixture.uid,
        '--output',
        'catalog.json',
      ],
      { io: captured.io, fetch: fetchMock },
    )

    expect(code).toBe(0)
    expect(JSON.parse(captured.writtenFiles['catalog.json'] ?? '{}')).toMatchObject({
      format: 'xcs-schema-catalog/1',
      targetUid: fixture.uid,
    })
    expect(JSON.parse(captured.stdout[0] ?? '{}')).toMatchObject({
      valid: true,
      validationScope: 'internal-consistency',
      xrplRegistrationVerified: false,
      evidenceSource: 'configured-api',
      targetUid: fixture.uid,
      schemaCount: 1,
    })
    const [endpoint, request] = fetchMock.mock.calls[0] ?? []
    expect(String(endpoint)).toBe(
      `https://xcs.example/base/v1/networks/${profile.profileId}/schemas/${fixture.uid}/catalog`,
    )
    expect(request).toEqual(
      expect.objectContaining({ method: 'GET', cache: 'no-store', redirect: 'error' }),
    )
  })

  it.each(['declared', 'streamed'] as const)(
    'accepts a maximum-entry schema catalog above 1 MiB when its size is %s',
    async (transport) => {
      const fixture = maximumSchemaCatalogFixture()
      const byteLength = new TextEncoder().encode(fixture.text).byteLength
      expect(byteLength).toBeGreaterThan(1024 * 1024)
      expect(byteLength).toBeLessThanOrEqual(8 * 1024 * 1024)
      const captured = memoryIo()
      const io: CliIo = {
        ...captured.io,
        writeTextFile: async () => undefined,
      }
      const response = new Response(fixture.text, {
        status: 200,
        headers: {
          'content-type': 'application/json',
          ...(transport === 'declared' ? { 'content-length': String(byteLength) } : {}),
        },
      })

      const code = await runCli(
        [
          'node',
          'xcs',
          'schema',
          'catalog',
          '--api',
          'https://xcs.example',
          '--network',
          profile.profileId,
          '--schema',
          fixture.uid,
          '--output',
          'catalog.json',
        ],
        { io, fetch: async () => response },
      )

      expect(code).toBe(0)
      expect(JSON.parse(captured.stdout[0] ?? '{}')).toMatchObject({
        valid: true,
        targetUid: fixture.uid,
        schemaCount: 256,
      })
    },
    30_000,
  )

  it.each(['declared', 'streamed'] as const)(
    'accepts the catalog transport boundary and rejects one extra %s byte',
    async (transport) => {
      const limit = 8 * 1024 * 1024
      const fixture = schemaCatalogFixture()
      const compact = JSON.stringify(fixture.bundle)
      const exact = compact + ' '.repeat(limit - new TextEncoder().encode(compact).byteLength)

      for (const [body, expectedCode] of [
        [exact, 0],
        [`${exact} `, 3],
      ] as const) {
        const captured = memoryIo()
        const byteLength = new TextEncoder().encode(body).byteLength
        const response = new Response(body, {
          status: 200,
          headers: {
            'content-type': 'application/json',
            ...(transport === 'declared' ? { 'content-length': String(byteLength) } : {}),
          },
        })
        const code = await runCli(
          [
            'node',
            'xcs',
            'schema',
            'catalog',
            '--api',
            'https://xcs.example',
            '--network',
            profile.profileId,
            '--schema',
            fixture.uid,
            '--output',
            'catalog.json',
          ],
          { io: captured.io, fetch: async () => response },
        )

        expect(code).toBe(expectedCode)
        if (expectedCode === 3) {
          expect(JSON.parse(captured.stderr.at(-1) ?? '{}')).toMatchObject({
            error: {
              code: 'XCS_CLI_API_RESPONSE',
              message: expect.stringContaining('8 MiB'),
            },
          })
        }
      }
    },
    30_000,
  )

  it('classifies a structurally valid but unresolvable remote catalog as an API failure', async () => {
    const fixture = inheritedSchemaCatalogFixture()
    const root = fixture.bundle.schemas[0]!
    const child = fixture.bundle.schemas[1]!
    const conflictingDefinition = validateSchema({
      ...child.definition,
      fields: { courseId: { type: 'bool' } },
    })
    const conflictingUid = computeSchemaUid({
      networkId: profile.networkId,
      ledgerHash: child.ledgerHash,
      ledgerIndex: child.ledgerIndex,
      transactionIndex: child.transactionIndex,
      publisher: child.publisher,
      schema: conflictingDefinition,
    })
    const remoteBundle = {
      ...fixture.bundle,
      targetUid: conflictingUid,
      schemas: [root, { ...child, uid: conflictingUid, definition: conflictingDefinition }],
    }
    const captured = memoryIo()

    const code = await runCli(
      [
        'node',
        'xcs',
        'schema',
        'catalog',
        '--api',
        'https://xcs.example',
        '--network',
        profile.profileId,
        '--schema',
        conflictingUid,
        '--output',
        'catalog.json',
      ],
      {
        io: captured.io,
        fetch: async () => new Response(JSON.stringify(remoteBundle), { status: 200 }),
      },
    )

    expect(code).toBe(3)
    expect(captured.writtenFiles).not.toHaveProperty('catalog.json')
    expect(JSON.parse(captured.stderr.at(-1) ?? '{}')).toMatchObject({
      error: { code: 'XCS_CLI_API_RESPONSE' },
    })
  })

  it('prints an unsigned CredentialCreate as JSON without accepting a seed', async () => {
    const { io, stdout, stderr } = memoryIo()
    const uri = createHttpsPayloadUri('https://issuer.example/credential.json', '{}')
    const code = await runCli(
      [
        'node',
        'xcs',
        'credential',
        'issue',
        '--issuer',
        ISSUER,
        '--subject',
        SUBJECT,
        '--schema',
        UID,
        '--uri',
        uri,
      ],
      { io },
    )

    expect(code).toBe(0)
    expect(stderr).toEqual([])
    expect(JSON.parse(stdout.join(''))).toMatchObject({
      transaction: {
        TransactionType: 'CredentialCreate',
        Account: ISSUER,
        Subject: SUBJECT,
      },
    })
  })

  it('builds reproducible canonical payload bytes and an HTTPS integrity URI', async () => {
    const files = {
      'claims.json': JSON.stringify({ programId: 'course-1' }),
      'schema.json': JSON.stringify(schema),
    }
    const { io, stdout } = memoryIo(files)

    const code = await runCli(
      [
        'node',
        'xcs',
        'payload',
        'build',
        'claims.json',
        '--schema-file',
        'schema.json',
        '--issuer',
        ISSUER,
        '--subject',
        SUBJECT,
        '--schema',
        UID.toUpperCase(),
        '--https-url',
        'https://issuer.example/credentials/one.json',
      ],
      { io },
    )

    expect(code).toBe(0)
    const result = JSON.parse(stdout[0] ?? '{}')
    expect(result.payload).toEqual({
      xcsVersion: '0.1',
      issuer: ISSUER,
      subject: SUBJECT,
      schema: UID,
      claims: { programId: 'course-1' },
    })
    expect(result.canonical).toBe(canonicalize(result.payload as JsonValue))
    expect(result.uri).toMatch(
      /^https:\/\/issuer\.example\/credentials\/one\.json#xcs-sha256=[0-9a-f]{64}$/u,
    )
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/u)
  })

  it('builds a payload against a complete inherited-schema catalog', async () => {
    const fixture = inheritedSchemaCatalogFixture()
    const captured = memoryIo({
      'claims.json': JSON.stringify({ courseId: 'course-1', passed: true }),
      'catalog.json': JSON.stringify(fixture.bundle),
    })

    const code = await runCli(
      [
        'node',
        'xcs',
        'payload',
        'build',
        'claims.json',
        '--catalog',
        'catalog.json',
        '--issuer',
        ISSUER,
        '--subject',
        SUBJECT,
        '--schema',
        fixture.childUid,
        '--https-url',
        'https://issuer.example/credentials/inherited.json',
      ],
      { io: captured.io },
    )

    expect(code).toBe(0)
    expect(JSON.parse(captured.stdout[0] ?? '{}')).toMatchObject({
      payload: {
        schema: fixture.childUid,
        claims: { courseId: 'course-1', passed: true },
      },
    })
  })

  it('writes exact canonical payload bytes to --output without a trailing newline', async () => {
    const files = {
      'claims.json': JSON.stringify({ programId: 'course-1' }),
      'schema.json': JSON.stringify(schema),
    }
    const captured = memoryIo(files)

    const code = await runCli(
      [
        'node',
        'xcs',
        'payload',
        'build',
        'claims.json',
        '--schema-file',
        'schema.json',
        '--issuer',
        ISSUER,
        '--subject',
        SUBJECT,
        '--schema',
        UID,
        '--https-url',
        'https://issuer.example/credentials/one.json',
        '--output',
        'credential.json',
      ],
      { io: captured.io },
    )

    expect(code).toBe(0)
    const metadata = JSON.parse(captured.stdout[0] ?? '{}')
    expect(captured.writtenFiles['credential.json']).toBe(metadata.canonical)
    expect(captured.writtenFiles['credential.json']).not.toMatch(/\n$/u)
    expect(metadata.output).toBe('credential.json')
  })

  it('checks the exact canonical payload bytes against schema and URI', async () => {
    const payload = {
      xcsVersion: '0.1',
      issuer: ISSUER,
      subject: SUBJECT,
      schema: UID,
      claims: { programId: 'course-1' },
    }
    const canonical = canonicalize(payload as JsonValue)
    const uri = createHttpsPayloadUri('https://issuer.example/credentials/one.json', canonical)
    const files = {
      'payload.json': canonical,
      'schema.json': JSON.stringify(schema),
    }
    const { io, stdout } = memoryIo(files)

    const code = await runCli(
      [
        'node',
        'xcs',
        'payload',
        'check',
        'payload.json',
        '--schema-file',
        'schema.json',
        '--issuer',
        ISSUER,
        '--subject',
        SUBJECT,
        '--schema',
        UID,
        '--uri',
        uri,
      ],
      { io },
    )

    expect(code).toBe(0)
    expect(JSON.parse(stdout[0] ?? '{}')).toMatchObject({
      valid: true,
      payload,
      uri,
      integrity: { status: 'valid' },
    })
  })

  it('rejects payload bytes that do not match the URI digest', async () => {
    const payload = {
      xcsVersion: '0.1',
      issuer: ISSUER,
      subject: SUBJECT,
      schema: UID,
      claims: { programId: 'course-1' },
    }
    const canonical = canonicalize(payload as JsonValue)
    const uri = createHttpsPayloadUri('https://issuer.example/credentials/one.json', canonical)
    const files = {
      'payload.json': canonical.replace('course-1', 'course-2'),
      'schema.json': JSON.stringify(schema),
    }
    const { io, stdout, stderr } = memoryIo(files)

    const code = await runCli(
      [
        'node',
        'xcs',
        'payload',
        'check',
        'payload.json',
        '--schema-file',
        'schema.json',
        '--issuer',
        ISSUER,
        '--subject',
        SUBJECT,
        '--schema',
        UID,
        '--uri',
        uri,
      ],
      { io },
    )

    expect(code).toBe(5)
    expect(stdout).toEqual([])
    expect(JSON.parse(stderr.at(-1) ?? '{}')).toMatchObject({
      error: {
        code: 'XCS_CLI_PAYLOAD_INTEGRITY',
        details: { integrity: { status: 'tampered' } },
      },
    })
  })

  it('keeps structured errors on stderr and returns code 2 for invalid input', async () => {
    const { io, stdout, stderr } = memoryIo()
    const code = await runCli(
      [
        'node',
        'xcs',
        'credential',
        'accept',
        '--issuer',
        ISSUER,
        '--subject',
        'invalid',
        '--schema',
        UID,
      ],
      { io },
    )

    expect(code).toBe(2)
    expect(stdout).toEqual([])
    expect(JSON.parse(stderr.at(-1) ?? '{}')).toMatchObject({
      error: { code: 'XCS_SDK_INVALID_ADDRESS' },
    })
  })

  it('uses the exact verification request contract and returns exit code 5 for invalid reports', async () => {
    const { io, stdout, stderr } = memoryIo()
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            onChain: 'pending',
            schema: 'valid',
            payload: 'not_checked',
            issuerTrust: 'unknown',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    )
    const code = await runCli(
      [
        'node',
        'xcs',
        'credential',
        'verify',
        '--api',
        'https://xcs.example/xcs',
        '--network',
        'xrpl-testnet-xcs-v0.1',
        '--issuer',
        ISSUER,
        '--subject',
        SUBJECT,
        '--schema',
        UID,
      ],
      { io, fetch: fetchMock },
    )

    expect(code).toBe(5)
    expect(JSON.parse(stdout[0] ?? '{}')).toMatchObject({ onChain: 'pending' })
    expect(JSON.parse(stderr.at(-1) ?? '{}')).toMatchObject({
      error: { code: 'XCS_CLI_VERIFICATION_NOT_VALID' },
    })
    const [endpoint, request] = fetchMock.mock.calls[0] ?? []
    expect(String(endpoint)).toBe('https://xcs.example/xcs/v1/verify')
    expect(request).toEqual(
      expect.objectContaining({ redirect: 'error', signal: expect.any(AbortSignal) }),
    )
    expect(JSON.parse(String(request?.body))).toEqual({
      network: 'xrpl-testnet-xcs-v0.1',
      issuer: ISSUER,
      subject: SUBJECT,
      schemaUid: UID,
    })
  })

  it.each(['http://xcs.example', 'https://user:secret@xcs.example'])(
    'rejects an unsafe API origin %s before network access',
    async (api) => {
      const captured = memoryIo()
      const fetchMock = vi.fn()
      const code = await runCli(
        [
          'node',
          'xcs',
          'credential',
          'verify',
          '--api',
          api,
          '--network',
          profile.profileId,
          '--issuer',
          ISSUER,
          '--subject',
          SUBJECT,
          '--schema',
          UID,
        ],
        { io: captured.io, fetch: fetchMock },
      )

      expect(code).toBe(2)
      expect(fetchMock).not.toHaveBeenCalled()
      expect(JSON.parse(captured.stderr.at(-1) ?? '{}')).toMatchObject({
        error: { code: 'XCS_CLI_API_INPUT' },
      })
    },
  )

  it('sends a local payload without also requesting remote resolution', async () => {
    const payload = { programId: 'course-1' }
    const { io } = memoryIo({ 'payload.json': JSON.stringify(payload) })
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            onChain: 'active',
            schema: 'valid',
            payload: 'valid',
            issuerTrust: 'unknown',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    )

    const code = await runCli(
      [
        'node',
        'xcs',
        'credential',
        'verify',
        '--api',
        'https://xcs.example',
        '--network',
        'xrpl-testnet-xcs-v0.1',
        '--issuer',
        ISSUER,
        '--subject',
        SUBJECT,
        '--schema',
        UID,
        '--payload',
        'payload.json',
      ],
      { io, fetch: fetchMock },
    )

    expect(code).toBe(0)
    const [, request] = fetchMock.mock.calls[0] ?? []
    expect(JSON.parse(String(request?.body))).toEqual({
      network: 'xrpl-testnet-xcs-v0.1',
      issuer: ISSUER,
      subject: SUBJECT,
      schemaUid: UID,
      payload,
    })
  })

  it('rejects a structurally invalid successful verification response', async () => {
    const captured = memoryIo()
    const code = await runCli(
      [
        'node',
        'xcs',
        'credential',
        'verify',
        '--api',
        'https://xcs.example',
        '--network',
        profile.profileId,
        '--issuer',
        ISSUER,
        '--subject',
        SUBJECT,
        '--schema',
        UID,
      ],
      {
        io: captured.io,
        fetch: async () =>
          new Response(
            JSON.stringify({
              onChain: 'active',
              schema: 'valid',
              payload: 'valid',
              issuerTrust: 'unknown',
              accepted: true,
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
      },
    )

    expect(code).toBe(3)
    expect(captured.stdout).toEqual([])
    expect(JSON.parse(captured.stderr.at(-1) ?? '{}')).toMatchObject({
      error: { code: 'XCS_CLI_API_RESPONSE' },
    })
  })

  it.each([
    'INDEXER_STALE',
    'INDEXER_NOT_INITIALIZED',
    'INDEXER_STATUS_UNAVAILABLE',
    'INDEXER_NOT_READY',
    'INDEXER_HALTED',
    'INDEXER_LEASE_EXPIRED',
    'INDEXER_EVIDENCE_INVALID',
  ])('never succeeds when the API reports %s', async (apiError) => {
    const { io, stdout, stderr } = memoryIo()
    const fetchMock = vi.fn(async () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            error: apiError,
            message: 'The XCS API cannot provide a fresh indexed proof.',
          }),
          { status: 503, headers: { 'content-type': 'application/json' } },
        ),
      ),
    )

    const code = await runCli(
      [
        'node',
        'xcs',
        'credential',
        'verify',
        '--api',
        'https://xcs.example',
        '--network',
        'xrpl-testnet-xcs-v0.1',
        '--issuer',
        ISSUER,
        '--subject',
        SUBJECT,
        '--schema',
        UID,
      ],
      { io, fetch: fetchMock },
    )

    expect(code).toBe(3)
    expect(stdout).toEqual([])
    expect(JSON.parse(stderr.at(-1) ?? '{}')).toMatchObject({
      error: {
        code: 'XCS_CLI_INDEXER_UNAVAILABLE',
        details: { response: { error: apiError } },
      },
    })
  })

  it('aborts a stalled verification POST after the bounded timeout', async () => {
    vi.useFakeTimers()
    try {
      const { io, stderr } = memoryIo()
      const fetchMock = vi.fn(
        async (_input: string | URL | Request, init?: RequestInit): Promise<Response> =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
          }),
      )
      const execution = runCli(
        [
          'node',
          'xcs',
          'credential',
          'verify',
          '--api',
          'https://xcs.example',
          '--network',
          'xrpl-testnet-xcs-v0.1',
          '--issuer',
          ISSUER,
          '--subject',
          SUBJECT,
          '--schema',
          UID,
        ],
        { io, fetch: fetchMock },
      )

      await vi.advanceTimersByTimeAsync(10_000)
      await expect(execution).resolves.toBe(3)
      expect(JSON.parse(stderr.at(-1) ?? '{}')).toMatchObject({
        error: { code: 'XCS_CLI_NETWORK', message: expect.stringContaining('timed out') },
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it.each([
    [
      'declared',
      () =>
        new Response('{}', {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'content-length': String(1024 * 1024 + 1),
          },
        }),
    ],
    [
      'streamed',
      () =>
        new Response(new Uint8Array(1024 * 1024 + 1), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    ],
  ])('rejects an oversized %s verification response', async (_kind, response) => {
    const { io, stderr } = memoryIo()
    const code = await runCli(
      [
        'node',
        'xcs',
        'credential',
        'verify',
        '--api',
        'https://xcs.example',
        '--network',
        'xrpl-testnet-xcs-v0.1',
        '--issuer',
        ISSUER,
        '--subject',
        SUBJECT,
        '--schema',
        UID,
      ],
      { io, fetch: async () => response() },
    )

    expect(code).toBe(3)
    expect(JSON.parse(stderr.at(-1) ?? '{}')).toMatchObject({
      error: { code: 'XCS_CLI_API_RESPONSE', message: expect.stringContaining('1 MiB') },
    })
  })

  it('prepares an autofilled transaction bound to profile bytes and readiness', async () => {
    const profileText = JSON.stringify(profile, null, 2)
    const registration = buildSchemaRegistrationPayment({ publisher: ISSUER, profile, schema })
    const captured = memoryIo({
      'profile.json': profileText,
      'transaction.json': JSON.stringify({
        ...registration,
      }),
    })
    const fetchMock = vi.fn(async () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            profileId: profile.profileId,
            status: 'ready',
            checkpoint: readinessCheckpoint,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    )
    let connected = false
    const client = {
      networkID: profile.networkId,
      isConnected: () => connected,
      connect: vi.fn(async () => {
        connected = true
      }),
      disconnect: vi.fn(async () => {
        connected = false
      }),
      request: vi.fn(async (request: { command: string }) =>
        request.command === 'feature'
          ? {
              result: {
                [profile.requiredAmendment]: { enabled: true, supported: true },
              },
            }
          : {
              result: {
                validated: true,
                ledger_index: profile.activationLedgerIndex,
                ledger_hash: profile.activationLedgerHash,
              },
            },
      ),
      autofill: vi.fn(async (transaction: Record<string, unknown>) => ({
        ...transaction,
        Fee: '12',
        Sequence: 7,
        LastLedgerSequence: 120,
      })),
    } as unknown as Client

    const code = await runCli(
      [
        'node',
        'xcs',
        'tx',
        'prepare',
        'transaction.json',
        '--server',
        'wss://history.example',
        '--profile',
        'profile.json',
        '--api',
        'https://xcs.example',
        '--output',
        'prepared.json',
      ],
      { io: captured.io, fetch: fetchMock, createClient: () => client },
    )

    expect(code, captured.stderr.join('')).toBe(0)
    const envelope = JSON.parse(captured.writtenFiles['prepared.json'] ?? '{}')
    expect(envelope).toMatchObject({
      format: 'xcs-prepared-transaction/1',
      profileId: profile.profileId,
      profileSha256: sha256Hex(new TextEncoder().encode(profileText)),
      checkpoint: readinessCheckpoint,
      transaction: { Fee: '12', Sequence: 7, LastLedgerSequence: 120 },
    })
    expect(envelope.transactionSha256).toMatch(/^[0-9a-f]{64}$/u)
    expect(fetchMock).toHaveBeenCalledWith(
      new URL(`https://xcs.example/v1/networks/${profile.profileId}/readiness`),
      expect.objectContaining({ method: 'GET', cache: 'no-store', redirect: 'error' }),
    )
    expect(client.autofill).toHaveBeenCalledOnce()
    expect(client.disconnect).toHaveBeenCalledOnce()
  })

  it('proves a credential schema catalog before binding and autofilling it', async () => {
    const catalogFixture = schemaCatalogFixture()
    const profileText = JSON.stringify(profile)
    const transaction = buildCredentialCreate({
      issuer: ISSUER,
      subject: SUBJECT,
      schemaUid: catalogFixture.uid,
      uri: createHttpsPayloadUri('https://issuer.example/credential.json', '{}'),
    })
    const captured = memoryIo({
      'profile.json': profileText,
      'transaction.json': JSON.stringify({ transaction }),
    })
    const requestedPaths: string[] = []
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const path = new URL(input instanceof Request ? input.url : input).pathname
      requestedPaths.push(path)
      if (path.endsWith('/catalog')) return new Response(JSON.stringify(catalogFixture.bundle))
      return new Response(
        JSON.stringify({
          profileId: profile.profileId,
          status: 'ready',
          checkpoint: readinessCheckpoint,
        }),
      )
    })
    const client = {
      networkID: profile.networkId,
      isConnected: () => true,
      disconnect: vi.fn(async () => undefined),
      request: vi.fn(async (request: { command: string }) =>
        request.command === 'feature'
          ? { result: { [profile.requiredAmendment]: { enabled: true, supported: true } } }
          : {
              result: {
                validated: true,
                ledger_index: profile.activationLedgerIndex,
                ledger_hash: profile.activationLedgerHash,
              },
            },
      ),
      autofill: vi.fn(async (input: Record<string, unknown>) => ({
        ...input,
        Fee: '12',
        Sequence: 1,
        LastLedgerSequence: 120,
      })),
    } as unknown as Client

    const code = await runCli(
      [
        'node',
        'xcs',
        'tx',
        'prepare',
        'transaction.json',
        '--server',
        'wss://history.example',
        '--profile',
        'profile.json',
        '--api',
        'https://xcs.example',
        '--output',
        'prepared.json',
      ],
      { io: captured.io, fetch: fetchMock, createClient: () => client },
    )

    expect(code, captured.stderr.join('')).toBe(0)
    expect(requestedPaths).toEqual([
      `/v1/networks/${profile.profileId}/schemas/${catalogFixture.uid}/catalog`,
      `/v1/networks/${profile.profileId}/readiness`,
    ])
    expect(JSON.parse(captured.writtenFiles['prepared.json'] ?? '{}')).toMatchObject({
      transaction: {
        TransactionType: 'CredentialCreate',
        CredentialType: catalogFixture.uid.toUpperCase(),
        Memos: expect.arrayContaining([
          { Memo: { MemoType: '7863733A7072657061726564', MemoData: expect.any(String) } },
        ]),
      },
    })
  })

  it('submits an offline-signed blob only after all prepared-envelope gates pass', async () => {
    const profileText = JSON.stringify(profile)
    const transaction = bindPreparedTransactionContext({
      transaction: {
        ...buildSchemaRegistrationPayment({ publisher: ISSUER, profile, schema }).transaction,
        Fee: '12',
        Sequence: 1,
        LastLedgerSequence: 120,
      },
      profile,
      profileSha256: sha256Hex(new TextEncoder().encode(profileText)),
      checkpoint: readinessCheckpoint,
    })
    const envelope = createPreparedTransactionEnvelope({
      profile,
      profileSha256: sha256Hex(new TextEncoder().encode(profileText)),
      checkpoint: readinessCheckpoint,
      transaction,
    })
    const txBlob = TEST_WALLET.sign(transaction).tx_blob
    const captured = memoryIo({
      'profile.json': profileText,
      'prepared.json': JSON.stringify(envelope),
      'signed.txt': txBlob,
    })
    const events: string[] = []
    const fetchMock = vi.fn(async () => {
      events.push('readiness')
      return Promise.resolve(
        new Response(
          JSON.stringify({
            profileId: profile.profileId,
            status: 'ready',
            checkpoint: { ...readinessCheckpoint, ledgerIndex: 101, ledgerHash: '9a'.repeat(32) },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
    })
    let connected = false
    const submit = vi.fn(async () => {
      events.push('submit')
      return { result: { engine_result: 'tesSUCCESS' } }
    })
    const request = vi.fn(async (input: { command: string }) => {
      events.push(input.command)
      if (input.command === 'feature') {
        return {
          result: { [profile.requiredAmendment]: { enabled: true, supported: true } },
        }
      }
      if (input.command === 'ledger_current') {
        return { result: { ledger_current_index: 110 } }
      }
      return {
        result: {
          validated: true,
          ledger_index: 111,
          meta: { TransactionResult: 'tesSUCCESS' },
        },
      }
    })
    const client = {
      networkID: profile.networkId,
      isConnected: () => connected,
      connect: vi.fn(async () => {
        events.push('connect')
        connected = true
      }),
      disconnect: vi.fn(async () => {
        connected = false
      }),
      request,
      submit,
    } as unknown as Client

    const code = await runCli(
      [
        'node',
        'xcs',
        'tx',
        'submit',
        '--server',
        'wss://submit.example',
        '--profile',
        'profile.json',
        '--prepared',
        'prepared.json',
        '--api',
        'https://xcs.example',
        '--file',
        'signed.txt',
        '--timeout',
        '10',
        '--poll-interval',
        '1',
      ],
      { io: captured.io, fetch: fetchMock, createClient: () => client },
    )

    expect(code, captured.stderr.join('')).toBe(0)
    expect(request.mock.calls.map(([input]) => input.command)).toEqual([
      'feature',
      'ledger_current',
      'tx',
    ])
    expect(events).toEqual(['connect', 'feature', 'readiness', 'ledger_current', 'submit', 'tx'])
    expect(submit).toHaveBeenCalledOnce()
  })

  it('never submits when final readiness regresses, changes profile, or ledger_current is malformed', async () => {
    for (const failure of ['readiness', 'profile', 'ledger-current'] as const) {
      const fixture = preparedRegistrationFixture()
      const captured = memoryIo({
        'profile.json': fixture.profileText,
        'prepared.json': JSON.stringify(fixture.envelope),
        'signed.txt': fixture.txBlob,
      })
      const submit = vi.fn()
      let connected = false
      const client = {
        networkID: profile.networkId,
        isConnected: () => connected,
        connect: vi.fn(async () => {
          connected = true
        }),
        disconnect: vi.fn(async () => {
          connected = false
        }),
        submit,
        request: vi.fn(async (request: { command: string }) => {
          if (request.command === 'feature') {
            return { result: { [profile.requiredAmendment]: { enabled: true, supported: true } } }
          }
          if (request.command === 'ledger_current') return { result: {} }
          throw new Error(`unexpected command ${request.command}`)
        }),
      } as unknown as Client
      const code = await runCli(
        [
          'node',
          'xcs',
          'tx',
          'submit',
          '--server',
          'wss://submit.example',
          '--profile',
          'profile.json',
          '--prepared',
          'prepared.json',
          '--api',
          'https://xcs.example',
          '--file',
          'signed.txt',
        ],
        {
          io: captured.io,
          createClient: () => client,
          fetch: async () =>
            new Response(
              JSON.stringify({
                profileId: failure === 'profile' ? 'different-profile' : profile.profileId,
                status: 'ready',
                checkpoint:
                  failure === 'readiness'
                    ? { ...readinessCheckpoint, ledgerIndex: 99 }
                    : { ...readinessCheckpoint, ledgerIndex: 101, ledgerHash: '9a'.repeat(32) },
              }),
            ),
        },
      )

      expect(code).toBe(3)
      expect(submit).not.toHaveBeenCalled()
      expect(JSON.parse(captured.stderr.at(-1) ?? '{}')).toMatchObject({
        error: {
          code:
            failure === 'readiness'
              ? 'XCS_SDK_PREPARED_READINESS_REGRESSION'
              : failure === 'profile'
                ? 'XCS_CLI_API_RESPONSE'
                : 'XCS_SDK_LEDGER_CURRENT_INVALID',
        },
      })
    }
  })

  it('rejects a wallet-mutated prepared blob before readiness or XRPL access', async () => {
    const profileText = JSON.stringify(profile)
    const transaction = bindPreparedTransactionContext({
      transaction: {
        ...buildSchemaRegistrationPayment({ publisher: ISSUER, profile, schema }).transaction,
        Fee: '12',
        Sequence: 1,
        LastLedgerSequence: 120,
      },
      profile,
      profileSha256: sha256Hex(new TextEncoder().encode(profileText)),
      checkpoint: readinessCheckpoint,
    })
    const envelope = createPreparedTransactionEnvelope({
      profile,
      profileSha256: sha256Hex(new TextEncoder().encode(profileText)),
      checkpoint: readinessCheckpoint,
      transaction,
    })
    const captured = memoryIo({
      'profile.json': profileText,
      'prepared.json': JSON.stringify(envelope),
      'signed.txt': TEST_WALLET.sign({ ...transaction, Amount: '2' }).tx_blob,
    })
    const fetchMock = vi.fn()
    const createClient = vi.fn()

    const code = await runCli(
      [
        'node',
        'xcs',
        'tx',
        'submit',
        '--server',
        'wss://submit.example',
        '--profile',
        'profile.json',
        '--prepared',
        'prepared.json',
        '--api',
        'https://xcs.example',
        '--file',
        'signed.txt',
      ],
      { io: captured.io, fetch: fetchMock, createClient },
    )

    expect(code, captured.stderr.join('')).toBe(2)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(createClient).not.toHaveBeenCalled()
    expect(JSON.parse(captured.stderr.at(-1) ?? '{}')).toMatchObject({
      error: { code: 'XCS_SDK_INVALID_SIGNER_RESULT' },
    })
  })

  it('rejects insecure or credential-bearing XRPL WebSocket endpoints before access', async () => {
    for (const server of [
      'ws://xrpl.example',
      'wss://user:secret@xrpl.example',
      'wss://xrpl.example/#fragment',
      ' wss://xrpl.example',
    ]) {
      const captured = memoryIo({ 'profile.json': JSON.stringify(profile) })
      const createClient = vi.fn()
      const code = await runCli(
        [
          'node',
          'xcs',
          'tx',
          'status',
          '--server',
          server,
          '--profile',
          'profile.json',
          '--hash',
          'AB'.repeat(32),
        ],
        { io: captured.io, createClient },
      )

      expect(code).toBe(2)
      expect(createClient).not.toHaveBeenCalled()
      expect(JSON.parse(captured.stderr.at(-1) ?? '{}')).toMatchObject({
        error: { code: 'XCS_CLI_SERVER_INPUT' },
      })
    }
  })

  it('classifies XRPL network and activation-anchor contradictions as service failures', async () => {
    const statusIo = memoryIo({ 'profile.json': JSON.stringify(profile) })
    const wrongNetwork = {
      networkID: profile.networkId + 1,
      isConnected: () => true,
      disconnect: vi.fn(async () => undefined),
    } as unknown as Client
    const statusCode = await runCli(
      [
        'node',
        'xcs',
        'tx',
        'status',
        '--server',
        'wss://wrong-network.example',
        '--profile',
        'profile.json',
        '--hash',
        'AB'.repeat(32),
      ],
      { io: statusIo.io, createClient: () => wrongNetwork },
    )
    expect(statusCode).toBe(3)
    expect(JSON.parse(statusIo.stderr.at(-1) ?? '{}')).toMatchObject({
      error: { code: 'XCS_SDK_NETWORK_MISMATCH' },
    })

    const prepareIo = memoryIo({
      'profile.json': JSON.stringify(profile),
      'transaction.json': JSON.stringify(
        buildSchemaRegistrationPayment({ publisher: ISSUER, profile, schema }),
      ),
    })
    const historicalClient = {
      networkID: profile.networkId,
      isConnected: () => true,
      disconnect: vi.fn(async () => undefined),
      request: vi.fn(async (request: { command: string }) =>
        request.command === 'feature'
          ? { result: { [profile.requiredAmendment]: { enabled: true, supported: true } } }
          : {
              result: {
                validated: true,
                ledger_index: profile.activationLedgerIndex,
                ledger_hash: '00'.repeat(32),
              },
            },
      ),
      autofill: vi.fn(),
    } as unknown as Client
    const activationCode = await runCli(
      [
        'node',
        'xcs',
        'tx',
        'prepare',
        'transaction.json',
        '--server',
        'wss://history.example',
        '--profile',
        'profile.json',
        '--api',
        'https://xcs.example',
        '--output',
        'prepared.json',
      ],
      {
        io: prepareIo.io,
        createClient: () => historicalClient,
        fetch: async () =>
          new Response(
            JSON.stringify({
              profileId: profile.profileId,
              status: 'ready',
              checkpoint: readinessCheckpoint,
            }),
          ),
      },
    )
    expect(activationCode).toBe(3)
    expect(JSON.parse(prepareIo.stderr.at(-1) ?? '{}')).toMatchObject({
      error: { code: 'XCS_SDK_ACTIVATION_MISMATCH' },
    })
    expect(historicalClient.autofill).not.toHaveBeenCalled()
  })

  it('never exposes an inline signed-blob option', async () => {
    const { io, stdout } = memoryIo()
    const code = await runCli(['node', 'xcs', 'tx', 'submit', '--help'], { io })
    expect(code).toBe(0)
    expect(stdout.join('')).toContain('--file <path>')
    expect(stdout.join('')).not.toContain('--blob')
    expect(stdout.join('')).not.toContain('--seed')
  })

  it('submits a stdin blob and returns its sanitized recovery journal', async () => {
    const txBlob = TEST_WALLET.sign({
      TransactionType: 'Payment',
      Account: ISSUER,
      Destination: REGISTRY,
      Amount: '1',
      Fee: '12',
      Sequence: 1,
      LastLedgerSequence: 50,
    }).tx_blob
    const captured = memoryIo({ 'profile.json': JSON.stringify(profile) })
    const io: CliIo = {
      ...captured.io,
      stdinIsTerminal: false,
      readStdin: async () => txBlob,
    }
    let connected = false
    const client = {
      networkID: 1,
      isConnected: () => connected,
      connect: vi.fn(async () => {
        connected = true
      }),
      disconnect: vi.fn(async () => {
        connected = false
      }),
      submit: vi.fn(async () => ({ result: { engine_result: 'tesSUCCESS' } })),
      request: vi.fn(async (request: { command: string }) =>
        request.command === 'feature'
          ? {
              result: {
                [profile.requiredAmendment]: {
                  enabled: true,
                  supported: true,
                },
              },
            }
          : {
              result: {
                validated: true,
                ledger_index: 49,
                meta: { TransactionResult: 'tesSUCCESS' },
              },
            },
      ),
    } as unknown as Client

    const code = await runCli(
      [
        'node',
        'xcs',
        'tx',
        'submit',
        '--server',
        'wss://test.example',
        '--profile',
        'profile.json',
      ],
      { io, createClient: () => client },
    )

    expect(code).toBe(0)
    const output = JSON.parse(captured.stdout[0] ?? '{}')
    expect(output.result).toMatchObject({ status: 'validated', transactionResult: 'tesSUCCESS' })
    expect(output.journal.map((entry: { stage: string }) => entry.stage)).toEqual([
      'signed',
      'submitted',
      'validated',
    ])
    expect(captured.stdout.join('')).not.toContain(txBlob)
    expect(client.request).toHaveBeenCalledWith({
      command: 'feature',
      feature: profile.requiredAmendment,
    })
    expect(client.disconnect).toHaveBeenCalledOnce()
  })
})
