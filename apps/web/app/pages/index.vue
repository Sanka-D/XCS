<script setup lang="ts">
const { getStats } = useXcsApi()
const { locale, t } = useI18n()
const {
  data: stats,
  pending,
  error,
  refresh,
} = await useAsyncData('explorer-stats', () => getStats())

const numberFormat = computed(() => new Intl.NumberFormat(locale.value))

useSeoMeta({
  title: 'XCS — XRPL Credential Schemas',
  description: () => t('home.description'),
  robots: 'index,follow',
})
</script>

<template>
  <div>
    <section class="hero section-wrap">
      <div>
        <p class="eyebrow">{{ $t('home.eyebrow') }}</p>
        <h1>{{ $t('home.title') }}</h1>
        <p class="hero-copy">{{ $t('home.description') }}</p>
        <ExplorerSearch />
        <div class="button-row">
          <NuxtLinkLocale class="button" to="/schemas">{{ $t('home.explore') }}</NuxtLinkLocale>
          <NuxtLinkLocale class="button secondary" to="/verify">{{
            $t('home.verify')
          }}</NuxtLinkLocale>
        </div>
      </div>
      <div class="flow-card">
        <div><span>1</span>{{ $t('home.flow.schema') }}</div>
        <div><span>2</span>{{ $t('home.flow.issue') }}</div>
        <div><span>3</span>{{ $t('home.flow.accept') }}</div>
        <div><span>4</span>{{ $t('home.flow.verify') }}</div>
      </div>
    </section>

    <section class="section-wrap compact-section" aria-labelledby="network-overview-title">
      <div class="section-heading-inline">
        <div>
          <p class="eyebrow">{{ $t('home.stats.eyebrow') }}</p>
          <h2 id="network-overview-title">{{ $t('home.stats.title') }}</h2>
        </div>
        <NuxtLinkLocale class="text-link" to="/status">{{
          $t('home.stats.status')
        }}</NuxtLinkLocale>
      </div>
      <p v-if="pending" class="loading-state" role="status">{{ $t('common.loading') }}</p>
      <ExplorerError v-else-if="error" :error="error" @retry="refresh" />
      <div v-else-if="stats" class="stat-grid">
        <article>
          <strong>{{ numberFormat.format(stats.schemas.total) }}</strong>
          <span>{{ $t('home.stats.schemas') }}</span>
        </article>
        <article>
          <strong>{{ numberFormat.format(stats.schemas.publishers) }}</strong>
          <span>{{ $t('home.stats.publishers') }}</span>
        </article>
        <article>
          <strong>{{ numberFormat.format(stats.credentialGenerations.total) }}</strong>
          <span>{{ $t('home.stats.credentials') }}</span>
        </article>
        <article>
          <strong>{{ numberFormat.format(stats.checkpoint.ledgerIndex) }}</strong>
          <span>{{ $t('home.stats.ledger') }}</span>
        </article>
      </div>
    </section>

    <section class="section-wrap pillars">
      <article>
        <h2>{{ $t('home.pillars.keys.title') }}</h2>
        <p>{{ $t('home.pillars.keys.copy') }}</p>
      </article>
      <article>
        <h2>{{ $t('home.pillars.data.title') }}</h2>
        <p>{{ $t('home.pillars.data.copy') }}</p>
      </article>
      <article>
        <h2>{{ $t('home.pillars.trust.title') }}</h2>
        <p>{{ $t('home.pillars.trust.copy') }}</p>
      </article>
    </section>
  </div>
</template>
