<template>
  <div class="max-w-2xl mx-auto py-8 px-4">
    <h1 class="text-3xl font-bold mb-6">Verify Credential</h1>

    <div class="flex gap-3 mb-6">
      <input v-model="credentialId" placeholder="issuer:subject:credentialType"
             class="flex-1 px-4 py-2 border rounded-lg" />
      <button @click="run" :disabled="!credentialId || loading"
              class="px-6 py-2 bg-primary text-white rounded-lg">
        {{ loading ? 'Checking…' : 'Verify' }}
      </button>
    </div>

    <div v-if="result" class="border rounded-lg p-4">
      <p class="text-lg font-semibold" :class="result.valid ? 'text-green-600' : 'text-red-600'">
        {{ result.valid ? '✓ Valid' : '✗ Invalid' }}
      </p>
      <ul class="mt-3 text-sm space-y-1">
        <li>On-chain (not revoked): {{ result.checks.onChain }}</li>
        <li>Not expired: {{ result.checks.notExpired }}</li>
        <li>Proof valid: {{ result.checks.proofValid ?? 'n/a (private)' }}</li>
        <li>Schema match: {{ result.checks.schemaMatch ?? 'n/a (private)' }}</li>
      </ul>
      <ul v-if="result.reasons.length" class="mt-3 text-sm text-red-600 list-disc pl-5">
        <li v-for="r in result.reasons" :key="r">{{ r }}</li>
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
const credentialId = ref('');
const loading = ref(false);
const result = ref<any>(null);

async function run() {
  loading.value = true;
  try {
    const res = await $fetch<{ success: boolean; data: any }>(
      '/api/credential/verify',
      { params: { id: credentialId.value } }
    );
    result.value = res.data;
  } catch (e: any) {
    result.value = { valid: false, checks: {}, reasons: [e?.data?.message || e.message] };
  } finally {
    loading.value = false;
  }
}
</script>
