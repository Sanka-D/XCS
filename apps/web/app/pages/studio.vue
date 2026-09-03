<script setup lang="ts">
const { t } = useI18n()

useSeoMeta({
  title: () => `${t('studio.title')} — XCS`,
  description: () => t('studio.description'),
  robots: 'index,follow',
})
</script>

<template>
  <section class="section-wrap create-page">
    <p class="eyebrow">{{ $t('nav.create') }}</p>
    <h1>{{ $t('studio.title') }}</h1>
    <p class="lead">{{ $t('studio.description') }}</p>
    <p class="neutrality-note">{{ $t('studio.nonCustodial') }}</p>

    <div class="create-primary-grid">
      <NuxtLinkLocale class="create-primary-card" to="/schemas/register">
        <span class="create-card-index">01 / {{ $t('studio.schemaType') }}</span>
        <h2>{{ $t('studio.schemaTitle') }}</h2>
        <p>{{ $t('studio.register') }}</p>
        <strong>{{ $t('studio.schemaCta') }} <span aria-hidden="true">↗</span></strong>
      </NuxtLinkLocale>
      <NuxtLinkLocale class="create-primary-card create-primary-card-dark" to="/issue">
        <span class="create-card-index">02 / {{ $t('studio.credentialType') }}</span>
        <h2>{{ $t('studio.credentialTitle') }}</h2>
        <p>{{ $t('studio.issue') }}</p>
        <strong>{{ $t('studio.credentialCta') }} <span aria-hidden="true">↗</span></strong>
      </NuxtLinkLocale>
    </div>

    <div class="create-secondary-heading">
      <div>
        <p class="eyebrow">{{ $t('studio.manageEyebrow') }}</p>
        <h2>{{ $t('studio.manageTitle') }}</h2>
      </div>
      <p>{{ $t('studio.manageDescription') }}</p>
    </div>
    <div class="workflow-grid create-secondary-grid">
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
      <NuxtLinkLocale class="workflow-card" to="/operations">
        <span>05</span>
        <h2>{{ $t('nav.operations') }}</h2>
        <p>{{ $t('studio.operations') }}</p>
      </NuxtLinkLocale>
    </div>
  </section>
</template>
