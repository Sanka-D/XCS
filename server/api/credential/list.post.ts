import { db } from '../../db';
import { listCredentialsSchema } from '../../utils/validation';

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event);
    const validated = listCredentialsSchema.parse(body);

    const issuer = validated.issuer ?? null;
    const subject = validated.subject ?? null;
    const credentialType = validated.credentialType ?? null;
    const status = validated.status ?? null;

    const countRows = await db`
      SELECT count(*) as count
      FROM credentials
      WHERE (${issuer}::text IS NULL OR issuer = ${issuer})
        AND (${subject}::text IS NULL OR subject = ${subject})
        AND (${credentialType}::text IS NULL OR credential_type = ${credentialType})
        AND (${status}::text IS NULL OR status = ${status})
    `;
    const total = Number(countRows[0]?.count ?? 0);

    const results = await db`
      SELECT *
      FROM credentials
      WHERE (${issuer}::text IS NULL OR issuer = ${issuer})
        AND (${subject}::text IS NULL OR subject = ${subject})
        AND (${credentialType}::text IS NULL OR credential_type = ${credentialType})
        AND (${status}::text IS NULL OR status = ${status})
      ORDER BY created_ledger DESC NULLS LAST
      LIMIT ${validated.limit}
      OFFSET ${validated.offset}
    `;

    return {
      success: true,
      data: {
        credentials: results,
        total,
        limit: validated.limit,
        offset: validated.offset,
      },
    };
  } catch (error: any) {
    console.error('Error listing credentials:', error);
    throw createError({
      statusCode: 500,
      message: error.message || 'Failed to list credentials',
    });
  }
});
