import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { loadIndexerConfig } from '../src/config.js'

const paths: string[] = []

async function profilePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'xcs-indexer-test-'))
  paths.push(directory)
  const path = join(directory, 'profile.json')
  await writeFile(
    path,
    JSON.stringify({
      profileId: 'testnet',
      xcsVersion: '0.1',
      networkId: 1,
      requiredAmendment: 'a'.repeat(64),
      registryAddress: 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh',
      registrationAmountDrops: '1',
      activationLedgerIndex: 100,
      activationLedgerHash: 'b'.repeat(64),
    }),
  )
  return path
}

async function environment(overrides: NodeJS.ProcessEnv = {}): Promise<NodeJS.ProcessEnv> {
  return {
    XCS_NETWORK_PROFILE: await profilePath(),
    XCS_DATABASE_URL: 'postgres://localhost/xcs',
    XCS_RPC_URL_PRIMARY: 'wss://primary.example.test',
    XCS_RPC_URL_SECONDARY: 'wss://secondary.example.test',
    ...overrides,
  }
}

afterEach(async () => {
  await Promise.all(paths.splice(0).map((path) => rm(path, { recursive: true })))
})

describe('indexer configuration', () => {
  it('uses two distinct XCS RPC URLs and bounded defaults', async () => {
    const config = await loadIndexerConfig(await environment())
    expect(config).toMatchObject({
      databaseUrl: 'postgres://localhost/xcs',
      xrplRpcUrl: 'wss://primary.example.test/',
      xrplRpcUrlPrimary: 'wss://primary.example.test/',
      xrplRpcUrlSecondary: 'wss://secondary.example.test/',
      pollIntervalMs: 4_000,
      leaseDurationMs: 30_000,
      batchSize: 20,
    })
  })

  it('prefers the dedicated indexer database role URL', async () => {
    const config = await loadIndexerConfig(
      await environment({
        XCS_INDEXER_DATABASE_URL: 'postgres://xcs_indexer@localhost/xcs',
      }),
    )

    expect(config.databaseUrl).toBe('postgres://xcs_indexer@localhost/xcs')
  })

  it('uses the legacy RPC URL only as the primary source', async () => {
    const config = await loadIndexerConfig(
      await environment({
        XCS_RPC_URL_PRIMARY: undefined,
        XCS_RPC_URL: 'wss://legacy-primary.example.test',
      }),
    )

    expect(config.xrplRpcUrlPrimary).toBe('wss://legacy-primary.example.test/')
    expect(config.xrplRpcUrlSecondary).toBe('wss://secondary.example.test/')
  })

  it('requires a secondary RPC URL', async () => {
    await expect(
      loadIndexerConfig(await environment({ XCS_RPC_URL_SECONDARY: undefined })),
    ).rejects.toThrow('XCS_RPC_URL_SECONDARY is required')
  })

  it('rejects two URLs that normalize to the same endpoint', async () => {
    await expect(
      loadIndexerConfig(
        await environment({
          XCS_RPC_URL_PRIMARY: 'wss://same.example.test',
          XCS_RPC_URL_SECONDARY: 'wss://same.example.test/',
        }),
      ),
    ).rejects.toThrow('must be distinct')
  })

  it.each([
    ['non-WebSocket protocol', { XCS_RPC_URL_PRIMARY: 'https://primary.example.test' }],
    ['embedded credentials', { XCS_RPC_URL_PRIMARY: 'wss://user:secret@primary.example.test' }],
    ['plaintext non-loopback endpoint', { XCS_RPC_URL_PRIMARY: 'ws://primary.example.test' }],
  ])('rejects %s', async (_name, overrides) => {
    await expect(loadIndexerConfig(await environment(overrides))).rejects.toThrow(
      'XCS_RPC_URL_PRIMARY',
    )
  })

  it.each([
    'ws://localhost:6006',
    'ws://127.0.0.1:6006',
    'ws://127.255.1.2:6006',
    'ws://[::1]:6006',
  ])('allows plaintext WebSocket only for loopback endpoint %s', async (primaryUrl) => {
    await expect(
      loadIndexerConfig(await environment({ XCS_RPC_URL_PRIMARY: primaryUrl })),
    ).resolves.toMatchObject({ xrplRpcUrlPrimary: expect.stringMatching(/^ws:/u) })
  })

  it.each(['0', '101', '1.5'])('rejects invalid batch size %s', async (batchSize) => {
    await expect(
      loadIndexerConfig(await environment({ XCS_INDEXER_BATCH_SIZE: batchSize })),
    ).rejects.toThrow('XCS_INDEXER_BATCH_SIZE')
  })

  it.each(['9999', '300001', '1.5'])('rejects invalid lease duration %s', async (duration) => {
    await expect(
      loadIndexerConfig(await environment({ XCS_INDEXER_LEASE_DURATION_MS: duration })),
    ).rejects.toThrow('XCS_INDEXER_LEASE_DURATION_MS')
  })

  it('requires the lease to be at least three poll intervals', async () => {
    await expect(
      loadIndexerConfig(
        await environment({
          XCS_INDEXER_POLL_INTERVAL_MS: '10000',
          XCS_INDEXER_LEASE_DURATION_MS: '29999',
        }),
      ),
    ).rejects.toThrow('at least 3 times')

    await expect(
      loadIndexerConfig(
        await environment({
          XCS_INDEXER_POLL_INTERVAL_MS: '10000',
          XCS_INDEXER_LEASE_DURATION_MS: '30000',
        }),
      ),
    ).resolves.toMatchObject({ pollIntervalMs: 10_000, leaseDurationMs: 30_000 })
  })
})
