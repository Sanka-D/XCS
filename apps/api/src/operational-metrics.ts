import { rippleTimeToUnixSeconds, XcsError } from '@xcs-protocol/core'

import { PayloadInvalidError, PayloadUnavailableError } from './payload-resolver.js'
import type { PayloadResolver } from './types.js'

const CONTINUITY_FAILURE_CODES = new Set([
  'LEDGER_BEFORE_ACTIVATION',
  'LEDGER_GAP',
  'LEDGER_PARENT_MISMATCH',
  'ACTIVATION_HASH_MISMATCH',
])

export type OperationalIndexerState = 'starting' | 'catching_up' | 'ready' | 'halted'

export interface OperationalMetricsProfileSnapshot {
  profileId: string
  status:
    | {
        state: OperationalIndexerState
        primarySourceTip: number | null
        secondarySourceTip: number | null
        lastAgreedLedgerIndex: number | null
        lastAgreedLedgerHash: string | null
        errorCode: string | null
        updatedAt: Date
      }
    | undefined
  checkpoint:
    | {
        ledgerIndex: number
        ledgerHash: string
        closeTime: number
      }
    | undefined
  acceptedRegistrations: number
  rejectedRegistrations: number
}

export interface OperationalMetricsSnapshot {
  observedAt: Date
  database: {
    usedConnections: number
    maxConnections: number
    sizeBytes: number
  }
  profiles: OperationalMetricsProfileSnapshot[]
}

export interface OperationalMetricsRepository {
  getSnapshot(): Promise<OperationalMetricsSnapshot>
}

export class OperationalMetricsEvidenceError extends Error {
  readonly code = 'METRICS_EVIDENCE_INVALID'

  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'OperationalMetricsEvidenceError'
  }
}

export type RateLimitMetric = 'global' | 'verify' | 'pinning'

interface PayloadResolutionCounters {
  retrieved: number
  unavailable: number
  invalid: number
  error: number
}

interface RateLimitCounters {
  global: number
  verify: number
  pinning: number
}

function increment(value: number): number {
  return value >= Number.MAX_SAFE_INTEGER ? Number.MAX_SAFE_INTEGER : value + 1
}

function validDate(value: Date, label: string): Date {
  if (!Number.isFinite(value.getTime())) throw new Error(`${label} is invalid`)
  return value
}

function ledgerLag(
  status: NonNullable<OperationalMetricsProfileSnapshot['status']>,
): number | null {
  if (
    status.primarySourceTip === null ||
    status.secondarySourceTip === null ||
    status.lastAgreedLedgerIndex === null
  ) {
    return null
  }
  const lag =
    Math.min(status.primarySourceTip, status.secondarySourceTip) - status.lastAgreedLedgerIndex
  return Number.isSafeInteger(lag) && lag >= 0 ? lag : null
}

function publicProfile(profile: OperationalMetricsProfileSnapshot, observedAt: Date) {
  const status = profile.status
  const checkpoint = profile.checkpoint
  return {
    profileId: profile.profileId,
    state: status?.state ?? ('missing' as const),
    errorCode: status?.errorCode ?? null,
    statusUpdatedAt: status?.updatedAt.toISOString() ?? null,
    sourceTips: {
      primary: status?.primarySourceTip ?? null,
      secondary: status?.secondarySourceTip ?? null,
    },
    lastAgreedLedger:
      status?.lastAgreedLedgerIndex === null ||
      status?.lastAgreedLedgerIndex === undefined ||
      status.lastAgreedLedgerHash === null
        ? null
        : {
            index: status.lastAgreedLedgerIndex,
            hash: status.lastAgreedLedgerHash,
          },
    ledgerLag: status === undefined ? null : ledgerLag(status),
    checkpoint:
      checkpoint === undefined
        ? null
        : {
            index: checkpoint.ledgerIndex,
            hash: checkpoint.ledgerHash,
            closeTime: checkpoint.closeTime,
            ageSeconds:
              Math.floor(observedAt.getTime() / 1_000) -
              rippleTimeToUnixSeconds(checkpoint.closeTime),
          },
    continuityFailure:
      status?.state === 'halted' &&
      status.errorCode !== null &&
      CONTINUITY_FAILURE_CODES.has(status.errorCode)
        ? status.errorCode
        : null,
    registrations: {
      accepted: profile.acceptedRegistrations,
      rejected: profile.rejectedRegistrations,
    },
  }
}

