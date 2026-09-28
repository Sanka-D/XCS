/**
 * Operator CLI for the XCS registry blackhole ceremony on XRPL Testnet.
 *
 *   pnpm --dir apps/indexer ceremony <stage>
 *
 * Each stage is invoked deliberately, reads live validated ledger state before
 * it acts, and refuses when that state is not what the stage expects. The
 * procedure, the recovery path and the secret handling are documented in
 * `docs/runbooks/blackhole-ceremony.md`; `config/networks/README.md` is the
 * authority on the procedure and `profile-preflight.ts` on a valid result.
 *
 * Every rule about what counts as a valid registry is imported from
 * `profile-preflight.ts` and `lib/xcs/network.ts` — this file contains no second
 * copy of them, so the script cannot drift from the indexer.
 */
import { access, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Client, Wallet, type AccountSet, type Payment, type SetRegularKey } from 'xrpl'

import { parseNetworkProfile, type NetworkProfile } from './lib/xcs/index.js'

import {
  assertConnectedNetwork,
  assertProfileFileAbsent,
  assertProfileIdAllowed,
  assertReadyToDisableMasterKey,
  assertReadyToSetRegularKey,
  buildCeremonyProfile,
  CeremonyError,
  describeDisableMasterKeyPlan,
  parseCeremonyCommand,
  requireCeremonySeed,
  resolveCeremonyNetworkId,
  serializeProfileFile,
  summarizeAccountState,
  type CeremonyAccountState,
} from './ceremony.js'
import {
  assertRegistryBlackholed,
  assertRegistryReceivable,
  assertSourceCoversProfile,
  normalizeAccountObjectsPage,
  normalizeServerInfo,
  XRPL_ACCOUNT_ZERO,
  type SourceServerStatus,
} from './profile-preflight.js'
import { parseJson, sha256Hex } from './serialization.js'
import { indexerEnvironment } from './settings.js'
import { resolveRegistryPolicy } from './config.js'

const environment = indexerEnvironment()

const DEFAULT_RPC_URL = 'wss://s.altnet.rippletest.net:51233'
/** The amendment XCS 0.1 requires; the same value the spec and example carry. */
const REQUIRED_AMENDMENT = '1CB67D082CF7D9102412D34258CEDB400E659352D3B207348889297A6D90F5EF'
/**
 * Resolved from this file, not from the working directory: the script is run as
 * `pnpm --dir apps/indexer ceremony`, whose cwd is the app rather than the
 * repository root. `XCS_CEREMONY_PROFILE_OUTPUT` overrides it and is resolved
 * against the cwd as an operator would expect.
 */
const DEFAULT_PROFILE_OUTPUT = fileURLToPath(
  new URL('../../../config/networks/testnet.json', import.meta.url),
)
const ASF_DISABLE_MASTER = 4

type AnyRequest = Parameters<Client['request']>[0]

function out(line: string): void {
  process.stdout.write(`${line}\n`)
}

function rpcUrl(): string {
  const value = environment.XCS_CEREMONY_RPC_URL
  return value === undefined || value.trim().length === 0 ? DEFAULT_RPC_URL : value.trim()
}

function optional(name: string): string | undefined {
  const value = environment[name]
  return value === undefined || value.trim().length === 0 ? undefined : value.trim()
}

function required(name: string, hint: string): string {
  const value = optional(name)
  if (value === undefined) throw new CeremonyError('CEREMONY_USAGE', `${name} is required: ${hint}`)
  return value
}

function requiredLedgerIndex(name: string): number {
  const value = Number(required(name, 'the activation ledger index printed by disable-master-key'))
  if (!Number.isSafeInteger(value) || value < 1 || value > 0xffff_ffff) {
    throw new CeremonyError('CEREMONY_USAGE', `${name} must be a positive uint32`)
  }
  return value
}

async function rpc(client: Client, request: Record<string, unknown>): Promise<unknown> {
  const response = await client.request(request as unknown as AnyRequest)
  return (response as unknown as { result: unknown }).result
}

/**
 * Public Testnet clusters occasionally answer `server_info` from a node that is
 * momentarily not reporting `validated_ledger`. The shared normalizer is
 * deliberately strict about that, so the retry lives here rather than loosening
 * a rule the indexer depends on.
 */
