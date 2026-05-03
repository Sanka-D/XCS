import { describe, it, expect } from 'vitest';
import { Wallet } from 'xrpl';
import {
  buildVC,
  signVC,
  verifyVC,
  type VCInput,
} from '../server/utils/w3c-vc';

const issuerWallet = Wallet.fromSeed('sEdTM1uX8pu2do5XvTnutH6HsouMaM2');
// ^ deterministic Ed25519 testnet seed; never use in production.

const baseInput: VCInput = {
  issuerAddress: issuerWallet.address,
  issuerPublicKey: issuerWallet.publicKey,
  subjectAddress: 'rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe',
  schemaUid: '0123456789abcdef',
  schemaName: 'EmploymentCredential',
  data: { employer: 'Acme', role: 'Engineer' },
  issuanceDate: '2026-05-03T12:00:00Z',
};

describe('buildVC', () => {
  it('produces a W3C-compliant unsigned VC', () => {
    const vc = buildVC(baseInput);
    expect(vc['@context']).toContain('https://www.w3.org/2018/credentials/v1');
    expect(vc.type).toEqual(['VerifiableCredential', 'EmploymentCredential']);
    expect(vc.issuer).toBe(`did:xrpl:${baseInput.issuerAddress}`);
    expect(vc.credentialSubject.id).toBe(`did:xrpl:${baseInput.subjectAddress}`);
    expect(vc.credentialSubject.employer).toBe('Acme');
    expect(vc.credentialSchema.id).toBe('xcs:schema:0123456789abcdef');
    expect(vc.proof).toBeUndefined();
  });

  it('includes expirationDate when supplied', () => {
    const vc = buildVC({ ...baseInput, expirationDate: '2027-01-01T00:00:00Z' });
    expect(vc.expirationDate).toBe('2027-01-01T00:00:00Z');
  });
});

describe('signVC + verifyVC', () => {
  it('signs and verifies a VC roundtrip', () => {
    const vc = buildVC(baseInput);
    const signed = signVC(vc, issuerWallet);
    expect(signed.proof.proofValue).toMatch(/^[0-9A-F]+$/);
    expect(signed.proof.publicKeyHex).toBe(issuerWallet.publicKey);
    expect(verifyVC(signed)).toBe(true);
  });

  it('rejects tampered credentialSubject', () => {
    const signed = signVC(buildVC(baseInput), issuerWallet);
    signed.credentialSubject.role = 'CEO';
    expect(verifyVC(signed)).toBe(false);
  });

  it('rejects mismatched publicKey', () => {
    const signed = signVC(buildVC(baseInput), issuerWallet);
    const otherWallet = Wallet.fromSeed('sEdSKaCy2JT7JaM7v95H9SxkhP9wS2r');
    signed.proof.publicKeyHex = otherWallet.publicKey;
    expect(verifyVC(signed)).toBe(false);
  });
});
