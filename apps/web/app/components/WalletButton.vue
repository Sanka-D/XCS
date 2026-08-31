<script setup lang="ts">
const { account, busy, error, availableWallets, connect, disconnect } = useWallet()
const open = ref(false)
const wallets = ref<Array<{ id: string; name: string }>>([])

async function toggle() {
  if (account.value) {
    await disconnect()
    return
  }
  wallets.value = (await availableWallets()).map((wallet) => ({ id: wallet.id, name: wallet.name }))
  open.value = true
}

async function chooseWallet(walletId: string) {
  try {
    await connect(walletId)
    open.value = false
  } catch {
    // useWallet exposes the adapter error next to the control.
  }
}

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-5)}`
}
</script>

<template>
  <div class="wallet-control">
    <button
      class="button secondary compact"
      data-testid="wallet-toggle"
      :disabled="busy"
      type="button"
      @click="toggle"
    >
      {{ account ? shortAddress(account.address) : $t('wallet.connect') }}
    </button>

    <div v-if="open && !account" class="wallet-popover">
      <strong>{{ $t('wallet.choose') }}</strong>
      <button
        v-for="wallet in wallets"
        :key="wallet.id"
        class="wallet-choice"
        :data-wallet-id="wallet.id"
        type="button"
        @click="chooseWallet(wallet.id)"
      >
        {{ wallet.name }}
      </button>
      <p v-if="wallets.length === 0" class="muted">{{ $t('wallet.none') }}</p>
      <button class="text-button" type="button" @click="open = false">
        {{ $t('common.close') }}
      </button>
    </div>
    <p v-if="error" class="inline-error">{{ error }}</p>
  </div>
</template>
