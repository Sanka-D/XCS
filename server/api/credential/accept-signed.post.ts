import { acceptSignedSchema } from '../../utils/validation';
import { useXRPL } from '../../utils/xrpl';

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event);
    const { signedTxBlob } = acceptSignedSchema.parse(body);

    const xrpl = useXRPL();
    const result = await xrpl.submitSigned(signedTxBlob);

    return { success: true, data: result };
  } catch (error: any) {
    if (error.statusCode) throw error;
    console.error('Error submitting signed accept:', error);
    throw createError({
      statusCode: 500,
      message: error.message || 'Failed to submit signed transaction',
    });
  }
});