async function serverStatus(client: Client): Promise<SourceServerStatus> {
  let lastError: unknown
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return normalizeServerInfo(await rpc(client, { command: 'server_info' }))
    } catch (error) {
      lastError = error
      await new Promise((done) => setTimeout(done, 1500))
    }
  }
  throw lastError
}

/** Reads `server_info` through the indexer's own normalizer and enforces Testnet. */
async function connect(expectedNetworkId: number): Promise<{
  client: Client
  status: SourceServerStatus
}> {
  const client = new Client(rpcUrl())
  await client.connect()
  try {
    const status = await serverStatus(client)
    assertConnectedNetwork(expectedNetworkId, status.networkId)
    out(
      `server ${rpcUrl()} network_id=${status.networkId} validated=${status.validatedLedgerIndex}`,
    )
    return { client, status }
  } catch (error) {
    await client.disconnect()
    throw error
  }
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CeremonyError('CEREMONY_USAGE', `${label} must be an object`)
  }
  return value as Record<string, unknown>
}

interface LiveAccount {
  state: CeremonyAccountState
  accountInfo: unknown
  accountObjects: Record<string, unknown>[]
  ledgerIndex: number
}

/**
 * `ledgerIndex` selects the ledger the state is read at: the validated tip for
 * the pre-transaction ordering checks, and the activation ledger for the
 * preflight assertions, which demand that exact ledger.
 */
async function readAccount(
  client: Client,
  address: string,
  ledgerIndex: number | 'validated',
): Promise<LiveAccount> {
  const accountInfo = await rpc(client, {
    command: 'account_info',
    account: address,
    signer_lists: true,
    ledger_index: ledgerIndex,
  })
  const infoResult = asRecord(accountInfo, 'account_info result')
  const accountData = asRecord(infoResult.account_data, 'account_info.account_data')
  const resolvedIndex = Number(infoResult.ledger_index)

  const objects: Record<string, unknown>[] = []
  let marker: unknown
  do {
    const page = await rpc(client, {
      command: 'account_objects',
      account: address,
      ledger_index: resolvedIndex,
      ...(marker === undefined ? {} : { marker }),
    })
    const pageResult = asRecord(page, 'account_objects result')
    const entries = Array.isArray(pageResult.account_objects) ? pageResult.account_objects : []
    for (const entry of entries) objects.push(asRecord(entry, 'account_objects entry'))
    marker = pageResult.marker
  } while (marker !== undefined)

  const signerListsInResult = Array.isArray(infoResult.signer_lists) ? infoResult.signer_lists : []
  const signerListObjects = objects.filter((entry) => entry.LedgerEntryType === 'SignerList')
  const outgoingDelegates = objects.filter(
    (entry) => entry.LedgerEntryType === 'Delegate' && entry.Account === address,
  )

  const regularKey = accountData.RegularKey
  return {
    state: summarizeAccountState({
      address,
      flags: Number(accountData.Flags ?? 0),
      ...(typeof regularKey === 'string' ? { regularKey } : {}),
      signerListCount: signerListsInResult.length + signerListObjects.length,
      outgoingDelegateCount: outgoingDelegates.length,
    }),
    accountInfo,
    accountObjects: objects,
    ledgerIndex: resolvedIndex,
  }
}

function printState(state: CeremonyAccountState, ledgerIndex: number): void {
  out(`account ${state.address} at validated ledger ${ledgerIndex}`)
  out(`  Flags:                  0x${state.flags.toString(16).padStart(8, '0')}`)
  out(`  master key disabled:    ${state.masterKeyDisabled}`)
  out(`  regular key:            ${state.regularKey ?? '(unset)'}`)
  out(`  regular key is ZERO:    ${state.regularKeyIsAccountZero}`)
  out(`  DepositAuth:            ${state.depositAuthEnabled}`)
  out(`  RequireDestTag:         ${state.destinationTagRequired}`)
  out(`  signer lists:           ${state.signerListCount}`)
  out(`  outgoing delegates:     ${state.outgoingDelegateCount}`)
}

function engineResult(meta: unknown): string {
  if (typeof meta === 'object' && meta !== null && 'TransactionResult' in meta) {
    return String((meta as { TransactionResult: unknown }).TransactionResult)
  }
  return 'unknown'
}

interface SubmittedTransaction {
  hash: string
  result: string
  ledgerIndex: number
}

