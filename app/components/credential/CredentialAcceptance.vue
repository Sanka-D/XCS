<template>
  <div class="p-6 border rounded-lg bg-white shadow-sm">
    <!-- Credential Info -->
    <div class="mb-6">
      <h3 class="text-xl font-bold mb-2">Pending Credential</h3>
      <div class="space-y-2 text-sm">
        <p>
          <span class="font-medium">Issuer:</span>
          <code class="ml-2 text-xs">{{ credential.issuer }}</code>
        </p>
        <p>
          <span class="font-medium">Type:</span>
          <span class="ml-2">{{ credential.credentialType }}</span>
        </p>
        <p>
          <span class="font-medium">Issued:</span>
          <span class="ml-2">{{
            new Date(credential.createdAt).toLocaleDateString()
          }}</span>
        </p>
        <p v-if="credential.expiresAt">
          <span class="font-medium">Expires:</span>
          <span class="ml-2">{{
            new Date(credential.expiresAt).toLocaleDateString()
          }}</span>
        </p>
      </div>
    </div>

    <!-- W3C VC Data Preview -->
    <div class="mb-6">
      <h4 class="font-semibold mb-2">Credential Data</h4>
      <div class="p-4 bg-gray-50 rounded-lg overflow-auto max-h-64">
        <pre class="text-xs">{{
          JSON.stringify(credential.vcDocument, null, 2)
        }}</pre>
      </div>
    </div>

    <!-- Accept Button -->
    <div v-if="!showSeedInput">
      <button
        @click="showSeedInput = true"
        class="w-full px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 font-semibold"
      >
        Accept Credential
      </button>
    </div>

    <!-- Seed Input Form -->
    <div v-else class="space-y-4">
      <div>
        <label for="seed" class="block text-sm font-medium mb-2">
          Subject Seed (Private Key) *
        </label>
        <input
          id="seed"
          v-model="subjectSeed"
          type="password"
          required
          class="w-full px-4 py-2 border rounded-lg font-mono"
          placeholder="sXXXXXXXXXX..."
          :disabled="isAccepting"
        />
        <p class="text-xs text-gray-600 mt-1">
          Your seed is required to sign the acceptance transaction on XRPL. It
          is never stored or transmitted anywhere except directly to XRPL.
        </p>
      </div>

      <div class="flex gap-3">
        <button
          @click="handleAccept"
          :disabled="isAccepting"
          class="flex-1 px-6 py-3 bg-green-500 text-white rounded-lg hover:bg-green-600 font-semibold disabled:opacity-50"
        >
          {{ isAccepting ? 'Accepting...' : 'Confirm Accept' }}
        </button>
        <button
          @click="showSeedInput = false"
          :disabled="isAccepting"
          class="px-6 py-3 border rounded-lg hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Credential } from '~/lib/types/credential';

const props = defineProps<{
  credential: Credential;
}>();

const emit = defineEmits<{
  accept: [subjectSeed: string];
}>();

const subjectSeed = ref('');
const showSeedInput = ref(false);
const isAccepting = ref(false);

const handleAccept = async () => {
  if (!subjectSeed.value) {
    alert('Please enter your subject seed');
    return;
  }

  isAccepting.value = true;
  try {
    emit('accept', subjectSeed.value);
  } finally {
    isAccepting.value = false;
    subjectSeed.value = '';
    showSeedInput.value = false;
  }
};
</script>
