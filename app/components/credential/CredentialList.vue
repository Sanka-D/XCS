<template>
  <div class="space-y-6">
    <!-- Filters -->
    <div class="flex flex-col sm:flex-row gap-4">
      <USelectMenu
        v-model="selectedStatus"
        :options="statusOptions"
        size="lg"
        class="w-full sm:w-48"
      />
      <UInput
        v-model="subjectFilter"
        placeholder="Filter by subject address..."
        icon="i-heroicons-user"
        size="lg"
        class="flex-1"
      />
    </div>

    <!-- Loading State -->
    <div v-if="pending" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      <USkeleton v-for="i in 6" :key="i" class="h-80" />
    </div>

    <!-- Error State -->
    <UAlert
      v-else-if="error"
      color="error"
      variant="soft"
      title="Error loading credentials"
      :description="error.message"
    />

    <!-- Empty State -->
    <div
      v-else-if="!credentials || credentials.length === 0"
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
            d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z"
          />
        </svg>
      </div>
      <h3 class="text-lg font-medium text-gray-900 mb-2">
        No credentials found
      </h3>
      <p class="text-gray-500 mb-6">
        {{
          subjectFilter
            ? 'Try adjusting your filters'
            : 'Get started by issuing your first credential'
        }}
      </p>
      <UButton
        v-if="!subjectFilter"
        to="/credentials/issue"
        color="primary"
        size="lg"
      >
        Issue Credential
      </UButton>
    </div>

    <!-- Credentials Grid -->
    <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      <CredentialCard
        v-for="credential in credentials"
        :key="credential.id"
        :credential="credential"
      />
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
import type { Credential } from '~/lib/types/schema';

const selectedStatus = ref('all');
const subjectFilter = ref('');
const currentPage = ref(1);
const limit = 9;

const statusOptions = [
  { label: 'All Status', value: 'all' },
  { label: 'Pending', value: 'created' },
  { label: 'Accepted', value: 'accepted' },
  { label: 'Revoked', value: 'revoked' },
];

const offset = computed(() => (currentPage.value - 1) * limit);

watch([selectedStatus, subjectFilter, currentPage], () => {
  refresh();
});

const {
  data: credentialsData,
  pending,
  error,
  refresh,
} = await useFetch('/api/credential/list', {
  method: 'POST',
  body: computed(() => ({
    subject: subjectFilter.value || undefined,
    status: selectedStatus.value === 'all' ? undefined : selectedStatus.value,
    limit,
    offset: offset.value,
  })),
  watch: false,
});

const credentials = computed(() => (credentialsData.value?.data?.credentials as unknown as Credential[]) || []);
const total = computed(() => credentialsData.value?.data?.total || 0);
</script>
