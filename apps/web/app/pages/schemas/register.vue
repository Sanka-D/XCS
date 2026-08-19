<script setup lang="ts">
import { parseJsonStrict } from '@xcs-protocol/core'
import { buildSchemaRegistrationPayment } from '@xcs-protocol/sdk'
import type { Payment } from 'xrpl'

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
const formError = ref('')
const result = ref<Record<string, unknown> | null>(null)

async function buildPreview() {
  formError.value = ''
  result.value = null
  if (!account.value) {
    formError.value = 'WALLET_NOT_CONNECTED'
    return
  }
  try {
    const profile = await getActiveNetworkProfile()
    const built = buildSchemaRegistrationPayment({
      publisher: account.value.address,
      profile,
      schema: parseJsonStrict(schemaText.value),
    })
    canonicalSchema.value = built.canonicalSchema
    transaction.value = (await prepare(built.transaction, profile)) as Payment
  } catch (error) {
    formError.value = error instanceof Error ? error.message : String(error)
    transaction.value = null
  }
}

async function submit() {
  if (!transaction.value) return
  try {
    const response = await signAndSubmit(transaction.value)
    result.value = { ...response }
    transaction.value = null
  } catch (error) {
    formError.value = error instanceof Error ? error.message : String(error)
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
      <textarea id="schema-json" v-model="schemaText" rows="18" spellcheck="false" />
      <div class="warning-box">{{ $t('register.irreversible') }}</div>
      <button class="button" type="button" :disabled="busy" @click="buildPreview">
        {{ $t('register.prepare') }}
      </button>
    </div>

    <div v-if="formError" class="error-box">{{ formError }}</div>
    <div v-if="canonicalSchema" class="form-card">
      <h2>{{ $t('register.canonical') }}</h2>
      <pre>{{ canonicalSchema }}</pre>
    </div>
    <TransactionPreview :transaction="transaction" :busy="busy" @confirm="submit" />
    <div v-if="result" class="success-box">
      <h2>{{ $t('register.submitted') }}</h2>
      <p>{{ $t('register.uidLater') }}</p>
      <pre>{{ JSON.stringify(result, null, 2) }}</pre>
    </div>
  </section>
</template>
