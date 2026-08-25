import { waitForCredentialOperationEvent } from './credentialReview'
import {
  canReconfirmOperation,
  isGenerationBoundBusinessContext,
  validateOperationBusinessContext,
  type BusinessConfirmation,
  type StoredOperation,
} from './operationJournal'

export type CompletedBusinessConfirmation = Exclude<BusinessConfirmation, 'pending'>

interface ReconfirmValidatedBusinessOperationOptions {
  readonly operation: StoredOperation
  readonly loadEvent: () => Promise<unknown>
  readonly persist: (confirmation: CompletedBusinessConfirmation, at: string) => Promise<void>
  readonly timeoutMs?: number | undefined
  readonly pollIntervalMs?: number | undefined
  readonly now?: (() => Date) | undefined
}

/** Reconciles indexed evidence only. This path has no XRPL client, blob or submit dependency. */
export async function reconfirmValidatedBusinessOperation(
  options: ReconfirmValidatedBusinessOperationOptions,
): Promise<CompletedBusinessConfirmation> {
  if (!canReconfirmOperation(options.operation)) {
    throw new Error('OPERATION_BUSINESS_RECONFIRM_NOT_ALLOWED')
  }
  const business = options.operation.business
    ? validateOperationBusinessContext(options.operation.business)
    : undefined
  if (!isGenerationBoundBusinessContext(business) || !options.operation.txHash) {
    throw new Error('OPERATION_GENERATION_CONTEXT_REQUIRED')
  }

  let confirmation: CompletedBusinessConfirmation
  try {
    await waitForCredentialOperationEvent({
      ...business,
      txHash: options.operation.txHash,
      loadEvent: options.loadEvent,
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      ...(options.pollIntervalMs === undefined ? {} : { pollIntervalMs: options.pollIntervalMs }),
    })
    confirmation = 'confirmed'
  } catch (error) {
    confirmation =
      error instanceof Error && error.message === 'CREDENTIAL_EVENT_CONFIRMATION_MISMATCH'
        ? 'mismatch'
        : 'timeout'
  }

  await options.persist(confirmation, (options.now?.() ?? new Date()).toISOString())
  return confirmation
}
