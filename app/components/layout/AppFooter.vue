<template>
  <footer class="bg-gray-50 border-t border-gray-200 mt-auto">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div class="grid grid-cols-1 md:grid-cols-4 gap-8">
        <!-- About -->
        <div>
          <h3 class="text-sm font-semibold text-gray-900 uppercase mb-4">
            About
          </h3>
          <p class="text-sm text-gray-600">
            XCS is a decentralized credential platform built on XRPL, following
            W3C Verifiable Credentials standards.
          </p>
        </div>

        <!-- Quick Links -->
        <div>
          <h3 class="text-sm font-semibold text-gray-900 uppercase mb-4">
            Quick Links
          </h3>
          <ul class="space-y-2">
            <li>
              <NuxtLink
                to="/schemas"
                class="text-sm text-gray-600 hover:text-primary transition-colors"
              >
                Browse Schemas
              </NuxtLink>
            </li>
            <li>
              <NuxtLink
                to="/credentials"
                class="text-sm text-gray-600 hover:text-primary transition-colors"
              >
                Browse Credentials
              </NuxtLink>
            </li>
            <li>
              <NuxtLink
                to="/schemas/create"
                class="text-sm text-gray-600 hover:text-primary transition-colors"
              >
                Create Schema
              </NuxtLink>
            </li>
            <li>
              <NuxtLink
                to="/credentials/issue"
                class="text-sm text-gray-600 hover:text-primary transition-colors"
              >
                Issue Credential
              </NuxtLink>
            </li>
          </ul>
        </div>

        <!-- Documentation -->
        <div>
          <h3 class="text-sm font-semibold text-gray-900 uppercase mb-4">
            Documentation
          </h3>
          <ul class="space-y-2">
            <li>
              <NuxtLink
                to="/docs"
                class="text-sm text-gray-600 hover:text-primary transition-colors"
              >
                API Documentation
              </NuxtLink>
            </li>
            <li>
              <NuxtLink
                to="/docs/w3c-guide"
                class="text-sm text-gray-600 hover:text-primary transition-colors"
              >
                W3C VC Guide
              </NuxtLink>
            </li>
            <li>
              <a
                href="https://xrpl.org/"
                target="_blank"
                rel="noopener noreferrer"
                class="text-sm text-gray-600 hover:text-primary transition-colors"
              >
                XRPL Docs
              </a>
            </li>
          </ul>
        </div>

        <!-- Network Info -->
        <div>
          <h3 class="text-sm font-semibold text-gray-900 uppercase mb-4">
            Network
          </h3>
          <div class="space-y-2">
            <div class="flex items-center space-x-2">
              <div class="w-2 h-2 bg-green-500 rounded-full"></div>
              <span class="text-sm text-gray-600">XRPL Testnet</span>
            </div>
            <p class="text-xs text-gray-500">
              Currently connected to XRPL Testnet. All transactions are on the
              test network.
            </p>
          </div>
        </div>
      </div>

      <!-- Bottom Bar -->
      <div
        class="mt-8 pt-8 border-t border-gray-200 flex flex-col md:flex-row justify-between items-center"
      >
        <p class="text-sm text-gray-500">
          {{ new Date().getFullYear() }} XCS. Built on XRPL.
        </p>
        <div class="flex space-x-6 mt-4 md:mt-0">
          <a
            href="https://github.com"
            target="_blank"
            rel="noopener noreferrer"
            class="text-gray-400 hover:text-gray-500"
          >
            <span class="sr-only">GitHub</span>
            <svg class="h-6 w-6" fill="currentColor" viewBox="0 0 24 24">
              <path
                fill-rule="evenodd"
                d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
                clip-rule="evenodd"
              />
            </svg>
          </a>
        </div>
      </div>
    </div>
  </footer>
</template>