async function submit(
  client: Client,
  wallet: Wallet,
  transaction: AccountSet | Payment | SetRegularKey,
): Promise<SubmittedTransaction> {
  const response = await client.submitAndWait(transaction, { wallet, autofill: true })
  const result = asRecord(response.result, 'submitAndWait result')
  const submitted: SubmittedTransaction = {
    hash: String(result.hash),
    result: engineResult(result.meta),
    ledgerIndex: Number(result.ledger_index),
  }
  if (submitted.result !== 'tesSUCCESS') {
    throw new CeremonyError(
      'CEREMONY_USAGE',
      `${transaction.TransactionType} failed with ${submitted.result} (${submitted.hash})`,
    )
  }
  out(
    `${transaction.TransactionType} ${submitted.result} hash=${submitted.hash} ledger=${submitted.ledgerIndex}`,
  )
  return submitted
}

/** The ceremony's activation boundary: the first validated ledger after a stage. */
async function firstValidatedLedgerAfter(
  client: Client,
  ledgerIndex: number,
): Promise<{ ledgerIndex: number; ledgerHash: string }> {
  const target = ledgerIndex + 1
  for (;;) {
    const info = await serverStatus(client)
    if (info.validatedLedgerIndex >= target) break
    await new Promise((done) => setTimeout(done, 2000))
  }
  const ledger = asRecord(
    await rpc(client, { command: 'ledger', ledger_index: target }),
    'ledger result',
  )
  return { ledgerIndex: target, ledgerHash: String(ledger.ledger_hash).toLowerCase() }
}

async function ledgerHashAt(client: Client, ledgerIndex: number): Promise<string> {
  const ledger = asRecord(
    await rpc(client, { command: 'ledger', ledger_index: ledgerIndex }),
    'ledger result',
  )
  if (ledger.validated !== true) {
    throw new CeremonyError('CEREMONY_USAGE', `Ledger ${ledgerIndex} is not validated yet`)
  }
  return String(ledger.ledger_hash).toLowerCase()
}

function walletFromEnvironmentSeed(): Wallet {
  // The seed is read from the environment only, never from an argument, and is
  // never echoed, logged or written to disk by any stage but `create-account`.
  return Wallet.fromSeed(requireCeremonySeed(environment))
}

