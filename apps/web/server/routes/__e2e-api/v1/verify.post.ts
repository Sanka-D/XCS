import { assertBrowserE2eServerMode } from '../../../../app/utils/browserE2eMode'

const PROFILE_ID = 'xrpl-testnet-xcs-browser-e2e'
const ISSUER = 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh'
const SUBJECT = 'r9cZA1mLK5R5Am25ArfXFmqgNwjZgnfk59'
const GENERATION_ID = '34'.repeat(32)

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  assertBrowserE2eServerMode(config.browserE2eMode, config.public.browserE2eMode, import.meta.dev)
  if (config.browserE2eMode !== 'enabled') {
    throw createError({ statusCode: 404, statusMessage: 'Browser E2E API route not found' })
  }

  const body = await readBody<Record<string, unknown>>(event)
  if (
    body.network !== PROFILE_ID ||
    body.issuer !== ISSUER ||
    body.subject !== SUBJECT ||
    typeof body.schemaUid !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(body.schemaUid) ||
    body.resolvePayload !== false ||
    Object.hasOwn(body, 'payload')
  ) {
    throw createError({ statusCode: 400, statusMessage: 'Browser E2E verify input invalid' })
  }

  return {
    onChain: 'active',
    schema: 'valid',
    payload: 'not_checked',
    issuerTrust: 'unknown',
    generationId: GENERATION_ID,
  }
})
