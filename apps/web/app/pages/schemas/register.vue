<script setup lang="ts">
import { encodeUtf8, parseJsonStrict, sha256Hex } from '@xcs-protocol/core'
import { buildSchemaRegistrationPayment } from '@xcs-protocol/sdk'
import type { Payment } from 'xrpl'
import type { WalletSubmissionResult } from '~/composables/useWallet'

const example = `{
  "xcsVersion": "0.1",
  "name": "XRPL Developer Course Completion",
  "description": "Attests successful completion of one XRPL Commons developer course.",
  "fields": {
    "programId": { "type": "string" },
    "programName": { "type": "string" },
    "completedAt": { "type": "string" },
    "achievement": { "type": "string", "optional": true }
  }
}`

const { account, busy, prepare, signAndSubmit } = useWallet()
const { getActiveNetworkProfile } = useXcsApi()
const schemaText = ref(example)
const transaction = shallowRef<Payment | null>(null)
const canonicalSchema = ref('')
const schemaDigestHex = ref('')
const memoByteLength = ref<number | null>(null)
const formError = ref('')
const result = shallowRef<WalletSubmissionResult | null>(null)
const submitting = ref(false)
const pageBusy = computed(() => busy.value || submitting.value)
let previewRevision = 0

function invalidatePreview() {
  previewRevision += 1
  transaction.value = null
  canonicalSchema.value = ''
  schemaDigestHex.value = ''
  memoByteLength.value = null
  result.value = null
}

watch(schemaText, invalidatePreview)
watch(() => [account.value?.address ?? '', account.value?.network.id ?? ''], invalidatePreview)

async function buildPreview() {
  invalidatePreview()
  formError.value = ''
  result.value = null
  if (!account.value) {
    formError.value = 'WALLET_NOT_CONNECTED'
    return
  }
  const revision = previewRevision
  const publisher = account.value.address
  const schemaInput = schemaText.value
  try {
    const profile = await getActiveNetworkProfile()
    const built = buildSchemaRegistrationPayment({
      publisher,
      profile,
      schema: parseJsonStrict(schemaInput),
    })
    const prepared = (await prepare(built.transaction, profile)) as Payment
    if (revision !== previewRevision) throw new Error('SCHEMA_PREVIEW_CHANGED_DURING_BUILD')
    canonicalSchema.value = built.canonicalSchema
    schemaDigestHex.value = sha256Hex(encodeUtf8(built.canonicalSchema))
    memoByteLength.value = built.memoByteLength
    transaction.value = prepared
  } catch (error) {
    formError.value = error instanceof Error ? error.message : String(error)
    transaction.value = null
  }
}

async function submit() {
  const preparedTransaction = transaction.value
  const expectedPublisher = account.value?.address
  const expectedSchema = schemaText.value
  const expectedCanonical = canonicalSchema.value
  const expectedDigest = schemaDigestHex.value
  const expectedMemoByteLength = memoByteLength.value
  const expectedRevision = previewRevision
  if (
    !preparedTransaction ||
    !expectedPublisher ||
    !expectedCanonical ||
    !expectedDigest ||
    expectedMemoByteLength === null
  ) {
    formError.value = 'TRANSACTION_PREVIEW_REQUIRED'
    return
  }
  submitting.value = true
  try {
    const assertCurrent = () => {
      if (
        previewRevision !== expectedRevision ||
        transaction.value !== preparedTransaction ||
        account.value?.address !== expectedPublisher ||
        schemaText.value !== expectedSchema ||
        canonicalSchema.value !== expectedCanonical ||
        schemaDigestHex.value !== expectedDigest ||
        memoByteLength.value !== expectedMemoByteLength
      ) {
        throw new Error('SCHEMA_PREVIEW_CHANGED_BEFORE_SIGNATURE')
      }
    }
    const response = await signAndSubmit(
      preparedTransaction,
      {
        action: 'schema-register',
        publisher: expectedPublisher,
        schemaDigestHex: expectedDigest,
        memoByteLength: expectedMemoByteLength,
      },
      assertCurrent,
      undefined,
      (validated) => {
        result.value = { ...validated }
      },
    )
    result.value = response
    transaction.value = null
  } catch (error) {
    formError.value = error instanceof Error ? error.message : String(error)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <section class="section-wrap form-page">
    <p class="eyebrow">Schema publisher</p>
    <h1>{{ $t('register.title') }}</h1>
    <p class="lead">{{ $t('register.description') }}</p>

    <div class="form-card">
      <label for="schema-json">{{ $t('register.schema') }}</label>
      <textarea
        id="schema-json"
        v-model="schemaText"
        rows="18"
        spellcheck="false"
        :disabled="pageBusy"
      />
      <div class="warning-box">{{ $t('register.irreversible') }}</div>
      <button class="button" type="button" :disabled="pageBusy" @click="buildPreview">
        {{ $t('register.prepare') }}
      </button>
    </div>

    <div v-if="formError" class="error-box">{{ formError }}</div>
    <div v-if="canonicalSchema" class="form-card">
      <h2>{{ $t('register.canonical') }}</h2>
      <pre>{{ canonicalSchema }}</pre>
      <p class="muted">
        {{ memoByteLength }} bytes · <code>{{ schemaDigestHex }}</code>
      </p>
    </div>
    <TransactionPreview :transaction="transaction" :busy="pageBusy" @confirm="submit" />
    <BusinessFinality
      v-if="result"
      :tx-hash="result.txHash"
      :engine-result="result.transactionResult"
      :ledger-index="result.ledgerIndex"
      :business-confirmation="result.businessConfirmation"
      :business-evidence="result.businessEvidence"
    />
    <div
      v-if="result?.businessConfirmation === 'confirmed' && result.businessEvidence?.schemaUid"
      class="success-box"
    >
      <NuxtLinkLocale :to="`/schemas/${result.businessEvidence.schemaUid}`">
        {{ $t('register.openSchema') }}
      </NuxtLinkLocale>
    </div>
  </section>
</template>
