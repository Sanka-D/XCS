import { assertBrowserE2eServerMode } from '../../app/utils/browserE2eMode'

export default defineNitroPlugin(() => {
  const config = useRuntimeConfig()
  assertBrowserE2eServerMode(config.browserE2eMode, config.public.browserE2eMode, import.meta.dev)
})
