<template>
  <div class="max-w-4xl mx-auto py-8 px-4">
    <div class="mb-8">
      <NuxtLink
        to="/schemas"
        class="text-blue-500 hover:underline mb-4 inline-block"
      >
        ← Back to Schemas
      </NuxtLink>
      <h1 class="text-3xl font-bold mb-2">Issue Credential</h1>
      <p class="text-gray-600">
        Fill in the credential data and choose storage option.
      </p>
    </div>

    <div
      v-if="schemaError"
      class="bg-red-50 border border-red-200 rounded-lg p-4 mb-6"
    >
      <p class="text-red-800">Failed to load schema</p>
    </div>

    <div v-else-if="!schema" class="text-center py-12">
      <div
        class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"
      ></div>
      <p>Loading schema...</p>
    </div>

    <div v-else class="bg-white rounded-lg shadow-lg p-6">
      <CredentialForm :schema="schema" @submit="handleSubmit" />
    </div>

    <!-- Loading Overlay -->
    <div
      v-if="isIssuing"
      class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
    >
      <div class="bg-white rounded-lg p-8 text-center max-w-md">
        <div
          class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"
        ></div>
        <p class="text-lg font-semibold mb-2">Issuing credential...</p>
        <div class="text-sm text-gray-600 space-y-1">
          <p>1. Validating data against schema ✓</p>
          <p>2. Generating W3C VC document ✓</p>
          <p>3. Publishing to IPFS (if public)...</p>
          <p>4. Creating on-chain attestation...</p>
          <p>5. Storing in database...</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const route = useRoute();
const router = useRouter();
const toast = useToast();

const schemaId = computed(() => route.query.schemaId as string);

const { data: schemaData, error: schemaError } = await useFetch(`/api/schema`, {
  query: {
    id: schemaId,
    includeVersions: 'true',
  },
});
const schema = computed(() => schemaData.value?.data.schema);

const isIssuing = ref(false);

const handleSubmit = async (credentialData: any) => {
  isIssuing.value = true;

  try {
    const response = await $fetch('/api/credential/issue', {
      method: 'POST',
      body: {
        schemaId: schemaId.value,
        ...credentialData,
      },
    });

    if (response.success) {
      toast.add({
        title: 'Success',
        description: 'Credential issued successfully',
        color: 'green',
      });

      // Navigate to credential detail page
      router.push(`/credentials/${response.data.credential.id}`);
    }
  } catch (error) {
    toast.add({
      title: 'Error',
      description: error.data?.message || 'Failed to issue credential',
      color: 'red',
    });
  } finally {
    isIssuing.value = false;
  }
};
</script>
