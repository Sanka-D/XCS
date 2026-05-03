import { verifyVC, type SignedVC } from './w3c-vc';
import type { SchemaDoc } from '~/lib/types/schema';

export interface SinkCredential {
  id: string;
  issuer: string;
  subject: string;
  credential_type: string;
  uri?: string;
  expiration?: number; // Ripple epoch seconds; 0 means none
  status: 'created' | 'accepted' | 'revoked';
}

export interface SinkSchema {
  uid: string;
  schema_json: SchemaDoc;
}

export interface VerifyResult {
  valid: boolean;
  checks: {
    onChain: boolean;
    notExpired: boolean;
    proofValid: boolean | null;
    schemaMatch: boolean | null;
  };
  reasons: string[];
}

const RIPPLE_EPOCH_OFFSET = 946684800;

export function verifyCredentialPayload(
  cred: SinkCredential,
  schema: SinkSchema,
  vc: SignedVC | null
): VerifyResult {
  const reasons: string[] = [];

  const onChain = cred.status !== 'revoked';
  if (!onChain) reasons.push('credential has been revoked');

  const nowRipple = Math.floor(Date.now() / 1000) - RIPPLE_EPOCH_OFFSET;
  const notExpired = !cred.expiration || cred.expiration > nowRipple;
  if (!notExpired) reasons.push('credential has expired');

  let proofValid: boolean | null = null;
  let schemaMatch: boolean | null = null;
  if (vc) {
    proofValid = verifyVC(vc);
    if (!proofValid) reasons.push('VC proof signature is invalid');

    const expectedId = `xcs:schema:${schema.uid}`;
    schemaMatch = vc.credentialSchema?.id === expectedId;
    if (!schemaMatch) reasons.push('VC schema id does not match registered schema');
  }

  const valid =
    onChain &&
    notExpired &&
    (proofValid === null || proofValid) &&
    (schemaMatch === null || schemaMatch);

  return { valid, checks: { onChain, notExpired, proofValid, schemaMatch }, reasons };
}
