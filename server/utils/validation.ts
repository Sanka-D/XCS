import { z } from 'zod';

export const schemaFieldSchema: z.ZodType<{
  name: string;
  type: 'string' | 'number' | 'boolean' | 'date' | 'address' | 'object' | 'array';
  required: boolean;
  description?: string;
  pattern?: string;
  min?: number;
  max?: number;
  properties?: any[];
  items?: any;
}> = z.object({
  name: z.string().min(1).max(100),
  type: z.enum([
    'string',
    'number',
    'boolean',
    'date',
    'address',
    'object',
    'array',
  ]),
  required: z.boolean(),
  description: z.string().optional(),
  pattern: z.string().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  properties: z.array(z.lazy(() => schemaFieldSchema)).optional(),
  items: z.lazy(() => schemaFieldSchema).optional(),
});

// Schema registration — builds a Payment tx with xcs:schema_register memo
export const createSchemaSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  version: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/)
    .default('1.0.0'),
  fields: z.array(schemaFieldSchema).min(1),
  isPublic: z.boolean().default(false),
});

// Credential issuance — builds a CredentialCreate tx with xcs:credential_create memo
// credentialType = schema UID (hex string from the schemas table)
export const issueCredentialSchema = z.object({
  credentialType: z.string().min(1),
  subject: z.string().regex(/^r[1-9A-HJ-NP-Za-km-z]{25,34}$/),
  data: z.record(z.string(), z.unknown()).default({}),
  isPublic: z.boolean().default(false),
  uri: z.string().optional(),
  expiresAt: z.string().optional(),
});

// Credential acceptance — builds a CredentialAccept tx
export const acceptCredentialSchema = z.object({
  issuer: z.string().min(1),
  credentialType: z.string().min(1),
  subjectSeed: z.string().min(29),
});

// Credential revocation — builds a CredentialDelete tx (issuer = env seed)
export const revokeCredentialSchema = z.object({
  subject: z.string().min(1),
  credentialType: z.string().min(1),
});

export const listSchemasSchema = z.object({
  issuer: z.string().optional(),
  search: z.string().optional(),
  limit: z.number().min(1).max(100).default(50),
  offset: z.number().min(0).default(0),
});

export const listCredentialsSchema = z.object({
  issuer: z.string().optional(),
  subject: z.string().optional(),
  credentialType: z.string().optional(),
  status: z.enum(['created', 'accepted', 'revoked']).optional(),
  limit: z.number().min(1).max(100).default(50),
  offset: z.number().min(0).default(0),
});

export const acceptSignedSchema = z.object({
  signedTxBlob: z.string().min(1),
});
