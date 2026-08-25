import { createDatabaseClient } from '@xcs-protocol/db'

import { createApi } from './app.js'
import { loadApiConfig } from './config.js'
import { KuboPinStore } from './kubo.js'
import { DisabledPayloadResolver, SafePayloadResolver } from './payload-resolver.js'
import { DemoPinningService } from './pinning.js'
import { PostgresPinningRepository } from './pinning-repository.js'
import { PostgresApiRepository } from './repository.js'
import { StaticTrustPolicy } from './verification.js'

const config = loadApiConfig()
const database = createDatabaseClient(config.databaseUrl)
const repository = new PostgresApiRepository(database.db)
const pinningService = config.demoPinning.enabled
  ? new DemoPinningService({
      repository: new PostgresPinningRepository(database.db),
      apiRepository: repository,
      store: new KuboPinStore(config.demoPinning.kuboRpcUrl),
      ipHashSecret: config.demoPinning.ipHashSecret,
      enabledNetworks: new Set(config.demoPinning.networks),
      maxLedgerAgeSeconds: config.readinessMaxLedgerAgeSeconds,
    })
  : undefined
const app = await createApi({
  repository,
  resolver: config.payloadFetchEnabled
    ? new SafePayloadResolver(config.ipfsGateway)
    : new DisabledPayloadResolver(),
  trustPolicy: new StaticTrustPolicy({
    trusted: config.trustedIssuers,
    untrusted: config.untrustedIssuers,
  }),
  allowedOrigins: config.allowedOrigins,
  readinessMaxLedgerAgeSeconds: config.readinessMaxLedgerAgeSeconds,
  ...(pinningService === undefined ? {} : { pinningService }),
  logger: true,
})

const janitor =
  pinningService === undefined
    ? undefined
    : setInterval(
        () => {
          void pinningService.unpinExpired().catch((error: unknown) => {
            app.log.error({ error: String(error) }, 'demo pin cleanup failed')
          })
        },
        60 * 60 * 1_000,
      )
janitor?.unref()

const close = async () => {
  if (janitor !== undefined) clearInterval(janitor)
  await app.close()
  await database.close()
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => void close())
}

await app.listen({ host: config.host, port: config.port })
