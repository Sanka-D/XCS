import { createSchemaSchema } from '../../utils/validation';
import { useXRPL } from '../../utils/xrpl';
import { pinJSON, unpin } from '../../utils/ipfs';
import { db } from '../../db';

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event);
    const validated = createSchemaSchema.parse(body);

    if (validated.parentUid) {
      const [parent] = await db<{ uid: string }[]>`
        SELECT uid FROM schemas WHERE uid = ${validated.parentUid} LIMIT 1
      `;
      if (!parent) {
        throw createError({
          statusCode: 400,
          message: 'parentUid does not exist in the registry',
        });
      }
    }

    const schemaDoc = {
      name: validated.name,
      ...(validated.description ? { description: validated.description } : {}),
      version: validated.version,
      fields: validated.fields,
    };

    let ipfsCid: string | undefined;
    if (validated.isPublic) {
      ipfsCid = await pinJSON(schemaDoc);
    }

    const xrpl = useXRPL();
    let result;
    try {
      result = await xrpl.registerSchema({ ...schemaDoc, ipfsCid, parentUid: validated.parentUid });
    } catch (err) {
      if (ipfsCid) {
        await unpin(ipfsCid).catch(() => {/* best-effort cleanup */});
      }
      throw err;
    }

    return {
      success: true,
      data: {
        uid: result.uid,
        txHash: result.txHash,
        ledgerIndex: result.ledgerIndex,
        ipfsCid: ipfsCid ?? null,
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
