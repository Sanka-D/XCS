// Pure decision logic for the registry blackhole ceremony. Everything here is
// network-free and unit-tested; `ceremony-cli.ts` owns the XRPL and filesystem
// effects. The ceremony itself is documented in `docs/runbooks/blackhole-ceremony.md`.
import { resolve } from 'node:path'

import { parseNetworkProfile, type NetworkProfile } from './lib/xcs/index.js'

import { CONTROLLED_PILOT_PROFILE_ID } from './config.js'
import { XRPL_ACCOUNT_ZERO } from './profile-preflight.js'

export const CEREMONY_ERROR_CODES = [
  'CEREMONY_MAINNET_FORBIDDEN',
  'CEREMONY_NETWORK_NOT_TESTNET',
  'CEREMONY_NETWORK_MISMATCH',
  'CEREMONY_PROFILE_ID_RESERVED',
  'CEREMONY_PROFILE_FILE_EXISTS',
  'CEREMONY_SEED_IN_WORKING_TREE',
  'CEREMONY_SEED_MISSING',
  'CEREMONY_REGULAR_KEY_NOT_SET',
  'CEREMONY_MASTER_KEY_ALREADY_DISABLED',
  'CEREMONY_ACCOUNT_NOT_RECEIVABLE',
  'CEREMONY_USAGE',
] as const

export type CeremonyErrorCode = (typeof CEREMONY_ERROR_CODES)[number]

export class CeremonyError extends Error {
  constructor(
    readonly code: CeremonyErrorCode,
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message)
    this.name = 'CeremonyError'
  }
}

function ceremonyFailure(
  code: CeremonyErrorCode,
  message: string,
  details: Readonly<Record<string, unknown>> = {},
): never {
  throw new CeremonyError(code, message, details)
}

export const CEREMONY_COMMANDS = [
  'create-account',
  'status',
  'set-regular-key',
  'disable-master-key',
  'verify',
  'emit-profile',
] as const

export type CeremonyCommand = (typeof CEREMONY_COMMANDS)[number]

export function parseCeremonyCommand(argument: string | undefined): CeremonyCommand {
  const match = CEREMONY_COMMANDS.find((command) => command === argument)
  if (match === undefined) {
    return ceremonyFailure(
      'CEREMONY_USAGE',
      `Usage: pnpm --dir apps/indexer ceremony <${CEREMONY_COMMANDS.join('|')}>`,
    )
  }
  return match
}

/** XRPL reserves network id 0 for Mainnet; 1 is the public Testnet. */
export const XRPL_MAINNET_NETWORK_ID = 0
export const XRPL_TESTNET_NETWORK_ID = 1

/**
 * The ceremony runs on Testnet only. Mainnet is refused by its own error code
 * rather than folded into the generic refusal, because that is the one network
 * where a blackholed account has consequences this script must never create.
 */
export function resolveCeremonyNetworkId(environment: NodeJS.ProcessEnv): number {
  const raw = environment.XCS_CEREMONY_NETWORK_ID
  if (raw === undefined || raw.trim().length === 0) return XRPL_TESTNET_NETWORK_ID
  const networkId = Number(raw.trim())
  if (!Number.isSafeInteger(networkId) || networkId < 0 || networkId > 0xffff_ffff) {
    return ceremonyFailure(
      'CEREMONY_NETWORK_NOT_TESTNET',
      'XCS_CEREMONY_NETWORK_ID must be a uint32',
      { value: raw },
    )
  }
  if (networkId === XRPL_MAINNET_NETWORK_ID) {
    return ceremonyFailure(
      'CEREMONY_MAINNET_FORBIDDEN',
      'Refusing to run the blackhole ceremony against XRPL Mainnet (network id 0)',
    )
  }
  if (networkId !== XRPL_TESTNET_NETWORK_ID) {
    return ceremonyFailure(
      'CEREMONY_NETWORK_NOT_TESTNET',
      `The blackhole ceremony only runs on XRPL Testnet (network id ${XRPL_TESTNET_NETWORK_ID}), not network id ${networkId}`,
      { networkId },
    )
  }
  return networkId
}

