<script setup lang="ts">
import type { BusinessConfirmation, BusinessEvidence } from '~/utils/operationJournal'

defineProps<{
  txHash: string
  engineResult?: string | null
  ledgerIndex?: number | undefined
  businessConfirmation?: Exclude<BusinessConfirmation, 'pending'> | undefined
  businessEvidence?: BusinessEvidence | undefined
}>()
</script>

<template>
  <section class="form-card" data-testid="business-finality">
    <h2>{{ $t('finality.title') }}</h2>
    <div class="notice-box" data-testid="xrpl-finality">
      <strong>{{ $t('finality.xrplValidated') }}</strong>
      <p>
        <code>{{ txHash }}</code>
      </p>
      <p>{{ engineResult ?? 'tesSUCCESS' }} · ledger {{ ledgerIndex ?? '—' }}</p>
    </div>
    <div
      v-if="businessConfirmation === 'confirmed'"
      class="success-box"
      data-testid="xcs-confirmed"
    >
      <strong>{{ $t('finality.xcsConfirmed') }}</strong>
    </div>
    <div
      v-else-if="businessConfirmation === 'rejected'"
      class="error-box"
      data-testid="xcs-rejected"
    >
      <strong>{{ $t('finality.xcsRejected') }}</strong>
      <code v-if="businessEvidence?.reasonCode">{{ businessEvidence.reasonCode }}</code>
    </div>
    <div
      v-else-if="businessConfirmation === 'mismatch'"
      class="error-box"
      data-testid="xcs-mismatch"
    >
      <strong>{{ $t('finality.xcsMismatch') }}</strong>
    </div>
    <div v-else class="notice-box" data-testid="xcs-pending">
      <strong>{{ $t('finality.xcsPending') }}</strong>
      <p>{{ $t('finality.reconfirm') }}</p>
    </div>
    <dl v-if="businessEvidence" class="metadata-list">
      <dt>{{ $t('finality.proofLedger') }}</dt>
      <dd>{{ businessEvidence.ledgerIndex }}</dd>
      <dt>{{ $t('finality.proofLedgerHash') }}</dt>
      <dd>
        <code>{{ businessEvidence.ledgerHash }}</code>
      </dd>
      <dt>{{ $t('finality.proofTransactionIndex') }}</dt>
      <dd>{{ businessEvidence.transactionIndex }}</dd>
      <template v-if="businessEvidence.schemaUid">
        <dt>Schema UID</dt>
        <dd>
          <code>{{ businessEvidence.schemaUid }}</code>
        </dd>
      </template>
      <template v-if="businessEvidence.generationId">
        <dt>Generation ID</dt>
        <dd>
          <code>{{ businessEvidence.generationId }}</code>
        </dd>
      </template>
      <template v-if="businessEvidence.eventType">
        <dt>{{ $t('finality.proofEvent') }}</dt>
        <dd>
          <code>{{ businessEvidence.eventType }}</code>
        </dd>
      </template>
      <template v-if="businessEvidence.deletionCause">
        <dt>{{ $t('finality.proofDeletionCause') }}</dt>
        <dd>
          <code>{{ businessEvidence.deletionCause }}</code>
        </dd>
      </template>
    </dl>
  </section>
</template>
