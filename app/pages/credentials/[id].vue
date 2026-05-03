<template>
  <div class="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
    <!-- Loading State -->
    <div v-if="pending" class="space-y-6">
      <USkeleton class="h-32" />
      <USkeleton class="h-96" />
    </div>

    <!-- Error State -->
    <UAlert
      v-else-if="error"
      color="error"
      variant="soft"
      title="Error loading credential"
      :description="error.message"
    />

    <!-- Credential Details -->
    <div v-else-if="credential" class="space-y-8">
      <!-- Header -->
      <div>
        <div class="flex items-start justify-between mb-4">
          <div>
            <h1 class="text-3xl font-bold text-gray-900 mb-2">
              Verifiable Credential
            </h1>
            <div class="flex items-center gap-3 flex-wrap">
              <UBadge :color="statusColor" variant="subtle">
                {{ statusText }}
              </UBadge>
              <UBadge v-if="isExpired" color="error" variant="subtle">
                Expired
              </UBadge>
            </div>
          </div>
        </div>
      </div>

      <!-- Issuer & Subject -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <UCard>
          <template #header>
            <h3 class="font-semibold">Issuer</h3>
          </template>
          <code class="text-sm break-all">{{ credential.issuer }}</code>
        </UCard>

        <UCard>
          <template #header>
            <h3 class="font-semibold">Subject</h3>
          </template>
          <code class="text-sm break-all">{{ credential.subject }}</code>
        </UCard>
      </div>

      <!-- Schema Info -->
      <UCard v-if="schema">
        <template #header>
          <div class="flex items-center justify-between">
            <h3 class="font-semibold">Schema</h3>
            <UButton
              :to="`/schemas/${schema.uid}`"
              color="neutral"
              variant="ghost"
              size="xs"
            >
              View Schema
            </UButton>
          </div>
        </template>
        <div class="space-y-2">
          <div class="flex items-center gap-2">
            <span class="font-semibold">{{ schema.schema_json.name }}</span>
            <UBadge color="info" variant="subtle" size="xs">
              v{{ schema.schema_json.version }}
            </UBadge>
          </div>
          <p v-if="schema.schema_json.description" class="text-sm text-gray-600">
            {{ schema.schema_json.description }}
          </p>
        </div>
      </UCard>

      <!-- URI / Off-chain Data Link -->
      <UCard v-if="credential.uri">
        <template #header>
          <h3 class="font-semibold">Credential URI</h3>
        </template>
        <a
          :href="credential.uri"
          target="_blank"
          rel="noopener noreferrer"
          class="text-sm text-primary hover:underline break-all"
        >
          {{ credential.uri }}
        </a>
      </UCard>

      <!-- XRPL Transaction -->
      <UCard v-if="credential.tx_hash">
        <template #header>
          <h3 class="font-semibold">XRPL Transaction</h3>
        </template>
        <div class="space-y-3">
          <div>
            <div class="text-sm font-medium text-gray-700 mb-1">
              Transaction Hash
            </div>
            <div class="flex items-center gap-2">
              <code class="text-xs bg-gray-100 px-3 py-2 rounded flex-1 break-all">
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
          <div v-if="credential.created_ledger">
            <div class="text-sm font-medium text-gray-700 mb-1">
              Ledger
            </div>
            <code class="text-xs bg-gray-100 px-3 py-2 rounded">
              {{ credential.created_ledger }}
            </code>
          </div>
        </div>
      </UCard>

      <!-- Expiration -->
      <UCard v-if="credential.expiration">
        <div class="text-sm">
          <div class="font-medium text-gray-700 mb-1">Expires</div>
          <div :class="isExpired ? 'text-red-600' : 'text-gray-900'">
            {{ expirationDate }}
          </div>
        </div>
      </UCard>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Credential, Schema } from '~/lib/types/schema';

const RIPPLE_EPOCH = 946684800;

const route = useRoute();
const credentialId = decodeURIComponent(route.params.id as string);

const {
  data: credentialData,
  pending,
  error,
} = await useFetch(`/api/credential`, {
  query: { id: credentialId },
});

const credential = computed(() => credentialData.value?.data?.credential as Credential | undefined);
const schema = computed(() => credentialData.value?.data?.schema as Schema | null | undefined);

const isExpired = computed(() => {
  if (!credential.value?.expiration) return false;
  return (credential.value.expiration + RIPPLE_EPOCH) * 1000 < Date.now();
});

const expirationDate = computed(() => {
  if (!credential.value?.expiration) return '';
  const d = new Date((credential.value.expiration + RIPPLE_EPOCH) * 1000);
  return new Intl.DateTimeFormat('en', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(d);
});

const statusColor = computed(() => {
  if (!credential.value) return 'neutral';
  if (credential.value.status === 'revoked') return 'error';
  if (credential.value.status === 'accepted') return 'success';
  return 'warning';
});

const statusText = computed(() => {
  if (!credential.value) return 'Unknown';
  if (credential.value.status === 'revoked') return 'Revoked';
  if (credential.value.status === 'accepted') return 'Accepted';
  return 'Pending';
});

useHead({
  title: computed(() => `Credential ${credentialId.slice(0, 8)} - XCS`),
});
</script>
