<script setup lang="ts">
import { buildCredentialAccept, buildCredentialDelete } from '@xcs-protocol/sdk'
import type { CredentialAccept, CredentialDelete } from 'xrpl'
import type { ApiSchemaDetail } from '~/composables/useXcsApi'
import type { WalletSubmissionResult } from '~/composables/useWallet'
import {
  assertCredentialAcceptanceReviewCurrent,
  assertPayloadFetchConsentCurrent,
  createIssuerTrustAcknowledgementToken,
  createPayloadFetchConsentToken,
  credentialActionBlockReason,
  loadCredentialReview,
  type CredentialReview,
  type CredentialSubjectAction,
  type IssuerTrustAcknowledgementToken,
  type PayloadFetchConsentToken,
} from '~/utils/credentialReview'
import {
  assertLinkGeneration,
  assertLinkProfile,
  singleRouteQueryValue,
} from '~/utils/operationLinks'
import { inspectPilotHttpsPayloadHost } from '~/utils/payloadPublication'

const route = useRoute()
const { t } = useI18n()
const { account, busy: walletBusy, prepare, signAndSubmit } = useWallet()
const { getActiveNetworkProfile, getCredential, getSchema, verify } = useXcsApi()
const issuer = ref(singleRouteQueryValue(route.query.issuer))
const schemaUid = ref(singleRouteQueryValue(route.query.schema))
const linkedProfileId = ref(singleRouteQueryValue(route.query.profile))
const linkedGenerationId = ref(singleRouteQueryValue(route.query.generation))
const action = ref<CredentialSubjectAction>('accept')
const transaction = shallowRef<CredentialAccept | CredentialDelete | null>(null)
const review = shallowRef<CredentialReview | null>(null)
const reviewProfileId = ref<string | null>(null)
const schemaDetail = shallowRef<ApiSchemaDetail | null>(null)
const payloadConsent = ref(false)
const payloadConsentToken = shallowRef<PayloadFetchConsentToken | null>(null)
const issuerTrustAcknowledgementToken = shallowRef<IssuerTrustAcknowledgementToken | null>(null)
const reviewBusy = ref(false)
const message = ref('')
const result = shallowRef<WalletSubmissionResult | null>(null)
const busy = computed(() => walletBusy.value || reviewBusy.value)
const blockReason = computed(() => {
  if (!review.value) return undefined
  if (action.value === 'accept' && review.value.claims === undefined) {
    return review.value.report.issuerTrust === 'untrusted'
      ? 'CREDENTIAL_ISSUER_NOT_TRUSTED'
      : undefined
  }
  return credentialActionBlockReason(
    review.value,
    action.value,
    issuerTrustAcknowledgementToken.value ?? undefined,
    reviewProfileId.value ?? undefined,
  )
})
const blockReasonMessage = computed(() => {
  if (blockReason.value === 'CREDENTIAL_ISSUER_NOT_TRUSTED') return t('accept.issuerUntrusted')
  if (blockReason.value === 'CREDENTIAL_ISSUER_TRUST_ACK_REQUIRED') {
    return t('accept.issuerAcknowledgementRequired')
  }
  if (blockReason.value === 'CREDENTIAL_ISSUER_TRUST_ACK_STALE') {
    return t('accept.issuerAcknowledgementStale')
  }
  return blockReason.value
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
  reviewProfileId.value = null
  schemaDetail.value = null
  payloadConsent.value = false
  payloadConsentToken.value = null
  issuerTrustAcknowledgementToken.value = null
  result.value = null
}

watch([issuer, schemaUid, action, linkedProfileId, linkedGenerationId], invalidatePreview)
watch(() => [account.value?.address ?? '', account.value?.network.id ?? ''], invalidatePreview)
watch(
  () => [route.query.issuer, route.query.schema, route.query.profile, route.query.generation],
  ([nextIssuer, nextSchema, nextProfile, nextGeneration]) => {
    issuer.value = singleRouteQueryValue(nextIssuer)
    schemaUid.value = singleRouteQueryValue(nextSchema)
    linkedProfileId.value = singleRouteQueryValue(nextProfile)
    linkedGenerationId.value = singleRouteQueryValue(nextGeneration)
  },
)

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

function setIssuerTrustAcknowledgement(granted: boolean) {
  if (!granted) {
    issuerTrustAcknowledgementToken.value = null
    if (transaction.value === null) return
    previewRevision += 1
    transaction.value = null
    result.value = null
    return
  }

  try {
    if (!review.value) throw new Error('CREDENTIAL_ISSUER_TRUST_ACK_REQUIRED')
    if (!reviewProfileId.value) throw new Error('CREDENTIAL_ISSUER_TRUST_ACK_PROFILE_REQUIRED')
    issuerTrustAcknowledgementToken.value = createIssuerTrustAcknowledgementToken(
      review.value,
      reviewProfileId.value,
    )
    message.value = ''
  } catch (error) {
    issuerTrustAcknowledgementToken.value = null
    message.value = error instanceof Error ? error.message : String(error)
  }
}

function clearStalePayloadConsent(error: unknown): void {
  if (!(error instanceof Error) || error.message !== 'CREDENTIAL_PAYLOAD_CONSENT_STALE') return
  payloadConsent.value = false
  payloadConsentToken.value = null
  issuerTrustAcknowledgementToken.value = null
  review.value = null
  reviewProfileId.value = null
  schemaDetail.value = null
  previewRevision += 1
  transaction.value = null
  result.value = null
}

function clearInvalidIssuerTrustAcknowledgement(error: unknown): void {
  if (
    !(error instanceof Error) ||
    ![
      'CREDENTIAL_ISSUER_NOT_TRUSTED',
      'CREDENTIAL_ISSUER_TRUST_ACK_REQUIRED',
      'CREDENTIAL_ISSUER_TRUST_ACK_STALE',
      'CREDENTIAL_ISSUER_TRUST_CHANGED_AFTER_SIGNATURE',
      'CREDENTIAL_GENERATION_CHANGED_BEFORE_SIGNATURE',
      'CREDENTIAL_GENERATION_CHANGED_AFTER_SIGNATURE',
      'CREDENTIAL_REVIEW_CHANGED_AFTER_SIGNATURE',
      'CREDENTIAL_STATE_CHANGED_AFTER_SIGNATURE',
      'CREDENTIAL_LINK_GENERATION_MISMATCH',
      'NETWORK_PROFILE_CHANGED_AFTER_SIGNATURE',
    ].includes(error.message)
  ) {
    return
  }
  issuerTrustAcknowledgementToken.value = null
  previewRevision += 1
  transaction.value = null
  result.value = null
}

async function fetchExactReview(input: {
  issuer: string
  subject: string
  schemaUid: string
  profileId: string
  payloadConsent?: PayloadFetchConsentToken | undefined
  expectedGenerationId?: string | undefined
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
  const metadataReview = await loadCredentialReview(reviewOptions)
  assertLinkGeneration(input.expectedGenerationId, metadataReview.generationId)
  if (!input.payloadConsent) return { credentialReview: metadataReview, schema }
  assertPayloadFetchConsentCurrent(metadataReview, input.payloadConsent)
  const localReview = await loadCredentialReview({ ...reviewOptions, fetchPayload: true })
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
  result.value = null
  if (!account.value) return void (message.value = 'WALLET_NOT_CONNECTED')

  reviewBusy.value = true
  const revision = previewRevision
  const subjectAddress = account.value.address
  const issuerAddress = issuer.value
  const normalizedSchemaUid = schemaUid.value.toLowerCase()
  const selectedAction = action.value
  const consent = selectedAction === 'accept' ? payloadConsentToken.value : null
  const trustAcknowledgement =
    selectedAction === 'accept' ? issuerTrustAcknowledgementToken.value : null
  try {
    const profile = await getActiveNetworkProfile()
    assertLinkProfile(linkedProfileId.value || undefined, profile.profileId)
    const loaded = await fetchExactReview({
      issuer: issuerAddress,
      subject: subjectAddress,
      schemaUid: normalizedSchemaUid,
      profileId: profile.profileId,
      ...(linkedGenerationId.value ? { expectedGenerationId: linkedGenerationId.value } : {}),
      ...(consent ? { payloadConsent: consent } : {}),
    })
    if (revision !== previewRevision) throw new Error('CREDENTIAL_REVIEW_CHANGED_DURING_LOAD')

    review.value = loaded.credentialReview
    reviewProfileId.value = profile.profileId
    schemaDetail.value = loaded.schema
    if (selectedAction === 'accept' && !consent) {
      message.value = payloadHostBlockReason.value ?? 'CREDENTIAL_PAYLOAD_CONSENT_REQUIRED'
      return
    }
    const reason = credentialActionBlockReason(
      loaded.credentialReview,
      selectedAction,
      trustAcknowledgement ?? undefined,
      profile.profileId,
    )
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
    clearInvalidIssuerTrustAcknowledgement(error)
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
  const expectedIssuerTrustAcknowledgement = issuerTrustAcknowledgementToken.value
  const expectedLinkedProfileId = linkedProfileId.value
  const expectedLinkedGenerationId = linkedGenerationId.value
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
        payloadConsentToken.value !== expectedPayloadConsent ||
        issuerTrustAcknowledgementToken.value !== expectedIssuerTrustAcknowledgement ||
        linkedProfileId.value !== expectedLinkedProfileId ||
        linkedGenerationId.value !== expectedLinkedGenerationId
      ) {
        throw new Error('CREDENTIAL_REVIEW_CHANGED_BEFORE_SIGNATURE')
      }
    }
    assertCurrent()
    const profile = await getActiveNetworkProfile()
    assertLinkProfile(expectedLinkedProfileId || undefined, profile.profileId)
    const loaded = await fetchExactReview({
      issuer: expectedIssuer,
      subject: expectedSubject,
      schemaUid: expectedSchemaUid,
      profileId: profile.profileId,
      ...(expectedLinkedGenerationId ? { expectedGenerationId: expectedLinkedGenerationId } : {}),
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
    review.value = loaded.credentialReview
    reviewProfileId.value = profile.profileId
    schemaDetail.value = loaded.schema
    const reason = credentialActionBlockReason(
      loaded.credentialReview,
      expectedAction,
      expectedIssuerTrustAcknowledgement ?? undefined,
      profile.profileId,
    )
    if (reason) throw new Error(reason)

    const revalidateAcceptanceAfterSignature =
      expectedAction === 'accept'
        ? async () => {
            assertCurrent()
            const latestProfile = await getActiveNetworkProfile()
            assertLinkProfile(expectedLinkedProfileId || undefined, latestProfile.profileId)
            const latest = await fetchExactReview({
              issuer: expectedIssuer,
              subject: expectedSubject,
              schemaUid: expectedSchemaUid,
              profileId: latestProfile.profileId,
              ...(expectedLinkedGenerationId
                ? { expectedGenerationId: expectedLinkedGenerationId }
                : {}),
            })
            assertCurrent()
            assertCredentialAcceptanceReviewCurrent(
              loaded.credentialReview,
              latest.credentialReview,
              profile.profileId,
              latestProfile.profileId,
              expectedIssuerTrustAcknowledgement ?? undefined,
            )
          }
        : undefined

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
      revalidateAcceptanceAfterSignature,
      (validated) => {
        result.value = { ...validated }
      },
    )
    result.value = response
    transaction.value = null
  } catch (error) {
    clearStalePayloadConsent(error)
    clearInvalidIssuerTrustAcknowledgement(error)
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
      <div
        v-if="action === 'accept' && review.report.issuerTrust === 'unknown'"
        class="warning-box"
        data-testid="issuer-trust-acknowledgement"
      >
        <p>{{ $t('accept.issuerUnknown') }}</p>
        <label>
          <input
            type="checkbox"
            :checked="issuerTrustAcknowledgementToken !== null"
            :disabled="busy"
            @change="setIssuerTrustAcknowledgement(($event.target as HTMLInputElement).checked)"
          />
          {{ $t('accept.issuerAcknowledgement') }}
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
      <div v-if="blockReasonMessage" class="error-box">{{ blockReasonMessage }}</div>
      <div v-else-if="action === 'delete'" class="warning-box">
        {{ $t('accept.rejectSafety') }}
      </div>
    </article>

    <TransactionPreview :transaction="transaction" :busy="busy" @confirm="submit" />
    <BusinessFinality
      v-if="result"
      :tx-hash="result.txHash"
      :engine-result="result.transactionResult"
      :ledger-index="result.ledgerIndex"
      :business-confirmation="result.businessConfirmation"
      :business-evidence="result.businessEvidence"
    />
  </section>
</template>
