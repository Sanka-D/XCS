<script setup lang="ts">
import { buildCredentialAccept, buildCredentialDelete } from '@xcs-protocol/sdk'
import type { CredentialAccept, CredentialDelete } from 'xrpl'

const route = useRoute()
const { account, busy, prepare, signAndSubmit } = useWallet()
const { getActiveNetworkProfile } = useXcsApi()
const issuer = ref(typeof route.query.issuer === 'string' ? route.query.issuer : '')
const schemaUid = ref(typeof route.query.schema === 'string' ? route.query.schema : '')
const action = ref<'accept' | 'delete'>('accept')
const transaction = shallowRef<CredentialAccept | CredentialDelete | null>(null)
const message = ref('')

async function buildPreview() {
  message.value = ''
  if (!account.value) return void (message.value = 'WALLET_NOT_CONNECTED')
  try {
    const profile = await getActiveNetworkProfile()
    const normalizedSchemaUid = schemaUid.value.toLowerCase()
    const raw =
      action.value === 'accept'
        ? buildCredentialAccept({
            subject: account.value.address,
            issuer: issuer.value,
            schemaUid: normalizedSchemaUid,
          })
        : buildCredentialDelete({
            account: account.value.address,
            issuer: issuer.value,
            subject: account.value.address,
            schemaUid: normalizedSchemaUid,
          })
    transaction.value = (await prepare(raw, profile)) as CredentialAccept | CredentialDelete
  } catch (error) {
    transaction.value = null
    message.value = error instanceof Error ? error.message : String(error)
  }
}

async function submit() {
  if (!transaction.value) return
  try {
    const response = await signAndSubmit(transaction.value)
    message.value = `VALIDATED:${response.txHash}`
    transaction.value = null
  } catch (error) {
    message.value = error instanceof Error ? error.message : String(error)
  }
}
</script>

<template>
  <section class="section-wrap form-page">
    <p class="eyebrow">Credential subject</p>
    <h1>{{ $t('accept.title') }}</h1>
    <p class="lead">{{ $t('accept.description') }}</p>
    <div class="warning-box">{{ $t('accept.notTruth') }}</div>
    <div class="form-card form-grid">
      <label for="subject-action">{{ $t('accept.action') }}</label>
      <select id="subject-action" v-model="action">
        <option value="accept">CredentialAccept</option>
        <option value="delete">CredentialDelete</option>
      </select>
      <label for="issuer">Issuer</label>
      <input id="issuer" v-model.trim="issuer" placeholder="r…" />
      <label for="accept-schema">Schema UID</label>
      <input id="accept-schema" v-model.trim="schemaUid" pattern="[0-9a-fA-F]{64}" />
      <button class="button" type="button" :disabled="busy" @click="buildPreview">
        {{ $t('accept.prepare') }}
      </button>
    </div>
    <div v-if="message" class="notice-box">{{ message }}</div>
    <TransactionPreview :transaction="transaction" :busy="busy" @confirm="submit" />
  </section>
</template>
