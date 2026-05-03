<template>
  <div class="max-w-4xl mx-auto py-8 px-4">
    <div class="mb-8 flex items-center justify-between">
      <div>
        <h1 class="text-3xl font-bold mb-2">Accept Credentials</h1>
        <p class="text-gray-600">
          Connect your wallet to see and accept credentials issued to your address.
        </p>
      </div>
      <div>
        <button v-if="!connected" @click="connect()"
                class="px-4 py-2 bg-primary text-white rounded-lg">
          Connect Wallet
        </button>
        <div v-else class="text-sm">
          <p class="font-mono">{{ address }}</p>
          <button class="text-xs underline" @click="disconnect()">Disconnect</button>
        </div>
      </div>
    </div>

    <div v-if="!connected" class="text-center py-12 bg-gray-50 rounded-lg">
      <p>Please connect your wallet to view pending credentials.</p>
    </div>

    <div v-else-if="pendingCredentials.length === 0"
         class="text-center py-12 bg-gray-50 rounded-lg">
      <p>No pending credentials for {{ address }}.</p>
    </div>

    <div v-else class="space-y-6">
      <CredentialAcceptance
        v-for="credential in pendingCredentials"
        :key="credential.id"
        :credential="credential"
        @accept="() => handleAccept(credential)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Credential } from '~/lib/types/schema';

const toast = useToast();
const { connected, address, connect, disconnect, sign } = useWallet();

const { data: credentialsData, refresh } = await useFetch('/api/credential/list', {
  method: 'POST',
  body: computed(() => ({
    subject: address.value || undefined,
    status: 'created',
  })),
  watch: [address],
});

const pendingCredentials = computed(
  () => (credentialsData.value?.data?.credentials as unknown as Credential[]) || []
);

async function handleAccept(credential: Credential) {
  try {
    const tx = {
      TransactionType: 'CredentialAccept' as const,
      Account: address.value!,
      Issuer: credential.issuer,
      CredentialType: credential.credential_type,
    };
    const signed = await sign(tx);
    const blob = (signed as any).tx_blob ?? (signed as any).signedTransaction ?? signed;

    const res = await $fetch<{ success: boolean; data: { txHash: string } }>(
      '/api/credential/accept-signed',
      { method: 'POST', body: { signedTxBlob: blob } }
    );

    toast.add({
      title: 'Submitted',
      description: `Tx ${res.data.txHash.slice(0, 12)}… submitted to XRPL.`,
      color: 'success',
    });

    await refresh();
  } catch (e: any) {
    toast.add({
      title: 'Error',
      description: e?.data?.message || e.message || 'Failed to accept credential',
      color: 'error',
    });
  }
}
</script>
