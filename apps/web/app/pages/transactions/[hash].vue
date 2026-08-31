<script setup lang="ts">
import { singleQueryValue } from '~/utils/explorer'

const route = useRoute()
const localePath = useLocalePath()
const transactionHash = computed(() => String(route.params.hash))
const cursor = computed(() => singleQueryValue(route.query.cursor))
const { t } = useI18n()
const { getTransaction } = useXcsApi()
const { data, pending, error, refresh } = await useAsyncData(
  () => `transaction:${transactionHash.value}:${cursor.value}`,
  () =>
    getTransaction(transactionHash.value, {
      ...(cursor.value === '' ? {} : { cursor: cursor.value }),
      limit: 25,
    }),
)

function nextPage(): ReturnType<typeof navigateTo> | undefined {
  const nextCursor = data.value?.credentialEvents.nextCursor
  if (nextCursor === undefined) return undefined
  return navigateTo({
    path: localePath(`/transactions/${transactionHash.value.toLowerCase()}`),
    query: { cursor: nextCursor },
  })
}

useSeoMeta({
  title: () => `${t('transactionExplorer.title')} — XCS`,
  description: () => t('transactionExplorer.description'),
  robots: 'noindex,nofollow',
})
</script>

<template>
  <section class="section-wrap prose-page">
    <p class="eyebrow">Explorer · XRPL</p>
    <h1>{{ $t('transactionExplorer.title') }}</h1>
    <p class="lead">{{ $t('transactionExplorer.description') }}</p>

    <p v-if="pending" class="loading-state" role="status">{{ $t('common.loading') }}</p>
    <ExplorerError v-else-if="error" :error="error" @retry="refresh" />
    <template v-else-if="data">
      <dl class="metadata-list explorer-metadata">
        <dt>{{ $t('transactionExplorer.hash') }}</dt>
        <dd>
          <code>{{ data.transactionHash }}</code>
        </dd>
        <dt>{{ $t('schemas.ledger') }}</dt>
        <dd>{{ data.ledgerIndex }} · tx {{ data.transactionIndex }}</dd>
        <dt>{{ $t('transactionExplorer.ledgerHash') }}</dt>
        <dd>
          <code>{{ data.ledgerHash }}</code>
        </dd>
      </dl>

      <section v-if="data.registration" class="evidence-card">
        <div class="section-heading-inline">
          <h2>{{ $t('transactionExplorer.registration') }}</h2>
          <StatusPill :value="data.registration.status" />
        </div>
        <dl class="metadata-list">
          <dt>{{ $t('transactionExplorer.publisher') }}</dt>
          <dd>
            <code>{{ data.registration.publisher }}</code>
          </dd>
          <template v-if="data.registration.schemaUid">
            <dt>Schema UID</dt>
            <dd>
              <NuxtLinkLocale :to="`/schemas/${data.registration.schemaUid}`"
                ><code>{{ data.registration.schemaUid }}</code></NuxtLinkLocale
              >
            </dd>
          </template>
          <template v-if="data.registration.schemaDigestHex">
            <dt>{{ $t('transactionExplorer.schemaDigest') }}</dt>
            <dd>
              <code>{{ data.registration.schemaDigestHex }}</code>
            </dd>
          </template>
          <template v-if="data.registration.reasonCode">
            <dt>{{ $t('activity.reason') }}</dt>
            <dd>
              <code>{{ data.registration.reasonCode }}</code>
            </dd>
          </template>
        </dl>
      </section>

      <section v-if="data.credentialEvents.items.length" class="evidence-card">
        <h2>{{ $t('transactionExplorer.credentialEvents') }}</h2>
        <div class="event-list">
          <article v-for="event in data.credentialEvents.items" :key="event.nodeIndex">
            <StatusPill :value="event.eventType" />
            <dl class="compact-metadata">
              <dt>{{ $t('credential.generation') }}</dt>
              <dd>
                <NuxtLinkLocale v-if="event.generationId" :to="`/credentials/${event.generationId}`"
                  ><code>{{ event.generationId }}</code></NuxtLinkLocale
                >
                <span v-else>—</span>
              </dd>
              <dt>{{ $t('credential.issuer') }}</dt>
              <dd>
                <code>{{ event.issuer }}</code>
              </dd>
              <dt>{{ $t('credential.subject') }}</dt>
              <dd>
                <code>{{ event.subject }}</code>
              </dd>
              <dt>{{ $t('credential.schema') }}</dt>
              <dd>
                <NuxtLinkLocale :to="`/schemas/${event.schemaUid}`"
                  ><code>{{ event.schemaUid }}</code></NuxtLinkLocale
                >
              </dd>
              <template v-if="event.deletionCause">
                <dt>{{ $t('transactionExplorer.deletionCause') }}</dt>
                <dd>
                  <code>{{ event.deletionCause }}</code>
                </dd>
              </template>
            </dl>
          </article>
        </div>
      </section>

      <div
        v-if="!data.registration && data.credentialEvents.items.length === 0"
        class="empty-state"
      >
        {{ $t('transactionExplorer.empty') }}
      </div>

      <nav class="pagination" :aria-label="$t('explorer.pagination.label')">
        <NuxtLinkLocale
          v-if="cursor"
          class="button secondary compact"
          :to="`/transactions/${transactionHash}`"
        >
          {{ $t('explorer.pagination.first') }}
        </NuxtLinkLocale>
        <button
          v-if="data.credentialEvents.nextCursor"
          class="button secondary compact"
          type="button"
          @click="nextPage"
        >
          {{ $t('explorer.pagination.next') }}
        </button>
      </nav>
    </template>
  </section>
</template>
