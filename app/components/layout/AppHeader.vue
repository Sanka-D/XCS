<template>
  <header class="bg-white border-b border-gray-200 sticky top-0 z-50">
    <nav class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="flex justify-between items-center h-16">
        <!-- Logo -->
        <NuxtLink to="/" class="flex items-center space-x-3">
          <div class="text-2xl font-bold text-primary">XCS</div>
          <span class="text-sm text-gray-500 hidden sm:block"
            >XRPL Credential System</span
          >
        </NuxtLink>

        <!-- Desktop Navigation -->
        <div class="hidden md:flex items-center space-x-8">
          <NuxtLink
            to="/schemas"
            class="text-gray-700 hover:text-primary transition-colors"
          >
            Schemas
          </NuxtLink>
          <NuxtLink
            to="/credentials"
            class="text-gray-700 hover:text-primary transition-colors"
          >
            Credentials
          </NuxtLink>
          <NuxtLink
            to="/docs"
            class="text-gray-700 hover:text-primary transition-colors"
          >
            Docs
          </NuxtLink>

          <!-- Action Buttons -->
          <div class="flex items-center space-x-3 ml-6">
            <!-- Wallet Connector Web Component -->
            <xrpl-wallet-connector
              ref="walletConnectorRef"
              background-color="#1a202c"
              text-color="#F5F4E7"
              primary-color="#0ea5e9"
              primary-wallet="xaman"
              font-family="'Inter', sans-serif"
              @wallet-connected="onWalletConnected"
            />

            <UButton to="/schemas/create" color="primary" variant="outline">
              Create Schema
            </UButton>
            <UButton to="/credentials/issue" color="primary">
              Issue Credential
            </UButton>
          </div>
        </div>

        <!-- Mobile menu button -->
        <button
          @click="mobileMenuOpen = !mobileMenuOpen"
          class="md:hidden p-2 rounded-md text-gray-700 hover:bg-gray-100"
        >
          <svg
            v-if="!mobileMenuOpen"
            class="h-6 w-6"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M4 6h16M4 12h16M4 18h16"
            />
          </svg>
          <svg
            v-else
            class="h-6 w-6"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>

      <!-- Mobile Navigation -->
      <div
        v-if="mobileMenuOpen"
        class="md:hidden py-4 border-t border-gray-200"
      >
        <div class="flex flex-col space-y-4">
          <NuxtLink
            to="/schemas"
            class="text-gray-700 hover:text-primary transition-colors"
            @click="mobileMenuOpen = false"
          >
            Schemas
          </NuxtLink>
          <NuxtLink
            to="/credentials"
            class="text-gray-700 hover:text-primary transition-colors"
            @click="mobileMenuOpen = false"
          >
            Credentials
          </NuxtLink>
          <NuxtLink
            to="/docs"
            class="text-gray-700 hover:text-primary transition-colors"
            @click="mobileMenuOpen = false"
          >
            Docs
          </NuxtLink>
          <div class="pt-4 space-y-2">
            <UButton
              to="/schemas/create"
              color="primary"
              variant="outline"
              block
            >
              Create Schema
            </UButton>
            <UButton to="/credentials/issue" color="primary" block>
              Issue Credential
            </UButton>
          </div>
        </div>
      </div>
    </nav>
  </header>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { useWallet } from '~/composables/useWallet';

const mobileMenuOpen = ref(false);
const walletConnectorRef = ref();

// Use wallet composable
const { account, connected, loading, disconnect } = useWallet();
const { $walletManager } = useNuxtApp();

// Methods
const onWalletConnected = () => {
  // Additional logic if needed when wallet is connected
  mobileMenuOpen.value = false;
};

// Close mobile menu on route change
const route = useRoute();
watch(
  () => route.path,
  () => {
    mobileMenuOpen.value = false;
  }
);

// Ensure wallet manager is set on component mount
onMounted(() => {
  if (walletConnectorRef.value) {
    walletConnectorRef.value.setWalletManager($walletManager);
  }
});
</script>
