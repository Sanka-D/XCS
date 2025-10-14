import { db } from '../../db';
import { schemas } from '../../db/schema';
import { listSchemasSchema } from '../../utils/validation';
import { eq, and, ilike, or, sql } from 'drizzle-orm';

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event);
    const validated = listSchemasSchema.parse(body);

    // Build query conditions
    const conditions = [];

    if (validated.creator) {
      conditions.push(eq(schemas.creator, validated.creator));
    }

    if (validated.isPublic !== undefined) {
      conditions.push(eq(schemas.isPublic, validated.isPublic));
    }

    if (validated.search) {
      conditions.push(
        or(
          ilike(schemas.name, `%${validated.search}%`),
          ilike(schemas.description, `%${validated.search}%`)
        )
      );
    }

    // Get total count
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(schemas)
      .where(conditions.length > 0 ? and(...conditions) : undefined);

    // Get paginated results
    const results = await db
      .select()
      .from(schemas)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(schemas.createdAt)
      .limit(validated.limit)
      .offset(validated.offset);

    return {
      success: true,
      data: {
        schemas: results,
        total: Number(count),
        limit: validated.limit,
        offset: validated.offset,
      },
    };
  } catch (error) {
    console.error('Error listing schemas:', error);
    throw createError({
      statusCode: 500,
      message: error.message || 'Failed to list schemas',
    });
  }
});
