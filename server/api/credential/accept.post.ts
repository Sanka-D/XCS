import { acceptCredentialSchema } from '../../utils/validation';
import { useXRPL } from '../../utils/xrpl';
import { Wallet } from 'xrpl';

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event);
    const validated = acceptCredentialSchema.parse(body);

    // Derive subject address from seed to include in response
    const subjectWallet = Wallet.fromSeed(validated.subjectSeed);

    const xrpl = useXRPL();
    const result = await xrpl.acceptCredential({
      subjectSeed: validated.subjectSeed,
      issuer: validated.issuer,
      credentialType: validated.credentialType,
    });

    return {
      success: true,
      data: {
        txHash: result.txHash,
        subject: subjectWallet.address,
        issuer: validated.issuer,
        credentialType: validated.credentialType,
      },
    };
  } catch (error: any) {
    if (error.statusCode) throw error;
    console.error('Error accepting credential:', error);
    throw createError({
      statusCode: 500,
      message: error.message || 'Failed to accept credential',
    });
  }
});
