<script setup lang="ts">
const auth = useAuth()
const localePath = useLocalePath()
const { t } = useI18n()
const token = ref('')
const loaded = ref(false)
const failed = ref(false)
const busy = ref(false)
const claimed = ref(false)
const preview = ref<{ organizationName?: string; schemaName?: string } | null>(null)
onMounted(async () => {
  token.value = window.location.hash.slice(1)
  // Drop the bearer from the visible URL; do not persist it or include it in requests until explicit preview.
  window.history.replaceState(
    window.history.state,
    '',
    window.location.pathname + window.location.search,
  )
  await auth.load(true)
  if (auth.user.value && /^[A-Za-z0-9_-]{43}$/.test(token.value)) {
    try {
      preview.value = await auth.mutateApplication('/api/issuer/invitations/preview', {
        token: token.value,
      })
    } catch {
      failed.value = true
    }
  } else if (auth.user.value) failed.value = true
  loaded.value = true
})
async function claim() {
  if (busy.value) return
  busy.value = true
  try {
    await auth.mutateApplication('/api/issuer/invitations/claim', { token: token.value })
    claimed.value = true
    token.value = ''
  } catch {
    failed.value = true
  } finally {
    busy.value = false
  }
}
useSeoMeta({
  title: () => `${t('issuer.claimTitle')} — XCS`,
  robots: 'noindex,nofollow',
  referrer: 'no-referrer',
})
</script>
<template>
  <UContainer class="max-w-2xl py-10">
    <PageHeader :title="$t('issuer.claimTitle')" :lead="$t('issuer.claimHelp')" />
    <p v-if="!loaded">{{ $t('issuer.loading') }}</p>
    <template v-else-if="!auth.user.value">
      <p class="mb-4">{{ $t('issuer.claimLogin') }}</p>
      <UButton :to="localePath('/auth/login')">{{ $t('auth.signIn') }}</UButton>
    </template>
    <StatusBox v-else-if="failed" tone="error">{{ $t('issuer.claimUnavailable') }}</StatusBox>
    <template v-else-if="claimed">
      <StatusBox tone="success">{{ $t('issuer.claimedHelp') }}</StatusBox>
      <UButton class="mt-5" :to="localePath('/account')">{{
        $t('auth.linkCurrentWallet')
      }}</UButton>
    </template>
    <template v-else-if="preview">
      <h2 class="text-xl font-semibold">{{ preview.schemaName }}</h2>
      <p class="mt-2">{{ preview.organizationName }}</p>
      <UButton class="mt-5" :loading="busy" :disabled="busy" @click="claim">{{
        $t('issuer.claim')
      }}</UButton>
    </template>
  </UContainer>
</template>
