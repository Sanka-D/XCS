<template>
  <div class="space-y-6">
    <!-- Filters -->
    <div class="flex flex-col sm:flex-row gap-4">
      <UInput
        v-model="searchQuery"
        placeholder="Search schemas..."
        icon="i-heroicons-magnifying-glass"
        size="lg"
        class="flex-1"
      />
    </div>

    <!-- Loading State -->
    <div v-if="pending" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      <USkeleton v-for="i in 6" :key="i" class="h-64" />
    </div>

    <!-- Error State -->
    <UAlert
      v-else-if="error"
      color="error"
      variant="soft"
      title="Error loading schemas"
      :description="error.message"
    />

    <!-- Empty State -->
    <div
      v-else-if="!schemas || schemas.length === 0"
      class="text-center py-12"
    >
      <div class="text-gray-400 mb-4">
        <svg
          class="mx-auto h-12 w-12"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
          />
        </svg>
      </div>
      <h3 class="text-lg font-medium text-gray-900 mb-2">No schemas found</h3>
      <p class="text-gray-500 mb-6">
        {{ searchQuery ? 'Try adjusting your search' : 'Get started by creating your first schema' }}
      </p>
      <UButton v-if="!searchQuery" to="/schemas/create" color="primary" size="lg">
        Create Schema
      </UButton>
    </div>

    <!-- Schemas Grid -->
    <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      <SchemaCard v-for="schema in schemas" :key="schema.uid" :schema="schema" />
    </div>

    <!-- Pagination -->
    <div v-if="total > limit" class="flex justify-center">
      <UPagination
        v-model="currentPage"
        :total="total"
        :page-count="limit"
        :max="5"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Schema } from '~/lib/types/schema';

const searchQuery = ref('');
const currentPage = ref(1);
const limit = 9;

const offset = computed(() => (currentPage.value - 1) * limit);

watch([searchQuery, currentPage], () => {
  refresh();
});

const {
  data: schemasData,
  pending,
  error,
  refresh,
} = await useFetch('/api/schema/list', {
  method: 'POST',
  body: computed(() => ({
    search: searchQuery.value || undefined,
    limit,
    offset: offset.value,
  })),
  watch: false,
});

const schemas = computed(() => (schemasData.value?.data?.schemas as unknown as Schema[]) || []);
const total = computed(() => schemasData.value?.data?.total || 0);
</script>
