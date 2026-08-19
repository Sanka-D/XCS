import {
  credentialEvents,
  credentialGenerations,
  ledgerCheckpoints,
  networkProfiles,
  schemaEvents,
  schemas,
  type XcsDatabase,
} from '@xcs-protocol/db'
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm'

import { assertLedgerContinuity } from './continuity.js'
import type {
  Checkpoint,
  CredentialMutation,
  IndexerRepository,
  LedgerProjection,
  NetworkProfile,
  SchemaCatalogEntry,
} from './types.js'

type StoredNetworkProfile = Pick<
  typeof networkProfiles.$inferSelect,
  | 'profileId'
  | 'xcsVersion'
  | 'networkId'
  | 'requiredAmendment'
  | 'registryAddress'
  | 'registrationAmountDrops'
  | 'activationLedgerIndex'
  | 'activationLedgerHash'
>

export function assertStoredProfileMatches(
  stored: StoredNetworkProfile,
  configured: NetworkProfile,
): void {
  const expected: StoredNetworkProfile = {
    profileId: configured.profileId,
    xcsVersion: configured.xcsVersion,
    networkId: configured.networkId,
    requiredAmendment: configured.requiredAmendment.toUpperCase(),
    registryAddress: configured.registryAddress,
    registrationAmountDrops: Number(configured.registrationAmountDrops),
    activationLedgerIndex: configured.activationLedgerIndex,
    activationLedgerHash: configured.activationLedgerHash.toLowerCase(),
  }
  const mismatches = (Object.keys(expected) as Array<keyof StoredNetworkProfile>).filter(
    (field) => stored[field] !== expected[field],
  )
  if (mismatches.length > 0) {
    throw new Error(
      `Stored network profile ${configured.profileId} differs from configuration: ${mismatches.join(', ')}`,
    )
  }
}

function checkpointFromRow(row: typeof ledgerCheckpoints.$inferSelect): Checkpoint {
  return {
    ledgerIndex: row.ledgerIndex,
    ledgerHash: row.ledgerHash,
    parentHash: row.parentHash,
    closeTime: row.closeTime,
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Stored schema value is not an object')
  }
  return value as Record<string, unknown>
}

export class PostgresIndexerRepository implements IndexerRepository {
  constructor(private readonly db: XcsDatabase) {}

  async getLastCheckpoint(profileId: string): Promise<Checkpoint | undefined> {
    const [row] = await this.db
      .select()
      .from(ledgerCheckpoints)
      .where(eq(ledgerCheckpoints.profileId, profileId))
      .orderBy(desc(ledgerCheckpoints.ledgerIndex))
      .limit(1)
    return row === undefined ? undefined : checkpointFromRow(row)
  }

  async getSchemaCatalog(profileId: string): Promise<SchemaCatalogEntry[]> {
    const [profile] = await this.db
      .select({ networkId: networkProfiles.networkId })
      .from(networkProfiles)
      .where(eq(networkProfiles.profileId, profileId))
      .limit(1)
    if (profile === undefined) return []
    const rows = await this.db
      .select()
      .from(schemas)
      .where(eq(schemas.profileId, profileId))
      .orderBy(asc(schemas.ledgerIndex), asc(schemas.transactionIndex))

    return rows.map((row) => ({
      uid: row.schemaUid,
      definition: row.definition as unknown as SchemaCatalogEntry['definition'],
      resolved: asRecord(row.resolvedDefinition) as unknown as SchemaCatalogEntry['resolved'],
      publisher: row.publisher,
      networkId: profile.networkId,
      ledgerIndex: row.ledgerIndex,
      transactionIndex: row.transactionIndex,
      name: row.name,
      description: row.description,
      transactionHash: row.registrationTransactionHash,
    }))
  }

