<script setup lang="ts">
const props = defineProps<{
  readonly title: string
  readonly code: string
  readonly copyLabel: string
  readonly copiedLabel: string
  readonly copyErrorLabel: string
}>()

const copyState = ref<'idle' | 'copied' | 'error'>('idle')

watch(
  () => props.code,
  () => {
    copyState.value = 'idle'
  },
)

async function copyCode(): Promise<void> {
  copyState.value = 'idle'
  try {
    if (!import.meta.client || navigator.clipboard === undefined) {
      throw new Error('CLIPBOARD_UNAVAILABLE')
    }
    await navigator.clipboard.writeText(props.code)
    copyState.value = 'copied'
  } catch {
    copyState.value = 'error'
  }
}
</script>

<template>
  <section class="code-snippet">
    <header>
      <h3>{{ title }}</h3>
      <button class="button secondary compact" type="button" @click="copyCode">
        {{ copyLabel }}
      </button>
    </header>
    <pre><code>{{ code }}</code></pre>
    <p v-if="copyState === 'copied'" class="muted" role="status">{{ copiedLabel }}</p>
    <p v-else-if="copyState === 'error'" class="error-text" role="status">
      {{ copyErrorLabel }}
    </p>
  </section>
</template>
