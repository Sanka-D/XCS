import { assertPublicRpcUrl } from '../../app/utils/publicRpcUrl'

export default defineNitroPlugin(() => {
  const config = useRuntimeConfig()
  assertPublicRpcUrl(config.public.rpcUrl)
})
