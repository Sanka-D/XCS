# XCS Testnet web app

The Nuxt application is a non-custodial Testnet playground. It constructs and autofills an XRPL transaction, shows those exact final fields to the user, then asks an external wallet to sign without submitting. The private key or seed never enters the application.

## Wallet support

The alpha deliberately enables only `CrossmarkAdapter` and `GemWalletAdapter` from `xrpl-connect@0.8.2`. Xaman is disabled because this flow requires a complete `tx_blob` from a sign-only request before the application controls submission and recovery.

Crossmark and GemWallet currently return `hash: ""` from their sign-only adapters. The application derives the transaction hash from `tx_blob` with `xrpl.hashes.hashSignedTx`. If a future adapter returns a non-empty hash, it must exactly match the derived value or the operation is rejected before submission.

The adapters still require real browser-extension testing for each native Credential transaction type. Unit tests cover the application-side blob, hash, persistence, and validation invariants; they do not prove that a particular released wallet UI supports XLS-70 transactions.

## Network safety

Set:

```bash
NUXT_API_BASE_URL=http://api:3001
NUXT_PUBLIC_API_BASE_URL=https://xcs-api.example
NUXT_PUBLIC_RPC_URL=wss://s.altnet.rippletest.net:51233
NUXT_PUBLIC_PROFILE_ID=xrpl-testnet-xcs-v0.1
```

`NUXT_API_BASE_URL` is the server-side/SSR endpoint; in Compose it is `http://api:3001`.
`NUXT_PUBLIC_API_BASE_URL` is exposed to the browser and must therefore be browser-reachable. The
profile is fetched from the XCS API, parsed by the SDK, and matched against the RPC server's reported
`network_id` before autofill and again before signing or recovery. This alpha rejects profiles other
than XRPL Testnet (`networkId: 1`). If `NUXT_PUBLIC_PROFILE_ID` is omitted, exactly one Testnet
profile must be returned by the API.

## Durable submission journal

Signed transaction blobs are stored in the origin's IndexedDB database `xcs-wallet-journal` before the first submit call. SDK journal stages are retained with the hash, `LastLedgerSequence`, profile, and XRPL result. The `/operations` page can safely resubmit and reconcile `signed`, `submitted`, or `pending` operations by hash. The blob is removed from the local record as soon as the operation becomes `validated`, `expired`, or `failed`. A transaction is presented as successful only when the server reports both `validated: true` and `TransactionResult: tesSUCCESS`.

The journal contains no seed or private key. A signed blob can nevertheless be relayed until its sequence or `LastLedgerSequence` makes it unusable, so the application must maintain a strict Content Security Policy and treat same-origin script execution as a trust boundary. Clearing browser site data removes the local recovery journal.
