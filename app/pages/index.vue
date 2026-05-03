<template>
  <div>
    <!-- Hero Section -->
    <section class="bg-gradient-to-br from-primary-50 to-blue-50 py-20">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div class="text-center">
          <h1
            class="text-4xl sm:text-5xl md:text-6xl font-bold text-gray-900 mb-6"
          >
            Decentralized Credentials
            <span class="text-primary">on XRPL</span>
          </h1>
          <p class="text-xl text-gray-600 mb-8 max-w-3xl mx-auto">
            Create schemas and issue verifiable credentials following W3C
            standards. Store privately or publish to IPFS. Powered by the XRP
            Ledger.
          </p>
          <div class="flex flex-col sm:flex-row gap-4 justify-center">
            <UButton to="/schemas/create" color="primary" size="xl">
              Create Schema
            </UButton>
            <UButton to="/credentials/issue" color="neutral" size="xl">
              Issue Credential
            </UButton>
            <UButton to="/docs" color="neutral" variant="ghost" size="xl">
              Documentation
            </UButton>
          </div>
        </div>
      </div>
    </section>

    <!-- Features Section -->
    <section class="py-20 bg-white">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div class="text-center mb-16">
          <h2 class="text-3xl font-bold text-gray-900 mb-4">
            Why Use XCS?
          </h2>
          <p class="text-lg text-gray-600 max-w-2xl mx-auto">
            A complete platform for managing verifiable credentials on the
            blockchain
          </p>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-8">
          <!-- Feature 1 -->
          <div class="text-center p-6">
            <div
              class="w-16 h-16 bg-primary-100 rounded-lg flex items-center justify-center mx-auto mb-4"
            >
              <svg
                class="w-8 h-8 text-primary"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
            </div>
            <h3 class="text-xl font-semibold text-gray-900 mb-2">
              Flexible Schemas
            </h3>
            <p class="text-gray-600">
              Create custom credential schemas with validation rules. Support
              for versioning and evolution over time.
            </p>
          </div>

          <!-- Feature 2 -->
          <div class="text-center p-6">
            <div
              class="w-16 h-16 bg-green-100 rounded-lg flex items-center justify-center mx-auto mb-4"
            >
              <svg
                class="w-8 h-8 text-green-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                />
              </svg>
            </div>
            <h3 class="text-xl font-semibold text-gray-900 mb-2">
              W3C Compliant
            </h3>
            <p class="text-gray-600">
              Fully compliant with W3C Verifiable Credentials standard.
              Interoperable and future-proof.
            </p>
          </div>

          <!-- Feature 3 -->
          <div class="text-center p-6">
            <div
              class="w-16 h-16 bg-blue-100 rounded-lg flex items-center justify-center mx-auto mb-4"
            >
              <svg
                class="w-8 h-8 text-blue-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"
                />
              </svg>
            </div>
            <h3 class="text-xl font-semibold text-gray-900 mb-2">
              Decentralized Storage
            </h3>
            <p class="text-gray-600">
              Choose private storage or publish to IPFS. On-chain attestation
              via XRPL ensures authenticity.
            </p>
          </div>
        </div>
      </div>
    </section>

    <!-- Quick Stats -->
    <section class="py-16 bg-gray-50">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div class="grid grid-cols-1 md:grid-cols-3 gap-8 text-center">
          <div>
            <div class="text-4xl font-bold text-primary mb-2">
              {{ stats.schemas }}
            </div>
            <div class="text-gray-600">Active Schemas</div>
          </div>
          <div>
            <div class="text-4xl font-bold text-primary mb-2">
              {{ stats.credentials }}
            </div>
            <div class="text-gray-600">Credentials Issued</div>
          </div>
          <div>
            <div class="text-4xl font-bold text-primary mb-2">
              {{ stats.accepted }}
            </div>
            <div class="text-gray-600">Credentials Accepted</div>
          </div>
        </div>
      </div>
    </section>

    <!-- CTA Section -->
    <section class="py-20 bg-primary">
      <div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <h2 class="text-3xl font-bold text-white mb-4">
          Ready to Get Started?
        </h2>
        <p class="text-xl text-primary-100 mb-8">
          Create your first schema or issue a credential in minutes
        </p>
        <div class="flex flex-col sm:flex-row gap-4 justify-center">
          <UButton to="/schemas" color="neutral" size="xl"> Browse Schemas </UButton>
          <UButton to="/credentials" color="neutral" variant="outline" size="xl">
            View Credentials
          </UButton>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
// Fetch some quick stats
const { data: schemasData } = await useFetch('/api/schema/list', {
  method: 'POST',
  body: { limit: 1, offset: 0 },
});

const { data: credentialsData } = await useFetch('/api/credential/list', {
  method: 'POST',
  body: { limit: 1, offset: 0 },
});

const { data: acceptedData } = await useFetch('/api/credential/list', {
  method: 'POST',
  body: { accepted: true, limit: 1, offset: 0 },
});

const stats = computed(() => ({
  schemas: schemasData.value?.data?.total || 0,
  credentials: credentialsData.value?.data?.total || 0,
  accepted: acceptedData.value?.data?.total || 0,
}));

useHead({
  title: 'XCS - XRPL Credential System',
  meta: [
    {
      name: 'description',
      content:
        'Decentralized credential platform built on XRPL following W3C Verifiable Credentials standards',
    },
  ],
});
</script>