/** Checked against live `server_info` before any transaction is submitted. */
export function assertConnectedNetwork(expectedNetworkId: number, actualNetworkId: number): void {
  if (actualNetworkId === XRPL_MAINNET_NETWORK_ID) {
    return ceremonyFailure(
      'CEREMONY_MAINNET_FORBIDDEN',
      'The connected XRPL server reports Mainnet (network id 0); refusing to continue',
    )
  }
  if (actualNetworkId !== expectedNetworkId) {
    return ceremonyFailure(
      'CEREMONY_NETWORK_MISMATCH',
      `The connected XRPL server reports network id ${actualNetworkId}, but the ceremony targets network id ${expectedNetworkId}`,
      { expectedNetworkId, actualNetworkId },
    )
  }
}

export const EXAMPLE_PROFILE_ID = 'xrpl-testnet-xcs-v0.1-example'

/**
 * `parseNetworkProfile` already enforces the identifier grammar. This adds the
 * two identifiers a real public profile may never claim: the documentation
 * template's, and the one ADR 0003 reserves for the controlled pilot (whose
 * suffix the indexer's policy resolution keys off).
 */
export function assertProfileIdAllowed(profileId: string): string {
  if (profileId === EXAMPLE_PROFILE_ID) {
    return ceremonyFailure(
      'CEREMONY_PROFILE_ID_RESERVED',
      `profileId ${EXAMPLE_PROFILE_ID} belongs to the documentation template and can never name a live profile`,
      { profileId },
    )
  }
  if (profileId === CONTROLLED_PILOT_PROFILE_ID || profileId.endsWith('-controlled-pilot')) {
    return ceremonyFailure(
      'CEREMONY_PROFILE_ID_RESERVED',
      `profileId ${profileId} is reserved by ADR 0003 for the disposable controlled pilot; this script only emits blackholed profiles`,
      { profileId },
    )
  }
  return profileId
}

export interface CeremonyProfileInput {
  profileId: string
  networkId: number
  requiredAmendment: string
  registryAddress: string
  activationLedgerIndex: number
  activationLedgerHash: string
}

/** Builds the profile through the indexer's own parser, so it cannot drift. */
export function buildCeremonyProfile(input: CeremonyProfileInput): NetworkProfile {
  return parseNetworkProfile({
    profileId: assertProfileIdAllowed(input.profileId),
    xcsVersion: '0.1',
    networkId: input.networkId,
    requiredAmendment: input.requiredAmendment,
    registryAddress: input.registryAddress,
    registrationAmountDrops: '1',
    activationLedgerIndex: input.activationLedgerIndex,
    activationLedgerHash: input.activationLedgerHash,
  })
}

/**
 * The published bytes. The digest an operator publishes is the digest of this
 * exact text, so the field order and the trailing newline are part of the
 * artefact and match `testnet.example.json`.
 */
export function serializeProfileFile(profile: NetworkProfile): string {
  return `${JSON.stringify(
    {
      profileId: profile.profileId,
      xcsVersion: profile.xcsVersion,
      networkId: profile.networkId,
      requiredAmendment: profile.requiredAmendment,
      registryAddress: profile.registryAddress,
      registrationAmountDrops: profile.registrationAmountDrops,
      activationLedgerIndex: profile.activationLedgerIndex,
      activationLedgerHash: profile.activationLedgerHash,
    },
    null,
    2,
  )}\n`
}

/** A published profile is never edited in place; a new boundary gets a new file. */
export function assertProfileFileAbsent(path: string, exists: boolean): void {
  if (exists) {
    return ceremonyFailure(
      'CEREMONY_PROFILE_FILE_EXISTS',
      `${path} already exists; publish a new profile file instead of editing a published one in place`,
      { path },
    )
  }
}

/**
 * Seeds are printed once and stored by the operator in their own secret
 * manager. Nothing in the ceremony writes one to disk, and this refuses any
 * path inside the working tree so a future caller cannot make it do so.
 */
export function assertSeedSinkOutsideWorkingTree(path: string, workingTree: string): string {
  const absolute = resolve(workingTree, path)
  const root = resolve(workingTree)
  if (absolute === root || absolute.startsWith(`${root}/`)) {
    return ceremonyFailure(
      'CEREMONY_SEED_IN_WORKING_TREE',
      'Refusing to write an account seed anywhere inside the working tree; store it in your secret manager',
      { path: absolute },
    )
  }
  return absolute
}

/**
 * Seeds arrive by environment variable only: a command-line argument would be
 * captured by shell history and visible in the process list.
 */
