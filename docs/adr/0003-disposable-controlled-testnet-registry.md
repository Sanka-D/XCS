# ADR 0003: Disposable controlled-registry exception for a private Testnet pilot

Status: Accepted

Date: 2026-08-30

## Context

XCS v0.1 and the public Testnet beta require a dedicated blackholed registry. Blackholing is
irreversible, so using the beta registry while the first Commons deployment, wallet adapters and
operational procedures are still being exercised would either perform the ceremony too early or
encourage reuse of pilot state as beta evidence.

Commons therefore needs one short-lived private staging environment in which an operator can still
control the registry account. This changes the deployment trust assumption, not the XCS v0.1
schema, UID, payload or lifecycle rules. Endpoint URLs remain deployment configuration and are not
part of the network profile identity.

## Decision

The only controlled-registry profile is
`commons-testnet-xcs-v0.1-controlled-pilot`. It uses XRPL Testnet network ID `1`, a dedicated
registry account and a dedicated fresh PostgreSQL database. The profile file is named
`config/networks/commons-testnet-xcs-v0.1-controlled-pilot.json`; it is created only after the real
registry address and activation ledger index/hash are known. Placeholder registry or activation
values are never deployable.

The indexer remains fail-closed and uses the blackhole policy by default. The controlled exception
requires both exact values:

```dotenv
XCS_REGISTRY_POLICY=controlled-testnet-pilot
XCS_CONTROLLED_PILOT_ACK=DISPOSABLE_PROFILE_AND_DATABASE
```

The exception is accepted only for network ID `1` and a profile ID ending in
`-controlled-pilot`. It still requires validated `account_info` and every `account_objects` page to
match the configured registry and exact activation ledger index/hash. The registry must be able to
receive the one-drop registration Payment: `DepositAuth` and `RequireDestTag` remain forbidden.
Unlike the normal policy, the pilot may have an enabled master key, any or no regular key, a
SignerList, and incoming or outgoing delegates. Those controls are an explicit pilot trust risk,
not evidence of a blackholed registry.

The deployment is private staging, limited to named pilot participants and disposable Testnet
accounts. It must not process production data, personal data, production signing keys or a public
issuer workload. Its PostgreSQL volume must be new and must never be a legacy MVP, another XCS
profile or future beta database.

The pilot source roles are:

- primary authority input: a Commons-operated, complete-history `rippled` WSS endpoint supplied to
  operators out of band;
- secondary comparison input: Ripple's public Testnet endpoint
  `wss://s.altnet.rippletest.net:51233`;
- browser-only transaction submission: XRPL Labs' public Testnet endpoint
  `wss://testnet.xrpl-labs.com/`.

The two public endpoints are convenience services with no XCS availability, retention or support
SLA. The browser endpoint is never an authoritative verification source. The secondary endpoint
must pass the same network, activation-history and exact-ledger quorum checks as the primary; its
public availability does not prove durable history or satisfy the beta operations gate.

Before any public beta, Commons must create a different registry account, blackhole and
independently audit it under the normal policy, publish a new immutable profile ID and activation
boundary, and initialize another fresh PostgreSQL database. The controlled registry, profile,
events, projection and database are never renamed, edited or promoted into that beta. Pilot
payloads and accounts remain disposable Testnet evidence only.

## Consequences

- Commons can validate deployment and wallet operations before an irreversible registry ceremony.
- Anyone relying on this pilot must trust the registry controller not to change account controls,
  impede registrations or exercise signer/delegate authority. Past validated ledger data remains
  public, but this is not the neutrality guarantee of a blackholed registry.
- Pilot runs can provide staging and usability evidence, but they do not close the immutable-profile,
  provider-SLA, public-beta or Mainnet gates.
- A controlled-pilot profile without its explicit policy and exact acknowledgement is rejected
  before any database or ledger operation. Normal profiles retain the fail-closed `blackholed`
  default. Changing profile fields still requires a new profile ID and fresh projection as usual.

## Rejected alternatives

- Blackholing the future beta registry before staging is complete makes an operational mistake
  irreversible.
- Blackholing the controlled account after the pilot and reusing its profile would reinterpret a
  period that had different trust assumptions.
- Reusing its database for beta would mix controlled-period evidence with a different immutable
  profile and defeat reproducible replay.
