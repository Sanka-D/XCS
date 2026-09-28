import { loadPrivateDocumentStorageConfig } from '../documents/config'
import { serverSecret } from '../secrets'

export const adminSecret = serverSecret
export function loadAdminConfig(env: NodeJS.ProcessEnv) {
  if (env.XCS_ADMIN_ENABLED !== undefined && !['0', '1'].includes(env.XCS_ADMIN_ENABLED))
    throw new Error('ADMIN_FLAG_INVALID')
  if (env.XCS_ADMIN_ENABLED !== '1') return undefined
  if (env.XCS_AUTH_ENABLED !== '1') throw new Error('ADMIN_AUTH_REQUIRED')
  const databaseUrl = adminSecret(env, 'NUXT_ADMIN_DATABASE_URL'),
    signingKey = adminSecret(env, 'XCS_ADMIN_DOCUMENT_KEY')
  let database: URL
  try {
    database = new URL(databaseUrl)
  } catch {
    throw new Error('ADMIN_DATABASE_INVALID')
  }
  if (
    !['postgres:', 'postgresql:'].includes(database.protocol) ||
    decodeURIComponent(database.username) !== 'xcs_admin_app' ||
    !database.password
  )
    throw new Error('ADMIN_DATABASE_ROLE_REQUIRED')
  if (Buffer.byteLength(signingKey) < 32) throw new Error('ADMIN_DOCUMENT_CONFIGURATION_REQUIRED')
  const storage = loadPrivateDocumentStorageConfig(env)
  return { databaseUrl, signingKey, storage }
}
