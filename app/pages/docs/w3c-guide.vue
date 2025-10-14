<template>
  <div class="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
    <h1 class="text-4xl font-bold text-gray-900 mb-4">W3C Verifiable Credentials Guide</h1>
    <p class="text-xl text-gray-600 mb-8">
      Understanding the W3C VC standard and how it's implemented in XCS
    </p>

    <div class="space-y-12">
      <!-- Introduction -->
      <section>
        <h2 class="text-2xl font-bold mb-4">What are Verifiable Credentials?</h2>
        <p class="text-gray-700 mb-4">
          Verifiable Credentials (VCs) are digital statements made by an issuer
          about a subject. They are tamper-evident and cryptographically
          verifiable. The W3C VC Data Model is a standard way to express
          credentials on the Web.
        </p>
        <UCard>
          <div class="space-y-2 text-sm">
            <p><strong>Issuer:</strong> The entity that creates the credential</p>
            <p><strong>Subject:</strong> The entity the credential is about</p>
            <p><strong>Holder:</strong> The entity that possesses the credential (often the subject)</p>
            <p><strong>Verifier:</strong> The entity that verifies the credential</p>
          </div>
        </UCard>
      </section>

      <!-- Structure -->
      <section>
        <h2 class="text-2xl font-bold mb-4">W3C VC Structure</h2>
        <p class="text-gray-700 mb-4">
          A W3C Verifiable Credential consists of several key components:
        </p>
        <UCard>
          <pre class="text-xs overflow-x-auto">{
  "@context": [
    "https://www.w3.org/2018/credentials/v1",
    "https://w3id.org/security/suites/ed25519-2020/v1"
  ],
  "id": "urn:uuid:12345678-1234-1234-1234-123456789abc",
  "type": ["VerifiableCredential", "CustomCredentialType"],
  "issuer": {
    "id": "did:xrpl:testnet:rIssuersAddress",
    "name": "XRPL Credential Platform"
  },
  "issuanceDate": "2025-01-01T00:00:00Z",
  "expirationDate": "2026-01-01T00:00:00Z",
  "credentialSubject": {
    "id": "did:xrpl:testnet:rSubjectsAddress",
    "name": "John Doe",
    "age": 30,
    "verified": true
  },
  "credentialSchema": {
    "id": "ipfs://QmSchemaHash",
    "type": "JsonSchema"
  },
  "proof": {
    "type": "Ed25519Signature2020",
    "created": "2025-01-01T00:00:00Z",
    "verificationMethod": "did:xrpl:testnet:rIssuersAddress#keys-1",
    "proofPurpose": "assertionMethod"
  }
}</pre>
        </UCard>
      </section>

      <!-- Components -->
      <section>
        <h2 class="text-2xl font-bold mb-4">Key Components</h2>

        <div class="space-y-6">
          <UCard>
            <h3 class="text-lg font-semibold mb-3">@context</h3>
            <p class="text-sm text-gray-700">
              Defines the meaning of the terms used in the credential. XCS uses
              the standard W3C VC context plus additional contexts as needed.
            </p>
          </UCard>

          <UCard>
            <h3 class="text-lg font-semibold mb-3">id</h3>
            <p class="text-sm text-gray-700">
              A unique identifier for the credential. XCS uses UUIDs in URN format.
            </p>
          </UCard>

          <UCard>
            <h3 class="text-lg font-semibold mb-3">type</h3>
            <p class="text-sm text-gray-700">
              Specifies the type of credential. Always includes "VerifiableCredential"
              plus custom types based on the schema name.
            </p>
          </UCard>

          <UCard>
            <h3 class="text-lg font-semibold mb-3">issuer</h3>
            <p class="text-sm text-gray-700">
              The entity that issued the credential. XCS uses DID format with XRPL addresses:
              <code class="text-xs bg-gray-100 px-2 py-1 rounded ml-1">did:xrpl:testnet:ADDRESS</code>
            </p>
          </UCard>

          <UCard>
            <h3 class="text-lg font-semibold mb-3">credentialSubject</h3>
            <p class="text-sm text-gray-700 mb-3">
              Contains the actual claims about the subject. The structure is defined
              by the schema. Must include an "id" field identifying the subject.
            </p>
            <pre class="text-xs bg-gray-50 p-3 rounded">{
  "id": "did:xrpl:testnet:rSubjectAddress",
  "customField1": "value1",
  "customField2": "value2"
}</pre>
          </UCard>

          <UCard>
            <h3 class="text-lg font-semibold mb-3">credentialSchema</h3>
            <p class="text-sm text-gray-700">
              References the schema that defines the structure and validation rules
              for the credential. XCS uses IPFS CIDs for public schemas or internal
              URLs for private schemas.
            </p>
          </UCard>

          <UCard>
            <h3 class="text-lg font-semibold mb-3">proof</h3>
            <p class="text-sm text-gray-700">
              Cryptographic proof that verifies the credential's authenticity and
              integrity. XCS uses the XRPL blockchain for on-chain attestation.
            </p>
          </UCard>
        </div>
      </section>

      <!-- XRPL Integration -->
      <section>
        <h2 class="text-2xl font-bold mb-4">XRPL Integration</h2>
        <p class="text-gray-700 mb-4">
          XCS leverages the XRP Ledger's native Credentials feature for on-chain
          attestation. This provides:
        </p>
        <UCard>
          <ul class="space-y-2 text-sm">
            <li class="flex items-start gap-2">
              <span class="text-green-600 mt-1">✓</span>
              <span><strong>Immutable attestation:</strong> Credential issuance is recorded on the blockchain</span>
            </li>
            <li class="flex items-start gap-2">
              <span class="text-green-600 mt-1">✓</span>
              <span><strong>Acceptance workflow:</strong> Subjects must accept credentials on-chain</span>
            </li>
            <li class="flex items-start gap-2">
              <span class="text-green-600 mt-1">✓</span>
              <span><strong>Revocation support:</strong> Issuers can revoke credentials on-chain</span>
            </li>
            <li class="flex items-start gap-2">
              <span class="text-green-600 mt-1">✓</span>
              <span><strong>Decentralized verification:</strong> Anyone can verify the credential status</span>
            </li>
          </ul>
        </UCard>
      </section>

      <!-- Best Practices -->
      <section>
        <h2 class="text-2xl font-bold mb-4">Best Practices</h2>

        <div class="space-y-4">
          <UCard>
            <h3 class="text-lg font-semibold mb-2">Use Schemas</h3>
            <p class="text-sm text-gray-700">
              Always define a schema before issuing credentials. This ensures
              consistency and enables validation.
            </p>
          </UCard>

          <UCard>
            <h3 class="text-lg font-semibold mb-2">Set Expiration Dates</h3>
            <p class="text-sm text-gray-700">
              Include expiration dates for time-sensitive credentials to maintain
              data freshness and security.
            </p>
          </UCard>

          <UCard>
            <h3 class="text-lg font-semibold mb-2">Choose Storage Carefully</h3>
            <p class="text-sm text-gray-700">
              Use public (IPFS) storage for credentials that need to be widely
              accessible. Use private storage for sensitive data.
            </p>
          </UCard>

          <UCard>
            <h3 class="text-lg font-semibold mb-2">Implement Revocation</h3>
            <p class="text-sm text-gray-700">
              Have a clear revocation policy and process. Revoked credentials
              should be marked as such on-chain.
            </p>
          </UCard>
        </div>
      </section>

      <!-- Resources -->
      <section>
        <h2 class="text-2xl font-bold mb-4">Additional Resources</h2>
        <div class="space-y-2">
          <UCard class="hover:bg-gray-50 transition-colors">
            <a
              href="https://www.w3.org/TR/vc-data-model/"
              target="_blank"
              rel="noopener noreferrer"
              class="flex items-center justify-between text-primary"
            >
              <span>W3C Verifiable Credentials Data Model</span>
              <svg
                class="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                />
              </svg>
            </a>
          </UCard>

          <UCard class="hover:bg-gray-50 transition-colors">
            <a
              href="https://xrpl.org/"
              target="_blank"
              rel="noopener noreferrer"
              class="flex items-center justify-between text-primary"
            >
              <span>XRPL Documentation</span>
              <svg
                class="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                />
              </svg>
            </a>
          </UCard>

          <UCard class="hover:bg-gray-50 transition-colors">
            <NuxtLink
              to="/docs"
              class="flex items-center justify-between text-primary"
            >
              <span>XCS API Documentation</span>
              <svg
                class="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </NuxtLink>
          </UCard>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
useHead({
  title: 'W3C Verifiable Credentials Guide - XCS',
  meta: [
    {
      name: 'description',
      content:
        'Learn about W3C Verifiable Credentials and how they are implemented in XCS',
    },
  ],
});
</script>
