import { db } from '../../db';
import { z } from 'zod';

const querySchema = z.object({
  id: z.string().min(1),
});

export default defineEventHandler(async (event) => {
  try {
    const query = getQuery(event);
    const validated = querySchema.parse(query);

    const [credential] = await db`
      SELECT * FROM credentials WHERE id = ${validated.id} LIMIT 1
    `;

    if (!credential) {
      throw createError({ statusCode: 404, message: 'Credential not found' });
    }

    // Fetch the associated schema from the registry
    const [schema] = await db`
      SELECT * FROM schemas WHERE uid = ${credential.credential_type} LIMIT 1
    `;

    const nowRipple = Math.floor(Date.now() / 1000) - 946684800;
    const decorated = {
      ...credential,
      isExpired: !!credential.expiration && credential.expiration > 0 && credential.expiration <= nowRipple,
    };

    return {
      success: true,
      data: { credential: decorated, schema: schema ?? null },
    };
  } catch (error: any) {
    if (error.statusCode) throw error;
    console.error('Error fetching credential:', error);
    throw createError({
      statusCode: 500,
      message: error.message || 'Failed to fetch credential',
    });
  }
});
