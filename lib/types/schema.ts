// lib/types/schema.ts
export interface SchemaField {
  name: string;
  type:
    | 'string'
    | 'number'
    | 'boolean'
    | 'date'
    | 'address'
    | 'object'
    | 'array';
  required: boolean;
  description?: string;
  pattern?: string; // For string validation (regex)
  min?: number; // For number/array validation
  max?: number; // For number/array validation
  properties?: SchemaField[]; // For object type
  items?: SchemaField; // For array type
}

export interface SchemaFields {
  fields: SchemaField[];
}

export interface Schema {
  id: string;
  name: string;
  description?: string;
  version: string;
  fields: SchemaFields;
  creator: string;
  isPublic: boolean;
  ipfsCid?: string;
  parentSchemaId?: string;
  createdAt: Date;
  updatedAt: Date;
}

// lib/types/credential.ts
export interface CredentialData {
  [key: string]: any;
}

export interface Credential {
  id: string;
  schemaId: string;
  issuer: string;
  subject: string;
  vcDocument: W3CVerifiableCredential;
  isPublic: boolean;
  ipfsCid?: string;
  xrplTxHash?: string;
  xrplLedgerIndex?: string;
  credentialType: string;
  accepted: boolean;
  acceptedAt?: Date;
  revoked: boolean;
  revokedAt?: Date;
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// lib/types/w3c-vc.ts
export interface W3CVerifiableCredential {
  '@context': string[];
  id: string;
  type: string[];
  issuer: {
    id: string;
    name?: string;
  };
  issuanceDate: string;
  expirationDate?: string;
  credentialSubject: {
    id: string;
    [key: string]: any;
  };
  credentialSchema?: {
    id: string;
    type: string;
  };
  proof?: {
    type: string;
    created: string;
    verificationMethod: string;
    proofPurpose: string;
    [key: string]: any;
  };
}
