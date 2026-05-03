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
      color="error"
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
              {{ schema.schema_json.name }}
            </h1>
            <div class="flex items-center gap-3 flex-wrap">
              <UBadge color="info" variant="subtle">
                v{{ schema.schema_json.version }}
              </UBadge>
              <span class="text-sm text-gray-500">
                Ledger {{ schema.ledger_index }}
              </span>
            </div>
          </div>
          <div class="flex gap-2">
            <UButton
              :to="`/credentials/issue?schemaId=${schema.uid}`"
              color="primary"
            >
              Issue Credential
            </UButton>
          </div>
        </div>
        <p v-if="schema.schema_json.description" class="text-gray-600">
          {{ schema.schema_json.description }}
        </p>
      </div>

      <!-- Schema Info Grid -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <UCard>
          <div class="text-center">
            <div class="text-3xl font-bold text-primary mb-2">
              {{ schema.schema_json.fields.length }}
            </div>
            <div class="text-sm text-gray-600">Fields Defined</div>
          </div>
        </UCard>

        <UCard>
          <div class="text-center">
            <div class="text-sm text-gray-600 mb-1">Issuer</div>
            <code class="text-xs bg-gray-100 px-2 py-1 rounded">
              {{ truncateAddress(schema.issuer) }}
            </code>
          </div>
        </UCard>
      </div>

      <!-- UID -->
      <UCard>
        <template #header>
          <h3 class="font-semibold">Schema UID</h3>
        </template>
        <code class="text-xs break-all">{{ schema.uid }}</code>
      </UCard>

      <!-- Fields -->
      <UCard>
        <template #header>
          <h2 class="text-xl font-semibold">Schema Fields</h2>
        </template>

        <div class="space-y-4">
          <div
            v-for="(field, index) in schema.schema_json.fields"
            :key="index"
            class="p-4 border border-gray-200 rounded-lg"
          >
            <div class="flex items-start justify-between mb-2">
              <div>
                <div class="flex items-center gap-2">
                  <span class="font-semibold text-gray-900">{{ field.name }}</span>
                  <UBadge v-if="field.required" color="warning" variant="subtle" size="xs">
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
            <div v-if="field.pattern || field.min !== undefined || field.max !== undefined" class="mt-2 text-xs text-gray-500 flex gap-4">
              <span v-if="field.pattern">Pattern: {{ field.pattern }}</span>
              <span v-if="field.min !== undefined">Min: {{ field.min }}</span>
              <span v-if="field.max !== undefined">Max: {{ field.max }}</span>
            </div>
          </div>
        </div>
      </UCard>

      <!-- TX Hash -->
      <UCard>
        <template #header>
          <h3 class="font-semibold">Registration Transaction</h3>
        </template>
        <div class="flex items-center gap-2">
          <code class="text-xs bg-gray-100 px-3 py-2 rounded flex-1 break-all">
            {{ schema.tx_hash }}
          </code>
          <UButton
            :to="`https://testnet.xrpl.org/transactions/${schema.tx_hash}`"
            target="_blank"
            color="neutral"
            variant="ghost"
            size="xs"
            icon="i-heroicons-arrow-top-right-on-square"
          />
        </div>
      </UCard>

      <!-- Version History -->
      <SchemaVersionHistory
        v-if="ancestors.length || descendants.length"
        :current="schema"
        :ancestors="ancestors"
        :descendants="descendants"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Schema } from '~/lib/types/schema';

const route = useRoute();
const schemaUid = route.params.id as string;

const {
  data: schemaData,
  pending,
  error,
} = await useFetch(`/api/schema`, {
  query: { uid: schemaUid },
});

const schema = computed(() => schemaData.value?.data?.schema as Schema | undefined);
const ancestors = computed(() => (schemaData.value?.data?.ancestors as Schema[]) ?? []);
const descendants = computed(() => (schemaData.value?.data?.descendants as Schema[]) ?? []);

const truncateAddress = (address: string) => {
  if (address.length <= 12) return address;
  return `${address.slice(0, 8)}...${address.slice(-6)}`;
};

useHead({
  title: computed(() =>
    schema.value ? `${schema.value.schema_json.name} - XCS` : 'Schema - XCS'
  ),
});
</script>
