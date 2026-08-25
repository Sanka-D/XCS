<script setup lang="ts">
import type { Transaction } from 'xrpl'

defineProps<{ transaction: Transaction | null; busy?: boolean }>()
defineEmits<{ confirm: [] }>()
</script>

<template>
  <section
    v-if="transaction"
    class="preview-card"
    data-testid="transaction-preview"
    aria-live="polite"
  >
    <div>
      <p class="eyebrow">{{ $t('transaction.preview') }}</p>
      <h2>{{ transaction.TransactionType }}</h2>
      <dl class="preview-grid">
        <template v-for="(value, key) in transaction" :key="key">
          <dt>{{ key }}</dt>
          <dd>
            <code>{{ typeof value === 'object' ? JSON.stringify(value) : value }}</code>
          </dd>
        </template>
      </dl>
    </div>
    <div class="warning-box">{{ $t('transaction.confirmWarning') }}</div>
    <button
      class="button"
      data-testid="transaction-sign"
      type="button"
      :disabled="busy"
      @click="$emit('confirm')"
    >
      {{ busy ? $t('common.working') : $t('transaction.sign') }}
    </button>
  </section>
</template>
