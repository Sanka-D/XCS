<script setup lang="ts">
const props = defineProps<{ value: string }>()
const tone = computed(() => {
  if (['active', 'valid', 'trusted'].includes(props.value)) return 'positive'
  if (['tampered', 'invalid', 'untrusted', 'deleted'].includes(props.value)) return 'negative'
  if (['pending', 'unavailable', 'unknown', 'not_checked'].includes(props.value)) return 'warning'
  return 'neutral'
})
</script>

<template>
  <span class="status-pill" :class="`status-${tone}`">{{ value }}</span>
</template>
