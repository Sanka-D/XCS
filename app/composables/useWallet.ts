import { ref, computed, onMounted, onUnmounted } from 'vue'
import type { AccountInfo } from 'xrpl-connect'

export function useWallet() {
  const { $walletManager } = useNuxtApp()

  const account = ref<AccountInfo | null>(null)
  const connected = ref(false)
  const error = ref<string | null>(null)
  const loading = ref(false)

  // Event handlers
  const handleConnect = (acc: AccountInfo) => {
    console.log('[useWallet] Wallet connected:', acc?.address)
    account.value = acc
    connected.value = true
    error.value = null
  }

  const handleDisconnect = () => {
    console.log('[useWallet] Wallet disconnected')
    account.value = null
    connected.value = false
  }

  const handleError = (err: any) => {
    error.value = err?.message || 'An error occurred'
    console.error('[useWallet] Wallet error:', err)
  }

  // Initialize listeners
  onMounted(() => {
    if (!$walletManager) {
      console.warn('[useWallet] Wallet manager not available')
      error.value = 'Wallet manager not initialized'
      return
    }

    console.log('[useWallet] Setting up listeners, manager connected:', $walletManager.connected)

    // Check if already connected
    if ($walletManager.connected && $walletManager.account) {
      account.value = $walletManager.account
      connected.value = true
      console.log('[useWallet] Already connected to wallet:', $walletManager.account?.address)
    }

    // Add listeners
    $walletManager.on('connect', handleConnect)
    $walletManager.on('disconnect', handleDisconnect)
    $walletManager.on('error', handleError)

    console.log('[useWallet] Listeners registered')
  })

  // Cleanup
  onUnmounted(() => {
    if (!$walletManager) return
    $walletManager.off('connect', handleConnect)
    $walletManager.off('disconnect', handleDisconnect)
    $walletManager.off('error', handleError)
    console.log('[useWallet] Listeners removed')
  })

  // Methods
  const connect = async (adapterId?: string) => {
    if (!$walletManager) {
      error.value = 'Wallet manager not available'
      console.error('[useWallet] Cannot connect: wallet manager not available')
      return
    }

    loading.value = true
    error.value = null

    try {
      console.log('[useWallet] Connecting wallet...', adapterId ? `adapter: ${adapterId}` : 'auto-detect')
      const acc = adapterId
        ? await $walletManager.connect(adapterId)
        : await $walletManager.connect()
      account.value = acc
      connected.value = true
      error.value = null
      console.log('[useWallet] Connected successfully:', acc?.address)
    } catch (err: any) {
      error.value = err?.message || 'Failed to connect wallet'
      console.error('[useWallet] Connection failed:', err)
      handleError(err)
    } finally {
      loading.value = false
    }
  }

  const disconnect = async () => {
    if (!$walletManager) {
      console.warn('[useWallet] Cannot disconnect: wallet manager not available')
      return
    }

    try {
      console.log('[useWallet] Disconnecting wallet...')
      await $walletManager.disconnect()
      account.value = null
      connected.value = false
      error.value = null
      console.log('[useWallet] Disconnected successfully')
    } catch (err: any) {
      error.value = err?.message || 'Failed to disconnect wallet'
      console.error('[useWallet] Disconnection failed:', err)
      handleError(err)
    }
  }

  const sign = async (transaction: any) => {
    if (!$walletManager || !connected.value) {
      error.value = 'Wallet not connected'
      console.error('[useWallet] Cannot sign: wallet not connected')
      throw new Error('Wallet not connected')
    }

    try {
      console.log('[useWallet] Signing transaction...')
      const signed = await $walletManager.sign(transaction)
      console.log('[useWallet] Transaction signed successfully')
      return signed
    } catch (err: any) {
      error.value = err?.message || 'Failed to sign transaction'
      console.error('[useWallet] Signing failed:', err)
      throw err
    }
  }

  const signMessage = async (message: string) => {
    if (!$walletManager || !connected.value) {
      error.value = 'Wallet not connected'
      console.error('[useWallet] Cannot sign message: wallet not connected')
      throw new Error('Wallet not connected')
    }

    try {
      console.log('[useWallet] Signing message...')
      const signed = await $walletManager.signMessage(message)
      console.log('[useWallet] Message signed successfully')
      return signed
    } catch (err: any) {
      error.value = err?.message || 'Failed to sign message'
      console.error('[useWallet] Message signing failed:', err)
      throw err
    }
  }

  const address = computed(() => account.value?.address || null)
  const network = computed(() => account.value?.network || null)

  return {
    account,
    connected,
    error,
    loading,
    address,
    network,
    connect,
    disconnect,
    sign,
    signMessage,
  }
}
