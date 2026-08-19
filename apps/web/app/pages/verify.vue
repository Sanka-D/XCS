<script setup lang="ts">
const { verify } = useXcsApi()
const issuer = ref('')
const subject = ref('')
const schemaUid = ref('')
const resolvePayload = ref(true)
const busy = ref(false)
const error = ref('')
const report = ref<Awaited<ReturnType<typeof verify>> | null>(null)

async function runVerification() {
  busy.value = true
  error.value = ''
  report.value = null
  try {
    report.value = await verify({
      issuer: issuer.value,
      subject: subject.value,
      schemaUid: schemaUid.value,
      resolvePayload: resolvePayload.value,
    })
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
      <label for="verify-issuer">Issuer</label
      ><input id="verify-issuer" v-model.trim="issuer" placeholder="r…" />
      <label for="verify-subject">Subject</label
      ><input id="verify-subject" v-model.trim="subject" placeholder="r…" />
      <label for="verify-schema">Schema UID</label
      ><input id="verify-schema" v-model.trim="schemaUid" pattern="[0-9a-fA-F]{64}" />
      <label class="check-row"
        ><input v-model="resolvePayload" type="checkbox" />{{ $t('verify.fetch') }}</label
      >
      <button class="button" type="button" :disabled="busy" @click="runVerification">
        {{ busy ? $t('common.working') : $t('verify.run') }}
      </button>
    </div>
    <div v-if="error" class="error-box">{{ error }}</div>
    <div v-if="report" class="verification-grid">
      <article>
        <span>{{ $t('verify.onChain') }}</span
        ><StatusPill :value="report.onChain" />
      </article>
      <article>
        <span>{{ $t('verify.schema') }}</span
        ><StatusPill :value="report.schema" />
      </article>
      <article>
        <span>{{ $t('verify.payload') }}</span
        ><StatusPill :value="report.payload" />
      </article>
      <article>
        <span>{{ $t('verify.trust') }}</span
        ><StatusPill :value="report.issuerTrust" />
      </article>
      <p class="verification-note">{{ $t('verify.trustNote') }}</p>
    </div>
  </section>
</template>
