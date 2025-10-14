// server/api/schema/create.post.ts
import { db } from '../../db';
import { schemas } from '../../db/schema';
import { createSchemaSchema } from '../../utils/validation';
import { useXRPL } from '../../utils/xrpl';
import { useIPFS } from '../../utils/ipfs';

export default defineEventHandler(async (event) => {
  try {
    // Parse and validate request body
    const body = await readBody(event);
    const validated = createSchemaSchema.parse(body);

    // Get creator address (from env for MVP)
    const xrpl = useXRPL();
    const creatorAddress = xrpl.getIssuerAddress();

    // If updating version, verify parent exists
    if (validated.parentSchemaId) {
      const [parent] = await db
        .select()
        .from(schemas)
        .where(eq(schemas.id, validated.parentSchemaId))
        .limit(1);

      if (!parent) {
        throw createError({
          statusCode: 404,
          message: 'Parent schema not found',
        });
      }

      // Verify creator owns parent
      if (parent.creator !== creatorAddress) {
        throw createError({
          statusCode: 403,
          message: 'You do not own the parent schema',
        });
      }
    }

    // Prepare schema object for IPFS (if public)
    let ipfsCid: string | undefined;

    if (validated.isPublic) {
      const ipfs = useIPFS();
      const schemaDocument = {
        name: validated.name,
        description: validated.description,
        version: validated.version,
        fields: validated.fields,
        creator: creatorAddress,
        createdAt: new Date().toISOString(),
      };

      ipfsCid = await ipfs.publish(schemaDocument);
    }

    // Insert into database
    const [schema] = await db
      .insert(schemas)
      .values({
        name: validated.name,
        description: validated.description,
        version: validated.version,
        fields: { fields: validated.fields },
        creator: creatorAddress,
        isPublic: validated.isPublic,
        ipfsCid,
        parentSchemaId: validated.parentSchemaId,
      })
      .returning();

    return {
      success: true,
      data: {
        schema,
        ipfsCid,
      },
    };
  } catch (error) {
    if (error.statusCode) {
      throw error;
    }

    console.error('Error creating schema:', error);
    throw createError({
      statusCode: 500,
      message: error.message || 'Failed to create schema',
    });
  }
});
