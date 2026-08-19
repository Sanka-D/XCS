import {
  credentialEvents,
  credentialGenerations,
  ledgerCheckpoints,
  networkProfiles,
  schemas,
  type XcsDatabase,
} from '@xcs-protocol/db'
import { and, asc, desc, eq, gt, or, sql } from 'drizzle-orm'

import type { ApiRepository } from './types.js'

export class PostgresApiRepository implements ApiRepository {
  constructor(private readonly db: XcsDatabase) {}

  async ping(): Promise<void> {
    await this.db.execute(sql`select 1`)
  }

  listNetworks() {
    return this.db
      .select()
      .from(networkProfiles)
      .where(eq(networkProfiles.enabled, true))
      .orderBy(asc(networkProfiles.profileId))
  }

  async getNetwork(profileId: string) {
    const [row] = await this.db
      .select()
      .from(networkProfiles)
      .where(and(eq(networkProfiles.profileId, profileId), eq(networkProfiles.enabled, true)))
      .limit(1)
    return row
  }

  async getLatestCheckpoint(profileId: string) {
    const [row] = await this.db
      .select()
      .from(ledgerCheckpoints)
      .where(eq(ledgerCheckpoints.profileId, profileId))
      .orderBy(desc(ledgerCheckpoints.ledgerIndex))
      .limit(1)
    return row
  }

  async getSchema(profileId: string, schemaUid: string) {
    const [row] = await this.db
      .select()
      .from(schemas)
      .where(and(eq(schemas.profileId, profileId), eq(schemas.schemaUid, schemaUid)))
      .limit(1)
    return row
  }

  listSchemas(input: Parameters<ApiRepository['listSchemas']>[0]) {
    const filters = [eq(schemas.profileId, input.profileId)]
    if (input.publisher !== undefined) {
      filters.push(eq(schemas.publisher, input.publisher))
    }
    if (input.cursor !== undefined) {
      filters.push(
        or(
          gt(schemas.ledgerIndex, input.cursor.ledgerIndex),
          and(
            eq(schemas.ledgerIndex, input.cursor.ledgerIndex),
            gt(schemas.transactionIndex, input.cursor.transactionIndex),
          ),
          and(
            eq(schemas.ledgerIndex, input.cursor.ledgerIndex),
            eq(schemas.transactionIndex, input.cursor.transactionIndex),
            gt(schemas.schemaUid, input.cursor.schemaUid),
          ),
        )!,
      )
    }

    return this.db
      .select()
      .from(schemas)
      .where(and(...filters))
      .orderBy(asc(schemas.ledgerIndex), asc(schemas.transactionIndex), asc(schemas.schemaUid))
      .limit(input.limit + 1)
  }

  async getCredential(input: Parameters<ApiRepository['getCredential']>[0]) {
    const [row] = await this.db
      .select()
      .from(credentialGenerations)
      .where(
        and(
          eq(credentialGenerations.profileId, input.profileId),
          eq(credentialGenerations.issuer, input.issuer),
          eq(credentialGenerations.subject, input.subject),
          eq(credentialGenerations.schemaUid, input.schemaUid),
        ),
      )
      .orderBy(
        desc(credentialGenerations.createdLedgerIndex),
        desc(credentialGenerations.createdTransactionIndex),
      )
      .limit(1)
    return row
  }

  getCredentialEvents(input: Parameters<ApiRepository['getCredentialEvents']>[0]) {
    return this.db
      .select()
      .from(credentialEvents)
      .where(
        and(
          eq(credentialEvents.profileId, input.profileId),
          eq(credentialEvents.issuer, input.issuer),
          eq(credentialEvents.subject, input.subject),
          eq(credentialEvents.schemaUid, input.schemaUid),
        ),
      )
      .orderBy(
        asc(credentialEvents.ledgerIndex),
        asc(credentialEvents.transactionIndex),
        asc(credentialEvents.nodeIndex),
      )
  }
}
