import { db } from '../../db';
import { schemas } from '../../db/schema';
import { eq, or } from 'drizzle-orm';
import { z } from 'zod';

const getSchemaQuerySchema = z.object({
  id: z.string().uuid(),
  includeVersions: z
    .string()
    .optional()
    .transform((val) => val === 'true'),
});

export default defineEventHandler(async (event) => {
  try {
    const query = getQuery(event);
    console.log(query);
    const validated = getSchemaQuerySchema.parse(query);

    // Get main schema
    const [schema] = await db
      .select()
      .from(schemas)
      .where(eq(schemas.id, validated.id))
      .limit(1);

    if (!schema) {
      throw createError({
        statusCode: 404,
        message: 'Schema not found',
      });
    }

    let versions: (typeof schema)[] | undefined;

    // If requesting versions, get all related versions
    if (validated.includeVersions) {
      // Find root schema (parent of all versions)
      const rootSchemaId = schema.parentSchemaId || schema.id;

      // Get all schemas with same root (including root itself)
      versions = await db
        .select()
        .from(schemas)
        .where(
          or(
            eq(schemas.id, rootSchemaId),
            eq(schemas.parentSchemaId, rootSchemaId)
          )
        )
        .orderBy(schemas.createdAt);
    }

    return {
      success: true,
      data: {
        schema,
        versions,
      },
    };
  } catch (error) {
    if (error.statusCode) {
      throw error;
    }

    console.error('Error fetching schema:', error);
    throw createError({
      statusCode: 500,
      message: error.message || 'Failed to fetch schema',
    });
  }
});
