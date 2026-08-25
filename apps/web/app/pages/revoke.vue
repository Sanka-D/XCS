<script setup lang="ts">
import { decodeUtf8Hex, rippleTimeToIso8601 } from '@xcs-protocol/core'
import { buildCredentialDelete } from '@xcs-protocol/sdk'
import type { CredentialDelete } from 'xrpl'
import {
  credentialRevocationBlockReason,
  parseApiCredentialDetail,
  parseVerificationDimensions,
  type ApiCredentialDetail,
  type VerificationDimensions,
} from '~/utils/credentialReview'

const route = useRoute()
const { account, busy: walletBusy, prepare, signAndSubmit } = useWallet()
const { getActiveNetworkProfile, getCredential, verify } = useXcsApi()
const subject = ref(typeof route.query.subject === 'string' ? route.query.subject : '')
const schemaUid = ref(typeof route.query.schema === 'string' ? route.query.schema : '')
const transaction = shallowRef<CredentialDelete | null>(null)
const credential = shallowRef<ApiCredentialDetail | null>(null)
const report = shallowRef<VerificationDimensions | null>(null)
const reviewBusy = ref(false)
const message = ref('')
const successHash = ref('')
const busy = computed(() => walletBusy.value || reviewBusy.value)
const decodedUri = computed(() => {
  if (!credential.value?.uriHex) return null
  try {
    return decodeUtf8Hex(credential.value.uriHex)
  } catch {
    return null
  }
})
const expiration = computed(() =>
  credential.value?.expiration === null || credential.value?.expiration === undefined
    ? null
    : rippleTimeToIso8601(credential.value.expiration),
)
let previewRevision = 0

function invalidatePreview() {
  previewRevision += 1
  transaction.value = null
  credential.value = null
  report.value = null
}

watch([subject, schemaUid], invalidatePreview)
watch(() => [account.value?.address ?? '', account.value?.network.id ?? ''], invalidatePreview)

async function fetchExactCredential(input: {
  issuer: string
  subject: string
  schemaUid: string
  profileId: string
}) {
  const [rawCredential, rawReport] = await Promise.all([
    getCredential(input.issuer, input.subject, input.schemaUid, input.profileId),
    verify(
      {
        issuer: input.issuer,
        subject: input.subject,
        schemaUid: input.schemaUid,
        resolvePayload: false,
      },
      input.profileId,
    ),
  ])
  const exactCredential = parseApiCredentialDetail(rawCredential, input)
  const dimensions = parseVerificationDimensions(rawReport)
  if (exactCredential.state !== dimensions.onChain) {
    throw new Error('CREDENTIAL_REVIEW_STATE_MISMATCH')
  }
  if (dimensions.generationId && dimensions.generationId !== exactCredential.generationId) {
    throw new Error('CREDENTIAL_REVIEW_GENERATION_MISMATCH')
  }
  const reason = credentialRevocationBlockReason(exactCredential)
  if (reason) throw new Error(reason)
  return { exactCredential, dimensions }
}

async function buildPreview() {
  invalidatePreview()
  message.value = ''
  successHash.value = ''
  if (!account.value) return void (message.value = 'WALLET_NOT_CONNECTED')

  reviewBusy.value = true
  const revision = previewRevision
  const issuerAddress = account.value.address
  const subjectAddress = subject.value
  const normalizedSchemaUid = schemaUid.value.toLowerCase()
  try {
    const profile = await getActiveNetworkProfile()
    const loaded = await fetchExactCredential({
      issuer: issuerAddress,
      subject: subjectAddress,
      schemaUid: normalizedSchemaUid,
      profileId: profile.profileId,
    })
    if (revision !== previewRevision) throw new Error('CREDENTIAL_REVIEW_CHANGED_DURING_LOAD')
    credential.value = loaded.exactCredential
    report.value = loaded.dimensions
    const raw = buildCredentialDelete({
      account: issuerAddress,
      issuer: issuerAddress,
      subject: subjectAddress,
      schemaUid: normalizedSchemaUid,
    })
    const prepared = (await prepare(raw, profile)) as CredentialDelete
    if (revision !== previewRevision) throw new Error('CREDENTIAL_REVIEW_CHANGED_DURING_BUILD')
    transaction.value = prepared
  } catch (error) {
    transaction.value = null
    message.value = error instanceof Error ? error.message : String(error)
  } finally {
    reviewBusy.value = false
  }
}

