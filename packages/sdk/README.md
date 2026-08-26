# `@xcs-protocol/sdk`

Signer-agnostic builders and reliable-submission helpers for XCS v0.1.

This alpha package has not yet been published. Maintainers can validate the exact local tarballs
without network access by running `pnpm package:smoke` at the repository root. Passing
`--output-dir <directory>` preserves the three validated tarballs for a release workflow; the
default command removes its temporary artifacts.

The SDK intentionally exposes no API that accepts an XRPL seed or private key. Wallets implement the
small `Signer` interface and receive an autofilled, unsigned transaction containing a bounded
`LastLedgerSequence`. A signed blob can also be submitted directly when it was produced out of
process.

Use `prepareSignAndSubmit` for a headless flow. A UI that previews the final autofilled transaction
must call `autofillXcsTransaction`, display the returned transaction, then pass that exact object to
`signPreparedAndSubmit`; the latter does not autofill a second time and rejects wallet mutations.

The operation journal never contains the signed blob, full transaction, private material, or
credential payload. Persist it in the host application to reconcile a transaction hash after an
ambiguous network failure.

Because the journal intentionally excludes the signed blob, browser and service hosts can persist
recovery material with `onValidatedSignature`. This hook runs only after the SDK has verified the
wallet-reported hash, decoded the signed blob, and proved that all reviewed transaction fields are
unchanged; it still runs before submission. The Nuxt reference application uses this boundary to
write the blob to IndexedDB, erases it for terminal operations after reconciliation, and retains
only sanitized status metadata.

The XRPL protocol permits a 256-byte Credential URI, and the builders preserve that limit. The
locked `xrpl.js` 5.0.0 validator mistakenly applies its 256-character limit to the hexadecimal JSON
field, so SDK submission helpers currently reject URIs above 128 bytes with `XCS_SDK_INVALID_URI`.
Use an IPFS raw CID or a shorter HTTPS base URL until the upstream validator is corrected.

Schema UIDs cannot be predicted before inclusion. `deriveSchemaUid` requires a validated ledger
hash, ledger index, transaction index, publisher, network ID, and a `tesSUCCESS` result.

`buildSchemaRegistrationPayment` returns `memoByteLength`, the exact number of serialized Memo-object
bytes counted by `rippled`. Use `measureSchemaRegistrationMemoBytes(canonicalSchema)` when previewing
an already canonicalized schema; `assertMemoFits` applies the same measurement against the
1,024-byte XRPL memo limit. This count includes each `Memo` object header, its variable-length field
prefixes and its object terminator. It excludes the outer `Memos` field header (`F9`) and array
terminator (`F1`), because `rippled` excludes those two bytes from this limit even though they remain
present in the transaction serialized by `xrpl.js`.
