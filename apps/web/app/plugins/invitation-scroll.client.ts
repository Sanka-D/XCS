import routerOptions from '#build/router.options.mjs'
import type { RouterOptions } from 'vue-router'

export default defineNuxtPlugin(() => {
  const router = useRouter()
  const generatedOptions = routerOptions as Pick<RouterOptions, 'scrollBehavior'>
  const defaultScrollBehavior = generatedOptions.scrollBehavior
  // Nuxt restores this generated options object after its initial navigation.
  // Updating only router.options is overwritten during hydration.
  generatedOptions.scrollBehavior = (to, from, savedPosition) => {
    // Invitation fragments are bearer tokens, not DOM selectors. Vue Router's
    // missing-selector warning would otherwise print the token to the console.
    if (/^\/(?:fr\/)?recipient\/invitations\/?$/.test(to.path)) {
      return savedPosition ?? { left: 0, top: 0 }
    }
    return defaultScrollBehavior?.(to, from, savedPosition)
  }
  router.options.scrollBehavior = generatedOptions.scrollBehavior
})
