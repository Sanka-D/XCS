<script setup lang="ts">
import { singleQueryValue } from '~/utils/explorer'

const route = useRoute()
const localePath = useLocalePath()
const { t } = useI18n()
const cursor = computed(() => singleQueryValue(route.query.cursor))
const { listSchemas } = useXcsApi()
const { data, pending, error, refresh } = await useAsyncData(
  () => `schemas:${cursor.value}`,
  () => listSchemas({ ...(cursor.value === '' ? {} : { cursor: cursor.value }), limit: 18 }),
)

function nextPage(): ReturnType<typeof navigateTo> | undefined {
  if (data.value?.nextCursor === undefined) return undefined
  return navigateTo({ path: localePath('/schemas'), query: { cursor: data.value.nextCursor } })
}

useSeoMeta({
  title: () => t('schemas.metaTitle'),
  description: () => t('schemas.description'),
  robots: 'index,follow',
})
</script>

<template>
  <section class="section-wrap">
    <div class="page-heading">
      <div>
        <p class="eyebrow">Registry</p>
        <h1>{{ $t('schemas.title') }}</h1>
      </div>
      <NuxtLinkLocale class="button" to="/schemas/register">{{
        $t('schemas.register')
      }}</NuxtLinkLocale>
    </div>
    <p>{{ $t('schemas.description') }}</p>
    <p v-if="pending" class="loading-state" role="status">{{ $t('common.loading') }}</p>
    <ExplorerError v-else-if="error" :error="error" @retry="refresh" />
    <div v-else-if="data?.items.length" class="schema-grid">
      <NuxtLinkLocale
        v-for="schema in data.items"
        :key="schema.uid"
        class="schema-card"
        :to="`/schemas/${schema.uid}`"
      >
        <StatusPill :value="schema.valid ? 'valid' : 'invalid'" />
        <h2>{{ schema.name }}</h2>
        <p>{{ schema.description }}</p>
        <code>{{ schema.uid }}</code>
        <small>{{ schema.publisher }}</small>
        <small>{{ $t('explorer.ledger', { ledger: schema.ledgerIndex }) }}</small>
      </NuxtLinkLocale>
    </div>
    <div v-else class="empty-state">{{ $t('schemas.empty') }}</div>
    <nav v-if="data" class="pagination" :aria-label="$t('explorer.pagination.label')">
      <NuxtLinkLocale v-if="cursor" class="button secondary compact" to="/schemas">
        {{ $t('explorer.pagination.first') }}
      </NuxtLinkLocale>
      <button
        v-if="data.nextCursor"
        class="button secondary compact"
        type="button"
        @click="nextPage"
      >
        {{ $t('explorer.pagination.next') }}
      </button>
    </nav>
  </section>
</template>
