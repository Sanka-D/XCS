import { authReturnPath } from '~/utils/portalRoutes'

export default defineNuxtRouteMiddleware(async (to) => {
  const auth = useAuth()
  await auth.load(true)
  if (!auth.user.value) {
    return navigateTo({
      path: useLocalePath()('/auth/login'),
      query: { returnTo: authReturnPath(to.fullPath) },
    })
  }
})
