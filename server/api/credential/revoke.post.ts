import { db } from '../../db';
import { credentials } from '../../db/schema';
import { useXRPL } from '../../utils/xrpl';
import { useIPFS } from '../../utils/ipfs';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

const revokeSchema = z.object({
  credentialId: z.string().uuid(),
});

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event);
    const validated = revokeSchema.parse(body);

    // Get credential
    const [credential] = await db
      .select()
      .from(credentials)
      .where(eq(credentials.id, validated.credentialId))
      .limit(1);

    if (!credential) {
      throw createError({
        statusCode: 404,
        message: 'Credential not found',
      });
    }

    // Verify issuer (in MVP, check against env issuer)
    const xrpl = useXRPL();
    const issuerAddress = xrpl.getIssuerAddress();

    if (credential.issuer !== issuerAddress) {
      throw createError({
        statusCode: 403,
        message: 'Only issuer can revoke credential',
      });
    }

    // Check if already revoked
    if (credential.revoked) {
      throw createError({
        statusCode: 400,
        message: 'Credential already revoked',
      });
    }

    // Delete from XRPL
    const xrplResult = await xrpl.deleteCredential({
      subject: credential.subject,
      credentialType: credential.credentialType,
    });

    // Unpin from IPFS if public
    let ipfsUnpinned = false;
    if (credential.isPublic && credential.ipfsCid) {
      const ipfs = useIPFS();
      ipfsUnpinned = await ipfs.unpin(credential.ipfsCid);
    }

    // Update database
    const [updatedCredential] = await db
      .update(credentials)
      .set({
        revoked: true,
        revokedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(credentials.id, validated.credentialId))
      .returning();

    return {
      success: true,
      data: {
        credential: updatedCredential,
        xrplTxHash: xrplResult.txHash,
        ipfsUnpinned,
      },
    };
  } catch (error) {
    if (error.statusCode) {
      throw error;
    }

    console.error('Error revoking credential:', error);
    throw createError({
      statusCode: 500,
      message: error.message || 'Failed to revoke credential',
    });
  }
});
