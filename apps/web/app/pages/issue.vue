<script setup lang="ts">
import {
  canonicalize,
  createHttpsPayloadUri,
  parseJsonStrict,
  validateCredentialPayload,
  type CredentialPayload,
} from '@xcs-protocol/core'
import { buildCredentialCreate } from '@xcs-protocol/sdk'
import type { CredentialCreate } from 'xrpl'
import type { WalletSubmissionResult } from '~/composables/useWallet'
import { buildCredentialAcceptLink, buildCredentialVerifyLink } from '~/utils/operationLinks'
import {
  verifyHttpsPayloadPublication,
  type PayloadPublicationProof,
} from '~/utils/payloadPublication'

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
const httpsUrl = ref('https://issuer.example/credentials/replace-me.json')
const expiration = ref('')
const publicationProof = ref<PayloadPublicationProof | null>(null)
const publicationCheckBusy = ref(false)
const flowBusy = ref(false)
const canonicalPayload = ref('')
const credentialUri = ref('')
const transaction = shallowRef<CredentialCreate | null>(null)
const preparedProfileId = ref('')
const formError = ref('')
const result = shallowRef<WalletSubmissionResult | null>(null)
const issuedLinkInputs = shallowRef<{
  profileId: string
  issuer: string
  subject: string
  schemaUid: string
} | null>(null)
const submissionBusy = computed(() => busy.value || flowBusy.value)
let previewRevision = 0

function invalidatePreview() {
  previewRevision += 1
  publicationProof.value = null
  canonicalPayload.value = ''
  credentialUri.value = ''
  transaction.value = null
  preparedProfileId.value = ''
  result.value = null
  issuedLinkInputs.value = null
}

watch([schemaUid, subject, claimsText, httpsUrl, expiration], invalidatePreview)
watch(() => [account.value?.address ?? '', account.value?.network.id ?? ''], invalidatePreview)

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
  result.value = null
  if (!account.value) return void (formError.value = 'WALLET_NOT_CONNECTED')
  const revision = previewRevision
  const issuerAddress = account.value.address
  const normalizedSchemaUid = schemaUid.value.toLowerCase()
  const subjectAddress = subject.value
  const claimsInput = claimsText.value
  const payloadUrl = httpsUrl.value
  const expirationInput = expiration.value
  try {
    const profile = await getActiveNetworkProfile()
    const schema = await getSchema(normalizedSchemaUid, profile.profileId)
    if (revision !== previewRevision) throw new Error('ISSUANCE_PREVIEW_CHANGED_DURING_BUILD')
    const claims = parseJsonStrict(claimsInput)
    const payload = validateCredentialPayload(
      {
        xcsVersion: '0.1',
        issuer: issuerAddress,
        subject: subjectAddress,
        schema: normalizedSchemaUid,
        claims,
      },
      {
        issuer: issuerAddress,
        subject: subjectAddress,
        schemaUid: normalizedSchemaUid,
        schema: schema.resolved,
      },
    )
    canonicalPayload.value = canonicalize(payload as CredentialPayload)
    credentialUri.value = createHttpsPayloadUri(payloadUrl, canonicalPayload.value)
    const raw = buildCredentialCreate({
      issuer: issuerAddress,
      subject: subjectAddress,
      schemaUid: normalizedSchemaUid,
      uri: credentialUri.value,
      ...(expirationInput ? { expiration: new Date(expirationInput).toISOString() } : {}),
    })
    const prepared = (await prepare(raw, profile)) as CredentialCreate
    if (revision !== previewRevision) throw new Error('ISSUANCE_PREVIEW_CHANGED_DURING_BUILD')
    transaction.value = prepared
    preparedProfileId.value = profile.profileId
  } catch (error) {
    transaction.value = null
    formError.value = error instanceof Error ? error.message : String(error)
  }
}

