<template>
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
    <!-- Header -->
    <div class="mb-8">
      <h1 class="text-3xl font-bold text-gray-900 mb-2">Schemas</h1>
      <p class="text-gray-600">
        Browse and search all credential schemas on the platform
      </p>
    </div>

    <!-- Schema List Component -->
    <SchemaList />
  </div>
</template>

<script setup lang="ts">
useHead({
  title: 'Schemas - XCS',
  meta: [
    {
      name: 'description',
      content: 'Browse all credential schemas on the XRPL Credential System',
    },
  ],
});
</script>
