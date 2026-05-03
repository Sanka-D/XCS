<template>
  <div class="max-w-4xl mx-auto py-8 px-4">
    <div class="mb-8">
      <h1 class="text-3xl font-bold mb-2">Accept Credentials</h1>
      <p class="text-gray-600 mb-4">
        Review and accept credentials that have been issued to you.
      </p>

      <!-- Subject Address Filter -->
      <div class="flex gap-3">
        <input
          v-model="subjectAddress"
          type="text"
          placeholder="Enter your XRPL address to filter..."
          class="flex-1 px-4 py-2 border rounded-lg"
        />
        <button
          @click="() => refresh()"
          class="px-6 py-2 bg-primary text-white rounded-lg hover:opacity-90"
        >
          Search
        </button>
      </div>
    </div>

    <!-- Pending Credentials List -->
    <div
      v-if="pendingCredentials.length === 0"
      class="text-center py-12 bg-gray-50 rounded-lg"
    >
      <p class="text-gray-600">No pending credentials found</p>
      <p class="text-sm text-gray-500 mt-2">
        Enter your XRPL address above to search for credentials issued to you.
      </p>
    </div>

    <div v-else class="space-y-6">
      <CredentialAcceptance
        v-for="credential in pendingCredentials"
        :key="credential.id"
        :credential="credential"
        @accept="(seed) => handleAccept(credential, seed)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Credential } from '~/lib/types/schema';

const route = useRoute();
const toast = useToast();

const subjectAddress = ref((route.query.subject as string) || '');

const { data: credentialsData, refresh } = await useFetch(
  '/api/credential/list',
  {
    method: 'POST',
    body: computed(() => ({
      subject: subjectAddress.value || undefined,
      status: 'created', // only show pending (not yet accepted)
    })),
  }
);

const pendingCredentials = computed(
  () => (credentialsData.value?.data?.credentials as unknown as Credential[]) || []
);

const handleAccept = async (credential: Credential, subjectSeed: string) => {
  try {
    const response = await $fetch('/api/credential/accept', {
      method: 'POST',
      body: {
        issuer: credential.issuer,
        credentialType: credential.credential_type,
        subjectSeed,
      },
    });

    if (response.success) {
      toast.add({
        title: 'Success',
        description: 'Credential accepted on XRPL',
        color: 'success',
      });

      await refresh();
    }
  } catch (error: any) {
    toast.add({
      title: 'Error',
      description: error.data?.message || 'Failed to accept credential',
      color: 'error',
    });
  }
};
</script>
