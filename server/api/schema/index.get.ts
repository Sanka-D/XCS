import { db } from '../../db';
import { z } from 'zod';

const querySchema = z.object({
  uid: z.string().min(1),
});

export default defineEventHandler(async (event) => {
  try {
    const query = getQuery(event);
    const validated = querySchema.parse(query);

    const [schema] = await db`
      SELECT * FROM schemas WHERE uid = ${validated.uid} LIMIT 1
    `;

    if (!schema) {
      throw createError({ statusCode: 404, message: 'Schema not found' });
    }

    // Walk parent chain (oldest ancestor first)
    const ancestors: any[] = [];
    let cursor: string = schema.parent_uid ?? '';
    while (cursor) {
      const [row] = await db<any[]>`
        SELECT uid, parent_uid, schema_json, ledger_index
        FROM schemas WHERE uid = ${cursor} LIMIT 1
      `;
      if (!row) break;
      ancestors.unshift(row);
      cursor = row.parent_uid ?? '';
    }

    // Fetch direct children
    const descendants = await db<any[]>`
      SELECT uid, parent_uid, schema_json, ledger_index
      FROM schemas WHERE parent_uid = ${schema.uid}
    `;

    return {
      success: true,
      data: { schema, ancestors, descendants },
    };
  } catch (error: any) {
    if (error.statusCode) throw error;
    console.error('Error fetching schema:', error);
    throw createError({
      statusCode: 500,
      message: error.message || 'Failed to fetch schema',
    });
  }
});
