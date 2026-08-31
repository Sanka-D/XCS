<script setup lang="ts">
import type { ApiSchemaDetail } from '~/composables/useXcsApi'
import {
  assertPayloadFetchConsentCurrent,
  createPayloadFetchConsentToken,
  loadCredentialReview,
  loadCredentialReviewWithConsent,
  type CredentialReview,
  type PayloadFetchConsentToken,
} from '~/utils/credentialReview'
import {
  assertLinkGeneration,
  assertLinkProfile,
  singleRouteQueryValue,
} from '~/utils/operationLinks'
import { inspectPilotHttpsPayloadHost } from '~/utils/payloadPublication'

const route = useRoute()
const { getActiveNetworkProfile, getCredential, getSchema, verify } = useXcsApi()
const issuer = ref(singleRouteQueryValue(route.query.issuer))
const subject = ref(singleRouteQueryValue(route.query.subject))
const schemaUid = ref(singleRouteQueryValue(route.query.schema))
const linkedProfileId = ref(singleRouteQueryValue(route.query.profile))
const linkedGenerationId = ref(singleRouteQueryValue(route.query.generation))
const busy = ref(false)
const error = ref('')
const review = shallowRef<CredentialReview | null>(null)
const schemaDetail = shallowRef<ApiSchemaDetail | null>(null)
const payloadConsent = ref(false)
const payloadConsentToken = shallowRef<PayloadFetchConsentToken | null>(null)
let reviewRevision = 0

const payloadHost = computed(() => {
  if (!review.value?.uri) return null
  try {
    return inspectPilotHttpsPayloadHost(review.value.uri)
  } catch {
    return null
  }
})

function invalidateReview() {
  reviewRevision += 1
  review.value = null
  schemaDetail.value = null
  payloadConsent.value = false
  payloadConsentToken.value = null
}

watch([issuer, subject, schemaUid, linkedProfileId, linkedGenerationId], invalidateReview)
watch(
  () => [
    route.query.issuer,
    route.query.subject,
    route.query.schema,
    route.query.profile,
    route.query.generation,
  ],
  ([nextIssuer, nextSubject, nextSchema, nextProfile, nextGeneration]) => {
    issuer.value = singleRouteQueryValue(nextIssuer)
    subject.value = singleRouteQueryValue(nextSubject)
    schemaUid.value = singleRouteQueryValue(nextSchema)
    linkedProfileId.value = singleRouteQueryValue(nextProfile)
    linkedGenerationId.value = singleRouteQueryValue(nextGeneration)
  },
)

async function loadExactMetadata(input: {
  issuer: string
  subject: string
  schemaUid: string
  profileId: string
  requireSchema: boolean
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
      (caught: unknown) => ({ error: caught }),
    ),
  ])
  if ('error' in schemaResult && input.requireSchema) throw schemaResult.error
  const schema = 'schema' in schemaResult ? schemaResult.schema : null
  const credentialReview = await loadCredentialReview({
    credential,
    report: metadataReport,
    issuer: input.issuer,
    subject: input.subject,
    schemaUid: input.schemaUid,
    ...(schema ? { schema: schema.resolved } : {}),
  })
  assertLinkGeneration(linkedGenerationId.value || undefined, credentialReview.generationId)
  return { credentialReview, schema }
}

async function loadMetadata() {
  invalidateReview()
  busy.value = true
  error.value = ''
  const revision = reviewRevision
  const expected = {
    issuer: issuer.value,
    subject: subject.value,
    schemaUid: schemaUid.value.toLowerCase(),
  }
  try {
    const profile = await getActiveNetworkProfile()
    assertLinkProfile(linkedProfileId.value || undefined, profile.profileId)
    const loaded = await loadExactMetadata({
      ...expected,
      profileId: profile.profileId,
      requireSchema: false,
    })
    if (revision !== reviewRevision) throw new Error('CREDENTIAL_REVIEW_CHANGED_DURING_LOAD')
    review.value = loaded.credentialReview
    schemaDetail.value = loaded.schema
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught)
  } finally {
    busy.value = false
  }
}

function setPayloadConsent(granted: boolean) {
  if (!granted) {
    payloadConsent.value = false
    payloadConsentToken.value = null
    return
  }
  try {
    if (!review.value) throw new Error('CREDENTIAL_PAYLOAD_CONSENT_REQUIRED')
    payloadConsentToken.value = createPayloadFetchConsentToken(review.value)
    payloadConsent.value = true
    error.value = ''
  } catch (caught) {
    payloadConsent.value = false
    payloadConsentToken.value = null
    error.value = caught instanceof Error ? caught.message : String(caught)
  }
}

