<script setup lang="ts">
import { buildCredentialAccept, buildCredentialDelete } from '@xcs-protocol/sdk'
import type { CredentialAccept, CredentialDelete } from 'xrpl'
import type { ApiSchemaDetail } from '~/composables/useXcsApi'
import {
  createPayloadFetchConsentToken,
  credentialActionBlockReason,
  loadCredentialReview,
  loadCredentialReviewWithConsent,
  type CredentialReview,
  type CredentialSubjectAction,
  type PayloadFetchConsentToken,
} from '~/utils/credentialReview'
import { inspectPilotHttpsPayloadHost } from '~/utils/payloadPublication'

const route = useRoute()
const { account, busy: walletBusy, prepare, signAndSubmit } = useWallet()
const { getActiveNetworkProfile, getCredential, getSchema, verify } = useXcsApi()
const issuer = ref(typeof route.query.issuer === 'string' ? route.query.issuer : '')
const schemaUid = ref(typeof route.query.schema === 'string' ? route.query.schema : '')
const action = ref<CredentialSubjectAction>('accept')
const transaction = shallowRef<CredentialAccept | CredentialDelete | null>(null)
const review = shallowRef<CredentialReview | null>(null)
const schemaDetail = shallowRef<ApiSchemaDetail | null>(null)
const payloadConsent = ref(false)
const payloadConsentToken = shallowRef<PayloadFetchConsentToken | null>(null)
const reviewBusy = ref(false)
const message = ref('')
const successHash = ref('')
const busy = computed(() => walletBusy.value || reviewBusy.value)
const blockReason = computed(() => {
  if (!review.value) return undefined
  if (action.value === 'accept' && review.value.claims === undefined) return undefined
  return credentialActionBlockReason(review.value, action.value)
})
const payloadHost = computed(() => {
  if (!review.value?.uri) return null
  try {
    return new URL(review.value.uri).hostname
  } catch {
    return null
  }
})
const payloadHostBlockReason = computed(() => {
  if (!review.value?.uri) return 'CREDENTIAL_URI_REQUIRED'
  try {
    inspectPilotHttpsPayloadHost(review.value.uri)
    return undefined
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
})
let previewRevision = 0

function invalidatePreview() {
  previewRevision += 1
  transaction.value = null
  review.value = null
  schemaDetail.value = null
  payloadConsent.value = false
  payloadConsentToken.value = null
}

watch([issuer, schemaUid, action], invalidatePreview)
watch(() => [account.value?.address ?? '', account.value?.network.id ?? ''], invalidatePreview)

function setPayloadConsent(granted: boolean) {
  if (!granted) {
    payloadConsent.value = false
    payloadConsentToken.value = null
    if (transaction.value === null) return
    previewRevision += 1
    transaction.value = null
    return
  }

  try {
    if (!review.value) throw new Error('CREDENTIAL_PAYLOAD_CONSENT_REQUIRED')
    payloadConsentToken.value = createPayloadFetchConsentToken(review.value)
    payloadConsent.value = true
    message.value = ''
  } catch (error) {
    payloadConsent.value = false
    payloadConsentToken.value = null
    message.value = error instanceof Error ? error.message : String(error)
  }
}

function clearStalePayloadConsent(error: unknown): void {
  if (!(error instanceof Error) || error.message !== 'CREDENTIAL_PAYLOAD_CONSENT_STALE') return
  payloadConsent.value = false
  payloadConsentToken.value = null
  review.value = null
  schemaDetail.value = null
}

async function fetchExactReview(input: {
  issuer: string
  subject: string
  schemaUid: string
  profileId: string
  payloadConsent?: PayloadFetchConsentToken | undefined
}): Promise<{ credentialReview: CredentialReview; schema: ApiSchemaDetail | null }> {
  const [credential, metadataReport, schemaResult] = await Promise.all([
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
    getSchema(input.schemaUid, input.profileId).then(
      (schema) => ({ schema }),
      (error: unknown) => ({ error }),
    ),
  ])
  if ('error' in schemaResult && input.payloadConsent) throw schemaResult.error
  const schema = 'schema' in schemaResult ? schemaResult.schema : null
  const reviewOptions = {
    credential,
    report: metadataReport,
    issuer: input.issuer,
    subject: input.subject,
    schemaUid: input.schemaUid,
    ...(schema ? { schema: schema.resolved } : {}),
  }
  const localReview = input.payloadConsent
    ? await loadCredentialReviewWithConsent({
        ...reviewOptions,
        consent: input.payloadConsent,
      })
    : await loadCredentialReview(reviewOptions)
  if (!input.payloadConsent) return { credentialReview: localReview, schema }
  if (localReview.payload === undefined) throw new Error('CREDENTIAL_PAYLOAD_REVIEW_FAILED')

  // The API validates the already-consented, locally parsed object. It never
  // resolves the issuer URI, so the server-side URL resolver may stay disabled.
  const verifiedReport = await verify(
    {
      issuer: input.issuer,
      subject: input.subject,
      schemaUid: input.schemaUid,
      payload: localReview.payload,
    },
    input.profileId,
  )
  const verifiedMetadata = await loadCredentialReview({
    credential,
    report: verifiedReport,
    issuer: input.issuer,
    subject: input.subject,
    schemaUid: input.schemaUid,
  })
  return {
    schema,
    credentialReview: {
      ...verifiedMetadata,
      payload: localReview.payload,
      claims: localReview.claims,
      payloadDigestHex: localReview.payloadDigestHex,
      payloadByteLength: localReview.payloadByteLength,
      payloadCheckedAt: localReview.payloadCheckedAt,
    },
  }
}

async function buildPreview() {
  previewRevision += 1
  transaction.value = null
  message.value = ''
  successHash.value = ''
  if (!account.value) return void (message.value = 'WALLET_NOT_CONNECTED')

  reviewBusy.value = true
  const revision = previewRevision
  const subjectAddress = account.value.address
  const issuerAddress = issuer.value
  const normalizedSchemaUid = schemaUid.value.toLowerCase()
  const selectedAction = action.value
  const consent = selectedAction === 'accept' ? payloadConsentToken.value : null
  try {
    const profile = await getActiveNetworkProfile()
    const loaded = await fetchExactReview({
      issuer: issuerAddress,
      subject: subjectAddress,
      schemaUid: normalizedSchemaUid,
      profileId: profile.profileId,
      ...(consent ? { payloadConsent: consent } : {}),
    })
    if (revision !== previewRevision) throw new Error('CREDENTIAL_REVIEW_CHANGED_DURING_LOAD')

    review.value = loaded.credentialReview
    schemaDetail.value = loaded.schema
    if (selectedAction === 'accept' && !consent) {
      message.value = payloadHostBlockReason.value ?? 'CREDENTIAL_PAYLOAD_CONSENT_REQUIRED'
      return
    }
    const reason = credentialActionBlockReason(loaded.credentialReview, selectedAction)
    if (reason) throw new Error(reason)

    const raw =
      selectedAction === 'accept'
        ? buildCredentialAccept({
            subject: subjectAddress,
            issuer: issuerAddress,
            schemaUid: normalizedSchemaUid,
          })
        : buildCredentialDelete({
            account: subjectAddress,
            issuer: issuerAddress,
            subject: subjectAddress,
            schemaUid: normalizedSchemaUid,
          })
    const prepared = (await prepare(raw, profile)) as CredentialAccept | CredentialDelete
    if (revision !== previewRevision) throw new Error('CREDENTIAL_REVIEW_CHANGED_DURING_BUILD')
    transaction.value = prepared
  } catch (error) {
    clearStalePayloadConsent(error)
    transaction.value = null
    message.value = error instanceof Error ? error.message : String(error)
  } finally {
    reviewBusy.value = false
  }
}

async function submit() {
  const preparedTransaction = transaction.value
  const expectedReview = review.value
  const expectedSubject = account.value?.address
  const expectedIssuer = issuer.value
  const expectedSchemaUid = schemaUid.value.toLowerCase()
  const expectedAction = action.value
  const expectedPayloadConsent = payloadConsentToken.value
  const expectedRevision = previewRevision
  if (!preparedTransaction || !expectedReview || !expectedSubject) {
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
        account.value?.address !== expectedSubject ||
        issuer.value !== expectedIssuer ||
        schemaUid.value.toLowerCase() !== expectedSchemaUid ||
        action.value !== expectedAction ||
        payloadConsentToken.value !== expectedPayloadConsent
      ) {
        throw new Error('CREDENTIAL_REVIEW_CHANGED_BEFORE_SIGNATURE')
      }
    }
    assertCurrent()
    const profile = await getActiveNetworkProfile()
    const loaded = await fetchExactReview({
      issuer: expectedIssuer,
      subject: expectedSubject,
      schemaUid: expectedSchemaUid,
      profileId: profile.profileId,
      ...(expectedAction === 'accept' && expectedPayloadConsent
        ? { payloadConsent: expectedPayloadConsent }
        : {}),
    })
    if (expectedAction === 'accept' && !expectedPayloadConsent) {
      throw new Error('CREDENTIAL_PAYLOAD_CONSENT_REQUIRED')
    }
    assertCurrent()
    if (loaded.credentialReview.generationId !== expectedReview.generationId) {
      throw new Error('CREDENTIAL_GENERATION_CHANGED_BEFORE_SIGNATURE')
    }
    const reason = credentialActionBlockReason(loaded.credentialReview, expectedAction)
    if (reason) throw new Error(reason)
    review.value = loaded.credentialReview
    schemaDetail.value = loaded.schema

    const response = await signAndSubmit(
      preparedTransaction,
      {
        action: expectedAction === 'accept' ? 'credential-accept' : 'credential-reject',
        issuer: expectedIssuer,
        subject: expectedSubject,
        schemaUid: expectedSchemaUid,
        generationId: loaded.credentialReview.generationId,
        ...(loaded.credentialReview.payloadDigestHex
          ? { payloadDigestHex: loaded.credentialReview.payloadDigestHex }
          : {}),
      },
      assertCurrent,
    )
    successHash.value = response.txHash
    transaction.value = null
  } catch (error) {
    clearStalePayloadConsent(error)
    message.value = error instanceof Error ? error.message : String(error)
  } finally {
    reviewBusy.value = false
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
      <select id="subject-action" v-model="action" :disabled="busy">
        <option value="accept">{{ $t('accept.acceptAction') }}</option>
        <option value="delete">{{ $t('accept.rejectAction') }}</option>
      </select>
      <label for="issuer">Issuer</label>
      <input id="issuer" v-model.trim="issuer" placeholder="r…" :disabled="busy" />
      <label for="accept-schema">Schema UID</label>
      <input
        id="accept-schema"
        v-model.trim="schemaUid"
        pattern="[0-9a-fA-F]{64}"
        :disabled="busy"
      />
      <button class="button" type="button" :disabled="busy" @click="buildPreview">
        {{
          busy
            ? $t('common.working')
            : action === 'accept' && review && payloadConsent
              ? $t('accept.fetchAndPrepare')
              : $t('accept.review')
        }}
      </button>
    </div>

    <div v-if="message" class="error-box">{{ message }}</div>
    <article v-if="review" class="form-card">
      <h2>{{ $t('accept.exactCredential') }}</h2>
      <dl class="metadata-list">
        <dt>Issuer</dt>
        <dd>
          <code>{{ review.issuer }}</code>
        </dd>
        <dt>Subject</dt>
        <dd>
          <code>{{ review.subject }}</code>
        </dd>
        <dt>Schema</dt>
        <dd>
          <strong v-if="schemaDetail">{{ schemaDetail.name }}</strong>
          <code>{{ review.schemaUid }}</code>
        </dd>
        <dt>{{ $t('accept.expiration') }}</dt>
        <dd>{{ review.expiration ?? $t('accept.noExpiration') }}</dd>
        <dt>URI</dt>
        <dd>
          <code>{{ review.uri ?? '—' }}</code>
        </dd>
        <dt>{{ $t('accept.generation') }}</dt>
        <dd>
          <code>{{ review.generationId }}</code>
        </dd>
      </dl>

      <div class="verification-grid">
        <article>
          <span>{{ $t('verify.onChain') }}</span
          ><StatusPill :value="review.report.onChain" />
        </article>
        <article>
          <span>{{ $t('verify.schema') }}</span
          ><StatusPill :value="review.report.schema" />
        </article>
        <article>
          <span>{{ $t('verify.payload') }}</span
          ><StatusPill :value="review.report.payload" />
        </article>
        <article>
          <span>{{ $t('verify.trust') }}</span
          ><StatusPill :value="review.report.issuerTrust" />
        </article>
      </div>

      <div v-if="action === 'accept' && !review.claims" class="warning-box">
        <p>{{ $t('accept.payloadConsentIntro', { host: payloadHost ?? '—' }) }}</p>
        <div v-if="payloadHostBlockReason" class="error-box">{{ payloadHostBlockReason }}</div>
        <label v-else>
          <input
            type="checkbox"
            :checked="payloadConsent"
            :disabled="busy"
            @change="setPayloadConsent(($event.target as HTMLInputElement).checked)"
          />
          {{ $t('accept.payloadConsent') }}
        </label>
      </div>
      <template v-if="action === 'accept'">
        <h2>{{ $t('accept.publicClaims') }}</h2>
        <pre v-if="review.claims">{{ JSON.stringify(review.claims, null, 2) }}</pre>
        <div v-else-if="review.payloadReviewError" class="error-box">
          {{ $t('accept.payloadUnavailable') }} <code>{{ review.payloadReviewError }}</code>
        </div>
        <p v-if="review.payloadDigestHex" class="muted">
          {{ review.payloadByteLength }} bytes · <code>{{ review.payloadDigestHex }}</code>
        </p>
      </template>
      <div v-if="blockReason" class="error-box">{{ blockReason }}</div>
      <div v-else-if="action === 'delete'" class="warning-box">
        {{ $t('accept.rejectSafety') }}
      </div>
    </article>

    <TransactionPreview :transaction="transaction" :busy="busy" @confirm="submit" />
    <div v-if="successHash" class="success-box">
      <strong>{{ $t('accept.submitted') }}</strong
      ><code>{{ successHash }}</code>
    </div>
  </section>
</template>
