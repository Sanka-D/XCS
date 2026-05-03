<template>
  <UCard>
    <template #header>
      <h3 class="text-lg font-semibold">Version History</h3>
    </template>

    <div v-if="versions && versions.length > 0" class="space-y-4">
      <div
        v-for="(version, index) in sortedVersions"
        :key="version.uid"
        class="relative"
      >
        <!-- Timeline connector -->
        <div
          v-if="index < sortedVersions.length - 1"
          class="absolute left-4 top-10 bottom-0 w-0.5 bg-gray-200"
        ></div>

        <div class="flex gap-4">
          <!-- Version Badge -->
          <div class="flex-shrink-0">
            <div
              class="w-8 h-8 rounded-full flex items-center justify-center"
              :class="
                version.uid === currentUid
                  ? 'bg-primary text-white'
                  : 'bg-gray-200 text-gray-600'
              "
            >
              <span class="text-xs font-semibold">
                v{{ getMajorVersion(version.schema_json.version) }}
              </span>
            </div>
          </div>

          <!-- Version Details -->
          <div class="flex-1 pb-4">
            <div class="flex items-center justify-between mb-1">
              <div class="flex items-center gap-2">
                <span class="font-semibold text-gray-900">
                  v{{ version.schema_json.version }}
                </span>
                <UBadge
                  v-if="version.uid === currentUid"
                  color="primary"
                  variant="subtle"
                  size="xs"
                >
                  Current
                </UBadge>
              </div>
              <UButton
                :to="`/schemas/${version.uid}`"
                color="neutral"
                variant="ghost"
                size="xs"
              >
                View
              </UButton>
            </div>

            <p
              v-if="version.schema_json.description"
              class="text-sm text-gray-600 mb-2"
            >
              {{ version.schema_json.description }}
            </p>

            <div class="flex items-center gap-4 text-xs text-gray-500">
              <span>{{ version.schema_json.fields.length }} fields</span>
              <span>Ledger {{ version.ledger_index }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-else class="text-center py-8 text-gray-500">
      <p>No version history available</p>
    </div>
  </UCard>
</template>

<script setup lang="ts">
import type { Schema } from '~/lib/types/schema';

const props = defineProps<{
  versions: Schema[];
  currentUid: string;
}>();

// Sort by ledger index ascending (oldest first)
const sortedVersions = computed(() => {
  return [...props.versions].sort((a, b) => a.ledger_index - b.ledger_index);
});

const getMajorVersion = (version: string) => {
  return version.split('.')[0];
};
</script>
