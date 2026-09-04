# `@xcs-protocol/sdk`

XRPL transaction builders and submission helpers for XCS v0.1.

The package has three responsibilities:

- build schema-registration `Payment` transactions and native XRPL
  `CredentialCreate`, `CredentialAccept`, and `CredentialDelete` transactions;
- validate that a transaction has XCS semantics for a network profile;
- autofill, sign, submit, and reconcile a transaction without ever handling a seed or private key.

Protocol data validation, canonical JSON, payload URIs, schema resolution, and UID derivation live in
`@xcs-protocol/core`. XRPL serialization, address validation, signing, and submission use `xrpl.js`.

## Transaction flow

Use `prepareSignAndSubmit` for a headless signer. A UI that previews the final transaction should:

1. call `autofillXcsTransaction`;
2. display the returned transaction to the user;
3. pass that exact transaction to `signPreparedAndSubmit`.

`signPreparedAndSubmit` validates the wallet result, rejects non-signature mutations, and reconciles
ambiguous submission results. The `Signer` interface receives unsigned transaction JSON and returns
only a signed blob and transaction hash. Hosts integrating a wallet that refreshes
`LastLedgerSequence` may explicitly enable `allowSignerLastLedgerSequenceRefresh`; every other
non-signature field remains bound to the reviewed transaction, and submission uses the signed expiry
value.

The optional operation journal records hashes and lifecycle stages, never signed blobs, payloads,
seeds, or private keys. Browser and service hosts can persist a validated signed blob through
`onValidatedSignature` before the first relay attempt. Volatile checks belong in `beforeSubmit`; if
that hook rejects, the SDK keeps the journal stage `signed` so the host's persisted artifact remains
recoverable instead of being mislabeled as a terminal signing failure.

## Network safety

`connectAndValidateNetwork` checks the connected network ID, required amendment, and profile
activation anchor. `verifyNetworkProfileActivation` additionally reads the immutable activation
ledger and therefore requires a history-capable rippled endpoint.

`assertXcsTransactionSemantics` accepts only:

- the exact schema registry `Payment`, amount, flags, and canonical memo defined by the profile;
- native credential transactions containing a valid XCS schema UID and, for creation, an
  integrity-bound payload URI.

Schema UIDs cannot be known before inclusion. `deriveSchemaUid` requires validated ledger and
transaction coordinates with a `tesSUCCESS` result.

## Payload URI note

XRPL permits a 256-byte Credential URI. The locked `xrpl.js` 5.0.0 validator currently applies its
limit to the hexadecimal JSON representation, so submission helpers reject URIs above 128 bytes.
Prefer a raw CIDv1 IPFS URI or a short HTTPS URL until that upstream behavior changes.
