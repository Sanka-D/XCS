<script setup lang="ts">
const config = useRuntimeConfig()
const { t } = useI18n()
const apiDocumentationUrl = computed(
  () => `${String(config.public.apiBaseUrl).replace(/\/$/u, '')}/documentation`,
)

useSeoMeta({
  title: () => `${t('developers.title')} — XCS`,
  description: () => t('developers.description'),
  robots: 'index,follow',
})
</script>

<template>
  <section class="section-wrap prose-page">
    <p class="eyebrow">Developers</p>
    <h1>{{ $t('developers.title') }}</h1>
    <p class="lead">{{ $t('developers.description') }}</p>
    <div class="definition-grid">
      <section>
        <h2>REST API</h2>
        <p>{{ $t('developers.rest') }}</p>
        <a class="button secondary compact" :href="apiDocumentationUrl" rel="noreferrer">OpenAPI</a>
      </section>
      <section>
        <h2>SDK</h2>
        <p>{{ $t('developers.sdk') }}</p>
        <code>@xcs-protocol/sdk</code>
      </section>
      <section>
        <h2>CLI</h2>
        <p>{{ $t('developers.cli') }}</p>
        <code>@xcs-protocol/cli</code>
      </section>
    </div>
    <h2>{{ $t('developers.endpoints') }}</h2>
    <pre>
GET /v1/networks/:network/stats
GET /v1/networks/:network/search?q=
GET /v1/networks/:network/activity
GET /v1/networks/:network/credential-generations/:generationId
GET /v1/networks/:network/transactions/:transactionHash</pre>
    <NuxtLinkLocale class="button" to="/learn">{{ $t('developers.learn') }}</NuxtLinkLocale>
  </section>
</template>
