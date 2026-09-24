<script setup lang="ts">
import type { ResolvedPresentation } from '../../server/xcs/recipient/types'
import { presentationHeadline } from '~/utils/presentationView'

const props = defineProps<{ result: ResolvedPresentation }>()
const headline = computed(() =>
  presentationHeadline(props.result.verification, { usable: true, fresh: true }),
)
</script>
<template>
  <article data-testid="presentation-result">
    <h1 class="text-2xl font-bold" data-testid="presentation-headline">
      {{ $t(`presentation.headlines.${headline}`) }}
    </h1>
    <p class="mt-2 text-sm text-muted">{{ $t('presentation.limitation') }}</p>
    <p v-if="result.verification.payload === 'not_checked'" class="mt-2 font-semibold">
      {{ $t('presentation.partialHelp') }}
    </p>
    <VerificationGrid :report="result.verification" test-id-prefix="presentation" :note="false" />
    <h2 class="text-xl font-semibold">
      {{ result.credential.schemaName ?? $t('recipient.credential') }}
    </h2>
    <p class="mt-2">{{ result.credential.organizationName }}</p>
    <p class="mt-4 font-semibold">
      {{ $t(result.scope === 'full' ? 'presentation.fullFields' : 'presentation.publicFields') }}
    </p>
    <p v-if="!Object.keys(result.claims).length" class="mt-3 text-muted">
      {{ $t('presentation.noFields') }}
    </p>
    <dl v-else class="mt-3 grid gap-3">
      <div
        v-for="(value, key) in result.claims"
        :key="key"
        class="rounded border border-default p-3"
      >
        <dt class="font-semibold">{{ key }}</dt>
        <dd class="mt-1 break-words whitespace-pre-wrap">
          {{ typeof value === 'object' ? JSON.stringify(value) : String(value) }}
        </dd>
      </div>
    </dl>
    <StatusBox v-if="result.requiresAuthorization" class="mt-5">{{
      $t('presentation.authorizationHelp')
    }}</StatusBox>
    <details class="mt-5 rounded border border-default p-4">
      <summary class="cursor-pointer font-semibold">{{ $t('recipient.evidence') }}</summary>
      <MetadataList class="mt-3">
        <dt>{{ $t('recipient.issuerWallet') }}</dt>
        <dd class="break-all font-mono">{{ result.credential.issuerAddress }}</dd>
        <dt>{{ $t('recipient.generation') }}</dt>
        <dd class="break-all font-mono">{{ result.credential.generationId }}</dd>
        <dt>{{ $t('auth.network') }}</dt>
        <dd>{{ result.credential.profileId }}</dd>
      </MetadataList>
    </details>
  </article>
</template>
