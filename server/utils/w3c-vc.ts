import { Wallet } from 'xrpl';
import { sign as keypairSign, verify as keypairVerify } from 'ripple-keypairs';
import { canonicalize, type JSONValue } from './canonical-json';

export interface VCInput {
  issuerAddress: string;
  issuerPublicKey: string;
  subjectAddress: string;
  schemaUid: string;
  schemaName: string;
  data: Record<string, JSONValue>;
  issuanceDate?: string;
  expirationDate?: string;
}

export interface UnsignedVC {
  '@context': string[];
  type: string[];
  issuer: string;
  issuanceDate: string;
  expirationDate?: string;
  credentialSubject: { id: string } & Record<string, JSONValue>;
  credentialSchema: { id: string; type: string };
  proof?: never;
}

export interface VCProof {
  type: 'XrplKey2026';
  created: string;
  verificationMethod: string;
  proofPurpose: 'assertionMethod';
  publicKeyHex: string;
  proofValue: string; // hex signature of canonical(VC without proof)
}

export interface SignedVC extends Omit<UnsignedVC, 'proof'> {
  proof: VCProof;
}

const W3C_CONTEXT = 'https://www.w3.org/2018/credentials/v1';
const XCS_CONTEXT = 'https://xcs.xrpl/credentials/v1';

export function buildVC(input: VCInput): UnsignedVC {
  return {
    '@context': [W3C_CONTEXT, XCS_CONTEXT],
    type: ['VerifiableCredential', input.schemaName],
    issuer: `did:xrpl:${input.issuerAddress}`,
    issuanceDate: input.issuanceDate ?? new Date().toISOString(),
    ...(input.expirationDate ? { expirationDate: input.expirationDate } : {}),
    credentialSubject: {
      id: `did:xrpl:${input.subjectAddress}`,
      ...input.data,
    },
    credentialSchema: {
      id: `xcs:schema:${input.schemaUid}`,
      type: 'XCSSchemaValidator2026',
    },
  };
}

export function signVC(vc: UnsignedVC, wallet: Wallet): SignedVC {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- UnsignedVC has `proof?: never` for type discrimination; cast needed to pass to canonicalize
  const canonical = canonicalize(vc as any);
  const messageHex = Buffer.from(canonical, 'utf8').toString('hex').toUpperCase();
  const signature = keypairSign(messageHex, wallet.privateKey);

  return {
    ...vc,
    proof: {
      type: 'XrplKey2026',
      created: new Date().toISOString(),
      verificationMethod: `did:xrpl:${wallet.address}#key-1`,
      proofPurpose: 'assertionMethod',
      publicKeyHex: wallet.publicKey,
      proofValue: signature,
    },
  };
}

export function verifyVC(signed: SignedVC): boolean {
  const { proof, ...unsigned } = signed;
  if (!proof || proof.type !== 'XrplKey2026') return false;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- unsigned has `proof?: never` stripped; cast needed to pass to canonicalize
  const canonical = canonicalize(unsigned as any);
  const messageHex = Buffer.from(canonical, 'utf8').toString('hex').toUpperCase();

  try {
    return keypairVerify(messageHex, proof.proofValue, proof.publicKeyHex);
  } catch {
    return false;
  }
}
