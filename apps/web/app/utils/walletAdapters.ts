import {
  CrossmarkAdapter,
  GemWalletAdapter,
  LedgerAdapter,
  MetaMaskSnapAdapter,
  OtsuAdapter,
  WalletConnectAdapter,
  XamanAdapter,
  XyraAdapter,
  adapterSupports,
  type WalletAdapter,
} from 'xrpl-connect'

export interface XrplConnectAdapterConfig {
  readonly xamanApiKey?: string | undefined
  readonly walletConnectProjectId?: string | undefined
}

function configuredValue(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized ? normalized : undefined
}

/**
 * The published 1.0.0 RC reports Otsu as available in every browser. Keep the
 * adapter surface intact while applying the same provider marker check already
 * used by its connect path (fixed upstream after the RC).
 */
class XcsOtsuAdapter extends OtsuAdapter {
  public override async isAvailable(): Promise<boolean> {
    const runtime = globalThis as typeof globalThis & {
      xrpl?: { readonly isOtsu?: boolean }
    }
    return runtime.xrpl?.isOtsu === true
  }
}

/**
 * Register every xrpl-connect adapter that can be initialized with the
 * deployment's public configuration. Xaman and WalletConnect need public app
 * identifiers; the other adapters are self-contained and detect availability
 * in the browser.
 */
export function createXrplConnectAdapters(config: XrplConnectAdapterConfig = {}): WalletAdapter[] {
  const xamanApiKey = configuredValue(config.xamanApiKey)
  const walletConnectProjectId = configuredValue(config.walletConnectProjectId)
  const adapters: WalletAdapter[] = [
    ...(xamanApiKey ? [new XamanAdapter({ apiKey: xamanApiKey })] : []),
    new CrossmarkAdapter(),
    new GemWalletAdapter(),
    ...(walletConnectProjectId
      ? [
          new WalletConnectAdapter({
            projectId: walletConnectProjectId,
            useModal: true,
            modalMode: 'always',
            themeMode: 'light',
          }),
        ]
      : []),
    new LedgerAdapter(),
    new XyraAdapter(),
    new XcsOtsuAdapter(),
    new MetaMaskSnapAdapter(),
  ]

  // XCS never falls back to signAndSubmit: the application must validate and
  // persist the signed transaction before it owns the only submission effect.
  return adapters.filter((adapter) => adapterSupports(adapter, 'sign'))
}
