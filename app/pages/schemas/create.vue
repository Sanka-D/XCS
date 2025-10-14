<template>
  <div class="max-w-4xl mx-auto py-8 px-4">
    <div class="mb-8">
      <h1 class="text-3xl font-bold mb-2">Create New Schema</h1>
      <p class="text-gray-600">
        Define a schema that describes the structure of credentials you want to
        issue.
      </p>
    </div>

    <div class="bg-white rounded-lg shadow-lg p-6">
      <SchemaForm @submit="handleSubmit" />
    </div>

    <!-- Loading Overlay -->
    <div
      v-if="isCreating"
      class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
    >
      <div class="bg-white rounded-lg p-8 text-center">
        <div
          class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"
        ></div>
        <p class="text-lg font-semibold">Creating schema...</p>
        <p class="text-sm text-gray-600 mt-2">
          Publishing to {{ isCreating ? 'IPFS' : 'database' }}...
        </p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const router = useRouter();
const toast = useToast();

const isCreating = ref(false);

const handleSubmit = async (schemaData: any) => {
  isCreating.value = true;

  try {
    const response = await $fetch('/api/schema/create', {
      method: 'POST',
      body: schemaData,
    });

    if (response.success) {
      toast.add({
        title: 'Success',
        description: 'Schema created successfully',
        color: 'green',
      });

      // Navigate to schema detail page
      router.push(`/schemas/${response.data.schema.id}`);
    }
  } catch (error) {
    toast.add({
      title: 'Error',
      description: error.message || 'Failed to create schema',
      color: 'red',
    });
  } finally {
    isCreating.value = false;
  }
};
</script>
