# Runbook: the registry blackhole ceremony

This runbook walks an operator through creating the XCS **registry account** on XRPL Testnet,
blackholing it, verifying the result independently, and emitting the network profile the indexer and
the web application both read.

[`config/networks/README.md`](../../config/networks/README.md) is the authority on the procedure.
[`apps/indexer/src/profile-preflight.ts`](../../apps/indexer/src/profile-preflight.ts) is the
authority on what counts as a valid result, and the script imports those checks rather than
restating them, so the script and the indexer cannot disagree.

## What the registry account is for

Publishers register an XCS schema by sending a **one-drop `Payment` with no destination tag** to the
registry address, carrying the schema definition in a memo. The registry is a destination and an
ordering anchor, nothing more. Nobody should be able to sign for it, because a signer could send
transactions from it, delete it, or set flags that make registration impossible.

So the account is _blackholed_: its regular key is set to XRPL `ACCOUNT_ZERO`
(`rrrrrrrrrrrrrrrrrrrrrhoLvTp`), an address whose secret key does not exist, and then its master key
is disabled. `DepositAuth` and `RequireDestTag` must stay off, or the one-drop registration payment
could never arrive.

## Before you start

- The script runs on **XRPL Testnet only**. It refuses network id 0 (Mainnet) outright and refuses
  every other network id. Before any transaction it also reads live `server_info` and aborts if the
  connected server's `network_id` is not the one the ceremony targets.
- Run every stage from the indexer workspace, so dependencies resolve from that package:

  ```sh
  pnpm --dir apps/indexer ceremony <stage>
  ```

  If you need to install first, per-app pnpm commands must carry `--ignore-workspace`:
  `pnpm --dir apps/indexer install --ignore-workspace --frozen-lockfile`.

### Environment

| Variable                               | Used by                                 | Notes                                              |
| -------------------------------------- | --------------------------------------- | -------------------------------------------------- |
| `XCS_CEREMONY_SEED`                    | `set-regular-key`, `disable-master-key` | The registry account's seed. Environment only.     |
| `XCS_CEREMONY_ADDRESS`                 | `status`, `verify`, `emit-profile`      | Derived from the seed when that is set instead.    |
| `XCS_CEREMONY_ACTIVATION_LEDGER_INDEX` | `verify`, `emit-profile`                | Printed by `disable-master-key`.                   |
| `XCS_CEREMONY_PROFILE_ID`              | `emit-profile`                          | The identifier you will publish.                   |
| `XCS_CEREMONY_RPC_URL`                 | all                                     | Defaults to `wss://s.altnet.rippletest.net:51233`. |
| `XCS_CEREMONY_NETWORK_ID`              | all                                     | Defaults to `1`. Only `1` is accepted.             |
| `XCS_CEREMONY_PROFILE_OUTPUT`          | `emit-profile`                          | Defaults to `config/networks/testnet.json`.        |

## Where the seed must be stored

`create-account` prints the seed **once**. Copy it into your own secret manager immediately —
1Password, Vault, the platform's secret store, whatever your team already uses for XRPL keys.

- No stage writes a seed to any file. The script refuses any seed sink path inside the working tree,
  so a seed can never end up committed.
- No stage logs a seed, at any verbosity.
- Later stages read the seed from `XCS_CEREMONY_SEED` only. **Never pass a seed as a command-line
  argument**: arguments are recorded in shell history and are visible to every process on the host
  through the process list.

Once the master key is disabled the seed no longer controls anything, but keep it until the ceremony
is verified and the profile is published, because it is the only way to fix a half-finished ceremony.

## The command sequence

### 1. Create and fund the account

```sh
pnpm --dir apps/indexer ceremony create-account
```

Prints the address, the funded balance and the seed. Store the seed, then export it:

```sh
read -rs XCS_CEREMONY_SEED && export XCS_CEREMONY_SEED
```

(`read -rs` keeps the seed out of your shell history.)

### 2. Look at the account

```sh
pnpm --dir apps/indexer ceremony status
```

**Check before continuing:** the address is the one you just created, `master key disabled` is
`false`, `regular key` is `(unset)`, `DepositAuth` and `RequireDestTag` are `false`, and there are no
signer lists and no outgoing delegates.

### 3. Set the regular key to `ACCOUNT_ZERO`

```sh
pnpm --dir apps/indexer ceremony set-regular-key
```

Refuses if the master key is already disabled, because then the regular key can never be changed
again. Re-running after success is a no-op.

**Check before continuing:** the state printed after the transaction shows
`regular key: rrrrrrrrrrrrrrrrrrrrrhoLvTp` and `regular key is ZERO: true`.

### 4. Disable the master key — irreversible

```sh
pnpm --dir apps/indexer ceremony disable-master-key
```

This stage reads validated ledger state first and **refuses** unless the regular key is already
`ACCOUNT_ZERO` and neither `DepositAuth` nor `RequireDestTag` is set. It then prints exactly what it
is about to do — the account, the network id, the server, and the regular key it verified — and
submits `AccountSet(asfDisableMaster)`.