async function verifyPayload() {
  const displayedReview = review.value
  const consent = payloadConsentToken.value
  if (!displayedReview || !consent) {
    error.value = 'CREDENTIAL_PAYLOAD_CONSENT_REQUIRED'
    return
  }
  busy.value = true
  error.value = ''
  const revision = reviewRevision
  const expected = {
    issuer: issuer.value,
    subject: subject.value,
    schemaUid: schemaUid.value.toLowerCase(),
  }
  try {
    const profile = await getActiveNetworkProfile()
    assertLinkProfile(linkedProfileId.value || undefined, profile.profileId)
    const loaded = await loadExactMetadata({
      ...expected,
      profileId: profile.profileId,
      requireSchema: true,
    })
    if (revision !== reviewRevision) throw new Error('CREDENTIAL_REVIEW_CHANGED_DURING_LOAD')
    assertPayloadFetchConsentCurrent(loaded.credentialReview, consent)
    if (!loaded.schema) throw new Error('CREDENTIAL_SCHEMA_UNAVAILABLE')

    // Generation/profile/link checks happen above, before this browser contacts the issuer host.
    const localReview = await loadCredentialReviewWithConsent({
      credential: await getCredential(
        expected.issuer,
        expected.subject,
        expected.schemaUid,
        profile.profileId,
      ),
      report: await verify({ ...expected, resolvePayload: false }, profile.profileId),
      ...expected,
      schema: loaded.schema.resolved,
      consent,
    })
    if (revision !== reviewRevision) throw new Error('CREDENTIAL_REVIEW_CHANGED_DURING_FETCH')
    if (!localReview.payload) throw new Error('CREDENTIAL_PAYLOAD_REVIEW_FAILED')

    // The API validates the parsed object only; it never receives a request to resolve the URI.
    const verifiedReport = await verify(
      { ...expected, payload: localReview.payload },
      profile.profileId,
    )
    const verifiedMetadata = await loadCredentialReview({
      credential: await getCredential(
        expected.issuer,
        expected.subject,
        expected.schemaUid,
        profile.profileId,
      ),
      report: verifiedReport,
      ...expected,
    })
    assertPayloadFetchConsentCurrent(verifiedMetadata, consent)
    if (verifiedMetadata.generationId !== displayedReview.generationId) {
      throw new Error('CREDENTIAL_GENERATION_CHANGED_DURING_VERIFICATION')
    }
    review.value = {
      ...verifiedMetadata,
      payload: localReview.payload,
      claims: localReview.claims,
      payloadDigestHex: localReview.payloadDigestHex,
      payloadByteLength: localReview.payloadByteLength,
      payloadCheckedAt: localReview.payloadCheckedAt,
    }
    schemaDetail.value = loaded.schema
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="section-wrap form-page">
    <p class="eyebrow">Verifier</p>
    <h1>{{ $t('verify.title') }}</h1>
    <p class="lead">{{ $t('verify.description') }}</p>
    <div class="form-card form-grid">
      <label for="verify-issuer">Issuer</label>
      <input id="verify-issuer" v-model.trim="issuer" placeholder="r…" :disabled="busy" />
      <label for="verify-subject">Subject</label>
      <input id="verify-subject" v-model.trim="subject" placeholder="r…" :disabled="busy" />
      <label for="verify-schema">Schema UID</label>
      <input
        id="verify-schema"
        v-model.trim="schemaUid"
        pattern="[0-9a-fA-F]{64}"
        :disabled="busy"
      />
      <button class="button" type="button" :disabled="busy" @click="loadMetadata">
        {{ busy ? $t('common.working') : $t('verify.loadMetadata') }}
      </button>
    </div>
    <div v-if="error" class="error-box">{{ error }}</div>

    <article v-if="review" class="form-card">
      <h2>{{ $t('verify.metadata') }}</h2>
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
        <dt>Generation ID</dt>
        <dd>
          <code>{{ review.generationId }}</code>
        </dd>
        <dt>URI</dt>
        <dd>
          <code>{{ review.uri ?? '—' }}</code>
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
        <p class="verification-note">{{ $t('verify.trustNote') }}</p>
      </div>

      <div v-if="!review.payload" class="warning-box">
        <p>{{ $t('verify.payloadConsentIntro', { host: payloadHost ?? '—' }) }}</p>
        <label v-if="payloadHost">
          <input
            type="checkbox"
            :checked="payloadConsent"
            :disabled="busy"
            @change="setPayloadConsent(($event.target as HTMLInputElement).checked)"
          />
          {{ $t('verify.payloadConsent') }}
        </label>
        <button
          class="button secondary"
          type="button"
          :disabled="busy || !payloadConsent"
          @click="verifyPayload"
        >
          {{ $t('verify.fetch') }}
        </button>
      </div>
      <div v-else class="success-box">
        {{ $t('verify.payloadChecked', { bytes: review.payloadByteLength ?? 0 }) }}
        <code>{{ review.payloadDigestHex }}</code>
      </div>
    </article>
  </section>
</template>
