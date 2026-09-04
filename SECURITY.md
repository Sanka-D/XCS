# Security policy

XCS v0.1 is pre-release Testnet software. It has not completed an external security audit and must not be treated as production custody or identity infrastructure.

## Reporting

Report a vulnerability privately to the repository maintainers. Include the affected version, reproduction conditions and potential impact. Do not include private keys, seeds or personal data in a report.

## Security boundaries

- XCS constructs transactions but does not control signing keys.
- SDK submission decodes the signed blob with `xrpl.js`, verifies its XRPL single-signature, rejects
  multisign and any mutation of reviewed fields, then reconciles submission by transaction hash.
- Hosts can persist the validated signed blob and repeat readiness checks immediately before relay.
- Portable schema catalog relation closures are bounded to 256 unique entries at transport, API
  retrieval and independent verification boundaries without changing on-ledger schema validity.
- Catalog parsing proves internal consistency only; the portable bundle has no XRPL inclusion proof.
  On-ledger claims require a trusted authoritative source/checkpoint or independently verified
  validated-ledger transaction and metadata evidence.
- A subject accepting a Credential acknowledges it; acceptance does not prove its claims.
- Payload integrity proves that retrieved bytes match the issuer-bound URI, not that the issuer is trustworthy.
- Trust decisions remain local to the verifier.
- Server-side URL resolution is disabled by default and must retain the restrictions in the threat model when enabled.
- Database provisioning is supported only on a dedicated PostgreSQL cluster. It quarantines runtime
  roles as `NOLOGIN`, removes delegated memberships, rejects every cluster-wide owner dependency,
  denies Large Object and unused advisory functions, and terminates non-administrator sessions.

See [`docs/threat-model.md`](./docs/threat-model.md) for implemented controls and residual risks.