function registryAddress(): string {
  const address = optional('XCS_CEREMONY_ADDRESS')
  if (address !== undefined) return address
  const seed = optional('XCS_CEREMONY_SEED')
  if (seed !== undefined) return Wallet.fromSeed(seed).classicAddress
  throw new CeremonyError(
    'CEREMONY_USAGE',
    'XCS_CEREMONY_ADDRESS is required (or XCS_CEREMONY_SEED, from which it is derived)',
  )
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function runCreateAccount(networkId: number): Promise<void> {
  const { client } = await connect(networkId)
  try {
    const funded = await client.fundWallet()
    out('')
    out('Registry candidate account created and funded from the Testnet faucet.')
    out(`  address:  ${funded.wallet.classicAddress}`)
    out(`  balance:  ${funded.balance} XRP`)
    out('')
    out('The seed is printed once, on the next line only. Store it in your secret')
    out('manager now; no stage writes it to disk, and later stages read it from')
    out('XCS_CEREMONY_SEED. Never pass it as a command-line argument.')
    out('')
    out(`  seed:     ${funded.wallet.seed ?? '(unavailable)'}`)
    out('')
    out('Next: export XCS_CEREMONY_SEED and run `ceremony status`.')
  } finally {
    await client.disconnect()
  }
}

async function runStatus(networkId: number): Promise<void> {
  const { client } = await connect(networkId)
  try {
    const live = await readAccount(client, registryAddress(), 'validated')
    printState(live.state, live.ledgerIndex)
  } finally {
    await client.disconnect()
  }
}

async function runSetRegularKey(networkId: number): Promise<void> {
  const wallet = walletFromEnvironmentSeed()
  const { client } = await connect(networkId)
  try {
    const live = await readAccount(client, wallet.classicAddress, 'validated')
    printState(live.state, live.ledgerIndex)
    assertReadyToSetRegularKey(live.state)
    if (live.state.regularKeyIsAccountZero) {
      out(`Regular key is already ${XRPL_ACCOUNT_ZERO}; nothing to do.`)
      return
    }
    out(`Setting the regular key of ${wallet.classicAddress} to ${XRPL_ACCOUNT_ZERO}.`)
    await submit(client, wallet, {
      TransactionType: 'SetRegularKey',
      Account: wallet.classicAddress,
      RegularKey: XRPL_ACCOUNT_ZERO,
    })
    const after = await readAccount(client, wallet.classicAddress, 'validated')
    printState(after.state, after.ledgerIndex)
    out('Next: `ceremony disable-master-key`.')
  } finally {
    await client.disconnect()
  }
}

async function runDisableMasterKey(networkId: number): Promise<void> {
  const wallet = walletFromEnvironmentSeed()
  const { client } = await connect(networkId)
  try {
    const live = await readAccount(client, wallet.classicAddress, 'validated')
    printState(live.state, live.ledgerIndex)
    // Ordering check against live validated state, not against what an earlier
    // stage believed: disabling the master key first would strand the account.
    assertReadyToDisableMasterKey(live.state)
    out('')
    out(
      describeDisableMasterKeyPlan({
        address: wallet.classicAddress,
        networkId,
        rpcUrl: rpcUrl(),
        regularKey: live.state.regularKey ?? XRPL_ACCOUNT_ZERO,
      }),
    )
    out('')
    const disabled = await submit(client, wallet, {
      TransactionType: 'AccountSet',
      Account: wallet.classicAddress,
      SetFlag: ASF_DISABLE_MASTER,
    })
    const boundary = await firstValidatedLedgerAfter(client, disabled.ledgerIndex)
    out('')
    out('Activation boundary — the first validated ledger after the ceremony:')
    out(`  XCS_CEREMONY_ACTIVATION_LEDGER_INDEX=${boundary.ledgerIndex}`)
    out(`  activationLedgerHash=${boundary.ledgerHash}`)
    out('Next: `ceremony verify`.')
  } finally {
    await client.disconnect()
  }
}

/** A throwaway funded account proves receivability for real, not by flag reading. */
async function proveOneDropReceivable(client: Client, address: string): Promise<string> {
  const payer = await client.fundWallet()
  out(`one-drop probe payer ${payer.wallet.classicAddress} (throwaway, discarded after this run)`)
  const payment: Payment = {
    TransactionType: 'Payment',
    Account: payer.wallet.classicAddress,
    Destination: address,
    Amount: '1',
  }
  const sent = await submit(client, payer.wallet, payment)
  out(`one-drop registration Payment with no DestinationTag: ${sent.result} (${sent.hash})`)
  return sent.hash
}

function probeProfile(input: {
  registryAddress: string
  networkId: number
  activationLedgerIndex: number
  activationLedgerHash: string
}): NetworkProfile {
  return buildCeremonyProfile({
    profileId: optional('XCS_CEREMONY_PROFILE_ID') ?? 'ceremony-verification-probe',
    networkId: input.networkId,
    requiredAmendment: REQUIRED_AMENDMENT,
    registryAddress: input.registryAddress,
    activationLedgerIndex: input.activationLedgerIndex,
    activationLedgerHash: input.activationLedgerHash,
  })
}

/**
 * Runs the indexer's own registry assertions against the activation ledger.
 * `normalizeAccountObjectsPage` also re-checks that every page really comes from
 * that ledger, which is why the objects are re-fetched here.
 */
async function assertBlackholedAtActivation(
  client: Client,
  profile: NetworkProfile,
): Promise<unknown> {
  const accountInfo = await rpc(client, {
    command: 'account_info',
    account: profile.registryAddress,
    signer_lists: true,
    ledger_index: profile.activationLedgerIndex,
  })
  const objects: Record<string, unknown>[] = []
  let marker: unknown
  do {
    const page = normalizeAccountObjectsPage(
      await rpc(client, {
        command: 'account_objects',
        account: profile.registryAddress,
        ledger_index: profile.activationLedgerIndex,
        ...(marker === undefined ? {} : { marker }),
      }),
      profile,
    )
    objects.push(...page.objects)
    marker = page.marker
  } while (marker !== undefined)

  assertRegistryBlackholed({ accountInfo, accountObjects: objects, profile })
  assertRegistryReceivable({ accountInfo, profile })
  return accountInfo
}

async function runVerify(networkId: number): Promise<void> {
  const address = registryAddress()
  const activationLedgerIndex = requiredLedgerIndex('XCS_CEREMONY_ACTIVATION_LEDGER_INDEX')
  const { client, status } = await connect(networkId)
  try {
    const activationLedgerHash = await ledgerHashAt(client, activationLedgerIndex)
    const profile = probeProfile({
      registryAddress: address,
      networkId,
      activationLedgerIndex,
      activationLedgerHash,
    })
    const live = await readAccount(client, address, activationLedgerIndex)
    printState(live.state, live.ledgerIndex)

    assertSourceCoversProfile(status, profile)
    out('assertSourceCoversProfile: pass')
    await assertBlackholedAtActivation(client, profile)
    out('assertRegistryBlackholed: pass (AccountRoot, no SignerList, no outgoing Delegate)')
    out('assertRegistryReceivable: pass (no DepositAuth, no RequireDestTag)')

    const hash = await proveOneDropReceivable(client, address)
    out('')
    out('Verification complete.')
    out(`  registry:              ${address}`)
    out(`  activation ledger:     ${activationLedgerIndex}`)
    out(`  activation hash:       ${activationLedgerHash}`)
    out(`  one-drop payment:      tesSUCCESS ${hash}`)
    out('Next: `ceremony emit-profile` with XCS_CEREMONY_PROFILE_ID set.')
  } finally {
    await client.disconnect()
  }
}

async function runEmitProfile(networkId: number): Promise<void> {
  const address = registryAddress()
  // Reserved-identifier and overwrite refusals happen before any network call.
  const profileId = assertProfileIdAllowed(
    required('XCS_CEREMONY_PROFILE_ID', 'the published profile identifier'),
  )
  const activationLedgerIndex = requiredLedgerIndex('XCS_CEREMONY_ACTIVATION_LEDGER_INDEX')
  const override = optional('XCS_CEREMONY_PROFILE_OUTPUT')
  const outputPath =
    override === undefined ? DEFAULT_PROFILE_OUTPUT : resolve(process.cwd(), override)
  // Refuse before touching the network, so a rerun cannot cost a faucet call.
  assertProfileFileAbsent(outputPath, await fileExists(outputPath))

  const { client, status } = await connect(networkId)
  try {
    const activationLedgerHash = await ledgerHashAt(client, activationLedgerIndex)
    const profile = buildCeremonyProfile({
      profileId,
      networkId,
      requiredAmendment: REQUIRED_AMENDMENT,
      registryAddress: address,
      activationLedgerIndex,
      activationLedgerHash,
    })
    // Never emit a profile whose registry has not just been proven blackholed.
    await assertBlackholedAtActivation(client, profile)
    assertSourceCoversProfile(status, profile)

    const contents = serializeProfileFile(profile)
    assertProfileFileAbsent(outputPath, await fileExists(outputPath))
    await writeFile(outputPath, contents, { encoding: 'utf8', flag: 'wx' })
    const bytes = Buffer.from(contents, 'utf8')
    out('')
    out(`Wrote ${outputPath}`)
    out(`  sha256: ${sha256Hex(bytes)}`)
    out('Publish the file and that digest together.')

    // Final gate: parse the bytes on disk exactly as the indexer's config loader
    // does, resolve the registry policy, and re-run the preflight assertions.
    const reparsed = parseNetworkProfile(parseJson(bytes))
    const registryPolicy = resolveRegistryPolicy(reparsed, environment)
    await assertBlackholedAtActivation(client, reparsed)
    assertSourceCoversProfile(status, reparsed)
    out('')
    out('Indexer preflight against the emitted file: PASS')
    out(`  parseNetworkProfile:   ok (profileId ${reparsed.profileId})`)
    out(`  registry policy:       ${registryPolicy}`)
    out('  assertRegistryPolicy:  pass')
    out('  assertSourceCoversProfile: pass')
  } finally {
    await client.disconnect()
  }
}

async function main(): Promise<void> {
  const command = parseCeremonyCommand(process.argv[2])
  const networkId = resolveCeremonyNetworkId(environment)
  switch (command) {
    case 'create-account':
      return runCreateAccount(networkId)
    case 'status':
      return runStatus(networkId)
    case 'set-regular-key':
      return runSetRegularKey(networkId)
    case 'disable-master-key':
      return runDisableMasterKey(networkId)
    case 'verify':
      return runVerify(networkId)
    case 'emit-profile':
      return runEmitProfile(networkId)
  }
}

try {
  await main()
} catch (error) {
  const code = error instanceof CeremonyError ? error.code : 'CEREMONY_FAILED'
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`${code}: ${message}\n`)
  process.exitCode = 1
}
