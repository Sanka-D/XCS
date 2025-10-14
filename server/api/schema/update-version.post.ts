import { db } from '../../db';
import { schemas } from '../../db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { schemaFieldSchema } from '../../utils/validation';
import { useXRPL } from '../../utils/xrpl';
import { useIPFS } from '../../utils/ipfs';

const updateVersionSchema = z.object({
  parentSchemaId: z.string().uuid(),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  fields: z.array(schemaFieldSchema).min(1),
  description: z.string().optional(),
});

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event);
    const validated = updateVersionSchema.parse(body);

    // Get parent schema
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

    // Get creator address (from env for MVP)
    const xrpl = useXRPL();
    const creatorAddress = xrpl.getIssuerAddress();

    // Verify creator owns parent
    if (parent.creator !== creatorAddress) {
      throw createError({
        statusCode: 403,
        message: 'You do not own the parent schema',
      });
    }

    // Check if version already exists for this schema lineage
    const rootSchemaId = parent.parentSchemaId || parent.id;
    const existingVersion = await db
      .select()
      .from(schemas)
      .where(eq(schemas.version, validated.version))
      .where(
        eq(
          schemas.parentSchemaId,
          rootSchemaId === parent.id ? parent.id : rootSchemaId
        )
      )
      .limit(1);

    if (existingVersion.length > 0) {
      throw createError({
        statusCode: 409,
        message: `Version ${validated.version} already exists for this schema`,
      });
    }

    // Prepare new schema version
    let ipfsCid: string | undefined;

    if (parent.isPublic) {
      const ipfs = useIPFS();
      const schemaDocument = {
        name: parent.name,
        description: validated.description || parent.description,
        version: validated.version,
        fields: validated.fields,
        creator: creatorAddress,
        parentVersion: parent.version,
        createdAt: new Date().toISOString(),
      };

      ipfsCid = await ipfs.publish(schemaDocument);
    }

    // Insert new version
    const [newSchema] = await db
      .insert(schemas)
      .values({
        name: parent.name, // Keep same name
        description: validated.description || parent.description,
        version: validated.version,
        fields: { fields: validated.fields },
        creator: creatorAddress,
        isPublic: parent.isPublic,
        ipfsCid,
        parentSchemaId: validated.parentSchemaId,
      })
      .returning();

    return {
      success: true,
      data: {
        schema: newSchema,
        ipfsCid,
      },
    };
  } catch (error) {
    if (error.statusCode) {
      throw error;
    }

    console.error('Error updating schema version:', error);
    throw createError({
      statusCode: 500,
      message: error.message || 'Failed to update schema version',
    });
  }
});
