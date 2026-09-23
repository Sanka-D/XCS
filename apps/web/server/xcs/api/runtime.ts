import { createDatabaseClient } from '@xcs-protocol/db'

import { createApi } from './app.js'
import type { ApiConfig } from './config.js'
import { HostedPayloadService } from './hosted-payloads.js'
import { PostgresHostedPayloadRepository } from './hosted-payloads-repository.js'
import { HostedPayloadResolver } from './hosted-payload-resolver.js'
import { KuboPinStore } from './kubo.js'
import { PostgresOperationalMetricsRepository } from './operational-metrics-repository.js'
import { DisabledPayloadResolver, SafePayloadResolver } from './payload-resolver.js'
import { DemoPinningService } from './pinning.js'
import { PostgresPinningRepository } from './pinning-repository.js'
import { PostgresApiRepository } from './repository.js'
import { StaticTrustPolicy } from './verification.js'

export async function createApiRuntime(config: ApiConfig) {
  const database = createDatabaseClient(config.databaseUrl)
  let payloadDatabase: ReturnType<typeof createDatabaseClient> | undefined
  try {
    payloadDatabase =
      config.payloadDatabaseUrl === undefined
        ? undefined
        : createDatabaseClient(config.payloadDatabaseUrl)
    const repository = new PostgresApiRepository(database.db)
    const pinningService =
      config.demoPinning.enabled && payloadDatabase !== undefined
        ? new DemoPinningService({
            repository: new PostgresPinningRepository(payloadDatabase.db),
            apiRepository: repository,
            store: new KuboPinStore(config.demoPinning.kuboRpcUrl),
            ipHashSecret: config.demoPinning.ipHashSecret,
            enabledNetworks: new Set(config.demoPinning.networks),
            maxLedgerAgeSeconds: config.readinessMaxLedgerAgeSeconds,
          })
        : undefined
    const hostedPayloadService =
      config.hostedPayloads.enabled && payloadDatabase !== undefined
        ? new HostedPayloadService({
            repository: new PostgresHostedPayloadRepository(payloadDatabase.db),
            apiRepository: repository,
            publicBaseUrl: config.hostedPayloads.publicBaseUrl,
            ipHashSecret: config.hostedPayloads.ipHashSecret,
            enabledNetworks: new Set(config.hostedPayloads.networks),
            maxLedgerAgeSeconds: config.readinessMaxLedgerAgeSeconds,
          })
        : undefined
    const app = await createApi({
      repository,
      resolver: config.payloadFetchEnabled
        ? config.hostedPayloads.enabled && hostedPayloadService !== undefined
          ? new HostedPayloadResolver(
              config.hostedPayloads.publicBaseUrl,
              hostedPayloadService,
              new SafePayloadResolver(config.ipfsGateway),
            )
          : new SafePayloadResolver(config.ipfsGateway)
        : new DisabledPayloadResolver(),
      trustPolicy: new StaticTrustPolicy({
        trusted: config.trustedIssuers,
        untrusted: config.untrustedIssuers,
      }),
      allowedOrigins: config.allowedOrigins,
      trustedProxyCidrs: config.trustedProxyCidrs,
      readinessMaxLedgerAgeSeconds: config.readinessMaxLedgerAgeSeconds,
      ...(config.operationalMetrics.enabled
        ? {
            operationalMetrics: {
              token: config.operationalMetrics.token,
              repository: new PostgresOperationalMetricsRepository(database.db),
              observePayloadResolver: config.payloadFetchEnabled,
            },
          }
        : {}),
      ...(pinningService === undefined ? {} : { pinningService }),
      ...(hostedPayloadService === undefined ? {} : { hostedPayloadService }),
    })

    const janitor =
      pinningService === undefined
        ? undefined
        : setInterval(
            () => {
              void pinningService.unpinExpired().catch(() => {
                console.error('Demo pin cleanup failed')
              })
            },
            60 * 60 * 1_000,
          )
    janitor?.unref()

    const close = async () => {
      if (janitor !== undefined) clearInterval(janitor)
      await Promise.all([database.close(), payloadDatabase?.close()])
    }
    return { ...app, close }
  } catch (error) {
    await Promise.allSettled([database.close(), payloadDatabase?.close()])
    throw error
  }
}
