<template>
  <UCard>
    <template #header>
      <h3 class="text-lg font-semibold">Version History</h3>
    </template>

    <div v-if="versions && versions.length > 0" class="space-y-4">
      <div
        v-for="(version, index) in sortedVersions"
        :key="version.id"
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
                version.id === currentVersionId
                  ? 'bg-primary text-white'
                  : 'bg-gray-200 text-gray-600'
              "
            >
              <span class="text-xs font-semibold">
                v{{ getMajorVersion(version.version) }}
              </span>
            </div>
          </div>

          <!-- Version Details -->
          <div class="flex-1 pb-4">
            <div class="flex items-center justify-between mb-1">
              <div class="flex items-center gap-2">
                <span class="font-semibold text-gray-900">
                  v{{ version.version }}
                </span>
                <UBadge
                  v-if="version.id === currentVersionId"
                  color="primary"
                  variant="subtle"
                  size="xs"
                >
                  Current
                </UBadge>
                <UBadge
                  v-if="!version.parentSchemaId"
                  color="blue"
                  variant="subtle"
                  size="xs"
                >
                  Initial
                </UBadge>
              </div>
              <UButton
                :to="`/schemas/${version.id}`"
                color="gray"
                variant="ghost"
                size="xs"
              >
                View
              </UButton>
            </div>

            <p v-if="version.description" class="text-sm text-gray-600 mb-2">
              {{ version.description }}
            </p>

            <div class="flex items-center gap-4 text-xs text-gray-500">
              <span>{{ version.fields.fields.length }} fields</span>
              <span>{{ formatDate(version.createdAt) }}</span>
              <span v-if="version.isPublic && version.ipfsCid">
                <a
                  :href="`${ipfsGateway}/ipfs/${version.ipfsCid}`"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="text-primary hover:underline"
                >
                  IPFS →
                </a>
              </span>
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
  currentVersionId: string;
}>();

const config = useRuntimeConfig();
const ipfsGateway = config.public.ipfsGateway;

// Sort versions by creation date (newest first)
const sortedVersions = computed(() => {
  return [...props.versions].sort(
    (a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
});

const getMajorVersion = (version: string) => {
  return version.split('.')[0];
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
