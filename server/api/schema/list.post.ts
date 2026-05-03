import { db } from '../../db';
import { listSchemasSchema } from '../../utils/validation';

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event);
    const validated = listSchemasSchema.parse(body);

    const issuer = validated.issuer ?? null;
    const search = validated.search ? `%${validated.search}%` : null;

    const countRows = await db`
      SELECT count(*) as count
      FROM schemas
      WHERE (${issuer}::text IS NULL OR issuer = ${issuer})
        AND (${search}::text IS NULL OR schema_json::text ILIKE ${search})
    `;
    const total = Number(countRows[0]?.count ?? 0);

    const results = await db`
      SELECT *
      FROM schemas
      WHERE (${issuer}::text IS NULL OR issuer = ${issuer})
        AND (${search}::text IS NULL OR schema_json::text ILIKE ${search})
      ORDER BY ledger_index DESC
      LIMIT ${validated.limit}
      OFFSET ${validated.offset}
    `;

    return {
      success: true,
      data: {
        schemas: results,
        total,
        limit: validated.limit,
        offset: validated.offset,
      },
    };
  } catch (error: any) {
    console.error('Error listing schemas:', error);
    throw createError({
      statusCode: 500,
      message: error.message || 'Failed to list schemas',
    });
  }
});
