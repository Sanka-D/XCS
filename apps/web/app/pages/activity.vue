<script setup lang="ts">
import { singleQueryValue } from '~/utils/explorer'

const route = useRoute()
const localePath = useLocalePath()
const { t } = useI18n()
const cursor = computed(() => singleQueryValue(route.query.cursor))
const { getSchemaActivity } = useXcsApi()
const { data, pending, error, refresh } = await useAsyncData(
  () => `schema-activity:${cursor.value}`,
  () => getSchemaActivity({ ...(cursor.value === '' ? {} : { cursor: cursor.value }), limit: 25 }),
)

function nextPage(): ReturnType<typeof navigateTo> | undefined {
  if (data.value?.nextCursor === undefined) return undefined
  return navigateTo({ path: localePath('/activity'), query: { cursor: data.value.nextCursor } })
}

useSeoMeta({
  title: () => `${t('activity.title')} — XCS`,
  description: () => t('activity.description'),
  robots: 'index,follow',
})
</script>

<template>
  <section class="section-wrap">
    <div class="page-heading">
      <div>
        <p class="eyebrow">Explorer</p>
        <h1>{{ $t('activity.title') }}</h1>
      </div>
      <NuxtLinkLocale class="button secondary" to="/schemas">{{
        $t('nav.schemas')
      }}</NuxtLinkLocale>
    </div>
    <p class="lead">{{ $t('activity.description') }}</p>
    <p class="neutrality-note">{{ $t('activity.scope') }}</p>

    <p v-if="pending" class="loading-state" role="status">{{ $t('common.loading') }}</p>
    <ExplorerError v-else-if="error" :error="error" @retry="refresh" />
    <ol v-else-if="data?.items.length" class="activity-list">
      <li v-for="registration in data.items" :key="registration.transactionHash">
        <div>
          <StatusPill :value="registration.status" />
          <strong>{{ $t(`activity.${registration.status}`) }}</strong>
          <p>
            {{ $t('activity.by') }} <code>{{ registration.publisher }}</code>
          </p>
        </div>
        <dl class="compact-metadata">
          <dt>{{ $t('schemas.ledger') }}</dt>
          <dd>{{ registration.ledgerIndex }} · tx {{ registration.transactionIndex }}</dd>
          <dt>{{ $t('activity.transaction') }}</dt>
          <dd>
            <NuxtLinkLocale :to="`/transactions/${registration.transactionHash}`"
              ><code>{{ registration.transactionHash }}</code></NuxtLinkLocale
            >
          </dd>
          <template v-if="registration.schemaUid">
            <dt>Schema UID</dt>
            <dd>
              <NuxtLinkLocale :to="`/schemas/${registration.schemaUid}`"
                ><code>{{ registration.schemaUid }}</code></NuxtLinkLocale
              >
            </dd>
          </template>
          <template v-if="registration.reasonCode">
            <dt>{{ $t('activity.reason') }}</dt>
            <dd>
              <code>{{ registration.reasonCode }}</code>
            </dd>
          </template>
        </dl>
      </li>
    </ol>
    <div v-else class="empty-state">{{ $t('activity.empty') }}</div>

    <nav v-if="data" class="pagination" :aria-label="$t('explorer.pagination.label')">
      <NuxtLinkLocale v-if="cursor" class="button secondary compact" to="/activity">
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
