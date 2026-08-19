# ADR 0001: XCS v0.1 protocol boundaries

Status: Accepted

XCS v0.1 uses a blackholed one-drop registry, complete compact schemas in Payment memos, one parent without override, schema UID bytes as native `CredentialType`, and a small JCS payload envelope bound through IPFS or HTTPS SHA-256.

Any issuer may reuse any schema. Trust remains a verifier policy. The public API supports only exact Credential lookup. Keys remain exclusively in entity-controlled wallets or signers.

These decisions favor deterministic interoperability and a non-custodial alpha. Multiple active instances, W3C VC, private payload workflows, issuer delegation, multiple inheritance, batch issuance and Mainnet deployment are deferred.
