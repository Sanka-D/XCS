import { readFile } from 'node:fs/promises'

import { validateNetworkProfile, type NetworkProfile } from '@xcs-protocol/core'

export interface IndexerConfig {
  databaseUrl: string
  xrplRpcUrl: string
  pollIntervalMs: number
  batchSize: number
  profile: NetworkProfile
}

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${name} is required`)
  }
  return value
}

function compatibleRequired(
  environment: NodeJS.ProcessEnv,
  primary: string,
  legacy: string,
): string {
  const value = environment[primary] ?? environment[legacy]
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${primary} is required`)
  }
  return value
}

export async function loadIndexerConfig(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<IndexerConfig> {
  const profilePath = required(environment, 'XCS_NETWORK_PROFILE')
  const profileJson: unknown = JSON.parse(await readFile(profilePath, 'utf8'))
  const pollIntervalMs = Number(
    environment.XCS_INDEXER_POLL_INTERVAL_MS ?? environment.INDEXER_POLL_INTERVAL_MS ?? '4000',
  )
  if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 250 || pollIntervalMs > 60_000) {
    throw new Error('INDEXER_POLL_INTERVAL_MS must be between 250 and 60000')
  }
  const batchSize = Number(environment.XCS_INDEXER_BATCH_SIZE ?? '20')
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) {
    throw new Error('XCS_INDEXER_BATCH_SIZE must be between 1 and 100')
  }

  return {
    databaseUrl: compatibleRequired(environment, 'XCS_DATABASE_URL', 'DATABASE_URL'),
    xrplRpcUrl: compatibleRequired(environment, 'XCS_RPC_URL', 'XRPL_RPC_URL'),
    pollIntervalMs,
    batchSize,
    profile: validateNetworkProfile(profileJson),
  }
}
