<script setup lang="ts">
const { listSchemas } = useXcsApi()
const { data, pending, error, refresh } = await useAsyncData('schemas', () => listSchemas())
</script>

<template>
  <section class="section-wrap">
    <div class="page-heading">
      <div>
        <p class="eyebrow">Registry</p>
        <h1>{{ $t('schemas.title') }}</h1>
      </div>
      <NuxtLinkLocale class="button" to="/schemas/register">{{
        $t('schemas.register')
      }}</NuxtLinkLocale>
    </div>
    <p>{{ $t('schemas.description') }}</p>
    <p v-if="pending">{{ $t('common.loading') }}</p>
    <div v-else-if="error" class="error-box">
      {{ $t('common.apiUnavailable') }}
      <button class="text-button" type="button" @click="() => refresh()">
        {{ $t('common.retry') }}
      </button>
    </div>
    <div v-else-if="data?.items.length" class="schema-grid">
      <NuxtLinkLocale
        v-for="schema in data.items"
        :key="schema.uid"
        class="schema-card"
        :to="`/schemas/${schema.uid}`"
      >
        <StatusPill :value="schema.valid ? 'valid' : 'invalid'" />
        <h2>{{ schema.name }}</h2>
        <p>{{ schema.description }}</p>
        <code>{{ schema.uid }}</code>
        <small>{{ schema.publisher }}</small>
      </NuxtLinkLocale>
    </div>
    <div v-else class="empty-state">{{ $t('schemas.empty') }}</div>
  </section>
</template>
