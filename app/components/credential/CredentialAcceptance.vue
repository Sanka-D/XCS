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
    <div>
      <button
        @click="$emit('accept')"
        class="w-full px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 font-semibold"
      >
        Accept Credential
      </button>
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
  accept: [];
}>();

const expirationDate = computed(() => {
  if (!props.credential.expiration) return '';
  const d = new Date((props.credential.expiration + RIPPLE_EPOCH) * 1000);
  return new Intl.DateTimeFormat('en', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(d);
});
</script>
