<script setup lang="ts">
import { canRetryOperation } from '~/utils/operationJournal'

const { operations, busy, loadOperations, retryOperation } = useWallet()
const pageError = ref('')
const resultMessage = ref('')

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
  try {
    const result = await retryOperation(operationId)
    resultMessage.value = `VALIDATED:${result.txHash}`
  } catch (error) {
    pageError.value = error instanceof Error ? error.message : String(error)
  }
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' }).format(
    new Date(value),
  )
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
      <button class="button secondary" type="button" :disabled="busy" @click="refresh">
        {{ $t('operations.refresh') }}
      </button>
    </div>

    <div class="warning-box">{{ $t('operations.localOnly') }}</div>
    <div v-if="pageError" class="error-box">{{ pageError }}</div>
    <div v-if="resultMessage" class="success-box">{{ resultMessage }}</div>
    <div v-if="operations.length === 0" class="empty-state">{{ $t('operations.empty') }}</div>

    <div v-else class="operation-list">
      <article v-for="operation in operations" :key="operation.operationId" class="form-card">
        <div class="operation-heading">
          <div>
            <p class="eyebrow">{{ operation.transactionType }}</p>
            <h2>{{ operation.stage }}</h2>
          </div>
          <button
            v-if="canRetryOperation(operation)"
            class="button"
            type="button"
            :disabled="busy"
            @click="retry(operation.operationId)"
          >
            {{ $t('operations.retry') }}
          </button>
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
        </dl>
        <p v-if="operation.message" class="muted">{{ operation.message }}</p>
      </article>
    </div>
  </section>
</template>
