import { db } from '../../db';
import { credentials, schemas } from '../../db/schema';
import { issueCredentialSchema } from '../../utils/validation';
import { validateDataAgainstSchema, generateW3CVC } from '../../utils/w3c-vc';
import { useXRPL } from '../../utils/xrpl';
import { useIPFS } from '../../utils/ipfs';
import { eq } from 'drizzle-orm';

export default defineEventHandler(async (event) => {
  try {
    // Parse and validate request body
    const body = await readBody(event);
    console.log(body);
    const validated = issueCredentialSchema.parse(body);

    // Get schema
    const [schema] = await db
      .select()
      .from(schemas)
      .where(eq(schemas.id, validated.schemaId))
      .limit(1);

    if (!schema) {
      throw createError({
        statusCode: 404,
        message: 'Schema not found',
      });
    }

    // Validate credential data against schema
    const validation = validateDataAgainstSchema(validated.data, schema);
    if (!validation.valid) {
      throw createError({
        statusCode: 400,
        message: 'Data validation failed',
        data: { errors: validation.errors },
      });
    }

    // Generate credential ID
    const credentialId = crypto.randomUUID();

    // Get issuer address
    const xrpl = useXRPL();
    const issuerAddress = xrpl.getIssuerAddress();

    // Parse expiration date if provided
    const expiresAt = validated.expiresAt
      ? new Date(validated.expiresAt)
      : undefined;

    // Generate W3C VC document
    const vcDocument = generateW3CVC({
      credentialId,
      schema,
      issuer: issuerAddress,
      subject: validated.subject,
      data: validated.data,
      expiresAt,
    });

    let ipfsCid: string | undefined;
    let uri: string;

    // If public, publish to IPFS first
    if (validated.isPublic) {
      const ipfs = useIPFS();
      ipfsCid = await ipfs.publish(vcDocument);
      uri = `ipfs://${ipfsCid}`;
    } else {
      // Private: use our service URL
      const config = useRuntimeConfig();
      uri = `${config.public.baseUrl}/credentials/${credentialId}`;
    }

    // Generate credential type identifier (schema name + version)
    const credentialType = `${schema.name}-v${schema.version}`;

    // Create on-chain credential
    const xrplResult = await xrpl.createCredential({
      subject: validated.subject,
      credentialType,
      uri,
      expiresAt,
    });

    // Store in database
    const [credential] = await db
      .insert(credentials)
      .values({
        id: credentialId,
        schemaId: schema.id,
        issuer: issuerAddress,
        subject: validated.subject,
        vcDocument,
        isPublic: validated.isPublic,
        ipfsCid,
        xrplTxHash: xrplResult.txHash,
        xrplLedgerIndex: xrplResult.ledgerIndex.toString(),
        credentialType,
        expiresAt,
      })
      .returning();

    return {
      success: true,
      data: {
        credential,
        ipfsCid,
        xrplTxHash: xrplResult.txHash,
        xrplLedgerIndex: xrplResult.ledgerIndex,
      },
    };
  } catch (error) {
    if (error.statusCode) {
      throw error;
    }

    console.error('Error issuing credential:', error);
    throw createError({
      statusCode: 500,
      message: error.message || 'Failed to issue credential',
    });
  }
});
