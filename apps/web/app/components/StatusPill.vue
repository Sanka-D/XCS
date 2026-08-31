<script setup lang="ts">
const props = defineProps<{ value: string }>()
const tone = computed(() => {
  if (['active', 'valid', 'trusted', 'ready', 'accepted', 'created'].includes(props.value)) {
    return 'positive'
  }
  if (['tampered', 'invalid', 'untrusted', 'deleted', 'halted', 'rejected'].includes(props.value)) {
    return 'negative'
  }
  if (
    [
      'pending',
      'unavailable',
      'unknown',
      'not_checked',
      'starting',
      'catching_up',
      'expired',
    ].includes(props.value)
  ) {
    return 'warning'
  }
  return 'neutral'
})
</script>

<template>
  <span class="status-pill" :class="`status-${tone}`">{{ value }}</span>
</template>