**Why the order matters.** Disabling the master key first, before a regular key is set, produces an
account that nobody can ever sign for and that is not blackholed to `ACCOUNT_ZERO` either. That
cannot be undone. The ordering check exists to stop a wasted run, not to slow you down.

When the transaction is validated the stage waits for the **first validated ledger after it** and
prints that index and hash. That pair is the XCS activation boundary. Record both.

```sh
export XCS_CEREMONY_ACTIVATION_LEDGER_INDEX=<printed index>
```

### 5. Verify the finished account independently

```sh
pnpm --dir apps/indexer ceremony verify
```

This reads the account **at the activation ledger** and runs the indexer's own
`assertSourceCoversProfile`, `assertRegistryBlackholed` and `assertRegistryReceivable`: a validated
`AccountRoot` for that address, the master key disabled, the regular key `ACCOUNT_ZERO`, no signer
list, no outgoing `Delegate`, and neither `DepositAuth` nor `RequireDestTag`.

It then **proves receivability rather than inferring it**: it funds a throwaway account from the
faucet and sends a real one-drop `Payment` with no destination tag to the registry, and requires
`tesSUCCESS`. Flags can be read wrong; a delivered payment cannot.

**Check before continuing:** every assertion reports `pass` and the one-drop payment reports
`tesSUCCESS`.

### 6. Emit the profile

```sh
XCS_CEREMONY_PROFILE_ID=<your-new-profile-id> pnpm --dir apps/indexer ceremony emit-profile
```

Writes `config/networks/testnet.json` from real values: your profile identifier, the network id, the
required amendment, the registry address, `registrationAmountDrops` of `"1"`, and the activation
ledger index and hash. It

- refuses to overwrite an existing profile file;
- rejects `xrpl-testnet-xcs-v0.1-example` and the identifier ADR 0003 reserves for the controlled
  pilot (`commons-testnet-xcs-v0.1-controlled-pilot`, and anything ending `-controlled-pilot`);
- re-runs the blackhole assertions at the activation ledger before writing, so an unverified registry
  is never published;
- prints the file's SHA-256;
- finally parses the bytes it wrote through the indexer's `parseNetworkProfile`, resolves the registry
  policy, and re-runs preflight against them, reporting `PASS`.

**Publish the exact file and that digest together.** Verify the digest independently before
publishing:

```sh
shasum -a 256 config/networks/testnet.json
```

Then point the deployments at it with `XCS_NETWORK_PROFILE` and continue with
[`deployment.md`](./deployment.md).

## A profile identifier can never be reused

Once a `profileId` has been published and indexed, it names that registry account, that activation
boundary and that ledger history for good. After a Testnet reset, or after changing **any** profile
field — registry address, activation index, activation hash, network id, required amendment — you
must publish a **new** profile identifier, a new activation boundary and a fresh database. Never edit
a published profile in place, never rename one, and never copy a Testnet registry address into a
Mainnet profile.

## If a stage fails partway

On Testnet, nothing of value is at stake until a profile is published and indexed. Funding is free,
and a burnt or half-configured account has no consequence.

**So the recovery for any mis-ordered, failed or doubtful ceremony is: discard the account and run
the ceremony again from `create-account`.** This is a routine do-over, not an incident. Delete the
abandoned seed from your secret manager so it cannot be confused with the real one.

Specifically:

- **A transaction failed, or the stage crashed before submitting.** Re-run the stage. Every stage
  re-reads live ledger state first, so a re-run is safe and a completed step is a no-op.
- **`CEREMONY_REGULAR_KEY_NOT_SET`.** Expected if you skipped ahead. Run `set-regular-key`.
- **`CEREMONY_MASTER_KEY_ALREADY_DISABLED` from `set-regular-key`.** The account is stranded: the
  master key is gone and the regular key is not `ACCOUNT_ZERO`. It cannot be repaired. Discard it and
  start again.
- **`CEREMONY_ACCOUNT_NOT_RECEIVABLE`.** `DepositAuth` or `RequireDestTag` is set. Clear it with your
  own `AccountSet` while the master key still works, or discard the account and start again.
- **`verify` fails after a successful `disable-master-key`.** Do not publish a profile. Re-check the
  activation ledger index you exported; if the account genuinely does not satisfy the policy, discard
  it and start again.
- **`CEREMONY_PROFILE_FILE_EXISTS`.** A profile is already there. Do not delete it to make room —
  decide deliberately whether you are publishing a new profile, under a new identifier, and where it
  belongs.
- **You lost the seed before step 4.** Discard the account and start again.

## Tests

The pure decision logic — command parsing, network refusals, reserved identifiers, profile
serialization, seed handling, flag decoding and the ordering checks — is unit-tested with no network
access in [`apps/indexer/test/ceremony.test.ts`](../../apps/indexer/test/ceremony.test.ts).
