<script setup lang="ts">
import type { Transaction } from 'xrpl-connect'
import { requiresGemWalletRawSigning } from '~/utils/gemWalletRawSigning'

const props = defineProps<{
  transaction: Transaction | null
  busy?: boolean
  compact?: boolean
  confirmLabel?: string
}>()
const emit = defineEmits<{ confirm: [] }>()
const { walletId, consentToRawSigning } = useWallet()
const rawSigning = computed(() =>
  requiresGemWalletRawSigning(walletId.value, props.transaction?.TransactionType),
)
const rawAcknowledged = ref(false)
watch(
  [() => props.transaction, walletId],
  () => {
    rawAcknowledged.value = false
  },
  { deep: true },
)

function confirm() {
  if (!props.transaction || props.busy || (rawSigning.value && !rawAcknowledged.value)) return
  if (rawSigning.value) consentToRawSigning(props.transaction)
  rawAcknowledged.value = false
  emit('confirm')
}
</script>

<template>
  <UCard v-if="transaction" class="mb-6" data-testid="transaction-preview" aria-live="polite">
    <details v-if="compact && !rawSigning">
      <summary class="cursor-pointer font-semibold">{{ $t('transaction.preview') }}</summary>
      <JsonBlock class="mt-3" :code="JSON.stringify(transaction, null, 2)" />
    </details>
    <div v-else>
      <p class="text-xs font-semibold tracking-[0.2em] text-muted uppercase">
        {{ $t('transaction.preview') }}
      </p>
      <h2 class="mb-4 text-xl font-semibold">{{ transaction.TransactionType }}</h2>
      <MetadataList>
        <template v-for="(value, key) in transaction" :key="key">
          <dt>{{ key }}</dt>
          <dd>
            <code>{{ typeof value === 'object' ? JSON.stringify(value) : value }}</code>
          </dd>
        </template>
      </MetadataList>
    </div>
    <StatusBox v-if="rawSigning" tone="warning" class="mt-5">
      <p>{{ $t('transaction.rawWarning') }}</p>
      <UCheckbox
        v-model="rawAcknowledged"
        :disabled="busy"
        data-testid="raw-signing-consent"
        :label="$t('transaction.rawConsent')"
      />
    </StatusBox>
    <StatusBox v-else-if="!compact" tone="warning" class="mt-5">{{
      $t('transaction.confirmWarning')
    }}</StatusBox>
    <UButton
      class="mt-3"
      data-testid="transaction-sign"
      :disabled="busy || (rawSigning && !rawAcknowledged)"
      @click="confirm"
    >
      {{
        busy
          ? $t('common.working')
          : rawSigning
            ? $t('transaction.rawSign')
            : (confirmLabel ?? $t('transaction.sign'))
      }}
    </UButton>
  </UCard>
</template>