export function rateLimitMetric(routeUrl: string | undefined): RateLimitMetric {
  if (routeUrl === '/v1/verify') return 'verify'
  if (routeUrl?.startsWith('/v1/pinning/') === true) return 'pinning'
  return 'global'
}

export class OperationalMetricsCollector {
  private readonly processStartedAt: Date
  private serverPayloadResolutionEnabled = false
  private snapshotFailuresSinceStart = 0
  private readonly payloadResolutions: PayloadResolutionCounters = {
    retrieved: 0,
    unavailable: 0,
    invalid: 0,
    error: 0,
  }
  private readonly rateLimitedResponses: RateLimitCounters = {
    global: 0,
    verify: 0,
    pinning: 0,
  }

  constructor(private readonly now: () => Date = () => new Date()) {
    this.processStartedAt = new Date(validDate(this.now(), 'Metrics process start').getTime())
  }

  observePayloadResolver(resolver: PayloadResolver): PayloadResolver {
    this.serverPayloadResolutionEnabled = true
    return {
      resolve: async (uri) => {
        try {
          const content = await resolver.resolve(uri)
          this.payloadResolutions.retrieved = increment(this.payloadResolutions.retrieved)
          return content
        } catch (error) {
          if (error instanceof PayloadUnavailableError) {
            this.payloadResolutions.unavailable = increment(this.payloadResolutions.unavailable)
          } else if (error instanceof PayloadInvalidError || error instanceof XcsError) {
            this.payloadResolutions.invalid = increment(this.payloadResolutions.invalid)
          } else {
            this.payloadResolutions.error = increment(this.payloadResolutions.error)
          }
          throw error
        }
      },
    }
  }

  recordRateLimited(metric: RateLimitMetric): void {
    this.rateLimitedResponses[metric] = increment(this.rateLimitedResponses[metric])
  }

  async collect(repository: OperationalMetricsRepository) {
    const processGeneratedAt = validDate(this.now(), 'Metrics generation time').toISOString()
    const api = {
      counterScope: 'process' as const,
      processStartedAt: this.processStartedAt.toISOString(),
      serverPayloadResolutions: {
        enabled: this.serverPayloadResolutionEnabled,
        outcomes: { ...this.payloadResolutions },
      },
      rateLimitedResponses: { ...this.rateLimitedResponses },
    }
    const coverage = {
      continuityFailures: 'active_halt_only' as const,
      submissionOutcomes: 'not_observed_client_local' as const,
      payloadResolution: 'server_only' as const,
      databasePoolSaturation: 'not_observed' as const,
      diskUsage: 'logical_database_size_only' as const,
    }

    try {
      const snapshot = await repository.getSnapshot()
      let observedAt: Date
      let profiles: ReturnType<typeof publicProfile>[]
      try {
        observedAt = validDate(snapshot.observedAt, 'Metrics database observation time')
        profiles = snapshot.profiles.map((profile) => publicProfile(profile, observedAt))
      } catch (cause) {
        throw new OperationalMetricsEvidenceError('Operational metrics evidence is invalid', {
          cause,
        })
      }
      return {
        schemaVersion: 1 as const,
        generatedAt: observedAt.toISOString(),
        clockSource: 'database' as const,
        database: {
          available: true as const,
          errorCode: null,
          observedAt: observedAt.toISOString(),
          snapshotFailuresSinceStart: this.snapshotFailuresSinceStart,
          clusterConnections: {
            used: snapshot.database.usedConnections,
            maximum: snapshot.database.maxConnections,
          },
          logicalSizeBytes: snapshot.database.sizeBytes,
        },
        profiles,
        api,
        coverage,
      }
    } catch (error) {
      this.snapshotFailuresSinceStart = increment(this.snapshotFailuresSinceStart)
      const evidenceInvalid = error instanceof OperationalMetricsEvidenceError
      return {
        schemaVersion: 1 as const,
        generatedAt: processGeneratedAt,
        clockSource: 'process' as const,
        database: {
          available: evidenceInvalid,
          errorCode: evidenceInvalid ? error.code : ('DATABASE_UNAVAILABLE' as const),
          observedAt: null,
          snapshotFailuresSinceStart: this.snapshotFailuresSinceStart,
          clusterConnections: null,
          logicalSizeBytes: null,
        },
        profiles: [],
        api,
        coverage,
      }
    }
  }
}
