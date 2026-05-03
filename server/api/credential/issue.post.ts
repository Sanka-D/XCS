import { db } from '../../db';
import { issueCredentialSchema } from '../../utils/validation';
import { useXRPL } from '../../utils/xrpl';

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event);
    const validated = issueCredentialSchema.parse(body);

    // Verify the schema exists in the sink DB before issuing
    const [schema] = await db`
      SELECT uid FROM schemas WHERE uid = ${validated.credentialType} LIMIT 1
    `;

    if (!schema) {
      throw createError({
        statusCode: 404,
        message: 'Schema not found in registry. Wait for the indexer to process the registration tx.',
      });
    }

    const xrpl = useXRPL();
    const expiresAt = validated.expiresAt ? new Date(validated.expiresAt) : undefined;

    const result = await xrpl.createCredential({
      subject: validated.subject,
      credentialType: validated.credentialType,
      uri: validated.uri,
      expiresAt,
    });

    return {
      success: true,
      data: {
        txHash: result.txHash,
        ledgerIndex: result.ledgerIndex,
        status: 'pending',
      },
    };
  } catch (error: any) {
    if (error.statusCode) throw error;
    console.error('Error issuing credential:', error);
    throw createError({
      statusCode: 500,
      message: error.message || 'Failed to issue credential',
    });
  }
});
