<script setup lang="ts">
const route = useRoute()
const uid = computed(() => String(route.params.uid))
const { t } = useI18n()
const { getSchema } = useXcsApi()
const { data, pending, error, refresh } = await useAsyncData(
  () => `schema:${uid.value}`,
  () => getSchema(uid.value),
)

useSeoMeta({
  title: () => (data.value ? `${data.value.name} — XCS` : t('schemas.metaTitle')),
  description: () => data.value?.description ?? t('schemas.description'),
  robots: 'index,follow',
})
</script>

<template>
  <section class="section-wrap prose-page">
    <p v-if="pending" class="loading-state" role="status">{{ $t('common.loading') }}</p>
    <ExplorerError v-else-if="error" :error="error" @retry="refresh" />
    <template v-else-if="data">
      <StatusPill :value="data.valid ? 'valid' : 'invalid'" />
      <h1>{{ data.name }}</h1>
      <p class="lead">{{ data.description }}</p>
      <dl class="metadata-list">
        <dt>UID</dt>
        <dd>
          <code>{{ data.uid }}</code>
        </dd>
        <dt>Publisher</dt>
        <dd>
          <code>{{ data.publisher }}</code>
        </dd>
        <dt>{{ $t('schemas.ledger') }}</dt>
        <dd>{{ data.ledgerIndex }} · tx {{ data.transactionIndex }}</dd>
        <dt>{{ $t('schemas.registration') }}</dt>
        <dd>
          <NuxtLinkLocale :to="`/transactions/${data.registrationTransactionHash}`">
            <code>{{ data.registrationTransactionHash }}</code>
          </NuxtLinkLocale>
        </dd>
        <template v-if="data.parentUid">
          <dt>{{ $t('schemas.parent') }}</dt>
          <dd>
            <NuxtLinkLocale :to="`/schemas/${data.parentUid}`"
              ><code>{{ data.parentUid }}</code></NuxtLinkLocale
            >
          </dd>
        </template>
        <template v-if="data.supersedesUid">
          <dt>{{ $t('schemas.supersedes') }}</dt>
          <dd>
            <NuxtLinkLocale :to="`/schemas/${data.supersedesUid}`"
              ><code>{{ data.supersedesUid }}</code></NuxtLinkLocale
            >
          </dd>
        </template>
      </dl>
      <p class="neutrality-note">{{ $t('schemas.neutrality') }}</p>
      <h2>{{ $t('schemas.fields') }}</h2>
      <div class="field-list">
        <div v-for="(field, name) in data.resolved.fields" :key="name" class="field-row">
          <code>{{ name }}</code>
          <span>{{ field.type }}</span>
          <small>{{ field.optional ? $t('schemas.optional') : $t('schemas.required') }}</small>
        </div>
      </div>
      <template v-if="data.resolved.lineage.length">
        <h2>{{ $t('schemas.lineage') }}</h2>
        <ol class="lineage-list">
          <li v-for="ancestor in data.resolved.lineage" :key="ancestor">
            <NuxtLinkLocale :to="`/schemas/${ancestor}`"
              ><code>{{ ancestor }}</code></NuxtLinkLocale
            >
          </li>
        </ol>
      </template>
      <h2>{{ $t('schemas.definition') }}</h2>
      <pre>{{ JSON.stringify(data.definition, null, 2) }}</pre>
      <NuxtLinkLocale class="button" :to="`/issue?schema=${data.uid}`">{{
        $t('schemas.use')
      }}</NuxtLinkLocale>
    </template>
  </section>
</template>
