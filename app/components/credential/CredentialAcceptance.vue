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
          <code class="ml-2 text-xs truncate">{{ credential.credential_type }}</code>
        </p>
        <p v-if="credential.created_ledger">
          <span class="font-medium">Ledger:</span>
          <span class="ml-2">{{ credential.created_ledger }}</span>
        </p>
        <p v-if="expirationDate">
          <span class="font-medium">Expires:</span>
          <span class="ml-2">{{ expirationDate }}</span>
        </p>
        <p v-if="credential.uri">
          <span class="font-medium">URI:</span>
          <a :href="credential.uri" target="_blank" class="ml-2 text-blue-600 hover:underline truncate">
            {{ credential.uri }}
          </a>
        </p>
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
import type { Credential } from '~/lib/types/schema';

const RIPPLE_EPOCH = 946684800;

const props = defineProps<{
  credential: Credential;
}>();

const emit = defineEmits<{
  accept: [subjectSeed: string];
}>();

const subjectSeed = ref('');
const showSeedInput = ref(false);
const isAccepting = ref(false);

const expirationDate = computed(() => {
  if (!props.credential.expiration) return '';
  const d = new Date((props.credential.expiration + RIPPLE_EPOCH) * 1000);
  return new Intl.DateTimeFormat('en', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(d);
});

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
