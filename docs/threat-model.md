# Threat model

## Assets and trust boundaries

XCS protects deterministic schema identifiers, ledger-derived lifecycle state, payload integrity and accurate presentation of issuer trust. XRPL signing keys remain outside the system and are the issuer or subject's responsibility.

Untrusted inputs include schema memos, all XRPL metadata, API path/query/body values, fetched HTTPS/IPFS bytes, wallet responses and deployment configuration.

## Implemented controls

| Threat                                 | Control                                                                                                |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Ambiguous JSON or hash divergence      | Strict parser, duplicate-key rejection, I-JSON checks, JCS and cross-language vectors                  |
| Forged payload content                 | URI-bound SHA-256/CID verification plus envelope linkage                                               |
| False issuer endorsement               | State, payload and trust reported separately                                                           |
| Seed/key disclosure                    | No seed API; injected wallet signer; redacted errors and logs                                          |
| SSRF                                   | Fetch disabled by default; on-ledger URI only; HTTPS; DNS/IP checks; redirect, timeout and size limits |
| History gaps or inconsistent providers | Ledger/hash checkpoint, parent continuity and fail-closed readiness                                    |
| Duplicate/replayed ingestion           | Unique event keys and transactional, idempotent projections                                            |
| Account privacy amplification          | Exact Credential lookup only; no public account-wide listing                                           |
| Public pin abuse                       | Testnet-only, wallet challenge, IP/address rate limit and payload quota                                |

## Residual risks

- Wallet applications may not yet understand every Credential transaction type; only verified adapters are exposed.
- A valid domain proof or allowlist entry does not prove individual claims.
- Demo pinning blocks common PII-shaped field names but cannot recognize sensitive values under arbitrary schema fields.
- Public IPFS content cannot be reliably deleted after another node retrieves it.
- A blackholed registry prevents governance capture but cannot enforce anti-spam moderation.
- The alpha has not received an independent security audit and is not approved for PII or Mainnet use.
