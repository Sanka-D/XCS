import { db } from '../../db';
import { fetchJSON } from '../../utils/ipfs';
import { verifyCredentialPayload, type SinkSchema, type SinkCredential } from '../../utils/verify-credential';
import type { SignedVC } from '../../utils/w3c-vc';

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const id = typeof query.id === 'string' ? query.id : '';
  if (!id) {
    throw createError({ statusCode: 400, message: 'id query param required' });
  }

  const [cred] = await db<SinkCredential[]>`
    SELECT id, issuer, subject, credential_type, uri, expiration, status
      FROM credentials WHERE id = ${id} LIMIT 1
  `;
  if (!cred) {
    throw createError({ statusCode: 404, message: 'credential not found in sink' });
  }

  const [schema] = await db<SinkSchema[]>`
    SELECT uid, schema_json FROM schemas WHERE uid = ${cred.credential_type} LIMIT 1
  `;
  if (!schema) {
    throw createError({ statusCode: 404, message: 'schema not found in sink' });
  }

  let vc: SignedVC | null = null;
  if (cred.uri) {
    const cidMatch = cred.uri.match(/\/ipfs\/([A-Za-z0-9]+)/);
    if (cidMatch) {
      try {
        vc = await fetchJSON<SignedVC>(cidMatch[1]!);
      } catch (err) {
        // VC fetch failures don't fail the whole verify — they leave proof=null.
        console.warn('verify: failed to fetch VC from', cred.uri, err);
      }
    }
  }

  const result = verifyCredentialPayload(cred, schema, vc);
  return { success: true, data: { credentialId: cred.id, ...result } };
});
