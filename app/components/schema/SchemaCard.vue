<template>
  <UCard>
    <template #header>
      <div class="flex items-start justify-between">
        <div class="flex-1">
          <NuxtLink
            :to="`/schemas/${schema.uid}`"
            class="text-lg font-semibold text-gray-900 hover:text-primary transition-colors"
          >
            {{ schema.schema_json.name }}
          </NuxtLink>
          <div class="flex items-center gap-2 mt-1">
            <UBadge color="info" variant="subtle">
              v{{ schema.schema_json.version }}
            </UBadge>
          </div>
        </div>
      </div>
    </template>

    <div class="space-y-4">
      <p
        v-if="schema.schema_json.description"
        class="text-sm text-gray-600 line-clamp-2"
      >
        {{ schema.schema_json.description }}
      </p>

      <div class="flex items-center justify-between text-sm">
        <div class="space-y-1">
          <div class="flex items-center gap-2 text-gray-500">
            <span class="font-medium">{{ schema.schema_json.fields.length }}</span>
            <span>fields</span>
          </div>
          <div class="flex items-center gap-2 text-gray-500">
            <span class="text-xs">Ledger {{ schema.ledger_index }}</span>
          </div>
        </div>

        <UButton
          :to="`/schemas/${schema.uid}`"
          color="primary"
          variant="soft"
          size="sm"
        >
          View Details
        </UButton>
      </div>

      <div
        class="pt-3 border-t border-gray-100 flex items-center justify-between"
      >
        <div class="flex items-center gap-2">
          <span class="text-xs text-gray-500">Issuer:</span>
          <code class="text-xs bg-gray-100 px-2 py-1 rounded">
            {{ truncateAddress(schema.issuer) }}
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

const truncateAddress = (address: string) => {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
};
</script>
