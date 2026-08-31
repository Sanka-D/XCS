<script setup lang="ts">
const { t } = useI18n()

useSeoMeta({
  title: () => `${t('studio.title')} — XCS`,
  description: () => t('studio.description'),
  robots: 'index,follow',
})
</script>

<template>
  <section class="section-wrap">
    <p class="eyebrow">Studio</p>
    <h1>{{ $t('studio.title') }}</h1>
    <p class="lead">{{ $t('studio.description') }}</p>
    <p class="neutrality-note">{{ $t('studio.nonCustodial') }}</p>
    <div class="workflow-grid">
      <NuxtLinkLocale class="workflow-card" to="/schemas/register">
        <span>01</span>
        <h2>{{ $t('nav.register') }}</h2>
        <p>{{ $t('studio.register') }}</p>
      </NuxtLinkLocale>
      <NuxtLinkLocale class="workflow-card" to="/issue">
        <span>02</span>
        <h2>{{ $t('nav.issue') }}</h2>
        <p>{{ $t('studio.issue') }}</p>
      </NuxtLinkLocale>
      <NuxtLinkLocale class="workflow-card" to="/accept">
        <span>03</span>
        <h2>{{ $t('nav.accept') }}</h2>
        <p>{{ $t('studio.accept') }}</p>
      </NuxtLinkLocale>
      <NuxtLinkLocale class="workflow-card" to="/revoke">
        <span>04</span>
        <h2>{{ $t('nav.revoke') }}</h2>
        <p>{{ $t('studio.revoke') }}</p>
      </NuxtLinkLocale>
      <NuxtLinkLocale class="workflow-card" to="/verify">
        <span>05</span>
        <h2>{{ $t('nav.verify') }}</h2>
        <p>{{ $t('studio.verify') }}</p>
      </NuxtLinkLocale>
      <NuxtLinkLocale class="workflow-card" to="/operations">
        <span>06</span>
        <h2>{{ $t('nav.operations') }}</h2>
        <p>{{ $t('studio.operations') }}</p>
      </NuxtLinkLocale>
    </div>
  </section>
</template>
