<script setup lang="ts">
import {
  canReconfirmOperation,
  canRetryOperation,
  operationBusinessConfirmation,
  serializeOperationReceipts,
} from '~/utils/operationJournal'

const { operations, busy, loadOperations, retryOperation, reconfirmOperation } = useWallet()
const pageError = ref('')
const resultMessage = ref('')
const resultSucceeded = ref(false)

async function refresh() {
  pageError.value = ''
  try {
    await loadOperations()
  } catch (error) {
    pageError.value = error instanceof Error ? error.message : String(error)
  }
}

async function retry(operationId: string) {
  pageError.value = ''
  resultMessage.value = ''
  resultSucceeded.value = false
  try {
    const result = await retryOperation(operationId)
    resultMessage.value = `VALIDATED:${result.txHash}`
    resultSucceeded.value = true
  } catch (error) {
    pageError.value = error instanceof Error ? error.message : String(error)
  }
}

async function reconfirm(operationId: string) {
  pageError.value = ''
  resultMessage.value = ''
  resultSucceeded.value = false
  try {
    const confirmation = await reconfirmOperation(operationId)
    resultMessage.value = `BUSINESS_CONFIRMATION:${confirmation}`
    resultSucceeded.value = confirmation === 'confirmed'
  } catch (error) {
    pageError.value = error instanceof Error ? error.message : String(error)
  }
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' }).format(
    new Date(value),
  )
}

function downloadReceipts() {
  const content = serializeOperationReceipts(operations.value)
  const blob = new Blob([content], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `xcs-operation-receipts-${new Date().toISOString().slice(0, 10)}.json`
  anchor.click()
  URL.revokeObjectURL(url)
}

onMounted(refresh)
</script>

<template>
  <section class="section-wrap form-page">
    <div class="page-heading">
      <div>
        <p class="eyebrow">XRPL submission journal</p>
        <h1>{{ $t('operations.title') }}</h1>
        <p class="lead">{{ $t('operations.description') }}</p>
      </div>
      <div class="button-row">
        <button
          class="button secondary"
          type="button"
          :disabled="busy || operations.length === 0"
          @click="downloadReceipts"
        >
          {{ $t('operations.export') }}
        </button>
        <button class="button secondary" type="button" :disabled="busy" @click="refresh">
          {{ $t('operations.refresh') }}
        </button>
      </div>
    </div>

    <div class="warning-box">{{ $t('operations.localOnly') }}</div>
    <div v-if="pageError" class="error-box">{{ pageError }}</div>
    <div v-if="resultMessage" :class="resultSucceeded ? 'success-box' : 'error-box'">
      {{ resultMessage }}
    </div>
    <div v-if="operations.length === 0" class="empty-state">{{ $t('operations.empty') }}</div>

    <div v-else class="operation-list">
      <article v-for="operation in operations" :key="operation.operationId" class="form-card">
        <div class="operation-heading">
          <div>
            <p class="eyebrow">{{ operation.transactionType }}</p>
            <h2>{{ operation.stage }}</h2>
          </div>
          <div class="button-row">
            <button
              v-if="canRetryOperation(operation)"
              class="button"
              type="button"
              :disabled="busy"
              @click="retry(operation.operationId)"
            >
              {{ $t('operations.retry') }}
            </button>
            <button
              v-if="canReconfirmOperation(operation)"
              class="button secondary"
              type="button"
              :disabled="busy"
              @click="reconfirm(operation.operationId)"
            >
              {{ $t('operations.reconfirm') }}
            </button>
          </div>
        </div>
        <dl class="metadata-list">
          <dt>{{ $t('operations.hash') }}</dt>
          <dd>
            <code>{{ operation.txHash ?? '—' }}</code>
          </dd>
          <dt>{{ $t('operations.profile') }}</dt>
          <dd>
            <code>{{ operation.profileId }}</code>
          </dd>
          <dt>{{ $t('operations.updated') }}</dt>
          <dd>{{ formatDate(operation.updatedAt) }}</dd>
          <dt>{{ $t('operations.lastLedger') }}</dt>
          <dd>{{ operation.lastLedgerSequence ?? '—' }}</dd>
          <dt>{{ $t('operations.result') }}</dt>
          <dd>
            <code>{{ operation.engineResult ?? '—' }}</code>
          </dd>
          <template v-if="operation.business">
            <dt>{{ $t('operations.action') }}</dt>
            <dd>
              <code>{{ operation.business.action }}</code>
            </dd>
            <template v-if="operation.business.action !== 'schema-register'">
              <dt>Issuer</dt>
              <dd>
                <code>{{ operation.business.issuer }}</code>
              </dd>
              <dt>Subject</dt>
              <dd>
                <code>{{ operation.business.subject }}</code>
              </dd>
              <dt>Schema UID</dt>
              <dd>
                <code>{{ operation.business.schemaUid }}</code>
              </dd>
              <template v-if="operation.business.action !== 'credential-issue'">
                <dt>Generation ID</dt>
                <dd>
                  <code>{{ operation.business.generationId }}</code>
                </dd>
                <dt>Business confirmation</dt>
                <dd>
                  <code>{{ operationBusinessConfirmation(operation) }}</code>
                </dd>
              </template>
              <dt>{{ $t('operations.payloadHash') }}</dt>
              <dd>
                <code>{{ operation.business.payloadDigestHex ?? '—' }}</code>
              </dd>
            </template>
          </template>
          <dt>{{ $t('operations.ledger') }}</dt>
          <dd>{{ operation.ledgerIndex ?? '—' }}</dd>
        </dl>
        <p v-if="operation.message" class="muted">{{ operation.message }}</p>
      </article>
    </div>
  </section>
</template>
