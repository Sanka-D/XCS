# Network profiles

`testnet.example.json` is a documentation template, not a valid runtime profile. Its registry address and activation values are deliberate placeholders, so services must reject it for live indexing or transaction construction.

For a real profile:

1. create and fund a dedicated Testnet account;
2. set a regular key whose secret is provably unavailable;
3. disable the master key;
4. independently verify those ledger objects and that the account can only receive funds;
5. choose the first post-ceremony validated ledger as the XCS activation boundary;
6. copy the example to `testnet.json` and replace every placeholder;
7. publish the exact file and its SHA-256 digest.

Never reuse a Testnet profile after a network reset and never copy its registry address into a Mainnet profile.
