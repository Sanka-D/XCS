import { fail } from './errors.js'
import type { VerificationReport } from './types.js'

const REPORT_KEYS = new Set(['onChain', 'schema', 'payload', 'issuerTrust', 'generationId'])
const ON_CHAIN = new Set(['pending', 'active', 'expired', 'deleted', 'not_found'])
const SCHEMA = new Set(['valid', 'invalid', 'unknown'])
const PAYLOAD = new Set(['valid', 'unavailable', 'tampered', 'invalid', 'not_checked'])
const ISSUER_TRUST = new Set(['trusted', 'untrusted', 'unknown'])
const LOWERCASE_HASH = /^[0-9a-f]{64}$/u

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireStatus(
  input: Record<string, unknown>,
  key: 'onChain' | 'schema' | 'payload' | 'issuerTrust',
  allowed: ReadonlySet<string>,
): string {
  if (!Object.hasOwn(input, key) || typeof input[key] !== 'string' || !allowed.has(input[key])) {
    return fail(
      'VERIFICATION_REPORT_INVALID',
      `${key} must be a supported verification status`,
      `$.${key}`,
    )
  }
  return input[key]
}

/**
 * Validate an untrusted runtime value as the four-dimensional verification
 * report defined by XCS v0.1. Trust being unknown is a valid, explicit result.
 */
export function parseVerificationReport(input: unknown): VerificationReport {
  if (!isRecord(input)) {
    return fail('VERIFICATION_REPORT_INVALID', 'Verification report must be an object', '$')
  }
  for (const key of Object.keys(input)) {
    if (!REPORT_KEYS.has(key)) {
      return fail(
        'VERIFICATION_REPORT_INVALID',
        `Unknown verification report property ${key}`,
        `$.${key}`,
      )
    }
  }

  const onChain = requireStatus(input, 'onChain', ON_CHAIN) as VerificationReport['onChain']
  const schema = requireStatus(input, 'schema', SCHEMA) as VerificationReport['schema']
  const payload = requireStatus(input, 'payload', PAYLOAD) as VerificationReport['payload']
  const issuerTrust = requireStatus(
    input,
    'issuerTrust',
    ISSUER_TRUST,
  ) as VerificationReport['issuerTrust']

  if (
    Object.hasOwn(input, 'generationId') &&
    (typeof input.generationId !== 'string' || !LOWERCASE_HASH.test(input.generationId))
  ) {
    return fail(
      'VERIFICATION_REPORT_INVALID',
      'generationId must be a lowercase 32-byte hexadecimal hash',
      '$.generationId',
    )
  }

  return {
    onChain,
    schema,
    payload,
    issuerTrust,
    ...(typeof input.generationId === 'string' ? { generationId: input.generationId } : {}),
  }
}
