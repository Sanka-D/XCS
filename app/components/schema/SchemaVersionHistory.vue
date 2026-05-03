<template>
  <UCard v-if="ancestors.length || descendants.length">
    <template #header>
      <h3 class="text-lg font-semibold">Version History</h3>
    </template>

    <div class="space-y-2">
      <!-- Ancestor versions (oldest first) -->
      <NuxtLink
        v-for="ancestor in ancestors"
        :key="ancestor.uid"
        :to="`/schemas/${ancestor.uid}`"
        class="flex items-center justify-between p-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors text-sm"
      >
        <div class="flex items-center gap-3">
          <div class="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0">
            <span class="text-xs font-semibold text-gray-600">
              v{{ getMajorVersion(ancestor.schema_json.version) }}
            </span>
          </div>
          <div>
            <span class="font-medium text-gray-700">v{{ ancestor.schema_json.version }}</span>
            <span class="ml-2 font-mono text-xs text-gray-400">{{ ancestor.uid.slice(0, 16) }}…</span>
          </div>
        </div>
        <span class="text-xs text-gray-400">Ledger {{ ancestor.ledger_index }}</span>
      </NuxtLink>

      <!-- Current version (highlighted) -->
      <div class="flex items-center justify-between p-3 border-2 border-primary rounded-lg bg-primary/5 text-sm">
        <div class="flex items-center gap-3">
          <div class="w-7 h-7 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
            <span class="text-xs font-semibold text-white">
              v{{ getMajorVersion(current.schema_json.version) }}
            </span>
          </div>
          <div>
            <span class="font-medium text-primary">v{{ current.schema_json.version }}</span>
            <UBadge color="primary" variant="subtle" size="xs" class="ml-2">Current</UBadge>
            <span class="ml-2 font-mono text-xs text-gray-400">{{ current.uid.slice(0, 16) }}…</span>
          </div>
        </div>
        <span class="text-xs text-gray-400">Ledger {{ current.ledger_index }}</span>
      </div>

      <!-- Descendant versions -->
      <NuxtLink
        v-for="descendant in descendants"
        :key="descendant.uid"
        :to="`/schemas/${descendant.uid}`"
        class="flex items-center justify-between p-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors text-sm"
      >
        <div class="flex items-center gap-3">
          <div class="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0">
            <span class="text-xs font-semibold text-gray-600">
              v{{ getMajorVersion(descendant.schema_json.version) }}
            </span>
          </div>
          <div>
            <span class="font-medium text-gray-700">v{{ descendant.schema_json.version }}</span>
            <span class="ml-2 font-mono text-xs text-gray-400">{{ descendant.uid.slice(0, 16) }}…</span>
          </div>
        </div>
        <span class="text-xs text-gray-400">Ledger {{ descendant.ledger_index }}</span>
      </NuxtLink>
    </div>
  </UCard>
</template>

<script setup lang="ts">
import type { Schema } from '~/lib/types/schema';

defineProps<{
  current: Schema;
  ancestors: Schema[];
  descendants: Schema[];
}>();

const getMajorVersion = (version: string) => {
  return version.split('.')[0] ?? version;
};
</script>
