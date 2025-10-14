import type {
  W3CVerifiableCredential,
  Schema,
  CredentialData,
  SchemaField,
} from '~/lib/types/schema';

export function generateW3CVC(params: {
  credentialId: string;
  schema: Schema;
  issuer: string;
  subject: string;
  data: CredentialData;
  expiresAt?: Date;
}): W3CVerifiableCredential {
  const now = new Date();

  return {
    '@context': [
      'https://www.w3.org/2018/credentials/v1',
      'https://w3id.org/security/suites/ed25519-2020/v1',
    ],
    id: `urn:uuid:${params.credentialId}`,
    type: ['VerifiableCredential', sanitizeSchemaName(params.schema.name)],
    issuer: {
      id: `did:xrpl:testnet:${params.issuer}`,
      name: 'XRPL Credential Platform',
    },
    issuanceDate: now.toISOString(),
    expirationDate: params.expiresAt?.toISOString(),
    credentialSubject: {
      id: `did:xrpl:testnet:${params.subject}`,
      ...params.data,
    },
    credentialSchema: {
      id: params.schema.ipfsCid
        ? `ipfs://${params.schema.ipfsCid}`
        : `https://platform.example.com/schemas/${params.schema.id}`,
      type: 'JsonSchema',
    },
  };
}

export function validateDataAgainstSchema(
  data: CredentialData,
  schema: Schema
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  for (const field of schema.fields.fields) {
    // Check required fields
    if (field.required && !(field.name in data)) {
      errors.push(`Required field missing: ${field.name}`);
      continue;
    }

    // If field present, validate type
    if (field.name in data) {
      const value = data[field.name];

      if (!validateFieldType(value, field)) {
        errors.push(
          `Invalid type for ${field.name}: expected ${field.type}, got ${typeof value}`
        );
      }

      // Additional validations
      if (field.type === 'string' && field.pattern) {
        const regex = new RegExp(field.pattern);
        if (!regex.test(value)) {
          errors.push(
            `Field ${field.name} does not match pattern: ${field.pattern}`
          );
        }
      }

      if (field.type === 'number') {
        if (field.min !== undefined && value < field.min) {
          errors.push(`Field ${field.name} is below minimum: ${field.min}`);
        }
        if (field.max !== undefined && value > field.max) {
          errors.push(`Field ${field.name} exceeds maximum: ${field.max}`);
        }
      }

      if (field.type === 'array') {
        if (field.min !== undefined && value.length < field.min) {
          errors.push(
            `Array ${field.name} has fewer items than minimum: ${field.min}`
          );
        }
        if (field.max !== undefined && value.length > field.max) {
          errors.push(
            `Array ${field.name} has more items than maximum: ${field.max}`
          );
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

function validateFieldType(value: any, field: SchemaField): boolean {
  switch (field.type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && !isNaN(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'date':
      return !isNaN(Date.parse(value));
    case 'address':
      return /^r[1-9A-HJ-NP-Za-km-z]{25,34}$/.test(value);
    case 'object':
      return typeof value === 'object' && !Array.isArray(value);
    case 'array':
      return Array.isArray(value);
    default:
      return false;
  }
}

function sanitizeSchemaName(name: string): string {
  // Convert to PascalCase and remove special chars for W3C type
  return name
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('');
}
