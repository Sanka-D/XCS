<template>
  <UCard
    :ui="{
      body: { padding: 'p-6' },
      header: { padding: 'p-4 pb-0' },
    }"
  >
    <template #header>
      <div class="flex items-start justify-between">
        <div class="flex-1">
          <NuxtLink
            :to="`/credentials/${credential.id}`"
            class="text-lg font-semibold text-gray-900 hover:text-primary transition-colors"
          >
            Credential
            <span class="text-sm text-gray-500">
              #{{ credential.id.slice(0, 8) }}
            </span>
          </NuxtLink>
          <div class="flex items-center gap-2 mt-1 flex-wrap">
            <UBadge :color="getStatusColor()" variant="subtle">
              {{ getStatusText() }}
            </UBadge>
            <UBadge
              :color="credential.isPublic ? 'green' : 'gray'"
              variant="subtle"
            >
              {{ credential.isPublic ? 'Public' : 'Private' }}
            </UBadge>
            <UBadge v-if="isExpired" color="red" variant="subtle">
              Expired
            </UBadge>
          </div>
        </div>
        <UButton
          v-if="credential.ipfsCid"
          :to="`${ipfsGateway}/ipfs/${credential.ipfsCid}`"
          target="_blank"
          color="gray"
          variant="ghost"
          size="xs"
          icon="i-heroicons-arrow-top-right-on-square"
        >
          IPFS
        </UButton>
      </div>
    </template>

    <div class="space-y-4">
      <!-- Issuer & Subject -->
      <div class="space-y-2">
        <div class="flex items-center gap-2 text-sm">
          <span class="text-gray-500 w-20">Issuer:</span>
          <code class="text-xs bg-gray-100 px-2 py-1 rounded flex-1">
            {{ credential.issuer }}
          </code>
        </div>
        <div class="flex items-center gap-2 text-sm">
          <span class="text-gray-500 w-20">Subject:</span>
          <code class="text-xs bg-gray-100 px-2 py-1 rounded flex-1">
            {{ credential.subject }}
          </code>
        </div>
      </div>

      <!-- Dates -->
      <div class="flex items-center justify-between text-sm">
        <div class="space-y-1">
          <div class="text-gray-500">
            <span class="font-medium">Issued:</span>
            {{ formatDate(credential.createdAt) }}
          </div>
          <div v-if="credential.expiresAt" class="text-gray-500">
            <span class="font-medium">Expires:</span>
            {{ formatDate(credential.expiresAt) }}
          </div>
        </div>

        <UButton
          :to="`/credentials/${credential.id}`"
          color="primary"
          variant="soft"
          size="sm"
        >
          View Details
        </UButton>
      </div>

      <!-- XRPL Info -->
      <div
        v-if="credential.xrplTxHash"
        class="pt-3 border-t border-gray-100 space-y-2"
      >
        <div class="flex items-center gap-2 text-xs">
          <span class="text-gray-500">TX Hash:</span>
          <code class="bg-gray-100 px-2 py-1 rounded flex-1 truncate">
            {{ credential.xrplTxHash }}
          </code>
          <UButton
            :to="`https://testnet.xrpl.org/transactions/${credential.xrplTxHash}`"
            target="_blank"
            color="gray"
            variant="ghost"
            size="xs"
            icon="i-heroicons-arrow-top-right-on-square"
          />
        </div>
        <div
          v-if="credential.acceptedAt"
          class="flex items-center gap-2 text-xs text-gray-500"
        >
          <span>Accepted on {{ formatDate(credential.acceptedAt) }}</span>
        </div>
        <div
          v-if="credential.revokedAt"
          class="flex items-center gap-2 text-xs text-red-600"
        >
          <span>Revoked on {{ formatDate(credential.revokedAt) }}</span>
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

const config = useRuntimeConfig();
const ipfsGateway = config.public.ipfsGateway;

const isExpired = computed(() => {
  if (!props.credential.expiresAt) return false;
  return new Date(props.credential.expiresAt) < new Date();
});

const getStatusColor = () => {
  if (props.credential.revoked) return 'red';
  if (props.credential.accepted) return 'green';
  return 'yellow';
};

const getStatusText = () => {
  if (props.credential.revoked) return 'Revoked';
  if (props.credential.accepted) return 'Accepted';
  return 'Pending';
};

const formatDate = (date: Date | string) => {
  const d = new Date(date);
  return new Intl.DateTimeFormat('en', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(d);
};
</script>
