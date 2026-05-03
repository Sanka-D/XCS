<template>
  <div class="max-w-4xl mx-auto py-8 px-4">
    <div class="mb-8">
      <h1 class="text-3xl font-bold mb-2">Create New Schema</h1>
      <p class="text-gray-600">
        Define a schema that describes the structure of credentials you want to issue.
      </p>
    </div>

    <!-- Success result -->
    <div v-if="result" class="bg-white rounded-lg shadow-lg p-6 space-y-4">
      <div class="flex items-center gap-3 text-green-700">
        <span class="text-2xl">✓</span>
        <h2 class="text-xl font-semibold">Schema submitted to XRPL</h2>
      </div>

      <p class="text-gray-600 text-sm">
        The schema will appear in the list once the substreams indexer processes ledger
        <strong>{{ result.ledgerIndex }}</strong>.
      </p>

      <div class="space-y-3">
        <div>
          <p class="text-xs text-gray-500 mb-1 uppercase tracking-wide">Transaction hash</p>
          <div class="flex items-center gap-2">
            <code class="flex-1 bg-gray-100 px-3 py-2 rounded text-sm break-all">{{ result.txHash }}</code>
            <UButton size="sm" color="neutral" variant="outline" @click="copy(result.txHash)">
              {{ copied ? 'Copied!' : 'Copy' }}
            </UButton>
          </div>
        </div>

        <div>
          <p class="text-xs text-gray-500 mb-1 uppercase tracking-wide">Schema UID (computed)</p>
          <code class="block bg-gray-100 px-3 py-2 rounded text-sm break-all">{{ result.uid }}</code>
        </div>
      </div>

      <div class="flex gap-3 pt-2">
        <UButton color="primary" @click="$router.push('/schemas')">View all schemas</UButton>
        <UButton color="neutral" variant="outline" @click="result = null">Create another</UButton>
      </div>
    </div>

    <div v-else class="bg-white rounded-lg shadow-lg p-6">
      <SchemaForm @submit="handleSubmit" />
    </div>

    <!-- Loading Overlay -->
    <div
      v-if="isCreating"
      class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
    >
      <div class="bg-white rounded-lg p-8 text-center">
        <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
        <p class="text-lg font-semibold">Registering schema on XRPL…</p>
        <p class="text-sm text-gray-600 mt-2">Submitting Payment transaction with schema memo…</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const toast = useToast();

const isCreating = ref(false);
const result = ref<{ txHash: string; uid: string; ledgerIndex: number } | null>(null);
const copied = ref(false);

const copy = (text: string) => {
  navigator.clipboard.writeText(text);
  copied.value = true;
  setTimeout(() => (copied.value = false), 2000);
};

const handleSubmit = async (schemaData: any) => {
  isCreating.value = true;

  try {
    const response = await $fetch('/api/schema/create', {
      method: 'POST',
      body: schemaData,
    });

    if (response.success) {
      result.value = response.data;
    }
  } catch (error: any) {
    toast.add({
      title: 'Error',
      description: error.data?.message || error.message || 'Failed to register schema',
      color: 'error',
    });
  } finally {
    isCreating.value = false;
  }
};
</script>
