import { readFile } from 'node:fs/promises'

import { validateNetworkProfile, type NetworkProfile } from '@xcs-protocol/core'

export interface IndexerRuntimeConfig {
  databaseUrl: string
  pollIntervalMs: number
  leaseDurationMs: number
  batchSize: number
  profile: NetworkProfile
}

export interface IndexerConfig extends IndexerRuntimeConfig {
  /** @deprecated Use xrplRpcUrlPrimary. */
  xrplRpcUrl: string
  xrplRpcUrlPrimary: string
  xrplRpcUrlSecondary: string
}

export interface LedgerRpcConfig {
  xrplRpcUrlPrimary: string
  xrplRpcUrlSecondary: string
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

function rpcUrl(value: string, name: string): string {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`${name} must be a valid WebSocket URL`)
  }
  const isLoopback =
    parsed.hostname === 'localhost' ||
    parsed.hostname === '[::1]' ||
    /^127(?:\.\d{1,3}){3}$/u.test(parsed.hostname)
  if (
    !['ws:', 'wss:'].includes(parsed.protocol) ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    (parsed.protocol === 'ws:' && !isLoopback)
  ) {
    throw new Error(
      `${name} must use wss without embedded credentials; ws is allowed only for loopback`,
    )
  }
  return parsed.toString()
}

export function loadLedgerRpcConfig(environment: NodeJS.ProcessEnv = process.env): LedgerRpcConfig {
  const primary = rpcUrl(
    environment.XCS_RPC_URL_PRIMARY ??
      compatibleRequired(environment, 'XCS_RPC_URL', 'XRPL_RPC_URL'),
    'XCS_RPC_URL_PRIMARY',
  )
  const secondary = rpcUrl(required(environment, 'XCS_RPC_URL_SECONDARY'), 'XCS_RPC_URL_SECONDARY')
  if (primary === secondary) {
    throw new Error('XCS_RPC_URL_PRIMARY and XCS_RPC_URL_SECONDARY must be distinct')
  }
  return { xrplRpcUrlPrimary: primary, xrplRpcUrlSecondary: secondary }
}

export async function loadIndexerConfig(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<IndexerConfig> {
  const runtime = await loadIndexerRuntimeConfig(environment)
  const source = loadLedgerRpcConfig(environment)
  return {
    ...runtime,
    xrplRpcUrl: source.xrplRpcUrlPrimary,
    xrplRpcUrlPrimary: source.xrplRpcUrlPrimary,
    xrplRpcUrlSecondary: source.xrplRpcUrlSecondary,
  }
}

export async function loadIndexerRuntimeConfig(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<IndexerRuntimeConfig> {
  const profilePath = required(environment, 'XCS_NETWORK_PROFILE')
  const profileJson: unknown = JSON.parse(await readFile(profilePath, 'utf8'))
  const pollIntervalMs = Number(
    environment.XCS_INDEXER_POLL_INTERVAL_MS ?? environment.INDEXER_POLL_INTERVAL_MS ?? '4000',
  )
  if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 250 || pollIntervalMs > 60_000) {
    throw new Error('XCS_INDEXER_POLL_INTERVAL_MS must be between 250 and 60000')
  }
  const leaseDurationMs = Number(environment.XCS_INDEXER_LEASE_DURATION_MS ?? '30000')
  if (!Number.isInteger(leaseDurationMs) || leaseDurationMs < 10_000 || leaseDurationMs > 300_000) {
    throw new Error('XCS_INDEXER_LEASE_DURATION_MS must be between 10000 and 300000')
  }
  if (leaseDurationMs < pollIntervalMs * 3) {
    throw new Error('XCS_INDEXER_LEASE_DURATION_MS must be at least 3 times the poll interval')
  }
  const batchSize = Number(environment.XCS_INDEXER_BATCH_SIZE ?? '20')
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) {
    throw new Error('XCS_INDEXER_BATCH_SIZE must be between 1 and 100')
  }

  return {
    databaseUrl:
      environment.XCS_INDEXER_DATABASE_URL ??
      compatibleRequired(environment, 'XCS_DATABASE_URL', 'DATABASE_URL'),
    pollIntervalMs,
    leaseDurationMs,
    batchSize,
    profile: validateNetworkProfile(profileJson),
  }
}
