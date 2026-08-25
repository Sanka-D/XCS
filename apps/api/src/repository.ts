import {
  credentialEvents,
  credentialGenerations,
  indexerStatuses,
  ledgerCheckpoints,
  networkProfiles,
  schemaEvents,
  schemas,
  type XcsDatabase,
} from '@xcs-protocol/db'
import { and, asc, desc, eq, gt, inArray, or, sql } from 'drizzle-orm'

import type { ApiRepository } from './types.js'

export class PostgresApiRepository implements ApiRepository {
  constructor(private readonly db: XcsDatabase) {}

  withConsistentSnapshot<T>(callback: (repository: ApiRepository) => Promise<T>): Promise<T> {
    return this.db.transaction(
      (transaction) => callback(new PostgresApiRepository(transaction as unknown as XcsDatabase)),
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    )
  }

  async getDatabaseTime(): Promise<Date> {
    const [row] = await this.db.execute<{ now: Date }>(sql`SELECT CURRENT_TIMESTAMP AS "now"`)
    if (row === undefined || !Number.isFinite(row.now.getTime())) {
      throw new Error('PostgreSQL returned an invalid current timestamp')
    }
    return row.now
  }

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

  async getIndexerStatus(profileId: string) {
    const [row] = await this.db
      .select()
      .from(indexerStatuses)
      .where(eq(indexerStatuses.profileId, profileId))
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

  getSchemaProjectionEvidence(input: Parameters<ApiRepository['getSchemaProjectionEvidence']>[0]) {
    if (input.schemaUids.length === 0) return Promise.resolve([])
    return this.db
      .select({ schema: schemas, registration: schemaEvents })
      .from(schemas)
      .innerJoin(
        schemaEvents,
        and(
          eq(schemaEvents.profileId, schemas.profileId),
          eq(schemaEvents.transactionHash, schemas.registrationTransactionHash),
        ),
      )
      .where(
        and(
          eq(schemas.profileId, input.profileId),
          inArray(schemas.schemaUid, [...input.schemaUids]),
        ),
      )
  }

  async getSchemaRegistrationByTransaction(
    input: Parameters<ApiRepository['getSchemaRegistrationByTransaction']>[0],
  ) {
    const [row] = await this.db
      .select()
      .from(schemaEvents)
      .where(
        and(
          eq(schemaEvents.profileId, input.profileId),
          eq(schemaEvents.transactionHash, input.transactionHash),
        ),
      )
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
      .limit(input.limit)
  }

  getCredentialEventsByTransaction(
    input: Parameters<ApiRepository['getCredentialEventsByTransaction']>[0],
  ) {
    return this.db
      .select()
      .from(credentialEvents)
      .where(
        and(
          eq(credentialEvents.profileId, input.profileId),
          eq(credentialEvents.transactionHash, input.transactionHash),
          eq(credentialEvents.issuer, input.issuer),
          eq(credentialEvents.subject, input.subject),
          eq(credentialEvents.schemaUid, input.schemaUid),
        ),
      )
      .orderBy(asc(credentialEvents.nodeIndex))
      .limit(input.limit)
  }
}
