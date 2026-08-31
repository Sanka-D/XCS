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

`assertXcsTransactionSemantics` is the profile-bound transaction gate. It accepts only an XCS schema
registration `Payment` addressed to the profile registry for the exact registration amount, or a
native `CredentialCreate`, `CredentialAccept` or `CredentialDelete` carrying a valid XCS schema UID.
It also enforces the operation-specific address, canonical memo, payment-flag and integrity-bound URI
rules after generic XRPL validation.

For an offline or HSM-backed signer, call `bindPreparedTransactionContext` **before** autofill. It
adds exactly one `xcs:prepared` Memo whose digest commits to the profile ID, SHA-256 of the exact
reviewed profile-file bytes, and authoritative indexer checkpoint. The wallet therefore signs this
context together with the final `Fee`, `Sequence` and `LastLedgerSequence` produced by autofill.
`createPreparedTransactionEnvelope` then creates the `xcs-prepared-transaction/1` artifact containing
that autofilled transaction and its canonical digest.

After signing, call `assertPreparedEnvelopeMatchesProfile`, `assertSignedBlobMatchesPrepared`,
`assertReadinessAdvancesPreparedCheckpoint` and `assertTransactionNotExpired` before
`submitSignedTransaction`. Blob validation requires a cryptographically valid XRPL single-signature
and rejects every non-signature mutation; multisigning is deliberately outside this alpha flow. The
final readiness check must run before the `ledger_current` expiry check and both must complete before
the first relay side effect. None of these APIs accepts or exposes a seed.

The companion CLI implements the complete sequence as `xcs tx prepare` and
`xcs tx submit --prepared`. For every `Credential*` operation, it also downloads and strictly
validates the referenced `xcs-schema-catalog/1` bundle before preparation. An SDK host implementing
the same workflow must establish that catalog evidence itself; the deterministic SDK does not
choose or trust an API endpoint on the caller's behalf.

`verifyNetworkProfileActivation` independently reads the immutable activation ledger from a
history-capable `rippled` server after checking network ID and amendment support. Submission-only
endpoints that do not retain the activation range can continue to use `connectAndValidateNetwork`,
but they cannot establish the historical anchor by themselves.

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
