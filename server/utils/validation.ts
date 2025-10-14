import { z } from 'zod';

export const schemaFieldSchema = z.object({
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

export const createSchemaSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  version: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/)
    .default('1.0.0'),
  fields: z.array(schemaFieldSchema).min(1),
  isPublic: z.boolean(),
  parentSchemaId: z.string().uuid().optional(),
});

export const issueCredentialSchema = z.object({
  schemaId: z.string().uuid(),
  subject: z.string().regex(/^r[1-9A-HJ-NP-Za-km-z]{25,34}$/),
  data: z.record(z.string(), z.any()),
  isPublic: z.boolean(),
  expiresAt: z.string().optional(),
});

export const acceptCredentialSchema = z.object({
  credentialId: z.string().uuid(),
  subjectSeed: z.string().min(29),
});

export const listSchemasSchema = z.object({
  creator: z.string().optional(),
  isPublic: z.boolean().optional(),
  search: z.string().optional(),
  limit: z.number().min(1).max(100).default(50),
  offset: z.number().min(0).default(0),
});

export const listCredentialsSchema = z.object({
  issuer: z.string().optional(),
  subject: z.string().optional(),
  schemaId: z.string().uuid().optional(),
  accepted: z.boolean().optional(),
  revoked: z.boolean().optional(),
  isPublic: z.boolean().optional(),
  limit: z.number().min(1).max(100).default(50),
  offset: z.number().min(0).default(0),
});
