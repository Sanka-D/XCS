<template>
  <div class="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
    <h1 class="text-4xl font-bold text-gray-900 mb-4">API Documentation</h1>
    <p class="text-xl text-gray-600 mb-8">
      Complete API reference for the XRPL Credential System
    </p>

    <div class="space-y-12">
      <!-- Architecture Note -->
      <section>
        <h2 class="text-2xl font-bold mb-4">Architecture</h2>
        <p class="text-gray-700 mb-4">
          XCS uses a substreams-based indexer. Write operations submit XRPL transactions;
          the substreams pipeline indexes them into PostgreSQL. Read operations query that DB directly.
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
            <p class="text-sm text-gray-600 mb-3">
              Submits a Payment tx to XRPL with an <code>xcs:schema_register</code> memo.
              The schema is indexed by the substreams pipeline after the tx is confirmed.
            </p>
            <div class="space-y-3">
              <div>
                <UBadge color="success">POST</UBadge>
                <code class="ml-2 text-sm">/api/schema/create</code>
              </div>
              <div>
                <h4 class="font-medium mb-2">Request Body:</h4>
                <pre class="text-xs bg-gray-50 p-4 rounded overflow-x-auto">{
  "name": "string",
  "description": "string (optional)",
  "version": "string (semver, e.g. 1.0.0)",
  "fields": [
    {
      "name": "string",
      "type": "string | number | boolean | date | address | object | array",
      "required": boolean,
      "description": "string (optional)"
    }
  ]
}</pre>
              </div>
              <div>
                <h4 class="font-medium mb-2">Response:</h4>
                <pre class="text-xs bg-gray-50 p-4 rounded overflow-x-auto">{
  "success": true,
  "data": {
    "uid": "string (SHA-256 hex — deterministic schema identifier)",
    "txHash": "string (XRPL transaction hash)",
    "ledgerIndex": number,
    "status": "pending"
  }
}</pre>
              </div>
            </div>
          </UCard>

          <!-- List Schemas -->
          <UCard>
            <h3 class="text-lg font-semibold mb-3">List Schemas</h3>
            <div class="space-y-3">
              <div>
                <UBadge color="info">POST</UBadge>
                <code class="ml-2 text-sm">/api/schema/list</code>
              </div>
              <div>
                <h4 class="font-medium mb-2">Request Body:</h4>
                <pre class="text-xs bg-gray-50 p-4 rounded overflow-x-auto">{
  "issuer": "string (XRPL address, optional)",
  "search": "string (full-text search on schema JSON, optional)",
  "limit": number (default: 50),
  "offset": number (default: 0)
}</pre>
              </div>
              <div>
                <h4 class="font-medium mb-2">Response:</h4>
                <pre class="text-xs bg-gray-50 p-4 rounded overflow-x-auto">{
  "success": true,
  "data": {
    "schemas": [Schema],
    "total": number
  }
}</pre>
              </div>
            </div>
          </UCard>

          <!-- Get Schema -->
          <UCard>
            <h3 class="text-lg font-semibold mb-3">Get Schema</h3>
            <div class="space-y-3">
              <div>
                <UBadge color="neutral">GET</UBadge>
                <code class="ml-2 text-sm">/api/schema?uid={schemaUid}</code>
              </div>
              <div>
                <h4 class="font-medium mb-2">Response:</h4>
                <pre class="text-xs bg-gray-50 p-4 rounded overflow-x-auto">{
  "success": true,
  "data": {
    "schema": {
      "uid": "string",
      "issuer": "string (XRPL address)",
      "schema_json": object,
      "ledger_index": number,
      "tx_index": number,
      "tx_hash": "string"
    }
  }
}</pre>
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
            <p class="text-sm text-gray-600 mb-3">
              Submits a <code>CredentialCreate</code> tx on XRPL with an
              <code>xcs:credential_create</code> memo. The schema must already be indexed.
            </p>
            <div class="space-y-3">
              <div>
                <UBadge color="success">POST</UBadge>
                <code class="ml-2 text-sm">/api/credential/issue</code>
              </div>
              <div>
                <h4 class="font-medium mb-2">Request Body:</h4>
                <pre class="text-xs bg-gray-50 p-4 rounded overflow-x-auto">{
  "credentialType": "string (schema UID hex)",
  "subject": "string (XRPL address of the credential recipient)",
  "uri": "string (optional, arbitrary URI stored on-chain)",
  "expiresAt": "string (ISO date, optional)"
}</pre>
              </div>
              <div>
                <h4 class="font-medium mb-2">Response:</h4>
                <pre class="text-xs bg-gray-50 p-4 rounded overflow-x-auto">{
  "success": true,
  "data": {
    "txHash": "string",
    "ledgerIndex": number,
    "status": "pending"
  }
}</pre>
              </div>
            </div>
          </UCard>

          <!-- List Credentials -->
          <UCard>
            <h3 class="text-lg font-semibold mb-3">List Credentials</h3>
            <div class="space-y-3">
              <div>
                <UBadge color="info">POST</UBadge>
                <code class="ml-2 text-sm">/api/credential/list</code>
              </div>
              <div>
                <h4 class="font-medium mb-2">Request Body:</h4>
                <pre class="text-xs bg-gray-50 p-4 rounded overflow-x-auto">{
  "issuer": "string (XRPL address, optional)",
  "subject": "string (XRPL address, optional)",
  "credentialType": "string (schema UID hex, optional)",
  "status": "created | accepted | revoked (optional)",
  "limit": number (default: 50),
  "offset": number (default: 0)
}</pre>
              </div>
              <div>
                <h4 class="font-medium mb-2">Response:</h4>
                <pre class="text-xs bg-gray-50 p-4 rounded overflow-x-auto">{
  "success": true,
  "data": {
    "credentials": [Credential],
    "total": number
  }
}</pre>
              </div>
            </div>
          </UCard>

          <!-- Get Credential -->
          <UCard>
            <h3 class="text-lg font-semibold mb-3">Get Credential</h3>
            <div class="space-y-3">
              <div>
                <UBadge color="neutral">GET</UBadge>
                <code class="ml-2 text-sm">/api/credential?id={issuer}:{subject}:{credentialType}</code>
              </div>
            </div>
          </UCard>

          <!-- Accept Credential -->
          <UCard>
            <h3 class="text-lg font-semibold mb-3">Accept Credential</h3>
            <p class="text-sm text-gray-600 mb-3">
              Submits a <code>CredentialAccept</code> tx on XRPL. Subjects sign the transaction client-side using their wallet, then submit the signed blob.
              The legacy <code>/api/credential/accept</code> endpoint (with <code>subjectSeed</code>) is deprecated and will be removed.
            </p>
            <div class="space-y-3">
              <div>
                <UBadge color="success">POST</UBadge>
                <code class="ml-2 text-sm">/api/credential/accept-signed</code>
              </div>
              <div>
                <h4 class="font-medium mb-2">Request Body:</h4>
                <pre class="text-xs bg-gray-50 p-4 rounded overflow-x-auto">{
  "signedTxBlob": "string (subject-signed CredentialAccept tx, hex-encoded)"
}</pre>
              </div>
            </div>
          </UCard>

          <!-- Revoke Credential -->
          <UCard>
            <h3 class="text-lg font-semibold mb-3">Revoke Credential</h3>
            <p class="text-sm text-gray-600 mb-3">
              Submits a <code>CredentialDelete</code> tx signed by the issuer wallet.
            </p>
            <div class="space-y-3">
              <div>
                <UBadge color="error">POST</UBadge>
                <code class="ml-2 text-sm">/api/credential/revoke</code>
              </div>
              <div>
                <h4 class="font-medium mb-2">Request Body:</h4>
                <pre class="text-xs bg-gray-50 p-4 rounded overflow-x-auto">{
  "subject": "string (XRPL address)",
  "credentialType": "string (schema UID hex)"
}</pre>
              </div>
            </div>
          </UCard>
        </div>
      </section>

      <!-- Health -->
      <section>
        <h2 class="text-2xl font-bold mb-4">Health Check</h2>
        <UCard>
          <div class="space-y-3">
            <div>
              <UBadge color="neutral">GET</UBadge>
              <code class="ml-2 text-sm">/api/health</code>
            </div>
            <p class="text-sm text-gray-600">
              Returns health status of the API, PostgreSQL sink DB, and XRPL connection.
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
  meta: [{ name: 'description', content: 'Complete API reference for the XRPL Credential System' }],
});
</script>
