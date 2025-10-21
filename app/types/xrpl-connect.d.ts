declare namespace JSX {
  interface IntrinsicElements {
    'xrpl-wallet-connector': XrplWalletConnectorProps
  }
}

interface XrplWalletConnectorProps
  extends React.DetailedHTMLProps<
    React.HTMLAttributes<HTMLElement>,
    HTMLElement
  > {
  'background-color'?: string
  'text-color'?: string
  'primary-color'?: string
  'primary-wallet'?: string
  'font-family'?: string
  ref?: any
  setWalletManager?: (manager: any) => void
  open?: () => void
}
