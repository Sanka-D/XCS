import { describe, it, expect } from 'vitest';
import { Wallet } from 'xrpl';
import { buildVC, signVC } from '../server/utils/w3c-vc';
import {
  verifyCredentialPayload,
  type SinkCredential,
  type SinkSchema,
} from '../server/utils/verify-credential';

const wallet = Wallet.fromSeed('sEdTM1uX8pu2do5XvTnutH6HsouMaM2');
const subject = 'rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe';

const schema: SinkSchema = {
  uid: '0123456789abcdef',
  schema_json: {
    name: 'EmploymentCredential',
    version: '1.0.0',
    fields: [{ name: 'role', type: 'string', required: true }],
  },
};

const baseCred: SinkCredential = {
  id: `${wallet.address}:${subject}:${schema.uid}`,
  issuer: wallet.address,
  subject,
  credential_type: schema.uid,
  uri: '',
  expiration: 0,
  status: 'accepted',
};

const vc = signVC(
  buildVC({
    issuerAddress: wallet.address,
    issuerPublicKey: wallet.publicKey,
    subjectAddress: subject,
    schemaUid: schema.uid,
    schemaName: 'EmploymentCredential',
    data: { role: 'Engineer' },
  }),
  wallet
);

describe('verifyCredentialPayload', () => {
  it('passes for accepted, unexpired, valid-proof credential', () => {
    const r = verifyCredentialPayload(baseCred, schema, vc);
    expect(r.valid).toBe(true);
    expect(r.checks.onChain).toBe(true);
    expect(r.checks.proofValid).toBe(true);
  });

  it('fails when revoked', () => {
    const r = verifyCredentialPayload({ ...baseCred, status: 'revoked' }, schema, vc);
    expect(r.valid).toBe(false);
    expect(r.checks.onChain).toBe(false);
    expect(r.reasons).toContain('credential has been revoked');
  });

  it('fails when expired', () => {
    const past = Math.floor(Date.now() / 1000) - 946684800 - 60;
    const r = verifyCredentialPayload({ ...baseCred, expiration: past }, schema, vc);
    expect(r.valid).toBe(false);
    expect(r.checks.notExpired).toBe(false);
  });

  it('fails when proof signature does not match', () => {
    const tampered = { ...vc, credentialSubject: { ...vc.credentialSubject, role: 'CEO' } };
    const r = verifyCredentialPayload(baseCred, schema, tampered);
    expect(r.checks.proofValid).toBe(false);
    expect(r.valid).toBe(false);
  });

  it('fails when VC.credentialSchema.id does not match sink schema uid', () => {
    const wrongVc = { ...vc, credentialSchema: { ...vc.credentialSchema, id: 'xcs:schema:deadbeef' } };
    const r = verifyCredentialPayload(baseCred, schema, wrongVc);
    expect(r.checks.schemaMatch).toBe(false);
  });

  it('returns nulls for proof checks when no VC supplied (private credential)', () => {
    const r = verifyCredentialPayload(baseCred, schema, null);
    expect(r.checks.proofValid).toBeNull();
    expect(r.checks.schemaMatch).toBeNull();
    expect(r.valid).toBe(true); // on-chain + not-expired only
  });
});
