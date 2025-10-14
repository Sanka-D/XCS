<template>
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
    <!-- Header -->
    <div class="mb-8">
      <h1 class="text-3xl font-bold text-gray-900 mb-2">Credentials</h1>
      <p class="text-gray-600">
        Browse and manage all issued credentials
      </p>
    </div>

    <!-- Credential List Component -->
    <CredentialList />
  </div>
</template>

<script setup lang="ts">
useHead({
  title: 'Credentials - XCS',
  meta: [
    {
      name: 'description',
      content: 'Browse all credentials on the XRPL Credential System',
    },
  ],
});
</script>
