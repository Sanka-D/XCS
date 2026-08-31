# Network profiles

`testnet.example.json` is a documentation template, not a valid runtime profile. Its registry address and activation values are deliberate placeholders, so services must reject it for live indexing or transaction construction.

For a real profile:

1. create and fund a dedicated Testnet account;
2. set the regular key to the XRPL `ACCOUNT_ZERO` address
   (`rrrrrrrrrrrrrrrrrrrrrhoLvTp`, recommended) or `ACCOUNT_ONE`
   (`rrrrrrrrrrrrrrrrrrrrBZbvji`); no other address or claim that a secret is unavailable satisfies
   the XCS blackhole policy;
3. disable the master key without enabling DepositAuth or RequireDestTag;
4. independently verify the AccountRoot, absence of outgoing Delegate permissions and SignerList,
   and that the account can receive the one-drop registration Payment without any destination tag;
5. choose the first post-ceremony validated ledger as the XCS activation boundary;
6. copy the example to `testnet.json` and replace every placeholder;
7. publish the exact file and its SHA-256 digest.

Never reuse a `profileId` after a Testnet reset or after changing any profile field, and never copy
its registry address into a Mainnet profile. Publish a new profile and activation boundary instead
of editing the prior profile in place.

## Commons private controlled pilot

[`ADR 0003`](../../docs/adr/0003-disposable-controlled-testnet-registry.md) defines one
non-normative deployment exception before the blackholed public beta. Its exact profile ID is
`commons-testnet-xcs-v0.1-controlled-pilot`, its network ID is `1`, and its operator-created file is
`commons-testnet-xcs-v0.1-controlled-pilot.json` in this directory. Copy the example only after the
dedicated registry exists, then replace the registry address and activation index/hash with real
validated-ledger values. Do not commit a placeholder as though it were a live profile.

This registry remains controlled and disposable. It may have an enabled master key, any or no
regular key, a SignerList, and delegates, but it must be able to receive the one-drop Payment:
`DepositAuth` and `RequireDestTag` are forbidden. The indexer accepts that weaker state only when
both explicit acknowledgements are present:

```dotenv
XCS_REGISTRY_POLICY=controlled-testnet-pilot
XCS_CONTROLLED_PILOT_ACK=DISPOSABLE_PROFILE_AND_DATABASE
```

Use a new empty PostgreSQL database and restrict the deployment to private staging. Before a public
beta, create and independently audit a different blackholed registry, publish a different profile
ID and activation boundary, and rebuild into another fresh database. Never blackhole and rename the
controlled profile, and never promote its projection.
