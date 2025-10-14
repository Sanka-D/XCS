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
          @click="refresh"
          class="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
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
const route = useRoute();
const toast = useToast();

const subjectAddress = ref((route.query.subject as string) || '');

const { data: credentialsData, refresh } = await useFetch(
  '/api/credential/list',
  {
    method: 'POST',
    body: computed(() => ({
      subject: subjectAddress.value,
      accepted: false,
      revoked: false,
    })),
  }
);

const pendingCredentials = computed(
  () => credentialsData.value?.data.credentials || []
);

const handleAccept = async (credential: any, subjectSeed: string) => {
  try {
    const response = await $fetch('/api/credential/accept', {
      method: 'POST',
      body: {
        credentialId: credential.id,
        subjectSeed,
      },
    });

    if (response.success) {
      toast.add({
        title: 'Success',
        description: 'Credential accepted successfully',
        color: 'green',
      });

      // Refresh the list
      await refresh();
    }
  } catch (error) {
    toast.add({
      title: 'Error',
      description: error.data?.message || 'Failed to accept credential',
      color: 'red',
    });
  }
};
</script>
