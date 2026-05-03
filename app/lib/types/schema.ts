// Field definition shared between schema doc and frontend forms
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
  pattern?: string;
  min?: number;
  max?: number;
  properties?: SchemaField[];
  items?: SchemaField;
}

// The JSON document stored inside schema_json JSONB column
export interface SchemaDoc {
  name: string;
  description?: string;
  version: string;
  fields: SchemaField[];
  ipfsCid?: string; // populated when isPublic = true
  parentUid?: string; // optional parent schema for versioning
}

// Row from the substreams-sink-sql `schemas` table
export interface Schema {
  uid: string;
  issuer: string;
  schema_json: SchemaDoc;
  ledger_index: number;
  tx_index: number;
  tx_hash: string;
  parent_uid?: string;
}

// Row from the substreams-sink-sql `credentials` table
export interface Credential {
  id: string; // "issuer:subject:credential_type"
  issuer: string;
  subject: string;
  credential_type: string; // schema UID (hex)
  uri?: string;
  expiration?: number; // Ripple epoch seconds
  created_ledger?: number;
  status: 'created' | 'accepted' | 'revoked';
  tx_hash: string;
}
