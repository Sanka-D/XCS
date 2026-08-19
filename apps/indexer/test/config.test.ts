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

afterEach(async () => {
  await Promise.all(paths.splice(0).map((path) => rm(path, { recursive: true })))
})

describe('indexer configuration', () => {
  it('uses XCS names and bounded defaults', async () => {
    const config = await loadIndexerConfig({
      XCS_NETWORK_PROFILE: await profilePath(),
      XCS_DATABASE_URL: 'postgres://localhost/xcs',
      XCS_RPC_URL: 'wss://example.test',
    })
    expect(config).toMatchObject({
      databaseUrl: 'postgres://localhost/xcs',
      xrplRpcUrl: 'wss://example.test',
      pollIntervalMs: 4_000,
      batchSize: 20,
    })
  })

  it.each(['0', '101', '1.5'])('rejects invalid batch size %s', async (batchSize) => {
    await expect(
      loadIndexerConfig({
        XCS_NETWORK_PROFILE: await profilePath(),
        XCS_DATABASE_URL: 'postgres://localhost/xcs',
        XCS_RPC_URL: 'wss://example.test',
        XCS_INDEXER_BATCH_SIZE: batchSize,
      }),
    ).rejects.toThrow('XCS_INDEXER_BATCH_SIZE')
  })
})