export function requireCeremonySeed(environment: NodeJS.ProcessEnv): string {
  const seed = environment.XCS_CEREMONY_SEED
  if (seed === undefined || seed.trim().length === 0) {
    return ceremonyFailure(
      'CEREMONY_SEED_MISSING',
      'XCS_CEREMONY_SEED is required for this stage; export it from your secret manager and never pass a seed as an argument',
    )
  }
  return seed.trim()
}

const LSF_DISABLE_MASTER = 0x0010_0000
const LSF_DEPOSIT_AUTH = 0x0100_0000
const LSF_REQUIRE_DEST_TAG = 0x0002_0000

export interface CeremonyAccountState {
  address: string
  flags: number
  masterKeyDisabled: boolean
  depositAuthEnabled: boolean
  destinationTagRequired: boolean
  regularKey?: string
  regularKeyIsAccountZero: boolean
  signerListCount: number
  outgoingDelegateCount: number
}

export function summarizeAccountState(input: {
  address: string
  flags: number
  regularKey?: string
  signerListCount: number
  outgoingDelegateCount: number
}): CeremonyAccountState {
  return {
    address: input.address,
    flags: input.flags,
    masterKeyDisabled: (input.flags & LSF_DISABLE_MASTER) !== 0,
    depositAuthEnabled: (input.flags & LSF_DEPOSIT_AUTH) !== 0,
    destinationTagRequired: (input.flags & LSF_REQUIRE_DEST_TAG) !== 0,
    ...(input.regularKey === undefined ? {} : { regularKey: input.regularKey }),
    regularKeyIsAccountZero: input.regularKey === XRPL_ACCOUNT_ZERO,
    signerListCount: input.signerListCount,
    outgoingDelegateCount: input.outgoingDelegateCount,
  }
}

export function assertReadyToSetRegularKey(state: CeremonyAccountState): void {
  if (state.masterKeyDisabled) {
    return ceremonyFailure(
      'CEREMONY_MASTER_KEY_ALREADY_DISABLED',
      `${state.address} already has its master key disabled, so its regular key can no longer be changed; discard this account and start again`,
      { address: state.address },
    )
  }
}

/**
 * The ordering check. Disabling the master key before the regular key is set to
 * ACCOUNT_ZERO leaves an account nobody can ever sign for, so this reads live
 * ledger state and refuses rather than wasting a run.
 */
export function assertReadyToDisableMasterKey(state: CeremonyAccountState): void {
  if (state.masterKeyDisabled) {
    return ceremonyFailure(
      'CEREMONY_MASTER_KEY_ALREADY_DISABLED',
      `${state.address} already has its master key disabled; nothing to do`,
      { address: state.address },
    )
  }
  if (!state.regularKeyIsAccountZero) {
    return ceremonyFailure(
      'CEREMONY_REGULAR_KEY_NOT_SET',
      `Refusing to disable the master key: the regular key of ${state.address} is ${state.regularKey ?? '(unset)'}, not ${XRPL_ACCOUNT_ZERO}. Run set-regular-key first.`,
      {
        address: state.address,
        ...(state.regularKey === undefined ? {} : { regularKey: state.regularKey }),
      },
    )
  }
  if (state.depositAuthEnabled || state.destinationTagRequired) {
    return ceremonyFailure(
      'CEREMONY_ACCOUNT_NOT_RECEIVABLE',
      `Refusing to disable the master key: ${state.address} has DepositAuth or RequireDestTag set, which would permanently block the one-drop registration payment`,
      {
        address: state.address,
        depositAuthEnabled: state.depositAuthEnabled,
        destinationTagRequired: state.destinationTagRequired,
      },
    )
  }
}

/** The human-readable plan the irreversible stage prints before it acts. */
export function describeDisableMasterKeyPlan(input: {
  address: string
  networkId: number
  rpcUrl: string
  regularKey: string
}): string {
  return [
    'About to submit AccountSet(asfDisableMaster) — this is irreversible for this account.',
    `  account:     ${input.address}`,
    `  network id:  ${input.networkId} (XRPL Testnet)`,
    `  server:      ${input.rpcUrl}`,
    `  regular key: ${input.regularKey} (verified from validated ledger state)`,
    'After this the account can only ever be signed for by ACCOUNT_ZERO, which nobody holds.',
  ].join('\n')
}
