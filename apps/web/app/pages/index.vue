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
  title: () => t('home.metaTitle'),
  description: () => t('home.description'),
  robots: 'index,follow',
})
</script>

<template>
  <div class="landing-page">
    <section class="landing-hero" aria-labelledby="landing-title">
      <picture class="landing-art" aria-hidden="true">
        <img
          src="/images/xcs-orbit-hero.jpg"
          alt=""
          width="1672"
          height="941"
          fetchpriority="high"
          decoding="async"
        />
      </picture>
      <div class="landing-hero-content">
        <p class="landing-badge"><span aria-hidden="true" />{{ $t('home.badge') }}</p>
        <h1 id="landing-title">{{ $t('home.title') }}</h1>
        <p class="hero-copy">{{ $t('home.description') }}</p>
        <div class="button-row landing-actions">
          <NuxtLinkLocale class="button" to="/studio">
            <span class="terminal-glyph" aria-hidden="true">&gt;_</span>
            {{ $t('home.start') }}
          </NuxtLinkLocale>
          <a
            class="button secondary"
            href="https://github.com/XRPL-Commons/XCS"
            target="_blank"
            rel="noopener noreferrer"
          >
            {{ $t('home.github') }}
            <span aria-hidden="true">↗</span>
          </a>
        </div>
        <div class="install-command" :aria-label="$t('home.commandLabel')">
          <span aria-hidden="true">$</span>
          <code>pnpm install</code>
        </div>
      </div>
    </section>

    <section class="section-wrap landing-explorer" aria-labelledby="network-overview-title">
      <div class="section-heading-inline">
        <div>
          <p class="eyebrow">{{ $t('home.stats.eyebrow') }}</p>
          <h2 id="network-overview-title">{{ $t('home.stats.title') }}</h2>
        </div>
        <NuxtLinkLocale class="text-link" to="/status">{{
          $t('home.stats.status')
        }}</NuxtLinkLocale>
      </div>
      <p class="landing-explorer-copy">{{ $t('home.searchIntro') }}</p>
      <ExplorerSearch />
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

    <section class="section-wrap landing-flow" aria-labelledby="landing-flow-title">
      <div class="landing-section-heading">
        <p class="eyebrow">{{ $t('home.flowEyebrow') }}</p>
        <h2 id="landing-flow-title">{{ $t('home.flowTitle') }}</h2>
      </div>
      <ol class="landing-steps">
        <li><span>01</span>{{ $t('home.flow.schema') }}</li>
        <li><span>02</span>{{ $t('home.flow.issue') }}</li>
        <li><span>03</span>{{ $t('home.flow.accept') }}</li>
        <li><span>04</span>{{ $t('home.flow.verify') }}</li>
      </ol>
    </section>

    <section class="section-wrap pillars landing-pillars">
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
