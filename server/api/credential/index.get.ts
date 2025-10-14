import { db } from '../../db';
import { credentials, schemas } from '../../db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

const getCredentialQuerySchema = z.object({
  id: z.string().uuid(),
});

export default defineEventHandler(async (event) => {
  try {
    const query = getQuery(event);
    const validated = getCredentialQuerySchema.parse(query);

    // Get credential
    const [credential] = await db
      .select()
      .from(credentials)
      .where(eq(credentials.id, validated.id))
      .limit(1);

    if (!credential) {
      throw createError({
        statusCode: 404,
        message: 'Credential not found',
      });
    }

    // Get associated schema
    const [schema] = await db
      .select()
      .from(schemas)
      .where(eq(schemas.id, credential.schemaId))
      .limit(1);

    if (!schema) {
      throw createError({
        statusCode: 500,
        message: 'Associated schema not found',
      });
    }

    return {
      success: true,
      data: {
        credential,
        schema,
      },
    };
  } catch (error) {
    if (error.statusCode) {
      throw error;
    }

    console.error('Error fetching credential:', error);
    throw createError({
      statusCode: 500,
      message: error.message || 'Failed to fetch credential',
    });
  }
});
