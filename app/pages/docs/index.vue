<template>
  <div class="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
    <h1 class="text-4xl font-bold text-gray-900 mb-4">API Documentation</h1>
    <p class="text-xl text-gray-600 mb-8">
      Complete API reference for the XRPL Credential System
    </p>

    <div class="space-y-12">
      <!-- Introduction -->
      <section>
        <h2 class="text-2xl font-bold mb-4">Introduction</h2>
        <p class="text-gray-700 mb-4">
          The XCS API provides RESTful endpoints for managing schemas and
          credentials on the XRP Ledger. All endpoints accept and return JSON.
        </p>
        <UCard>
          <pre class="text-sm">Base URL: {{ config.public.baseUrl }}</pre>
        </UCard>
      </section>

      <!-- Schema Endpoints -->
      <section>
        <h2 class="text-2xl font-bold mb-4">Schema Endpoints</h2>

        <div class="space-y-6">
          <!-- Create Schema -->
          <UCard>
            <h3 class="text-lg font-semibold mb-3">Create Schema</h3>
            <div class="space-y-3">
              <div>
                <UBadge color="green">POST</UBadge>
                <code class="ml-2 text-sm">/api/schema/create</code>
              </div>
              <div>
                <h4 class="font-medium mb-2">Request Body:</h4>
                <pre class="text-xs bg-gray-50 p-4 rounded overflow-x-auto">{
  "name": "string",
  "description": "string (optional)",
  "version": "string (semver)",
  "fields": [
    {
      "name": "string",
      "type": "string|number|boolean|date|address|object|array",
      "required": boolean,
      "description": "string (optional)"
    }
  ],
  "isPublic": boolean
}</pre>
              </div>
            </div>
          </UCard>

          <!-- List Schemas -->
          <UCard>
            <h3 class="text-lg font-semibold mb-3">List Schemas</h3>
            <div class="space-y-3">
              <div>
                <UBadge color="blue">POST</UBadge>
                <code class="ml-2 text-sm">/api/schema/list</code>
              </div>
              <div>
                <h4 class="font-medium mb-2">Request Body:</h4>
                <pre class="text-xs bg-gray-50 p-4 rounded overflow-x-auto">{
  "search": "string (optional)",
  "isPublic": boolean (optional),
  "limit": number (default: 50),
  "offset": number (default: 0)
}</pre>
              </div>
            </div>
          </UCard>

          <!-- Get Schema -->
          <UCard>
            <h3 class="text-lg font-semibold mb-3">Get Schema</h3>
            <div class="space-y-3">
              <div>
                <UBadge color="gray">GET</UBadge>
                <code class="ml-2 text-sm">/api/schema?id={schemaId}</code>
              </div>
            </div>
          </UCard>
        </div>
      </section>

      <!-- Credential Endpoints -->
      <section>
        <h2 class="text-2xl font-bold mb-4">Credential Endpoints</h2>

        <div class="space-y-6">
          <!-- Issue Credential -->
          <UCard>
            <h3 class="text-lg font-semibold mb-3">Issue Credential</h3>
            <div class="space-y-3">
              <div>
                <UBadge color="green">POST</UBadge>
                <code class="ml-2 text-sm">/api/credential/issue</code>
              </div>
              <div>
                <h4 class="font-medium mb-2">Request Body:</h4>
                <pre class="text-xs bg-gray-50 p-4 rounded overflow-x-auto">{
  "schemaId": "string (UUID)",
  "subject": "string (XRPL address)",
  "data": {
    "field1": "value1",
    "field2": "value2"
  },
  "isPublic": boolean,
  "expiresAt": "string (ISO date, optional)"
}</pre>
              </div>
            </div>
          </UCard>

          <!-- List Credentials -->
          <UCard>
            <h3 class="text-lg font-semibold mb-3">List Credentials</h3>
            <div class="space-y-3">
              <div>
                <UBadge color="blue">POST</UBadge>
                <code class="ml-2 text-sm">/api/credential/list</code>
              </div>
              <div>
                <h4 class="font-medium mb-2">Request Body:</h4>
                <pre class="text-xs bg-gray-50 p-4 rounded overflow-x-auto">{
  "subject": "string (optional)",
  "accepted": boolean (optional),
  "revoked": boolean (optional),
  "isPublic": boolean (optional),
  "limit": number (default: 50),
  "offset": number (default: 0)
}</pre>
              </div>
            </div>
          </UCard>

          <!-- Accept Credential -->
          <UCard>
            <h3 class="text-lg font-semibold mb-3">Accept Credential</h3>
            <div class="space-y-3">
              <div>
                <UBadge color="green">POST</UBadge>
                <code class="ml-2 text-sm">/api/credential/accept</code>
              </div>
              <div>
                <h4 class="font-medium mb-2">Request Body:</h4>
                <pre class="text-xs bg-gray-50 p-4 rounded overflow-x-auto">{
  "credentialId": "string (UUID)",
  "subjectSeed": "string (XRPL seed)"
}</pre>
              </div>
            </div>
          </UCard>

          <!-- Revoke Credential -->
          <UCard>
            <h3 class="text-lg font-semibold mb-3">Revoke Credential</h3>
            <div class="space-y-3">
              <div>
                <UBadge color="red">POST</UBadge>
                <code class="ml-2 text-sm">/api/credential/revoke</code>
              </div>
              <div>
                <h4 class="font-medium mb-2">Request Body:</h4>
                <pre class="text-xs bg-gray-50 p-4 rounded overflow-x-auto">{
  "credentialId": "string (UUID)"
}</pre>
              </div>
            </div>
          </UCard>
        </div>
      </section>

      <!-- Health Endpoint -->
      <section>
        <h2 class="text-2xl font-bold mb-4">Health Check</h2>
        <UCard>
          <h3 class="text-lg font-semibold mb-3">Health Check</h3>
          <div class="space-y-3">
            <div>
              <UBadge color="gray">GET</UBadge>
              <code class="ml-2 text-sm">/api/health</code>
            </div>
            <p class="text-sm text-gray-600">
              Returns the health status of the API and connected services (database, XRPL, IPFS).
            </p>
          </div>
        </UCard>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
const config = useRuntimeConfig();

useHead({
  title: 'API Documentation - XCS',
  meta: [
    {
      name: 'description',
      content: 'Complete API reference for the XRPL Credential System',
    },
  ],
});
</script>
