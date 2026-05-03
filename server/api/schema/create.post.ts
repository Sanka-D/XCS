import { createSchemaSchema } from '../../utils/validation';
import { useXRPL } from '../../utils/xrpl';

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event);
    const validated = createSchemaSchema.parse(body);

    const xrpl = useXRPL();

    const schemaDoc = {
      name: validated.name,
      ...(validated.description ? { description: validated.description } : {}),
      version: validated.version,
      fields: validated.fields,
    };

    const result = await xrpl.registerSchema(schemaDoc);

    return {
      success: true,
      data: {
        uid: result.uid,
        txHash: result.txHash,
        ledgerIndex: result.ledgerIndex,
        status: 'pending',
      },
    };
  } catch (error: any) {
    if (error.statusCode) throw error;
    console.error('Error registering schema:', error);
    throw createError({
      statusCode: 500,
      message: error.message || 'Failed to register schema',
    });
  }
});
