<script setup lang="ts">
import { explorerErrorKind } from '~/utils/explorer'

const props = withDefaults(
  defineProps<{
    error?: unknown
    retryable?: boolean
  }>(),
  { error: undefined, retryable: true },
)

defineEmits<{ retry: [] }>()

const messageKey = computed(() => `explorer.errors.${explorerErrorKind(props.error)}`)
</script>

<template>
  <div class="error-box explorer-error" role="alert">
    <strong>{{ $t(messageKey) }}</strong>
    <p v-if="explorerErrorKind(error) === 'unavailable'">
      {{ $t('explorer.errors.unavailableHint') }}
    </p>
    <button v-if="retryable" class="text-button" type="button" @click="$emit('retry')">
      {{ $t('common.retry') }}
    </button>
  </div>
</template>
