import { assertLocalPayloadStoreServerMode } from '../../app/utils/localPayloadStoreMode'

export default defineNitroPlugin(() => {
  const config = useRuntimeConfig()
  assertLocalPayloadStoreServerMode(
    config.localPayloadStoreMode,
    config.public.localPayloadStoreMode,
    import.meta.dev,
  )
})
