import { db } from '../../db';
import { credentials } from '../../db/schema';
import { listCredentialsSchema } from '../../utils/validation';
import { eq, and, sql } from 'drizzle-orm';

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event);
    const validated = listCredentialsSchema.parse(body);

    // Build query conditions
    const conditions = [];

    if (validated.issuer) {
      conditions.push(eq(credentials.issuer, validated.issuer));
    }

    if (validated.subject) {
      conditions.push(eq(credentials.subject, validated.subject));
    }

    if (validated.schemaId) {
      conditions.push(eq(credentials.schemaId, validated.schemaId));
    }

    if (validated.accepted !== undefined) {
      conditions.push(eq(credentials.accepted, validated.accepted));
    }

    if (validated.revoked !== undefined) {
      conditions.push(eq(credentials.revoked, validated.revoked));
    }

    if (validated.isPublic !== undefined) {
      conditions.push(eq(credentials.isPublic, validated.isPublic));
    }

    // Get total count
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(credentials)
      .where(conditions.length > 0 ? and(...conditions) : undefined);

    // Get paginated results
    const results = await db
      .select()
      .from(credentials)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(credentials.createdAt)
      .limit(validated.limit)
      .offset(validated.offset);

    return {
      success: true,
      data: {
        credentials: results,
        total: Number(count),
        limit: validated.limit,
        offset: validated.offset,
      },
    };
  } catch (error) {
    console.error('Error listing credentials:', error);
    throw createError({
      statusCode: 500,
      message: error.message || 'Failed to list credentials',
    });
  }
});
