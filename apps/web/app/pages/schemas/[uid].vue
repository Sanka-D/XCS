<script setup lang="ts">
const route = useRoute()
const uid = computed(() => String(route.params.uid))
const { getSchema } = useXcsApi()
const { data, error } = await useAsyncData(
  () => `schema:${uid.value}`,
  () => getSchema(uid.value),
)
</script>

<template>
  <section class="section-wrap prose-page">
    <div v-if="error" class="error-box">{{ $t('schemas.notFound') }}</div>
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
      </dl>
      <h2>{{ $t('schemas.definition') }}</h2>
      <pre>{{ JSON.stringify(data.definition, null, 2) }}</pre>
      <NuxtLinkLocale class="button" :to="`/issue?schema=${data.uid}`">{{
        $t('schemas.use')
      }}</NuxtLinkLocale>
    </template>
  </section>
</template>
