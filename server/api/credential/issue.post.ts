import { Wallet } from 'xrpl';
import { db } from '../../db';
import { issueCredentialSchema } from '../../utils/validation';
import { useXRPL } from '../../utils/xrpl';
import { pinJSON, gatewayUrl, unpin } from '../../utils/ipfs';
import { buildVC, signVC } from '../../utils/w3c-vc';
import type { JSONValue } from '../../utils/canonical-json';
import type { SchemaDoc } from '~/lib/types/schema';

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event);
    const validated = issueCredentialSchema.parse(body);

    const [schemaRow] = await db<{ uid: string; schema_json: SchemaDoc }[]>`
      SELECT uid, schema_json FROM schemas WHERE uid = ${validated.credentialType} LIMIT 1
    `;
    if (!schemaRow) {
      throw createError({
        statusCode: 404,
        message:
          'Schema not found in registry. Wait for the indexer to process the registration tx.',
      });
    }

    const config = useRuntimeConfig();
    const issuerWallet = Wallet.fromSeed(config.issuerSeed);

    let uri = validated.uri;
    let vcCid: string | null = null;

    if (validated.isPublic) {
      const vc = buildVC({
        issuerAddress: issuerWallet.address,
        issuerPublicKey: issuerWallet.publicKey,
        subjectAddress: validated.subject,
        schemaUid: schemaRow.uid,
        schemaName: schemaRow.schema_json.name,
        data: validated.data as Record<string, JSONValue>,
        expirationDate: validated.expiresAt,
      });
      const signed = signVC(vc, issuerWallet);
      vcCid = await pinJSON(signed);
      uri = gatewayUrl(vcCid);
    }

    const xrpl = useXRPL();
    const expiresAt = validated.expiresAt
      ? new Date(validated.expiresAt)
      : undefined;

    let result;
    try {
      result = await xrpl.createCredential({
        subject: validated.subject,
        credentialType: validated.credentialType,
        uri,
        expiresAt,
      });
    } catch (err) {
      // Pin succeeded but XRPL submit failed — unpin so we don't leak storage cost.
      if (vcCid) {
        await unpin(vcCid).catch(() => {/* best-effort cleanup */});
      }
      throw err;
    }

    return {
      success: true,
      data: {
        txHash: result.txHash,
        ledgerIndex: result.ledgerIndex,
        ipfsCid: vcCid,
        uri: uri ?? null,
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
