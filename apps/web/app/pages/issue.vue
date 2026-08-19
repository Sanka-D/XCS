<script setup lang="ts">
import {
  canonicalize,
  createHttpsPayloadUri,
  createIpfsRawPayloadUri,
  parseJsonStrict,
  validateCredentialPayload,
  type CredentialPayload,
} from '@xcs-protocol/core'
import { buildCredentialCreate } from '@xcs-protocol/sdk'
import type { CredentialCreate } from 'xrpl'
import { payloadPublicationMatches, type PayloadPublicationProof } from '~/utils/payloadPublication'

const route = useRoute()
const { account, busy, prepare, signAndSubmit } = useWallet()
const { getActiveNetworkProfile, getSchema } = useXcsApi()

const schemaUid = ref(typeof route.query.schema === 'string' ? route.query.schema : '')
const subject = ref('')
const claimsText = ref(`{
  "programId": "xrpl-developer-fundamentals-2026",
  "programName": "XRPL Developer Fundamentals",
  "completedAt": "2026-08-19T12:00:00Z",
  "achievement": "completed"
}`)
const uriMode = ref<'https' | 'ipfs'>('https')
const httpsUrl = ref('https://issuer.example/credentials/replace-me.json')
const expiration = ref('')
const publicationProof = ref<PayloadPublicationProof | null>(null)
const canonicalPayload = ref('')
const credentialUri = ref('')
const transaction = shallowRef<CredentialCreate | null>(null)
const formError = ref('')
const successHash = ref('')
const payloadPublished = computed({
  get: () =>
    payloadPublicationMatches(publicationProof.value, canonicalPayload.value, credentialUri.value),
  set: (published: boolean) => {
    publicationProof.value = published
      ? {
          canonicalPayload: canonicalPayload.value,
          credentialUri: credentialUri.value,
        }
      : null
  },
})

function invalidatePreview() {
  publicationProof.value = null
  canonicalPayload.value = ''
  credentialUri.value = ''
  transaction.value = null
}

watch([schemaUid, subject, claimsText, uriMode, httpsUrl, expiration], invalidatePreview)

function downloadPayload() {
  const blob = new Blob([canonicalPayload.value], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'xcs-credential.json'
  anchor.click()
  URL.revokeObjectURL(url)
}

async function buildPreview() {
  invalidatePreview()
  formError.value = ''
  successHash.value = ''
  if (!account.value) return void (formError.value = 'WALLET_NOT_CONNECTED')
  try {
    const normalizedSchemaUid = schemaUid.value.toLowerCase()
    const profile = await getActiveNetworkProfile()
    const schema = await getSchema(normalizedSchemaUid, profile.profileId)
    const claims = parseJsonStrict(claimsText.value)
    const payload = validateCredentialPayload(
      {
        xcsVersion: '0.1',
        issuer: account.value.address,
        subject: subject.value,
        schema: normalizedSchemaUid,
        claims,
      },
      {
        issuer: account.value.address,
        subject: subject.value,
        schemaUid: normalizedSchemaUid,
        schema: schema.resolved,
      },
    )
    canonicalPayload.value = canonicalize(payload as CredentialPayload)
    credentialUri.value =
      uriMode.value === 'ipfs'
        ? createIpfsRawPayloadUri(canonicalPayload.value)
        : createHttpsPayloadUri(httpsUrl.value, canonicalPayload.value)
    const raw = buildCredentialCreate({
      issuer: account.value.address,
      subject: subject.value,
      schemaUid: normalizedSchemaUid,
      uri: credentialUri.value,
      ...(expiration.value ? { expiration: new Date(expiration.value).toISOString() } : {}),
    })
    transaction.value = (await prepare(raw, profile)) as CredentialCreate
  } catch (error) {
    transaction.value = null
    formError.value = error instanceof Error ? error.message : String(error)
  }
}

async function submit() {
  if (!transaction.value || !payloadPublished.value) {
    formError.value = 'PAYLOAD_MUST_BE_PUBLISHED_BEFORE_ISSUANCE'
    return
  }
  try {
    const response = await signAndSubmit(transaction.value)
    successHash.value = response.txHash
    transaction.value = null
  } catch (error) {
    formError.value = error instanceof Error ? error.message : String(error)
  }
}
</script>

<template>
  <section class="section-wrap form-page">
    <p class="eyebrow">Credential issuer</p>
    <h1>{{ $t('issue.title') }}</h1>
    <p class="lead">{{ $t('issue.description') }}</p>
    <div class="warning-box">{{ $t('issue.noPii') }}</div>

    <div class="form-card form-grid">
      <label for="schema-uid">Schema UID</label>
      <input id="schema-uid" v-model.trim="schemaUid" required pattern="[0-9a-fA-F]{64}" />
      <label for="subject">Subject</label>
      <input id="subject" v-model.trim="subject" required placeholder="r…" />
      <label for="claims">Claims JSON</label>
      <textarea id="claims" v-model="claimsText" rows="12" spellcheck="false" />
      <label for="uri-mode">{{ $t('issue.storage') }}</label>
      <select id="uri-mode" v-model="uriMode">
        <option value="https">HTTPS + SHA-256</option>
        <option value="ipfs">IPFS raw CID</option>
      </select>
      <template v-if="uriMode === 'https'">
        <label for="https-url">HTTPS URL</label>
        <input id="https-url" v-model.trim="httpsUrl" type="url" />
      </template>
      <label for="expiration">{{ $t('issue.expiration') }}</label>
      <input id="expiration" v-model="expiration" type="datetime-local" />
      <button class="button" type="button" :disabled="busy" @click="buildPreview">
        {{ $t('issue.prepare') }}
      </button>
    </div>

    <div v-if="formError" class="error-box">{{ formError }}</div>
    <div v-if="canonicalPayload" class="form-card">
      <h2>{{ $t('issue.payload') }}</h2>
      <pre>{{ canonicalPayload }}</pre>
      <p>
        <code>{{ credentialUri }}</code>
      </p>
      <button class="button secondary" type="button" @click="downloadPayload">
        {{ $t('issue.download') }}
      </button>
      <label class="check-row"
        ><input v-model="payloadPublished" type="checkbox" />{{ $t('issue.published') }}</label
      >
    </div>
    <TransactionPreview :transaction="transaction" :busy="busy" @confirm="submit" />
    <div v-if="successHash" class="success-box">
      <strong>{{ $t('issue.submitted') }}</strong
      ><code>{{ successHash }}</code>
    </div>
  </section>
</template>
