import { revokeCredentialSchema } from '../../utils/validation';
import { useXRPL } from '../../utils/xrpl';

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event);
    const validated = revokeCredentialSchema.parse(body);

    const xrpl = useXRPL();

    const result = await xrpl.deleteCredential({
      subject: validated.subject,
      credentialType: validated.credentialType,
    });

    return {
      success: true,
      data: {
        txHash: result.txHash,
        subject: validated.subject,
        credentialType: validated.credentialType,
      },
    };
  } catch (error: any) {
    if (error.statusCode) throw error;
    console.error('Error revoking credential:', error);
    throw createError({
      statusCode: 500,
      message: error.message || 'Failed to revoke credential',
    });
  }
});
