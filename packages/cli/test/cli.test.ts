import { canonicalize, createHttpsPayloadUri, type JsonValue } from '@xcs-protocol/core'
import { encode, type Client } from 'xrpl'
import { describe, expect, it, vi } from 'vitest'

import { createProgram, runCli, type CliIo } from '../src/index.js'

const ISSUER = 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh'
const SUBJECT = 'r9cZA1mLK5R5Am25ArfXFmqgNwjZgnfk59'
const UID = '12'.repeat(32)
const REGISTRY = 'rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe'
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
      schema: ['validate', 'register', 'uid'],
      payload: ['build', 'check'],
      credential: ['issue', 'accept', 'delete', 'verify'],
      tx: ['submit', 'status'],
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

    expect(code).toBe(5)
    expect(JSON.parse(stdout[0] ?? '{}')).toMatchObject({ onChain: 'pending' })
    expect(JSON.parse(stderr.at(-1) ?? '{}')).toMatchObject({
      error: { code: 'XCS_CLI_VERIFICATION_NOT_VALID' },
    })
    const [, request] = fetchMock.mock.calls[0] ?? []
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

  it('never exposes an inline signed-blob option', async () => {
    const { io, stdout } = memoryIo()
    const code = await runCli(['node', 'xcs', 'tx', 'submit', '--help'], { io })
    expect(code).toBe(0)
    expect(stdout.join('')).toContain('--file <path>')
    expect(stdout.join('')).not.toContain('--blob')
    expect(stdout.join('')).not.toContain('--seed')
  })

  it('submits a stdin blob and returns its sanitized recovery journal', async () => {
    const txBlob = encode({
      TransactionType: 'Payment',
      Account: ISSUER,
      Destination: REGISTRY,
      Amount: '1',
      Fee: '12',
      Sequence: 1,
      LastLedgerSequence: 50,
      SigningPubKey: '',
    })
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
