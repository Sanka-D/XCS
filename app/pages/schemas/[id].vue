<template>
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
    <!-- Loading State -->
    <div v-if="pending" class="space-y-6">
      <USkeleton class="h-32" />
      <USkeleton class="h-64" />
    </div>

    <!-- Error State -->
    <UAlert
      v-else-if="error"
      color="red"
      variant="soft"
      title="Error loading schema"
      :description="error.message"
    />

    <!-- Schema Details -->
    <div v-else-if="schema" class="space-y-8">
      <!-- Header -->
      <div>
        <div class="flex items-start justify-between mb-4">
          <div>
            <h1 class="text-3xl font-bold text-gray-900 mb-2">
              {{ schema.name }}
            </h1>
            <div class="flex items-center gap-3 flex-wrap">
              <UBadge :color="schema.isPublic ? 'green' : 'gray'" variant="subtle">
                {{ schema.isPublic ? 'Public' : 'Private' }}
              </UBadge>
              <UBadge color="blue" variant="subtle"> v{{ schema.version }} </UBadge>
              <span class="text-sm text-gray-500">
                Created {{ formatDate(schema.createdAt) }}
              </span>
            </div>
          </div>
          <div class="flex gap-2">
            <UButton
              :to="`/credentials/issue?schemaId=${schema.id}`"
              color="primary"
            >
              Issue Credential
            </UButton>
          </div>
        </div>
        <p v-if="schema.description" class="text-gray-600">
          {{ schema.description }}
        </p>
      </div>

      <!-- Schema Info Grid -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
        <UCard>
          <div class="text-center">
            <div class="text-3xl font-bold text-primary mb-2">
              {{ schema.fields.fields.length }}
            </div>
            <div class="text-sm text-gray-600">Fields Defined</div>
          </div>
        </UCard>

        <UCard>
          <div class="text-center">
            <div class="text-sm text-gray-600 mb-1">Creator</div>
            <code class="text-xs bg-gray-100 px-2 py-1 rounded">
              {{ truncateAddress(schema.creator) }}
            </code>
          </div>
        </UCard>

        <UCard v-if="schema.ipfsCid">
          <div class="text-center">
            <div class="text-sm text-gray-600 mb-1">IPFS CID</div>
            <a
              :href="`${ipfsGateway}/ipfs/${schema.ipfsCid}`"
              target="_blank"
              rel="noopener noreferrer"
              class="text-xs text-primary hover:underline"
            >
              View on IPFS →
            </a>
          </div>
        </UCard>
      </div>

      <!-- Fields -->
      <UCard>
        <template #header>
          <h2 class="text-xl font-semibold">Schema Fields</h2>
        </template>

        <div class="space-y-4">
          <div
            v-for="(field, index) in schema.fields.fields"
            :key="index"
            class="p-4 border border-gray-200 rounded-lg"
          >
            <div class="flex items-start justify-between mb-2">
              <div>
                <div class="flex items-center gap-2">
                  <span class="font-semibold text-gray-900">{{ field.name }}</span>
                  <UBadge v-if="field.required" color="orange" variant="subtle" size="xs">
                    Required
                  </UBadge>
                </div>
                <div class="text-sm text-gray-600 mt-1">
                  Type: <code class="bg-gray-100 px-2 py-0.5 rounded">{{ field.type }}</code>
                </div>
              </div>
            </div>
            <p v-if="field.description" class="text-sm text-gray-600 mt-2">
              {{ field.description }}
            </p>
            <div v-if="field.pattern || field.min || field.max" class="mt-2 text-xs text-gray-500">
              <span v-if="field.pattern">Pattern: {{ field.pattern }}</span>
              <span v-if="field.min">Min: {{ field.min }}</span>
              <span v-if="field.max">Max: {{ field.max }}</span>
            </div>
          </div>
        </div>
      </UCard>

      <!-- Version History -->
      <SchemaVersionHistory
        v-if="versions && versions.length > 0"
        :versions="versions"
        :current-version-id="schema.id"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
const route = useRoute();
const schemaId = route.params.id as string;

const config = useRuntimeConfig();
const ipfsGateway = config.public.ipfsGateway;

// Fetch schema with versions
const {
  data: schemaData,
  pending,
  error,
} = await useFetch(`/api/schema`, {
  query: {
    id: schemaId,
    includeVersions: 'true',
  },
});

const schema = computed(() => schemaData.value?.data?.schema);
const versions = computed(() => schemaData.value?.data?.versions);

const formatDate = (date: Date | string) => {
  const d = new Date(date);
  return new Intl.DateTimeFormat('en', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(d);
};

const truncateAddress = (address: string) => {
  if (address.length <= 12) return address;
  return `${address.slice(0, 8)}...${address.slice(-6)}`;
};

useHead({
  title: computed(() => schema.value ? `${schema.value.name} - XCS` : 'Schema - XCS'),
});
</script>
