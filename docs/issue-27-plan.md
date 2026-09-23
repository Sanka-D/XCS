# Issue 27 — XRP Identity and wallet linking

Baseline: `ee39ba5`. Tracks [#27](https://github.com/XRPL-Commons/XCS/issues/27).

## Goal and boundaries

Add an optional XRP Identity authorization-code/PKCE login, PostgreSQL sessions, current role guards
and non-transactional wallet ownership proofs. Keep existing public discovery and wallet transaction
flows available. No issuer/verifier auto-approval, admin override, invitation or private delivery flow.

## Evidence and decisions

- The current Identity discovery document and its repository identify `https://account.xrpl.in`
  as issuer; `identity.xrpl.in` in the issue no longer resolves in this environment.
- Commons' `starter.2026.04/modules/1.auth/server/providers/xrplIdentity` uses `openid-client`.
  Reuse that library and code-flow pattern, but bind XCS users by verified issuer/subject, not email;
  validate ID-token signatures and nonce, and do not import provider roles into XCS approvals.
- Existing `app_*` tables have no runtime grants or session tables. Add an isolated `xcs_app` pool
  and a forward migration. Historical migrations and current public pools remain unchanged.
- New accounts receive only the personal recipient role. Issuer/verifier access comes from the
  current approval of an active organization managed by that account.
- Default sessions: 30 minutes idle, at most 8 hours since sign-in; refresh rotates the opaque
  cookie and CSRF value. Logout ends the current XCS session, not every Identity application.
- Secure, httpOnly, SameSite=Lax cookies; no provider tokens or session bearer in browser storage.
  Browser tests use an isolated provider and storage adapter only in explicit development E2E mode.
- Real OIDC client registration/secrets remain an external prerequisite, requested from the user.
  No credentials are copied into the repository or conversation.

## Milestones

1. **In progress:** verify provider and wallet contracts; add auth schema and least-privilege role.
2. **Pending:** implement OIDC/session routes, CSRF, live permission guards and atomic wallet proofs.
3. **Pending:** add bilingual account screens and navigation, with explicit unsupported-wallet states.
4. **Pending:** test provider errors, session expiry/revocation, denied roles, invalid/replayed proofs,
   restricted database grants, browser reload/logout and unchanged public routes.
5. **Pending:** synchronize configuration, registration/deployment runbook and verification evidence.

## Verification and rollout

Run focused unit/HTTP tests first, then isolated PostgreSQL tests, static checks and a production
build. Exercise login/reload/link/unlink/logout with a stub OIDC provider through the browser.
Render relevant Compose overlays and build/smoke the affected production image as required.
Real provider sign-in and real extension approval are separate checks, never inferred from stubs.

Apply additive migrations before enabling authentication, provision the optional application role,
then configure its private URL and OIDC client. Disabling auth restores the current public-only
deployment; retain application data and use forward fixes rather than destructive down migrations.
