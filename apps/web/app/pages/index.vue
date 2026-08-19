<script setup lang="ts">
useSeoMeta({ title: 'XCS — XRPL Credential Schemas' })
</script>

<template>
  <div>
    <section class="hero section-wrap">
      <div>
        <p class="eyebrow">{{ $t('home.eyebrow') }}</p>
        <h1>{{ $t('home.title') }}</h1>
        <p class="hero-copy">{{ $t('home.description') }}</p>
        <div class="button-row">
          <NuxtLinkLocale class="button" to="/schemas/register">{{
            $t('home.register')
          }}</NuxtLinkLocale>
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
