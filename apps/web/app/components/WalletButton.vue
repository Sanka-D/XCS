<script setup lang="ts">
import type { WalletChoice } from '~/composables/useWallet'

const { account, busy, error, walletChoices, connect, disconnect } = useWallet()
const open = ref(false)
const wallets = ref<WalletChoice[]>([])

async function toggle() {
  if (account.value) {
    await disconnect()
    return
  }
  wallets.value = await walletChoices()
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
      <div v-for="wallet in wallets" :key="wallet.id" class="wallet-choice">
        <span>
          <strong>{{ wallet.name }}</strong>
          <small>{{ $t(wallet.available ? 'wallet.available' : 'wallet.unavailable') }}</small>
        </span>
        <button
          v-if="wallet.available"
          class="text-button wallet-action"
          :data-wallet-id="wallet.id"
          type="button"
          @click="chooseWallet(wallet.id)"
        >
          {{ $t('wallet.select') }}
        </button>
        <a
          v-else-if="wallet.url"
          class="text-button wallet-action"
          :data-wallet-id="wallet.id"
          :href="wallet.url"
          rel="noopener noreferrer"
          target="_blank"
        >
          {{ $t('wallet.setup') }}
        </a>
      </div>
      <p v-if="wallets.length === 0" class="muted">{{ $t('wallet.none') }}</p>
      <button class="text-button" type="button" @click="open = false">
        {{ $t('common.close') }}
      </button>
    </div>
    <p v-if="error" class="inline-error">{{ error }}</p>
  </div>
</template>
