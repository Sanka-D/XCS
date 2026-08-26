<script setup lang="ts">
import { decodeUtf8HexForDisplay, displayXrplTime } from '~/utils/explorer'

const route = useRoute()
const generationId = computed(() => String(route.params.generationId))
const { locale, t } = useI18n()
const { getCredentialGeneration } = useXcsApi()
const { data, pending, error, refresh } = await useAsyncData(
  () => `credential-generation:${generationId.value}`,
  () => getCredentialGeneration(generationId.value),
)

const payloadUri = computed(() => decodeUtf8HexForDisplay(data.value?.generation.uriHex))
const expiration = computed(() => displayXrplTime(data.value?.generation.expiration, locale.value))
const verificationQuery = computed(() => {
  const generation = data.value?.generation
  if (generation === undefined) return undefined
  return {
    issuer: generation.issuer,
    subject: generation.subject,
    schema: generation.schemaUid,
    generation: generation.generationId,
  }
})

useSeoMeta({
  title: () => `${t('credential.title')} — XCS`,
  description: () => t('credential.description'),
  robots: 'noindex,nofollow',
})
</script>

<template>
  <section class="section-wrap prose-page">
    <p class="eyebrow">Explorer · Credential</p>
    <h1>{{ $t('credential.title') }}</h1>
    <p class="lead">{{ $t('credential.description') }}</p>

    <p v-if="pending" class="loading-state" role="status">{{ $t('common.loading') }}</p>
    <ExplorerError v-else-if="error" :error="error" @retry="refresh" />
    <template v-else-if="data">
      <StatusPill :value="data.state" />
      <dl class="metadata-list explorer-metadata">
        <dt>{{ $t('credential.generation') }}</dt>
        <dd>
          <code>{{ data.generation.generationId }}</code>
        </dd>
        <dt>{{ $t('credential.issuer') }}</dt>
        <dd>
          <code>{{ data.generation.issuer }}</code>
        </dd>
        <dt>{{ $t('credential.subject') }}</dt>
        <dd>
          <code>{{ data.generation.subject }}</code>
        </dd>
        <dt>{{ $t('credential.schema') }}</dt>
        <dd>
          <NuxtLinkLocale :to="`/schemas/${data.generation.schemaUid}`"
            ><code>{{ data.generation.schemaUid }}</code></NuxtLinkLocale
          >
        </dd>
        <dt>{{ $t('credential.createdLedger') }}</dt>
        <dd>
          {{ data.generation.createdLedgerIndex }} · tx
          {{ data.generation.createdTransactionIndex }}
        </dd>
        <dt>{{ $t('credential.lastLedger') }}</dt>
        <dd>{{ data.generation.lastLedgerIndex }}</dd>
        <dt>{{ $t('credential.expiration') }}</dt>
        <dd>{{ expiration ?? $t('credential.noExpiration') }}</dd>
        <dt>{{ $t('credential.ledgerObject') }}</dt>
        <dd>
          <code>{{ data.generation.ledgerObjectId }}</code>
        </dd>
      </dl>

      <section class="privacy-panel">
        <h2>{{ $t('credential.payloadMetadata') }}</h2>
        <p>{{ $t('credential.payloadPrivacy') }}</p>
        <dl class="metadata-list">
          <dt>{{ $t('credential.uri') }}</dt>
          <dd>
            <code>{{ payloadUri ?? $t('credential.noUri') }}</code>
          </dd>
        </dl>
      </section>

      <section class="neutrality-panel">
        <h2>{{ $t('credential.trustTitle') }}</h2>
        <p>{{ $t('credential.trustNote') }}</p>
      </section>

      <NuxtLinkLocale
        v-if="verificationQuery"
        class="button"
        :to="{ path: '/verify', query: verificationQuery }"
      >
        {{ $t('credential.verify') }}
      </NuxtLinkLocale>

      <h2>{{ $t('credential.timeline') }}</h2>
      <ol v-if="data.timeline.length" class="timeline-list">
        <li v-for="event in data.timeline" :key="`${event.transactionHash}:${event.nodeIndex}`">
          <span class="timeline-marker" aria-hidden="true"></span>
          <div>
            <StatusPill :value="event.eventType" />
            <strong>{{ $t(`credential.events.${event.eventType}`) }}</strong>
            <p>
              {{ $t('explorer.ledger', { ledger: event.ledgerIndex }) }} · tx
              {{ event.transactionIndex }}
            </p>
            <p v-if="event.deletionCause">
              <code>{{ event.deletionCause }}</code>
            </p>
            <NuxtLinkLocale :to="`/transactions/${event.transactionHash}`"
              ><code>{{ event.transactionHash }}</code></NuxtLinkLocale
            >
          </div>
        </li>
      </ol>
      <div v-else class="empty-state">{{ $t('credential.timelineEmpty') }}</div>
    </template>
  </section>
</template>
