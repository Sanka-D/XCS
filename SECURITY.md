# Security policy

XCS v0.1 is pre-release Testnet software. It has not completed an external security audit and must not be treated as production custody or identity infrastructure.

## Reporting

Report a vulnerability privately to the repository maintainers. Include the affected version, reproduction conditions and potential impact. Do not include private keys, seeds or personal data in a report.

## Security boundaries

- XCS constructs transactions but does not control signing keys.
- A subject accepting a Credential acknowledges it; acceptance does not prove its claims.
- Payload integrity proves that retrieved bytes match the issuer-bound URI, not that the issuer is trustworthy.
- Trust decisions remain local to the verifier.
- Server-side URL resolution is disabled by default and must retain the restrictions in the threat model when enabled.

See [`docs/threat-model.md`](./docs/threat-model.md) for implemented controls and residual risks.
