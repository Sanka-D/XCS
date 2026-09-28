import { adminSecret } from '../admin/config'
import { loadPrivateDocumentStorageConfig } from '../documents/config'
export function loadIssuerConfig(env: NodeJS.ProcessEnv) {
  if (env.XCS_ISSUER_ENABLED !== undefined && !['0', '1'].includes(env.XCS_ISSUER_ENABLED))
    throw new Error('ISSUER_FLAG_INVALID')
  if (env.XCS_ISSUER_ENABLED !== '1') return undefined
  if (env.XCS_AUTH_ENABLED !== '1') throw new Error('ISSUER_AUTH_REQUIRED')
  const databaseUrl = adminSecret(env, 'NUXT_ISSUER_DATABASE_URL')
  let database: URL, origin: URL
  try {
    database = new URL(databaseUrl)
    origin = new URL(env.XCS_AUTH_ORIGIN ?? '')
  } catch {
    throw new Error('ISSUER_CONFIGURATION_INVALID')
  }
  if (
    !['postgres:', 'postgresql:'].includes(database.protocol) ||
    decodeURIComponent(database.username) !== 'xcs_issuer' ||
    !database.password
  )
    throw new Error('ISSUER_DATABASE_ROLE_REQUIRED')
  if (
    origin.protocol !== 'https:' ||
    origin.origin !== env.XCS_AUTH_ORIGIN ||
    origin.username ||
    origin.password
  )
    throw new Error('ISSUER_ORIGIN_INVALID')
  const storage = loadPrivateDocumentStorageConfig(env)
  const lifetime = env.XCS_ISSUER_INVITE_DAYS ?? '7'
  if (!/^\d+$/.test(lifetime) || Number(lifetime) < 1 || Number(lifetime) > 30)
    throw new Error('ISSUER_INVITE_LIFETIME_INVALID')
  return { databaseUrl, origin: origin.origin, storage, inviteDays: Number(lifetime) }
}
