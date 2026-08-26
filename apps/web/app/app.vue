<script setup lang="ts">
const { locale, locales, setLocale } = useI18n()
const clientReady = ref(false)

const availableLocales = computed(() =>
  locales.value.map((item) => (typeof item === 'string' ? { code: item, name: item } : item)),
)

onMounted(() => {
  clientReady.value = true
})
</script>

<template>
  <div class="app-shell" :data-client-ready="clientReady ? 'true' : 'false'">
    <header class="site-header">
      <NuxtLinkLocale class="brand" to="/" aria-label="XCS home">
        <span class="brand-mark">X</span>
        <span>XCS <small>Testnet alpha</small></span>
      </NuxtLinkLocale>

      <nav class="primary-nav" :aria-label="$t('nav.main')">
        <NuxtLinkLocale to="/">{{ $t('nav.explorer') }}</NuxtLinkLocale>
        <NuxtLinkLocale to="/studio">{{ $t('nav.studio') }}</NuxtLinkLocale>
        <NuxtLinkLocale to="/developers">{{ $t('nav.developers') }}</NuxtLinkLocale>
      </nav>

      <div class="header-actions">
        <ExplorerSearch compact />
        <label class="sr-only" for="locale">{{ $t('nav.language') }}</label>
        <select
          id="locale"
          :value="locale"
          class="locale-select"
          @change="setLocale(($event.target as HTMLSelectElement).value as 'fr' | 'en')"
        >
          <option v-for="item in availableLocales" :key="item.code" :value="item.code">
            {{ item.name }}
          </option>
        </select>
        <WalletButton />
      </div>
    </header>

    <div class="testnet-banner" role="status">{{ $t('common.testnetWarning') }}</div>

    <main>
      <NuxtPage />
    </main>

    <footer class="site-footer">
      <p>{{ $t('footer.summary') }}</p>
      <nav :aria-label="$t('footer.navigation')">
        <NuxtLinkLocale to="/schemas">{{ $t('nav.schemas') }}</NuxtLinkLocale>
        <NuxtLinkLocale to="/activity">{{ $t('nav.activity') }}</NuxtLinkLocale>
        <NuxtLinkLocale to="/status">{{ $t('nav.status') }}</NuxtLinkLocale>
        <NuxtLinkLocale to="/verify">{{ $t('nav.verify') }}</NuxtLinkLocale>
        <a href="https://github.com/XRPLF/XRPL-Standards" rel="noreferrer">XRPL Standards</a>
      </nav>
    </footer>
  </div>
</template>
