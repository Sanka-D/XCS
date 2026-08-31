<template>
  <article class="section-wrap prose-page">
    <p class="eyebrow">XCS 0.1</p>
    <h1>{{ $t('learn.title') }}</h1>
    <p class="lead">{{ $t('learn.intro') }}</p>

    <h2>{{ $t('learn.actorsTitle') }}</h2>
    <div class="definition-grid">
      <section>
        <h3>Publisher</h3>
        <p>{{ $t('learn.publisher') }}</p>
      </section>
      <section>
        <h3>Issuer</h3>
        <p>{{ $t('learn.issuer') }}</p>
      </section>
      <section>
        <h3>Subject</h3>
        <p>{{ $t('learn.subject') }}</p>
      </section>
      <section>
        <h3>Verifier</h3>
        <p>{{ $t('learn.verifier') }}</p>
      </section>
      <section>
        <h3>Indexer</h3>
        <p>{{ $t('learn.indexer') }}</p>
      </section>
      <section>
        <h3>Registry</h3>
        <p>{{ $t('learn.registry') }}</p>
      </section>
    </div>

    <h2>{{ $t('learn.verificationTitle') }}</h2>
    <p>{{ $t('learn.verification') }}</p>
    <div class="status-examples">
      <StatusPill value="active" />
      <StatusPill value="valid" />
      <StatusPill value="unknown" />
    </div>
  </article>
</template>
