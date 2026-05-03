<template>
  <div class="max-w-4xl mx-auto py-8 px-4">
    <div class="mb-8">
      <NuxtLink
        to="/schemas"
        class="text-primary hover:underline mb-4 inline-block"
      >
        ← Back to Schemas
      </NuxtLink>
      <h1 class="text-3xl font-bold mb-2">Issue Credential</h1>
      <p class="text-gray-600">
        Fill in the credential details and submit on XRPL.
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
        class="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"
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
          class="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"
        ></div>
        <p class="text-lg font-semibold mb-2">Issuing credential...</p>
        <p class="text-sm text-gray-600">
          Submitting CredentialCreate transaction on XRPL…
        </p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Schema } from '~/lib/types/schema';

const route = useRoute();
const router = useRouter();
const toast = useToast();

// schemaId in the query is the schema UID
const schemaUid = computed(() => route.query.schemaId as string);

const { data: schemaData, error: schemaError } = await useFetch(`/api/schema`, {
  query: { uid: schemaUid },
});
const schema = computed(() => schemaData.value?.data?.schema as Schema | undefined);

const isIssuing = ref(false);

const handleSubmit = async (credentialData: {
  subject: string;
  data: Record<string, any>;
  isPublic: boolean;
  expiresAt?: string;
}) => {
  isIssuing.value = true;

  try {
    const response = await $fetch('/api/credential/issue', {
      method: 'POST',
      body: {
        credentialType: schemaUid.value,
        subject: credentialData.subject,
        data: credentialData.data,
        isPublic: credentialData.isPublic,
        expiresAt: credentialData.expiresAt,
      },
    });

    if (response.success) {
      toast.add({
        title: 'Success',
        description: response.data.ipfsCid
          ? `Credential submitted — TX: ${response.data.txHash.slice(0, 12)}… (pinned: ${response.data.ipfsCid.slice(0, 16)}…)`
          : `Credential submitted — TX: ${response.data.txHash.slice(0, 12)}…`,
        color: 'success',
      });

      router.push('/credentials');
    }
  } catch (error: any) {
    toast.add({
      title: 'Error',
      description: error.data?.message || 'Failed to issue credential',
      color: 'error',
    });
  } finally {
    isIssuing.value = false;
  }
};
</script>