  async persistLedger(
    profile: NetworkProfile,
    projection: LedgerProjection,
  ): Promise<'inserted' | 'already_processed'> {
    return this.db.transaction(async (tx) => {
      // A per-profile transaction lock prevents two replicas from projecting
      // different ledgers concurrently while still allowing different networks.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${profile.profileId}, 0))`)

      const [storedProfile] = await tx
        .select()
        .from(networkProfiles)
        .where(eq(networkProfiles.profileId, profile.profileId))
        .limit(1)
      if (storedProfile === undefined) {
        await tx.insert(networkProfiles).values({
          profileId: profile.profileId,
          xcsVersion: profile.xcsVersion,
          networkId: profile.networkId,
          requiredAmendment: profile.requiredAmendment.toUpperCase(),
          registryAddress: profile.registryAddress,
          registrationAmountDrops: Number(profile.registrationAmountDrops),
          activationLedgerIndex: profile.activationLedgerIndex,
          activationLedgerHash: profile.activationLedgerHash.toLowerCase(),
        })
      } else {
        assertStoredProfileMatches(storedProfile, profile)
      }

      const [sameIndex] = await tx
        .select()
        .from(ledgerCheckpoints)
        .where(
          and(
            eq(ledgerCheckpoints.profileId, profile.profileId),
            eq(ledgerCheckpoints.ledgerIndex, projection.ledger.ledgerIndex),
          ),
        )
        .limit(1)
      if (sameIndex !== undefined) {
        if (sameIndex.ledgerHash !== projection.ledger.ledgerHash) {
          throw new Error(
            `Checkpoint conflict at ledger ${projection.ledger.ledgerIndex}: ${sameIndex.ledgerHash} != ${projection.ledger.ledgerHash}`,
          )
        }
        return 'already_processed' as const
      }

      const [latest] = await tx
        .select()
        .from(ledgerCheckpoints)
        .where(eq(ledgerCheckpoints.profileId, profile.profileId))
        .orderBy(desc(ledgerCheckpoints.ledgerIndex))
        .limit(1)
      assertLedgerContinuity(
        profile,
        latest === undefined ? undefined : checkpointFromRow(latest),
        projection.ledger,
      )

      for (const registration of projection.schemaRegistrations) {
        await tx
          .insert(schemaEvents)
          .values({
            profileId: profile.profileId,
            transactionHash: registration.transactionHash,
            ledgerIndex: projection.ledger.ledgerIndex,
            ledgerHash: projection.ledger.ledgerHash,
            transactionIndex: registration.transactionIndex,
            publisher: registration.publisher,
            status: registration.status,
            ...(registration.status === 'accepted'
              ? {
                  schemaUid: registration.schemaUid,
                  memoJson: registration.definition,
                }
              : {
                  reasonCode: registration.reasonCode,
                  ...(registration.memoJson === undefined
                    ? {}
                    : { memoJson: registration.memoJson }),
                }),
          })
          .onConflictDoNothing()

        if (registration.status === 'accepted') {
          await tx
            .insert(schemas)
            .values({
              profileId: profile.profileId,
              schemaUid: registration.schemaUid,
              publisher: registration.publisher,
              name: registration.definition.name,
              description: registration.definition.description,
              ...(registration.definition.extends === undefined
                ? {}
                : { parentUid: registration.definition.extends }),
              ...(registration.definition.supersedes === undefined
                ? {}
                : { supersedesUid: registration.definition.supersedes }),
              definition: registration.definition as unknown as Record<string, unknown>,
              resolvedDefinition: registration.resolved as unknown as Record<string, unknown>,
              registrationTransactionHash: registration.transactionHash,
              ledgerIndex: projection.ledger.ledgerIndex,
              transactionIndex: registration.transactionIndex,
            })
            .onConflictDoNothing()
        }
      }

      for (const mutation of projection.credentialMutations) {
        await this.persistCredentialMutation(
          tx as unknown as XcsDatabase,
          profile.profileId,
          projection,
          mutation,
        )
      }

      await tx.insert(ledgerCheckpoints).values({
        profileId: profile.profileId,
        ledgerIndex: projection.ledger.ledgerIndex,
        ledgerHash: projection.ledger.ledgerHash,
        parentHash: projection.ledger.parentHash,
        closeTime: projection.ledger.closeTime,
        transactionCount: projection.ledger.transactions.length,
      })

      return 'inserted' as const
    })
  }

  private async persistCredentialMutation(
    tx: XcsDatabase,
    profileId: string,
    projection: LedgerProjection,
    mutation: CredentialMutation,
  ): Promise<void> {
    let generationId: string

    if (mutation.eventType === 'created') {
      generationId = mutation.transactionHash
      await tx.insert(credentialGenerations).values({
        profileId,
        generationId,
        ledgerObjectId: mutation.ledgerObjectId,
        issuer: mutation.issuer,
        subject: mutation.subject,
        schemaUid: mutation.schemaUid,
        ...(mutation.uriHex === undefined ? {} : { uriHex: mutation.uriHex }),
        ...(mutation.expiration === undefined ? {} : { expiration: mutation.expiration }),
        accepted: mutation.accepted,
        createdLedgerIndex: projection.ledger.ledgerIndex,
        createdTransactionIndex: mutation.transactionIndex,
        lastLedgerIndex: projection.ledger.ledgerIndex,
      })
    } else {
      const [liveGeneration] = await tx
        .select()
        .from(credentialGenerations)
        .where(
          and(
            eq(credentialGenerations.profileId, profileId),
            eq(credentialGenerations.ledgerObjectId, mutation.ledgerObjectId),
            isNull(credentialGenerations.deletedLedgerIndex),
          ),
        )
        .orderBy(desc(credentialGenerations.createdLedgerIndex))
        .limit(1)
      if (liveGeneration === undefined) {
        throw new Error(
          `Credential ${mutation.ledgerObjectId} was ${mutation.eventType} without a live generation`,
        )
      }
      generationId = liveGeneration.generationId

      if (mutation.eventType === 'accepted') {
        await tx
          .update(credentialGenerations)
          .set({
            accepted: true,
            lastLedgerIndex: projection.ledger.ledgerIndex,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(credentialGenerations.profileId, profileId),
              eq(credentialGenerations.generationId, generationId),
            ),
          )
      } else {
        await tx
          .update(credentialGenerations)
          .set({
            lastLedgerIndex: projection.ledger.ledgerIndex,
            deletedLedgerIndex: projection.ledger.ledgerIndex,
            deletionCause: mutation.deletionCause,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(credentialGenerations.profileId, profileId),
              eq(credentialGenerations.generationId, generationId),
            ),
          )
      }
    }

    await tx
      .insert(credentialEvents)
      .values({
        profileId,
        transactionHash: mutation.transactionHash,
        nodeIndex: mutation.nodeIndex,
        generationId,
        ledgerObjectId: mutation.ledgerObjectId,
        ledgerIndex: projection.ledger.ledgerIndex,
        ledgerHash: projection.ledger.ledgerHash,
        transactionIndex: mutation.transactionIndex,
        eventType: mutation.eventType,
        issuer: mutation.issuer,
        subject: mutation.subject,
        schemaUid: mutation.schemaUid,
        ...(mutation.uriHex === undefined ? {} : { uriHex: mutation.uriHex }),
        ...(mutation.expiration === undefined ? {} : { expiration: mutation.expiration }),
        accepted: mutation.accepted,
        ...(mutation.deletionCause === undefined ? {} : { deletionCause: mutation.deletionCause }),
        snapshot: mutation.snapshot,
      })
      .onConflictDoNothing()
  }
}
