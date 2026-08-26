<script setup lang="ts">
import { explorerResultPath, normalizedExplorerQuery } from '~/utils/explorer'

const route = useRoute()
const localePath = useLocalePath()
const { t } = useI18n()
const query = computed(() => normalizedExplorerQuery(route.query.q))
const { search } = useXcsApi()
const { data, pending, error, refresh } = await useAsyncData(
  () => `explorer-search:${query.value}`,
  () => (query.value === '' ? Promise.resolve({ items: [], hasMore: false }) : search(query.value)),
)

function resultPath(item: NonNullable<typeof data.value>['items'][number]): string {
  return localePath(explorerResultPath(item) ?? '/search')
}

useSeoMeta({
  title: () => `${t('explorer.search.title')} — XCS`,
  description: () => t('explorer.search.description'),
  robots: 'noindex,follow',
})
</script>

<template>
  <section class="section-wrap">
    <div class="page-heading">
      <div>
        <p class="eyebrow">Explorer</p>
        <h1>{{ $t('explorer.search.title') }}</h1>
      </div>
    </div>
    <p class="lead">{{ $t('explorer.search.description') }}</p>
    <ExplorerSearch :initial-query="query" autofocus />

    <p v-if="pending" class="loading-state" role="status">{{ $t('common.loading') }}</p>
    <ExplorerError v-else-if="error" :error="error" @retry="refresh" />
    <div v-else-if="query === ''" class="empty-state">{{ $t('explorer.search.prompt') }}</div>
    <div v-else-if="data?.items.length" class="result-list">
      <NuxtLink
        v-for="item in data.items"
        :key="`${item.type}:${item.type === 'schema' ? item.schemaUid : item.type === 'credential_generation' ? item.generationId : item.transactionHash}`"
        class="result-card"
        :to="resultPath(item)"
      >
        <div>
          <StatusPill
            :value="
              item.type === 'schema'
                ? 'schema'
                : item.type === 'credential_generation'
                  ? item.state
                  : 'transaction'
            "
          />
          <h2 v-if="item.type === 'schema'">{{ item.name }}</h2>
          <h2 v-else-if="item.type === 'credential_generation'">
            {{ $t('explorer.search.credential') }}
          </h2>
          <h2 v-else>{{ $t('explorer.search.transaction') }}</h2>
          <p v-if="item.type === 'schema'">{{ item.description }}</p>
          <code>{{
            item.type === 'schema'
              ? item.schemaUid
              : item.type === 'credential_generation'
                ? item.generationId
                : item.transactionHash
          }}</code>
        </div>
        <span aria-hidden="true">→</span>
      </NuxtLink>
      <p v-if="data.hasMore" class="warning-box">{{ $t('explorer.search.limited') }}</p>
    </div>
    <div v-else class="empty-state">{{ $t('explorer.search.empty') }}</div>
  </section>
</template>
