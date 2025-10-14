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
            :to="`/schemas/${schema.id}`"
            class="text-lg font-semibold text-gray-900 hover:text-primary transition-colors"
          >
            {{ schema.name }}
          </NuxtLink>
          <div class="flex items-center gap-2 mt-1">
            <UBadge :color="schema.isPublic ? 'green' : 'gray'" variant="subtle">
              {{ schema.isPublic ? 'Public' : 'Private' }}
            </UBadge>
            <UBadge color="blue" variant="subtle"> v{{ schema.version }} </UBadge>
          </div>
        </div>
        <UButton
          v-if="schema.ipfsCid"
          :to="`${ipfsGateway}/ipfs/${schema.ipfsCid}`"
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
      <p v-if="schema.description" class="text-sm text-gray-600 line-clamp-2">
        {{ schema.description }}
      </p>

      <div class="flex items-center justify-between text-sm">
        <div class="space-y-1">
          <div class="flex items-center gap-2 text-gray-500">
            <span class="font-medium">{{ schema.fields.fields.length }}</span>
            <span>fields</span>
          </div>
          <div class="flex items-center gap-2 text-gray-500">
            <span class="text-xs">
              Created {{ formatDate(schema.createdAt) }}
            </span>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <UButton
            :to="`/schemas/${schema.id}`"
            color="primary"
            variant="soft"
            size="sm"
          >
            View Details
          </UButton>
        </div>
      </div>

      <!-- Creator Info -->
      <div
        class="pt-3 border-t border-gray-100 flex items-center justify-between"
      >
        <div class="flex items-center gap-2">
          <span class="text-xs text-gray-500">Creator:</span>
          <code class="text-xs bg-gray-100 px-2 py-1 rounded">
            {{ truncateAddress(schema.creator) }}
          </code>
        </div>
      </div>
    </div>
  </UCard>
</template>

<script setup lang="ts">
import type { Schema } from '~/lib/types/schema';

const props = defineProps<{
  schema: Schema;
}>();

const config = useRuntimeConfig();
const ipfsGateway = config.public.ipfsGateway;

const formatDate = (date: Date | string) => {
  const d = new Date(date);
  return new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(
    Math.ceil((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
    'day'
  );
};

const truncateAddress = (address: string) => {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
};
</script>
