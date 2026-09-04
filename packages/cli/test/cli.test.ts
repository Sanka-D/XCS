import { describe, expect, it, vi } from 'vitest'

import { runCli, type CliIo } from '../src/index.js'

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

function memoryIo(initialFiles: Readonly<Record<string, string>> = {}) {
  const files: Record<string, string> = { ...initialFiles }
  const stdout: string[] = []
  const stderr: string[] = []
  const io: CliIo = {
    stdinIsTerminal: true,
    readStdin: async () => '',
    readTextFile: async (path) => {
      const value = files[path]
      if (value === undefined) throw new Error(`Missing file: ${path}`)
      return value
    },
    writeTextFile: async (path, value) => {
      files[path] = value
    },
    writeStdout: (value) => stdout.push(value),
    writeStderr: (value) => stderr.push(value),
  }
  return { io, files, stdout, stderr }
}

function jsonOutput(output: readonly string[]): unknown {
  return JSON.parse(output.join('')) as unknown
}

describe('xcs CLI', () => {
  it('validates and canonicalizes a schema', async () => {
    const state = memoryIo({ 'schema.json': JSON.stringify(schema) })

    const exitCode = await runCli(['node', 'xcs', 'schema', 'validate', 'schema.json'], state)

    expect(exitCode).toBe(0)
    expect(jsonOutput(state.stdout)).toMatchObject({
      valid: true,
      schema,
      canonical:
        '{"description":"Successful completion of a course.","fields":{"programId":{"type":"string"}},"name":"Course completion","xcsVersion":"0.1"}',
    })
    expect(state.stderr).toEqual([])
  })

  it('builds a schema registration payment', async () => {
    const state = memoryIo({
      'schema.json': JSON.stringify(schema),
      'profile.json': JSON.stringify(profile),
    })

    const exitCode = await runCli(
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
      state,
    )

    expect(exitCode).toBe(0)
    expect(jsonOutput(state.stdout)).toMatchObject({
      transaction: {
        TransactionType: 'Payment',
        Account: ISSUER,
        Destination: REGISTRY,
        Amount: '1',
      },
      schema,
    })
  })

  it('builds and checks the exact credential payload bytes', async () => {
    const state = memoryIo({
      'schema.json': JSON.stringify(schema),
      'claims.json': JSON.stringify({ programId: 'course-42' }),
    })

    const buildExitCode = await runCli(
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
        '--ipfs',
        '--output',
        'payload.json',
      ],
      state,
    )

    expect(buildExitCode).toBe(0)
    const built = jsonOutput(state.stdout) as { uri: string; canonical: string }
    expect(built.uri).toMatch(/^ipfs:\/\/b/u)
    expect(state.files['payload.json']).toBe(built.canonical)

    state.stdout.length = 0
    const checkExitCode = await runCli(
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
        built.uri,
      ],
      state,
    )

    expect(checkExitCode).toBe(0)
    expect(jsonOutput(state.stdout)).toMatchObject({
      valid: true,
      payload: { issuer: ISSUER, subject: SUBJECT, schema: UID },
    })
  })

  it('rejects tampered payload bytes', async () => {
    const state = memoryIo({
      'schema.json': JSON.stringify(schema),
      'payload.json': '{}',
    })

    const exitCode = await runCli(
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
        `https://example.test/payload#xcs-sha256=${'00'.repeat(32)}`,
      ],
      state,
    )

    expect(exitCode).toBe(5)
    expect(state.stderr.join('')).toContain('XCS_CLI_PAYLOAD_INTEGRITY')
  })

  it('builds a native XRPL CredentialCreate transaction', async () => {
    const state = memoryIo()
    const uri = `https://example.test/payload#xcs-sha256=${'34'.repeat(32)}`

    const exitCode = await runCli(
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
      state,
    )

    expect(exitCode).toBe(0)
    expect(jsonOutput(state.stdout)).toEqual({
      transaction: {
        TransactionType: 'CredentialCreate',
        Account: ISSUER,
        Subject: SUBJECT,
        CredentialType: UID.toUpperCase(),
        URI: Buffer.from(uri).toString('hex').toUpperCase(),
      },
    })
  })

  it('returns the API verification result and a non-zero status when invalid', async () => {
    const state = memoryIo()
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(JSON.stringify({ onChain: 'active', schema: 'valid', payload: 'tampered' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const exitCode = await runCli(
      [
        'node',
        'xcs',
        'verify',
        '--api',
        'http://127.0.0.1:3001',
        '--network',
        profile.profileId,
        '--issuer',
        ISSUER,
        '--subject',
        SUBJECT,
        '--schema',
        UID,
      ],
      { ...state, fetch },
    )

    expect(exitCode).toBe(5)
    expect(fetch).toHaveBeenCalledOnce()
    expect(jsonOutput(state.stdout)).toEqual({
      onChain: 'active',
      schema: 'valid',
      payload: 'tampered',
    })
    expect(state.stderr.join('')).toContain('XCS_CLI_VERIFICATION_NOT_VALID')
  })

  it('refuses cleartext remote API endpoints', async () => {
    const state = memoryIo()
    const fetch = vi.fn<typeof globalThis.fetch>()

    const exitCode = await runCli(
      [
        'node',
        'xcs',
        'verify',
        '--api',
        'http://example.com',
        '--network',
        profile.profileId,
        '--issuer',
        ISSUER,
        '--subject',
        SUBJECT,
        '--schema',
        UID,
      ],
      { ...state, fetch },
    )

    expect(exitCode).toBe(2)
    expect(fetch).not.toHaveBeenCalled()
    expect(state.stderr.join('')).toContain('XCS_CLI_API_INPUT')
  })
})
