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