async function submit() {
  const preparedTransaction = transaction.value
  const expectedPayload = canonicalPayload.value
  const expectedUri = credentialUri.value
  const expectedIssuer = account.value?.address
  const expectedSubject = subject.value
  const expectedSchemaUid = schemaUid.value.toLowerCase()
  const expectedClaims = claimsText.value
  const expectedHttpsUrl = httpsUrl.value
  const expectedExpiration = expiration.value
  const expectedProfileId = preparedProfileId.value
  const expectedRevision = previewRevision
  if (
    !preparedTransaction ||
    !expectedPayload ||
    !expectedUri ||
    !expectedIssuer ||
    !expectedProfileId
  ) {
    formError.value = 'TRANSACTION_PREVIEW_REQUIRED'
    return
  }

  flowBusy.value = true
  publicationCheckBusy.value = true
  publicationProof.value = null
  formError.value = ''
  try {
    const assertCurrent = () => {
      if (
        previewRevision !== expectedRevision ||
        transaction.value !== preparedTransaction ||
        canonicalPayload.value !== expectedPayload ||
        credentialUri.value !== expectedUri ||
        account.value?.address !== expectedIssuer ||
        subject.value !== expectedSubject ||
        schemaUid.value.toLowerCase() !== expectedSchemaUid ||
        claimsText.value !== expectedClaims ||
        httpsUrl.value !== expectedHttpsUrl ||
        expiration.value !== expectedExpiration ||
        preparedProfileId.value !== expectedProfileId
      ) {
        throw new Error('ISSUANCE_PREVIEW_CHANGED_DURING_PUBLICATION_CHECK')
      }
    }
    const proof = await verifyHttpsPayloadPublication({
      canonicalPayload: expectedPayload,
      credentialUri: expectedUri,
    })
    assertCurrent()
    publicationProof.value = proof
    publicationCheckBusy.value = false
    const normalizedExpiration = expectedExpiration
      ? new Date(expectedExpiration).toISOString()
      : undefined
    const response = await signAndSubmit(
      preparedTransaction,
      {
        action: 'credential-issue',
        issuer: expectedIssuer,
        subject: expectedSubject,
        schemaUid: expectedSchemaUid,
        credentialUri: expectedUri,
        payloadDigestHex: proof.digestHex,
        ...(normalizedExpiration ? { expiration: normalizedExpiration } : {}),
      },
      assertCurrent,
      undefined,
      (validated) => {
        issuedLinkInputs.value = {
          profileId: expectedProfileId,
          issuer: expectedIssuer,
          subject: expectedSubject,
          schemaUid: expectedSchemaUid,
        }
        result.value = { ...validated }
      },
    )
    result.value = response
    transaction.value = null
  } catch (error) {
    formError.value = error instanceof Error ? error.message : String(error)
  } finally {
    publicationCheckBusy.value = false
    flowBusy.value = false
  }
}

const acceptLink = computed(() => {
  const generationId = result.value?.businessEvidence?.generationId
  if (
    result.value?.businessConfirmation !== 'confirmed' ||
    !generationId ||
    !issuedLinkInputs.value
  ) {
    return null
  }
  return buildCredentialAcceptLink({ ...issuedLinkInputs.value, generationId })
})

const verifyLink = computed(() => {
  const generationId = result.value?.businessEvidence?.generationId
  if (
    result.value?.businessConfirmation !== 'confirmed' ||
    !generationId ||
    !issuedLinkInputs.value
  ) {
    return null
  }
  return buildCredentialVerifyLink({ ...issuedLinkInputs.value, generationId })
})
</script>

<template>
  <section class="section-wrap form-page">
    <p class="eyebrow">Credential issuer</p>
    <h1>{{ $t('issue.title') }}</h1>
    <p class="lead">{{ $t('issue.description') }}</p>
    <div class="warning-box">{{ $t('issue.noPii') }}</div>

    <div class="form-card form-grid">
      <label for="schema-uid">Schema UID</label>
      <input
        id="schema-uid"
        v-model.trim="schemaUid"
        required
        pattern="[0-9a-fA-F]{64}"
        :disabled="submissionBusy"
      />
      <label for="subject">Subject</label>
      <input
        id="subject"
        v-model.trim="subject"
        required
        placeholder="r…"
        :disabled="submissionBusy"
      />
      <label for="claims">Claims JSON</label>
      <textarea
        id="claims"
        v-model="claimsText"
        rows="12"
        spellcheck="false"
        :disabled="submissionBusy"
      />
      <label for="https-url">HTTPS URL</label>
      <input id="https-url" v-model.trim="httpsUrl" type="url" :disabled="submissionBusy" />
      <p class="form-hint">{{ $t('issue.httpsProof') }}</p>
      <label for="expiration">{{ $t('issue.expiration') }}</label>
      <input
        id="expiration"
        v-model="expiration"
        type="datetime-local"
        :disabled="submissionBusy"
      />
      <button class="button" type="button" :disabled="submissionBusy" @click="buildPreview">
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
      <div v-if="publicationCheckBusy" class="notice-box">{{ $t('issue.checking') }}</div>
      <div v-else-if="publicationProof" class="success-box">
        {{ $t('issue.checked', { bytes: publicationProof.byteLength }) }}
        <code>{{ publicationProof.digestHex }}</code>
      </div>
    </div>
    <TransactionPreview :transaction="transaction" :busy="submissionBusy" @confirm="submit" />
    <BusinessFinality
      v-if="result"
      :tx-hash="result.txHash"
      :engine-result="result.transactionResult"
      :ledger-index="result.ledgerIndex"
      :business-confirmation="result.businessConfirmation"
      :business-evidence="result.businessEvidence"
    />
    <div v-if="acceptLink && verifyLink" class="form-card">
      <h2>{{ $t('issue.links') }}</h2>
      <p>
        <NuxtLinkLocale :to="acceptLink">{{ $t('issue.acceptLink') }}</NuxtLinkLocale>
      </p>
      <p>
        <NuxtLinkLocale :to="verifyLink">{{ $t('issue.verifyLink') }}</NuxtLinkLocale>
      </p>
    </div>
  </section>
</template>
