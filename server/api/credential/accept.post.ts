import { db } from '../../db';
import { credentials } from '../../db/schema';
import { acceptCredentialSchema } from '../../utils/validation';
import { useXRPL } from '../../utils/xrpl';
import { eq, and } from 'drizzle-orm';
import { Wallet } from 'xrpl';

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event);
    const validated = acceptCredentialSchema.parse(body);

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

    // Check if already accepted
    if (credential.accepted) {
      throw createError({
        statusCode: 400,
        message: 'Credential already accepted',
      });
    }

    // Verify subject seed matches credential subject
    const subjectWallet = Wallet.fromSeed(validated.subjectSeed);
    if (subjectWallet.address !== credential.subject) {
      throw createError({
        statusCode: 403,
        message: 'Subject seed does not match credential subject',
      });
    }

    // Accept on XRPL
    const xrpl = useXRPL();
    const xrplResult = await xrpl.acceptCredential({
      subjectSeed: validated.subjectSeed,
      issuer: credential.issuer,
      credentialType: credential.credentialType,
    });

    // Update database
    const [updatedCredential] = await db
      .update(credentials)
      .set({
        accepted: true,
        acceptedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(credentials.id, validated.credentialId))
      .returning();

    return {
      success: true,
      data: {
        credential: updatedCredential,
        xrplTxHash: xrplResult.txHash,
      },
    };
  } catch (error) {
    if (error.statusCode) {
      throw error;
    }

    console.error('Error accepting credential:', error);
    throw createError({
      statusCode: 500,
      message: error.message || 'Failed to accept credential',
    });
  }
});
