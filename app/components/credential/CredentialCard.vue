<template>
  <UCard>
    <template #header>
      <div class="flex items-start justify-between">
        <div class="flex-1">
          <NuxtLink
            :to="`/credentials/${encodeURIComponent(credential.id)}`"
            class="text-lg font-semibold text-gray-900 hover:text-primary transition-colors"
          >
            Credential
            <span class="text-sm text-gray-500">
              #{{ credential.id.slice(0, 8) }}
            </span>
          </NuxtLink>
          <div class="flex items-center gap-2 mt-1 flex-wrap">
            <UBadge :color="statusColor" variant="subtle">
              {{ statusText }}
            </UBadge>
            <UBadge v-if="isExpired" color="error" variant="subtle">
              Expired
            </UBadge>
          </div>
        </div>
      </div>
    </template>

    <div class="space-y-4">
      <!-- Issuer & Subject -->
      <div class="space-y-2">
        <div class="flex items-center gap-2 text-sm">
          <span class="text-gray-500 w-20">Issuer:</span>
          <code class="text-xs bg-gray-100 px-2 py-1 rounded flex-1 truncate">
            {{ credential.issuer }}
          </code>
        </div>
        <div class="flex items-center gap-2 text-sm">
          <span class="text-gray-500 w-20">Subject:</span>
          <code class="text-xs bg-gray-100 px-2 py-1 rounded flex-1 truncate">
            {{ credential.subject }}
          </code>
        </div>
      </div>

      <!-- Ledger info -->
      <div class="flex items-center justify-between text-sm">
        <div class="space-y-1">
          <div v-if="credential.created_ledger" class="text-gray-500">
            <span class="font-medium">Ledger:</span>
            {{ credential.created_ledger }}
          </div>
          <div v-if="credential.expiration" class="text-gray-500">
            <span class="font-medium">Expires:</span>
            {{ expirationDate }}
          </div>
        </div>

        <UButton
          :to="`/credentials/${encodeURIComponent(credential.id)}`"
          color="primary"
          variant="soft"
          size="sm"
        >
          View Details
        </UButton>
      </div>

      <!-- XRPL TX Hash -->
      <div
        v-if="credential.tx_hash"
        class="pt-3 border-t border-gray-100 space-y-2"
      >
        <div class="flex items-center gap-2 text-xs">
          <span class="text-gray-500">TX:</span>
          <code class="bg-gray-100 px-2 py-1 rounded flex-1 truncate">
            {{ credential.tx_hash }}
          </code>
          <UButton
            :to="`https://testnet.xrpl.org/transactions/${credential.tx_hash}`"
            target="_blank"
            color="neutral"
            variant="ghost"
            size="xs"
            icon="i-heroicons-arrow-top-right-on-square"
          />
        </div>
      </div>
    </div>
  </UCard>
</template>

<script setup lang="ts">
import type { Credential } from '~/lib/types/schema';

const props = defineProps<{
  credential: Credential;
}>();

// Ripple epoch offset: Jan 1 2000 00:00:00 UTC = 946684800 Unix seconds
const RIPPLE_EPOCH = 946684800;

const isExpired = computed(() => {
  if (!props.credential.expiration) return false;
  return (props.credential.expiration + RIPPLE_EPOCH) * 1000 < Date.now();
});

const expirationDate = computed(() => {
  if (!props.credential.expiration) return '';
  const d = new Date((props.credential.expiration + RIPPLE_EPOCH) * 1000);
  return new Intl.DateTimeFormat('en', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(d);
});

const statusColor = computed(() => {
  if (props.credential.status === 'revoked') return 'error';
  if (props.credential.status === 'accepted') return 'success';
  return 'warning';
});

const statusText = computed(() => {
  if (props.credential.status === 'revoked') return 'Revoked';
  if (props.credential.status === 'accepted') return 'Accepted';
  return 'Pending';
});
</script>
