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

    return {
      success: true,
      data: { schema },
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
