import { isClassicAddress } from './address.js'
import { fail } from './errors.js'
import type { NetworkProfile } from './types.js'

const PROFILE_KEYS = new Set([
  'profileId',
  'xcsVersion',
  'networkId',
  'requiredAmendment',
  'registryAddress',
  'registrationAmountDrops',
  'activationLedgerIndex',
  'activationLedgerHash',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isUint32(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 0xffff_ffff
}

export function validateNetworkProfile(input: unknown): NetworkProfile {
  if (!isRecord(input)) {
    return fail('NETWORK_PROFILE_INVALID', 'Network profile must be a JSON object', '$')
  }
  for (const key of Object.keys(input)) {
    if (!PROFILE_KEYS.has(key)) {
      return fail('NETWORK_PROFILE_INVALID', `Unknown network profile property ${key}`, `$.${key}`)
    }
  }
  if (
    typeof input.profileId !== 'string' ||
    !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(input.profileId)
  ) {
    return fail(
      'NETWORK_PROFILE_INVALID',
      'profileId must be a lowercase stable identifier of at most 128 characters',
      '$.profileId',
    )
  }
  if (input.xcsVersion !== '0.1') {
    return fail('NETWORK_PROFILE_INVALID', 'Unsupported XCS version', '$.xcsVersion')
  }
  if (!isUint32(input.networkId)) {
    return fail('NETWORK_PROFILE_INVALID', 'networkId must be a uint32', '$.networkId')
  }
  if (
    typeof input.requiredAmendment !== 'string' ||
    !/^[0-9A-Fa-f]{64}$/.test(input.requiredAmendment)
  ) {
    return fail(
      'NETWORK_PROFILE_INVALID',
      'requiredAmendment must be a 32-byte hexadecimal amendment ID',
      '$.requiredAmendment',
    )
  }
  if (typeof input.registryAddress !== 'string' || !isClassicAddress(input.registryAddress)) {
    return fail(
      'NETWORK_PROFILE_INVALID',
      'registryAddress must be a checksummed XRPL classic address',
      '$.registryAddress',
    )
  }
  if (input.registrationAmountDrops !== '1') {
    return fail(
      'NETWORK_PROFILE_INVALID',
      'registrationAmountDrops must be the string "1"',
      '$.registrationAmountDrops',
    )
  }
  if (!isUint32(input.activationLedgerIndex) || input.activationLedgerIndex === 0) {
    return fail(
      'NETWORK_PROFILE_INVALID',
      'activationLedgerIndex must be a positive uint32',
      '$.activationLedgerIndex',
    )
  }
  if (
    typeof input.activationLedgerHash !== 'string' ||
    !/^[0-9A-Fa-f]{64}$/.test(input.activationLedgerHash)
  ) {
    return fail(
      'NETWORK_PROFILE_INVALID',
      'activationLedgerHash must be a 32-byte hexadecimal ledger hash',
      '$.activationLedgerHash',
    )
  }

  return {
    profileId: input.profileId,
    xcsVersion: '0.1',
    networkId: input.networkId,
    requiredAmendment: input.requiredAmendment.toUpperCase(),
    registryAddress: input.registryAddress,
    registrationAmountDrops: '1',
    activationLedgerIndex: input.activationLedgerIndex,
    activationLedgerHash: input.activationLedgerHash.toLowerCase(),
  }
}
