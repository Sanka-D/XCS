<template>
  <div class="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
    <!-- Loading State -->
    <div v-if="pending" class="space-y-6">
      <USkeleton class="h-32" />
      <USkeleton class="h-96" />
    </div>

    <!-- Error State -->
    <UAlert
      v-else-if="error"
      color="red"
      variant="soft"
      title="Error loading credential"
      :description="error.message"
    />

    <!-- Credential Details -->
    <div v-else-if="credential && schema" class="space-y-8">
      <!-- Header -->
      <div>
        <div class="flex items-start justify-between mb-4">
          <div>
            <h1 class="text-3xl font-bold text-gray-900 mb-2">
              Verifiable Credential
            </h1>
            <div class="flex items-center gap-3 flex-wrap">
              <UBadge :color="getStatusColor()" variant="subtle">
                {{ getStatusText() }}
              </UBadge>
              <UBadge :color="credential.isPublic ? 'green' : 'gray'" variant="subtle">
                {{ credential.isPublic ? 'Public' : 'Private' }}
              </UBadge>
              <UBadge v-if="isExpired" color="red" variant="subtle">
                Expired
              </UBadge>
            </div>
          </div>
        </div>
      </div>

      <!-- Credential Info -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <UCard>
          <template #header>
            <h3 class="font-semibold">Issuer</h3>
          </template>
          <code class="text-sm break-all">{{ credential.issuer }}</code>
        </UCard>

        <UCard>
          <template #header>
            <h3 class="font-semibold">Subject</h3>
          </template>
          <code class="text-sm break-all">{{ credential.subject }}</code>
        </UCard>
      </div>

      <!-- Schema Info -->
      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <h3 class="font-semibold">Schema</h3>
            <UButton
              :to="`/schemas/${schema.id}`"
              color="gray"
              variant="ghost"
              size="xs"
            >
              View Schema
            </UButton>
          </div>
        </template>
        <div class="space-y-2">
          <div class="flex items-center gap-2">
            <span class="font-semibold">{{ schema.name }}</span>
            <UBadge color="blue" variant="subtle" size="xs">
              v{{ schema.version }}
            </UBadge>
          </div>
          <p v-if="schema.description" class="text-sm text-gray-600">
            {{ schema.description }}
          </p>
        </div>
      </UCard>

      <!-- Credential Data -->
      <UCard>
        <template #header>
          <h3 class="font-semibold">Credential Data</h3>
        </template>
        <div class="space-y-4">
          <div
            v-for="(value, key) in credential.vcDocument.credentialSubject"
            :key="key"
            v-show="key !== 'id'"
            class="border-b border-gray-100 pb-3 last:border-0"
          >
            <div class="text-sm font-medium text-gray-700 mb-1">{{ key }}</div>
            <div class="text-sm text-gray-900">
              {{ formatValue(value) }}
            </div>
          </div>
        </div>
      </UCard>

      <!-- XRPL Transaction -->
      <UCard v-if="credential.xrplTxHash">
        <template #header>
          <h3 class="font-semibold">XRPL Transaction</h3>
        </template>
        <div class="space-y-3">
          <div>
            <div class="text-sm font-medium text-gray-700 mb-1">
              Transaction Hash
            </div>
            <div class="flex items-center gap-2">
              <code class="text-xs bg-gray-100 px-3 py-2 rounded flex-1 break-all">
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
          </div>
          <div v-if="credential.xrplLedgerIndex">
            <div class="text-sm font-medium text-gray-700 mb-1">
              Ledger Index
            </div>
            <code class="text-xs bg-gray-100 px-3 py-2 rounded">
              {{ credential.xrplLedgerIndex }}
            </code>
          </div>
        </div>
      </UCard>

      <!-- Timestamps -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
        <UCard>
          <div class="text-sm">
            <div class="font-medium text-gray-700 mb-1">Issued</div>
            <div class="text-gray-900">{{ formatDate(credential.createdAt) }}</div>
          </div>
        </UCard>

        <UCard v-if="credential.acceptedAt">
          <div class="text-sm">
            <div class="font-medium text-gray-700 mb-1">Accepted</div>
            <div class="text-gray-900">
              {{ formatDate(credential.acceptedAt) }}
            </div>
          </div>
        </UCard>

        <UCard v-if="credential.expiresAt">
          <div class="text-sm">
            <div class="font-medium text-gray-700 mb-1">Expires</div>
            <div :class="isExpired ? 'text-red-600' : 'text-gray-900'">
              {{ formatDate(credential.expiresAt) }}
            </div>
          </div>
        </UCard>
      </div>

      <!-- Raw VC Document -->
      <UCard>
        <template #header>
          <h3 class="font-semibold">W3C VC Document (Raw)</h3>
        </template>
        <pre class="text-xs bg-gray-50 p-4 rounded overflow-x-auto">{{
          JSON.stringify(credential.vcDocument, null, 2)
        }}</pre>
      </UCard>
    </div>
  </div>
</template>

<script setup lang="ts">
const route = useRoute();
const credentialId = route.params.id as string;

// Fetch credential
const {
  data: credentialData,
  pending,
  error,
} = await useFetch(`/api/credential`, {
  query: {
    id: credentialId,
  },
});

const credential = computed(() => credentialData.value?.data?.credential);
const schema = computed(() => credentialData.value?.data?.schema);

const isExpired = computed(() => {
  if (!credential.value?.expiresAt) return false;
  return new Date(credential.value.expiresAt) < new Date();
});

const getStatusColor = () => {
  if (!credential.value) return 'gray';
  if (credential.value.revoked) return 'red';
  if (credential.value.accepted) return 'green';
  return 'yellow';
};

const getStatusText = () => {
  if (!credential.value) return 'Unknown';
  if (credential.value.revoked) return 'Revoked';
  if (credential.value.accepted) return 'Accepted';
  return 'Pending';
};

const formatDate = (date: Date | string) => {
  const d = new Date(date);
  return new Intl.DateTimeFormat('en', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
};

const formatValue = (value: any) => {
  if (typeof value === 'object') {
    return JSON.stringify(value, null, 2);
  }
  return String(value);
};

useHead({
  title: computed(() => `Credential ${credentialId.slice(0, 8)} - XCS`),
});
</script>
