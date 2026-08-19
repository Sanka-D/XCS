import { validateNetworkProfile, type NetworkProfile } from '@xcs-protocol/core'
import { isValidClassicAddress, type Client } from 'xrpl'

import { XcsSdkError } from './errors.js'

export function assertClassicAddress(address: string, field: string): void {
  if (!isValidClassicAddress(address)) {
    throw new XcsSdkError(
      'XCS_SDK_INVALID_ADDRESS',
      `${field} must be a valid XRPL classic address. X-addresses are not accepted by XCS v0.1.`,
      { field, address },
    )
  }
}

export function parseNetworkProfile(input: unknown): NetworkProfile {
  const profile = validateNetworkProfile(input)
  assertClassicAddress(profile.registryAddress, 'registryAddress')
  return profile
}

export async function connectAndValidateNetwork(
  client: Client,
  profileInput: unknown,
): Promise<NetworkProfile> {
  const profile = parseNetworkProfile(profileInput)
  if (!client.isConnected()) {
    await client.connect()
  }

  const actualNetworkId = client.networkID
  if (actualNetworkId === undefined) {
    throw new XcsSdkError(
      'XCS_SDK_CLIENT_NOT_CONNECTED',
      'The connected XRPL server did not report a network ID.',
    )
  }
  if (actualNetworkId !== profile.networkId) {
    throw new XcsSdkError(
      'XCS_SDK_NETWORK_MISMATCH',
      `XRPL server network ID ${actualNetworkId} does not match profile network ID ${profile.networkId}.`,
      { expectedNetworkId: profile.networkId, actualNetworkId },
    )
  }

  const request = client.request.bind(client) as unknown as (
    request: Record<string, unknown>,
  ) => Promise<{ result: unknown }>
  let featureResult: unknown
  try {
    featureResult = (await request({ command: 'feature', feature: profile.requiredAmendment }))
      .result
  } catch (error) {
    throw new XcsSdkError(
      'XCS_SDK_AMENDMENT_UNAVAILABLE',
      'The connected XRPL server could not prove the required amendment status.',
      { requiredAmendment: profile.requiredAmendment, cause: String(error) },
    )
  }
  const featureMap = asRecord(featureResult)
  const amendmentKey = Object.keys(featureMap).find(
    (key) => key.toUpperCase() === profile.requiredAmendment.toUpperCase(),
  )
  const amendment = amendmentKey === undefined ? undefined : asRecord(featureMap[amendmentKey])
  if (amendment?.enabled !== true || amendment.supported !== true) {
    throw new XcsSdkError(
      'XCS_SDK_AMENDMENT_UNAVAILABLE',
      'The required XRPL amendment is not enabled and supported by the connected server.',
      { requiredAmendment: profile.requiredAmendment },
    )
  }

  return profile
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}