async function submit() {
  const preparedTransaction = transaction.value
  const expectedCredential = credential.value
  const expectedIssuer = account.value?.address
  const expectedSubject = subject.value
  const expectedSchemaUid = schemaUid.value.toLowerCase()
  const expectedRevision = previewRevision
  if (!preparedTransaction || !expectedCredential || !expectedIssuer) {
    message.value = 'TRANSACTION_PREVIEW_REQUIRED'
    return
  }

  reviewBusy.value = true
  message.value = ''
  try {
    const assertCurrent = () => {
      if (
        previewRevision !== expectedRevision ||
        transaction.value !== preparedTransaction ||
        account.value?.address !== expectedIssuer ||
        subject.value !== expectedSubject ||
        schemaUid.value.toLowerCase() !== expectedSchemaUid
      ) {
        throw new Error('CREDENTIAL_REVIEW_CHANGED_BEFORE_SIGNATURE')
      }
    }
    assertCurrent()
    const profile = await getActiveNetworkProfile()
    const loaded = await fetchExactCredential({
      issuer: expectedIssuer,
      subject: expectedSubject,
      schemaUid: expectedSchemaUid,
      profileId: profile.profileId,
    })
    assertCurrent()
    if (loaded.exactCredential.generationId !== expectedCredential.generationId) {
      throw new Error('CREDENTIAL_GENERATION_CHANGED_BEFORE_SIGNATURE')
    }
    credential.value = loaded.exactCredential
    report.value = loaded.dimensions
    const response = await signAndSubmit(
      preparedTransaction,
      {
        action: 'credential-revoke',
        issuer: expectedIssuer,
        subject: expectedSubject,
        schemaUid: expectedSchemaUid,
        generationId: loaded.exactCredential.generationId,
      },
      assertCurrent,
    )
    successHash.value = response.txHash
    transaction.value = null
  } catch (error) {
    message.value = error instanceof Error ? error.message : String(error)
  } finally {
    reviewBusy.value = false
  }
}
</script>

<template>
  <section class="section-wrap form-page">
    <p class="eyebrow">Credential issuer</p>
    <h1>{{ $t('revoke.title') }}</h1>
    <p class="lead">{{ $t('revoke.description') }}</p>
    <div class="warning-box">{{ $t('revoke.warning') }}</div>

    <div class="form-card form-grid">
      <label for="revoke-subject">Subject</label>
      <input id="revoke-subject" v-model.trim="subject" placeholder="r…" :disabled="busy" />
      <label for="revoke-schema">Schema UID</label>
      <input
        id="revoke-schema"
        v-model.trim="schemaUid"
        pattern="[0-9a-fA-F]{64}"
        :disabled="busy"
      />
      <button class="button" type="button" :disabled="busy" @click="buildPreview">
        {{ busy ? $t('common.working') : $t('revoke.review') }}
      </button>
    </div>

    <div v-if="message" class="error-box">{{ message }}</div>
    <article v-if="credential && report" class="form-card">
      <h2>{{ $t('revoke.exactCredential') }}</h2>
      <dl class="metadata-list">
        <dt>Issuer</dt>
        <dd>
          <code>{{ credential.issuer }}</code>
        </dd>
        <dt>Subject</dt>
        <dd>
          <code>{{ credential.subject }}</code>
        </dd>
        <dt>Schema UID</dt>
        <dd>
          <code>{{ credential.schemaUid }}</code>
        </dd>
        <dt>{{ $t('revoke.state') }}</dt>
        <dd><StatusPill :value="credential.state" /></dd>
        <dt>{{ $t('revoke.expiration') }}</dt>
        <dd>{{ expiration ?? $t('revoke.noExpiration') }}</dd>
        <dt>URI</dt>
        <dd>
          <code>{{ decodedUri ?? '—' }}</code>
        </dd>
        <dt>{{ $t('revoke.generation') }}</dt>
        <dd>
          <code>{{ credential.generationId }}</code>
        </dd>
      </dl>
    </article>

    <TransactionPreview :transaction="transaction" :busy="busy" @confirm="submit" />
    <div v-if="successHash" class="success-box">
      <strong>{{ $t('revoke.submitted') }}</strong
      ><code>{{ successHash }}</code>
    </div>
  </section>
</template>
