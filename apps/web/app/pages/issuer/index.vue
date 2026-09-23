<script setup lang="ts">
definePageMeta({ middleware: ['auth', 'role'], requiredRole: 'issuer' })
const { t } = useI18n()
const localePath = useLocalePath()
const { user } = useAuth()
const organizations = computed(
  () => user.value?.organizations.filter((org) => org.roles.includes('issuer')) ?? [],
)
useSeoMeta({ title: () => `${t('auth.issuerSpace')} — XCS`, robots: 'noindex,nofollow' })
</script>

<template>
  <UContainer class="py-10 sm:py-14">
    <PageHeader :title="$t('auth.issuerSpace')" :lead="$t('auth.issuerIntro')" />
    <p class="mb-6 text-toned">{{ user?.displayName ?? user?.email ?? user?.id }}</p>
    <ul class="grid gap-4 sm:grid-cols-2" :aria-label="$t('auth.organizations')">
      <li v-for="organization in organizations" :key="organization.id">
        <UCard>
          <h2 class="text-xl font-semibold">{{ organization.name }}</h2>
          <p class="mt-2 text-sm text-muted">{{ $t('auth.roles.issuer') }}</p>
        </UCard>
      </li>
    </ul>
    <UButton class="mt-6" :to="localePath('/account')" color="neutral" variant="outline">{{
      $t('auth.account')
    }}</UButton>
  </UContainer>
</template>
