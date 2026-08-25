import { readFile } from 'node:fs/promises'

import { validateNetworkProfile, type NetworkProfile } from '@xcs-protocol/core'
import {
  createDatabaseClient,
  credentialEvents,
  credentialGenerations,
  ledgerCheckpoints,
  schemaEvents,
  schemas,
  type XcsDatabase,
} from '@xcs-protocol/db'
import { count, eq } from 'drizzle-orm'

import { loadIndexerConfig, type IndexerConfig } from './config.js'
import { computeProjectionDigest } from './projection-digest.js'
import { QuorumLedgerSource } from './quorum-ledger-source.js'
import { loadReplayTarget } from './replay-target.js'
import { PostgresIndexerRepository } from './repository.js'
import { sourceErrorCode } from './source-errors.js'
import { IndexerWorker } from './worker.js'
import { XrplLedgerSource } from './xrpl-source.js'

type MaintenanceCommand = 'preflight' | 'replay' | 'projection-digest'

class MaintenanceError extends Error {
  constructor(
    readonly code: 'MAINTENANCE_USAGE_INVALID' | 'REPLAY_PROJECTION_NOT_EMPTY',
    message: string,
  ) {
    super(message)
    this.name = 'MaintenanceError'
  }
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]
  if (value === undefined || value.trim().length === 0) {
    throw new MaintenanceError('MAINTENANCE_USAGE_INVALID', `${name} is required`)
  }
  return value
}

async function loadProfile(): Promise<NetworkProfile> {
  const path = requiredEnvironment('XCS_NETWORK_PROFILE')
  const input: unknown = JSON.parse(await readFile(path, 'utf8'))
  return validateNetworkProfile(input)
}

function databaseUrl(): string {
  return (
    process.env.XCS_INDEXER_DATABASE_URL ??
    process.env.XCS_DATABASE_URL ??
    requiredEnvironment('DATABASE_URL')
  )
}

function quorumSource(config: IndexerConfig): QuorumLedgerSource {
  return new QuorumLedgerSource(
    new XrplLedgerSource(config.xrplRpcUrlPrimary, 'primary'),
    new XrplLedgerSource(config.xrplRpcUrlSecondary, 'secondary'),
  )
}

async function runPreflight(): Promise<void> {
  const config = await loadIndexerConfig()
  const source = quorumSource(config)
  await source.connect()
  try {
    const result = await source.preflight(config.profile)
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        profileId: config.profile.profileId,
        networkId: result.networkId,
        activationLedger: {
          ledgerIndex: result.activationLedger.ledgerIndex,
          ledgerHash: result.activationLedger.ledgerHash,
          transactionRoot: result.activationLedger.transactionRoot,
        },
        sourceTips: result.tips,
      })}\n`,
    )
  } finally {
    await source.disconnect()
  }
}

async function rowCount(
  database: XcsDatabase,
  table:
    | typeof ledgerCheckpoints
    | typeof schemaEvents
    | typeof schemas
    | typeof credentialEvents
    | typeof credentialGenerations,
  profileId: string,
): Promise<number> {
  const [row] = await database
    .select({ value: count() })
    .from(table)
    .where(eq(table.profileId, profileId))
  return row?.value ?? 0
}

async function assertProjectionEmpty(database: XcsDatabase, profileId: string): Promise<void> {
  const counts = await Promise.all([
    rowCount(database, ledgerCheckpoints, profileId),
    rowCount(database, schemaEvents, profileId),
    rowCount(database, schemas, profileId),
    rowCount(database, credentialEvents, profileId),
    rowCount(database, credentialGenerations, profileId),
  ])
  if (counts.some((value) => value !== 0)) {
    throw new MaintenanceError(
      'REPLAY_PROJECTION_NOT_EMPTY',
      `Replay requires an empty projection for profile ${profileId}`,
    )
  }
}

async function runReplay(): Promise<void> {
  const config = await loadIndexerConfig()
  const replayTarget = loadReplayTarget()
  const database = createDatabaseClient(config.databaseUrl)
  const source = quorumSource(config)
  const controller = new AbortController()
  let caughtUpLedger: number | undefined

  try {
    await assertProjectionEmpty(database.db, config.profile.profileId)
    const worker = new IndexerWorker({
      profile: config.profile,
      source,
      repository: new PostgresIndexerRepository(database.db),
      pollIntervalMs: config.pollIntervalMs,
      leaseDurationMs: config.leaseDurationMs,
      batchSize: config.batchSize,
      replayTarget,
      observer: {
        ledgerProcessed: (event) =>
          process.stderr.write(`${JSON.stringify({ event: 'ledger_processed', ...event })}\n`),
        caughtUp: (ledgerIndex) => {
          caughtUpLedger = ledgerIndex
          controller.abort()
        },
      },
    })
    await worker.start(controller.signal)
    if (caughtUpLedger !== replayTarget.ledgerIndex) {
      throw new Error('Replay did not stop at the verified target ledger')
    }
    const digest = await computeProjectionDigest(database.db, config.profile.profileId)
    process.stdout.write(
      `${JSON.stringify({ ok: true, replayTarget, caughtUpLedger, projectionDigest: digest })}\n`,
    )
  } finally {
    await database.close()
  }
}

async function runProjectionDigest(): Promise<void> {
  const profile = await loadProfile()
  const database = createDatabaseClient(databaseUrl())
  try {
    const digest = await computeProjectionDigest(database.db, profile.profileId)
    process.stdout.write(`${JSON.stringify({ ok: true, projectionDigest: digest })}\n`)
  } finally {
    await database.close()
  }
}

function parseCommand(value: string | undefined): MaintenanceCommand {
  if (value === 'preflight' || value === 'replay' || value === 'projection-digest') return value
  throw new MaintenanceError(
    'MAINTENANCE_USAGE_INVALID',
    'Usage: xcs-indexer-maintenance <preflight|replay|projection-digest>',
  )
}

try {
  const command = parseCommand(process.argv[2])
  if (command === 'preflight') await runPreflight()
  if (command === 'replay') await runReplay()
  if (command === 'projection-digest') await runProjectionDigest()
} catch (error) {
  const code = error instanceof MaintenanceError ? error.code : sourceErrorCode(error)
  process.stderr.write(`${JSON.stringify({ ok: false, code })}\n`)
  process.exitCode = 1
}
