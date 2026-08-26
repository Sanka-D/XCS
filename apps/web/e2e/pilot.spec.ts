import { expect, test, type Download, type Page } from '@playwright/test'
import {
  canonicalize,
  computeSchemaUid,
  createHttpsPayloadUri,
  encodeUtf8,
  encodeUtf8Hex,
  sha256Hex,
  validateSchema,
  type JsonValue,
  type NetworkProfile,
  type SchemaDefinition,
} from '@xcs-protocol/core'

const API_PREFIX = '/__e2e-api'
const PROFILE_ID = 'xrpl-testnet-xcs-browser-e2e'
const ISSUER = 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh'
const SUBJECT = 'r9cZA1mLK5R5Am25ArfXFmqgNwjZgnfk59'
const ISSUER_WALLET_ID = 'xcs-browser-e2e'
const SUBJECT_WALLET_ID = 'xcs-browser-e2e-subject'
const LEDGER_HASH = 'cd'.repeat(32)
const SCHEMA: SchemaDefinition = {
  xcsVersion: '0.1',
  name: 'Diploma Award',
  description: 'Attests one deterministic browser test diploma award.',
  fields: {
    programId: { type: 'string' },
    programName: { type: 'string' },
    awardedAt: { type: 'string' },
    diplomaId: { type: 'string' },
    honors: { type: 'string', optional: true },
  },
}
const SCHEMA_UID = computeSchemaUid({
  schema: validateSchema(SCHEMA),
  networkId: 1,
  ledgerHash: LEDGER_HASH,
  ledgerIndex: 100_001,
  transactionIndex: 1,
  publisher: ISSUER,
})
const CLAIMS = {
  programId: 'xcs-protocol-engineering-2026',
  programName: 'Protocol Engineering',
  awardedAt: '2026-08-25T10:00:00Z',
  diplomaId: 'DIP-2026-0042',
  honors: 'with distinction',
}
const PAYLOAD_URL = 'https://issuer.xcs.invalid/diploma.json'
const PERMALINK_GENERATION_ID = '34'.repeat(32)
const PERMALINK_ACCEPTED_TRANSACTION_HASH = '78'.repeat(32)
const HISTORICAL_GENERATION_ID = '56'.repeat(32)
const CANONICAL_PAYLOAD = canonicalize({
  xcsVersion: '0.1',
  issuer: ISSUER,
  subject: SUBJECT,
  schema: SCHEMA_UID,
  claims: CLAIMS,
} as JsonValue)
const CREDENTIAL_URI = createHttpsPayloadUri(PAYLOAD_URL, CANONICAL_PAYLOAD)
const PROFILE: NetworkProfile = {
  profileId: PROFILE_ID,
  xcsVersion: '0.1',
  networkId: 1,
  requiredAmendment: 'ab'.repeat(32).toUpperCase(),
  registryAddress: SUBJECT,
  registrationAmountDrops: '1',
  activationLedgerIndex: 1,
  activationLedgerHash: 'ef'.repeat(32),
}

interface ApiMockOptions {
  readonly schemaDigestHex?: string
  readonly credentialEvidence?: () => 'confirmed' | 'mismatch'
  readonly credentialLifecycle?: BrowserCredentialLifecycle
  readonly credentialUri?: string
  readonly pendingCredentialRejection?: boolean
  readonly signingReadiness?: () => 'ready' | 'unavailable' | 'malformed'
}

interface BrowserCredentialLifecycle {
  generationId: string | null
  state: 'pending' | 'active' | 'expired' | 'deleted'
  accepted: boolean
  acceptedTransactionHash: string | null
  removedTransactionHash?: string | null
}

const browserErrors = new WeakMap<Page, string[]>()

test.beforeEach(({ page }) => {
  const errors: string[] = []
  browserErrors.set(page, errors)
  page.on('pageerror', (error) => errors.push(`pageerror:${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console:${message.text()}`)
  })
  page.on('requestfailed', (request) => {
    errors.push(`requestfailed:${request.method()} ${request.url()}`)
  })
})

test.afterEach(({ page }) => {
  expect(browserErrors.get(page) ?? []).toEqual([])
})

async function installApiMock(page: Page, options: ApiMockOptions = {}): Promise<void> {
  await page.route(`**${API_PREFIX}/v1/**`, async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname.slice(API_PREFIX.length)
    if (route.request().method() === 'POST' && path === '/v1/verify') {
      const body = route.request().postDataJSON() as Record<string, unknown>
      const lifecycle = options.credentialLifecycle
      if (
        lifecycle?.generationId === null ||
        body.network !== PROFILE_ID ||
        body.issuer !== ISSUER ||
        body.subject !== SUBJECT ||
        body.schemaUid !== SCHEMA_UID ||
        body.resolvePayload === true
      ) {
        await route.fulfill({ status: 400, json: { error: 'BROWSER_E2E_VERIFY_INPUT_INVALID' } })
        return
      }
      if (
        Object.hasOwn(body, 'payload') &&
        canonicalize(body.payload as JsonValue) !== CANONICAL_PAYLOAD
      ) {
        await route.fulfill({ status: 400, json: { error: 'BROWSER_E2E_VERIFY_PAYLOAD_INVALID' } })
        return
      }
      await route.fulfill({
        json: {
          onChain: lifecycle?.state ?? 'pending',
          schema: 'valid',
          payload: Object.hasOwn(body, 'payload') ? 'valid' : 'not_checked',
          issuerTrust: 'unknown',
          ...(lifecycle?.generationId ? { generationId: lifecycle.generationId } : {}),
        },
      })
      return
    }
    if (route.request().method() !== 'GET') {
      await route.fulfill({ status: 405, json: { error: 'BROWSER_E2E_METHOD_NOT_ALLOWED' } })
      return
    }
    if (path === '/v1/networks') {
      await route.fulfill({ json: { items: [PROFILE] } })
      return
    }
    if (path === `/v1/networks/${PROFILE_ID}/readiness`) {
      const readiness = options.signingReadiness?.() ?? 'ready'
      if (readiness === 'unavailable') {
        await route.fulfill({
          status: 503,
          json: { error: 'INDEXER_STALE', message: 'Synthetic stale indexer.' },
        })
        return
      }
      if (readiness === 'malformed') {
        await route.fulfill({ json: { profileId: 'wrong-profile', status: 'ready' } })
        return
      }
      await route.fulfill({
        json: {
          profileId: PROFILE_ID,
          status: 'ready',
          checkpoint: {
            ledgerIndex: 100_001,
            ledgerHash: LEDGER_HASH,
            closeTime: 838_857_600,
            transactionRoot: 'cd'.repeat(32),
          },
        },
      })
      return
    }
    if (path === `/v1/networks/${PROFILE_ID}/stats`) {
      await route.fulfill({
        json: {
          network: PROFILE_ID,
          schemas: { total: 12, publishers: 4 },
          credentialGenerations: {
            total: 27,
            pending: 3,
            active: 20,
            expired: 2,
            deleted: 2,
          },
          checkpoint: {
            ledgerIndex: 100_001,
            ledgerHash: LEDGER_HASH,
            closeTime: 838_857_600,
            transactionRoot: 'cd'.repeat(32),
          },
        },
      })
      return
    }
    if (path === `/v1/networks/${PROFILE_ID}/search`) {
      await route.fulfill({
        json: {
          items: [
            {
              type: 'schema',
              schemaUid: SCHEMA_UID,
              name: SCHEMA.name,
              description: SCHEMA.description,
              publisher: ISSUER,
              parentUid: null,
              supersedesUid: null,
              registrationTransactionHash: '56'.repeat(32),
              ledgerIndex: 100_001,
              transactionIndex: 1,
            },
          ],
          hasMore: false,
        },
      })
      return
    }
    if (path === `/v1/networks/${PROFILE_ID}/schemas/${SCHEMA_UID}`) {
      await route.fulfill({
        json: {
          schemaUid: SCHEMA_UID,
          name: SCHEMA.name,
          description: SCHEMA.description,
          publisher: ISSUER,
          parentUid: null,
          supersedesUid: null,
          definition: SCHEMA,
          resolvedDefinition: { definition: SCHEMA, fields: SCHEMA.fields, lineage: [] },
          registrationTransactionHash: '56'.repeat(32),
          ledgerIndex: 100_001,
          transactionIndex: 1,
        },
      })
      return
    }
    const generationMatch = path.match(
      new RegExp(`^/v1/networks/${PROFILE_ID}/credential-generations/([0-9a-f]{64})$`, 'u'),
    )
    if (generationMatch) {
      const lifecycle = options.credentialLifecycle
      const requestedGenerationId = generationMatch[1]!
      if (
        !lifecycle?.generationId ||
        requestedGenerationId !== lifecycle.generationId ||
        !options.credentialUri
      ) {
        await route.fulfill({ status: 404, json: { error: 'CREDENTIAL_GENERATION_NOT_FOUND' } })
        return
      }
      const createdEvent = {
        transactionHash: lifecycle.generationId,
        nodeIndex: 0,
        generationId: lifecycle.generationId,
        ledgerIndex: 100_001,
        ledgerHash: LEDGER_HASH,
        transactionIndex: 2,
        eventType: 'created',
        issuer: ISSUER,
        subject: SUBJECT,
        schemaUid: SCHEMA_UID,
        accepted: false,
        deletionCause: null,
      }
      const acceptedEvent = {
        transactionHash: lifecycle.acceptedTransactionHash ?? PERMALINK_ACCEPTED_TRANSACTION_HASH,
        nodeIndex: 0,
        generationId: lifecycle.generationId,
        ledgerIndex: 100_002,
        ledgerHash: 'de'.repeat(32),
        transactionIndex: 1,
        eventType: 'accepted',
        issuer: ISSUER,
        subject: SUBJECT,
        schemaUid: SCHEMA_UID,
        accepted: true,
        deletionCause: null,
      }
      const removedEvent = {
        transactionHash: lifecycle.removedTransactionHash,
        nodeIndex: 0,
        generationId: lifecycle.generationId,
        ledgerIndex: 100_003,
        ledgerHash: 'fa'.repeat(32),
        transactionIndex: 1,
        eventType: 'deleted',
        issuer: ISSUER,
        subject: SUBJECT,
        schemaUid: SCHEMA_UID,
        accepted: lifecycle.accepted,
        deletionCause: lifecycle.accepted ? 'subject_removed' : 'subject_rejected',
      }
      await route.fulfill({
        json: {
          generation: {
            generationId: lifecycle.generationId,
            ledgerObjectId: '90'.repeat(32),
            issuer: ISSUER,
            subject: SUBJECT,
            schemaUid: SCHEMA_UID,
            uriHex: encodeUtf8Hex(options.credentialUri),
            expiration: null,
            accepted: lifecycle.accepted,
            createdLedgerIndex: 100_001,
            createdTransactionIndex: 2,
            lastLedgerIndex:
              lifecycle.state === 'deleted'
                ? 100_003
                : lifecycle.state === 'active' || lifecycle.state === 'expired'
                  ? 100_002
                  : 100_001,
            deletedLedgerIndex: lifecycle.state === 'deleted' ? 100_003 : null,
            deletionCause:
              lifecycle.state === 'deleted'
                ? lifecycle.accepted
                  ? 'subject_removed'
                  : 'subject_rejected'
                : null,
          },
          state: lifecycle.state,
          timeline:
            lifecycle.state === 'deleted'
              ? lifecycle.accepted
                ? [createdEvent, acceptedEvent, removedEvent]
                : [createdEvent, removedEvent]
              : lifecycle.state === 'active' || lifecycle.state === 'expired'
                ? [createdEvent, acceptedEvent]
                : [createdEvent],
        },
      })
      return
    }
    const registrationMatch = path.match(
      new RegExp(`^/v1/networks/${PROFILE_ID}/schema-registrations/([0-9a-f]{64})$`, 'u'),
    )
    if (registrationMatch) {
      const txHash = registrationMatch[1]!
      await route.fulfill({
        json: {
          transactionHash: txHash,
          registration: {
            status: 'accepted',
            publisher: ISSUER,
            ledgerIndex: 100_001,
            ledgerHash: LEDGER_HASH,
            transactionIndex: 1,
            schemaUid: SCHEMA_UID,
            schemaDigestHex: options.schemaDigestHex,
            reasonCode: null,
          },
        },
      })
      return
    }
    const credentialPath = `/v1/networks/${PROFILE_ID}/credentials/${ISSUER}/${SUBJECT}/${SCHEMA_UID}`
    if (path === credentialPath) {
      const lifecycle = options.credentialLifecycle
      if (!lifecycle?.generationId || !options.credentialUri) {
        await route.fulfill({ status: 404, json: { error: 'CREDENTIAL_NOT_FOUND' } })
        return
      }
      await route.fulfill({
        json: {
          generationId: lifecycle.generationId,
          issuer: ISSUER,
          subject: SUBJECT,
          schemaUid: SCHEMA_UID,
          uriHex: encodeUtf8Hex(options.credentialUri),
          expiration: null,
          accepted: lifecycle.accepted,
          state: lifecycle.state,
        },
      })
      return
    }
    const credentialEventMatch = path.match(
      new RegExp(
        `^/v1/networks/${PROFILE_ID}/credentials/${ISSUER}/${SUBJECT}/${SCHEMA_UID}/events/([0-9a-f]{64})$`,
        'u',
      ),
    )
    if (credentialEventMatch) {
      const txHash = credentialEventMatch[1]!
      const lifecycle = options.credentialLifecycle
      const lifecycleEvent = Boolean(
        lifecycle !== undefined &&
        lifecycle.generationId !== null &&
        lifecycle.generationId !== txHash,
      )
      const deletionEvent =
        lifecycleEvent &&
        (lifecycle.state !== 'pending' || options.pendingCredentialRejection === true)
      const acceptanceEvent = lifecycleEvent && !deletionEvent
      const evidenceConfirmed = options.credentialEvidence?.() === 'confirmed'
      const generationId = lifecycleEvent
        ? lifecycle.generationId!
        : evidenceConfirmed
          ? txHash
          : '34'.repeat(32)
      if (!lifecycleEvent && evidenceConfirmed && lifecycle) lifecycle.generationId = txHash
      if (acceptanceEvent && lifecycle) {
        lifecycle.state = 'active'
        lifecycle.accepted = true
        lifecycle.acceptedTransactionHash = txHash
      }
      if (deletionEvent && lifecycle) {
        lifecycle.state = 'deleted'
        lifecycle.removedTransactionHash = txHash
      }
      await route.fulfill({
        json: {
          transactionHash: txHash,
          event: {
            transactionHash: txHash,
            nodeIndex: 0,
            issuer: ISSUER,
            subject: SUBJECT,
            schemaUid: SCHEMA_UID,
            generationId,
            ledgerIndex: 100_001,
            ledgerHash: LEDGER_HASH,
            transactionIndex: 2,
            eventType: deletionEvent ? 'deleted' : acceptanceEvent ? 'accepted' : 'created',
            accepted: lifecycle?.accepted ?? false,
            deletionCause: deletionEvent
              ? lifecycle?.accepted
                ? 'subject_removed'
                : 'subject_rejected'
              : null,
          },
        },
      })
      return
    }
    await route.fulfill({
      status: 501,
      json: { error: 'UNEXPECTED_BROWSER_E2E_API_REQUEST', path },
    })
  })
}

async function connectSyntheticWallet(
  page: Page,
  actor: 'issuer' | 'subject' = 'issuer',
): Promise<void> {
  const walletId = actor === 'issuer' ? ISSUER_WALLET_ID : SUBJECT_WALLET_ID
  const account = actor === 'issuer' ? ISSUER : SUBJECT
  await page.locator('[data-client-ready="true"]').waitFor()
  await page.getByTestId('wallet-toggle').click()
  await page.locator(`[data-wallet-id="${walletId}"]`).click()
  await expect(page.getByTestId('wallet-toggle')).toContainText(account.slice(0, 6))
}

async function downloadText(download: Download): Promise<string> {
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function browserE2eEffects(page: Page): Promise<{
  walletSignatures: number
  ledgerSubmissions: number
}> {
  return page.evaluate(() => {
    const runtime = globalThis as typeof globalThis & {
      __xcsBrowserE2eEffects?: { walletSignatures: number; ledgerSubmissions: number }
    }
    return runtime.__xcsBrowserE2eEffects ?? { walletSignatures: 0, ledgerSubmissions: 0 }
  })
}

async function browserOperationPersistence(page: Page): Promise<
  {
    stage: unknown
    hasTxBlob: boolean
    hasTxHash: boolean
  }[]
> {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open('xcs-wallet-journal', 1)
        request.onerror = () => reject(request.error ?? new Error('INDEXED_DB_OPEN_FAILED'))
        request.onsuccess = () => {
          const database = request.result
          const transaction = database.transaction('operations', 'readonly')
          const rows = transaction.objectStore('operations').getAll()
          rows.onerror = () => reject(rows.error ?? new Error('INDEXED_DB_READ_FAILED'))
          rows.onsuccess = () => {
            resolve(
              (rows.result as Record<string, unknown>[]).map((row) => ({
                stage: row.stage,
                hasTxBlob: typeof row.txBlob === 'string' && row.txBlob.length > 0,
                hasTxHash: typeof row.txHash === 'string' && row.txHash.length > 0,
              })),
            )
          }
        }
      }),
  )
}

function consumeExpectedReadiness503(page: Page): void {
  const errors = browserErrors.get(page) ?? []
  const expected =
    'console:Failed to load resource: the server responded with a status of 503 (Service Unavailable)'
  const index = errors.indexOf(expected)
  expect(index).toBeGreaterThanOrEqual(0)
  errors.splice(index, 1)
}

test('discovers a schema from aggregate stats and global search', async ({ page }) => {
  await installApiMock(page)

  await page.goto('/')
  const schemaCount = page.getByText('12', { exact: true })
  await expect(schemaCount).toBeVisible()
  await expect(page.getByText(/schémas valides|valid schemas/u)).toBeVisible()

  await page.locator('[data-client-ready="true"]').waitFor()
  const search = page.locator('.explorer-search').filter({ has: page.locator('#explorer-search') })
  await search.getByRole('searchbox').fill('Diploma')
  await expect(search.getByRole('button')).toBeEnabled()
  await search.getByRole('button').click()
  await expect(page).toHaveURL(/\/(?:en\/)?search\?q=Diploma$/u)
  const result = page.locator('.result-card').filter({ hasText: SCHEMA.name })
  await expect(result).toContainText(SCHEMA_UID)
  await result.click()
  await expect(page.getByRole('heading', { level: 1, name: SCHEMA.name })).toBeVisible()
})

test('registers a schema through XRPL validation and exact indexed XCS finality', async ({
  page,
}) => {
  const validatedSchema = validateSchema(SCHEMA)
  const canonicalSchema = canonicalize(validatedSchema as unknown as JsonValue)
  const schemaDigestHex = sha256Hex(encodeUtf8(canonicalSchema))
  await installApiMock(page, { schemaDigestHex })

  await page.goto('/schemas/register')
  await connectSyntheticWallet(page)
  await page.getByRole('button', { name: 'Mode JSON' }).click()
  await page.locator('#schema-json').fill(JSON.stringify(SCHEMA, null, 2))
  await page.getByRole('button', { name: 'Valider et préparer' }).click()

  await expect(page.getByTestId('transaction-preview')).toContainText('Payment')
  await page.getByTestId('transaction-sign').click()

  await expect(page.getByTestId('xrpl-finality')).toContainText('tesSUCCESS')
  await expect(page.getByTestId('xcs-confirmed')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Ouvrir le schéma confirmé' })).toHaveAttribute(
    'href',
    `/schemas/${SCHEMA_UID}`,
  )
})

test('does not open the wallet when profile readiness is unavailable', async ({ page }) => {
  let readinessRequests = 0
  await installApiMock(page, {
    signingReadiness: () => {
      readinessRequests += 1
      return 'unavailable'
    },
  })

  await page.goto('/schemas/register')
  await connectSyntheticWallet(page)
  await page.getByRole('button', { name: 'Mode JSON' }).click()
  await page.locator('#schema-json').fill(JSON.stringify(SCHEMA, null, 2))
  await page.getByRole('button', { name: 'Valider et préparer' }).click()
  await expect(page.getByTestId('transaction-preview')).toContainText('Payment')

  await page.getByTestId('transaction-sign').click()

  await expect(page.locator('.error-box')).toContainText('INDEXER_SIGNING_READINESS_UNAVAILABLE')
  await expect(page.getByTestId('xrpl-finality')).toHaveCount(0)
  consumeExpectedReadiness503(page)
  expect(readinessRequests).toBe(1)
  expect(await browserE2eEffects(page)).toEqual({ walletSignatures: 0, ledgerSubmissions: 0 })
})

test('does not persist or submit a signature when readiness disappears in the wallet', async ({
  page,
}) => {
  let readinessRequests = 0
  await installApiMock(page, {
    signingReadiness: () => {
      readinessRequests += 1
      return readinessRequests === 1 ? 'ready' : 'unavailable'
    },
  })

  await page.goto('/schemas/register')
  await connectSyntheticWallet(page)
  await page.getByRole('button', { name: 'Mode JSON' }).click()
  await page.locator('#schema-json').fill(JSON.stringify(SCHEMA, null, 2))
  await page.getByRole('button', { name: 'Valider et préparer' }).click()
  await expect(page.getByTestId('transaction-preview')).toContainText('Payment')

  await page.getByTestId('transaction-sign').click()

  await expect(page.locator('.error-box')).toContainText('INDEXER_SIGNING_READINESS_UNAVAILABLE')
  await expect(page.getByTestId('xrpl-finality')).toHaveCount(0)
  consumeExpectedReadiness503(page)
  expect(readinessRequests).toBe(2)
  expect(await browserE2eEffects(page)).toEqual({ walletSignatures: 1, ledgerSubmissions: 0 })
  expect(await browserOperationPersistence(page)).toEqual([
    { stage: 'failed', hasTxBlob: false, hasTxHash: false },
  ])
})

test('issues, reconfirms, then accepts a credential with exact indexed evidence', async ({
  page,
}) => {
  let evidence: 'confirmed' | 'mismatch' = 'mismatch'
  const canonicalPayload = canonicalize({
    xcsVersion: '0.1',
    issuer: ISSUER,
    subject: SUBJECT,
    schema: SCHEMA_UID,
    claims: CLAIMS,
  } as JsonValue)
  const credentialUri = createHttpsPayloadUri(PAYLOAD_URL, canonicalPayload)
  const credentialLifecycle: BrowserCredentialLifecycle = {
    generationId: null,
    state: 'pending',
    accepted: false,
    acceptedTransactionHash: null,
  }
  await installApiMock(page, {
    credentialEvidence: () => evidence,
    credentialLifecycle,
    credentialUri,
  })
  let payloadRequestCount = 0
  await page.route(PAYLOAD_URL, async (route) => {
    payloadRequestCount += 1
    await route.fulfill({
      body: canonicalPayload,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
    })
  })

  await page.goto('/issue')
  await connectSyntheticWallet(page)
  await page.locator('#schema-uid').fill(SCHEMA_UID)
  await page.locator('#subject').fill(SUBJECT)
  await page.getByRole('button', { name: 'Mode JSON' }).click()
  await page.locator('#claims').fill(JSON.stringify(CLAIMS, null, 2))
  await page.locator('#https-url').fill(PAYLOAD_URL)
  await page.getByRole('button', { name: 'Valider et préparer' }).click()

  await expect(page.getByTestId('transaction-preview')).toContainText('CredentialCreate')
  await page.getByTestId('transaction-sign').click()

  await expect(page.getByTestId('xrpl-finality')).toContainText('tesSUCCESS')
  await expect(page.getByTestId('xcs-mismatch')).toBeVisible()

  evidence = 'confirmed'
  await page.goto('/operations')
  const operation = page
    .getByTestId('operation-card')
    .filter({ hasText: 'CredentialCreate' })
    .first()
  await expect(operation.getByTestId('operation-xcs-result')).toContainText('mismatch')
  await operation.getByTestId('operation-reconfirm').click()
  await expect(operation.getByTestId('operation-xcs-result')).toContainText('confirmed')
  await expect(operation).toContainText('Generation ID')
  const payloadRequestsAfterIssuance = payloadRequestCount

  await page.getByTestId('wallet-toggle').click()
  await operation.getByRole('link', { name: /Acceptation du sujet|Subject acceptance/u }).click()
  await expect(page).toHaveURL(
    new RegExp(
      `/accept\\?profile=${PROFILE_ID}&issuer=${ISSUER}&schema=${SCHEMA_UID}&generation=[0-9a-f]{64}$`,
      'u',
    ),
  )
  await connectSyntheticWallet(page, 'subject')

  await page
    .getByRole('button', { name: /Charger, relire et préparer|Load, review and prepare/u })
    .click()
  await expect(
    page.getByRole('heading', {
      name: /Relecture du credential exact|Exact credential review/u,
    }),
  ).toBeVisible()
  expect(payloadRequestCount).toBe(payloadRequestsAfterIssuance)

  const payloadConsent = page.getByLabel(
    /Je consens explicitement au chargement|I explicitly consent to fetching/u,
  )
  const trustAcknowledgement = page
    .getByTestId('issuer-trust-acknowledgement')
    .getByRole('checkbox')
  await expect(payloadConsent).not.toBeChecked()
  await expect(trustAcknowledgement).not.toBeChecked()
  await expect(page.getByTestId('transaction-preview')).toHaveCount(0)
  await payloadConsent.check()
  await page
    .getByRole('button', { name: /Charger le payload et préparer|Fetch payload and prepare/u })
    .click()
  await expect(page.getByTestId('transaction-preview')).toHaveCount(0)
  await expect(page.getByTestId('transaction-sign')).toHaveCount(0)
  await expect(
    page.getByText(/Confirmez votre propre décision de confiance|Confirm your own trust decision/u),
  ).toBeVisible()
  await trustAcknowledgement.check()
  await page
    .getByRole('button', { name: /Charger le payload et préparer|Fetch payload and prepare/u })
    .click()

  const preview = page.getByTestId('transaction-preview')
  await expect(preview).toContainText('CredentialAccept')
  await expect(preview).toContainText(SUBJECT)
  await expect(preview).toContainText(ISSUER)
  await expect(preview).toContainText(SCHEMA_UID.toUpperCase())
  expect(payloadRequestCount).toBeGreaterThan(payloadRequestsAfterIssuance)
  const payloadRequestsBeforeSign = payloadRequestCount
  await page.getByTestId('transaction-sign').click()

  await expect(page.getByTestId('xrpl-finality')).toContainText('tesSUCCESS')
  await expect(page.getByTestId('xcs-confirmed')).toBeVisible()
  expect(payloadRequestCount).toBe(payloadRequestsBeforeSign + 1)
  expect(credentialLifecycle.state).toBe('active')
  expect(credentialLifecycle.acceptedTransactionHash).toMatch(/^[0-9a-f]{64}$/u)

  await page.goto('/operations')
  const acceptanceOperation = page
    .getByTestId('operation-card')
    .filter({ hasText: 'CredentialAccept' })
    .first()
  await expect(acceptanceOperation.getByTestId('operation-xcs-result')).toContainText('confirmed')
  const downloadPromise = page.waitForEvent('download')
  await page
    .getByRole('button', { name: /Exporter les reçus minimisés|Export sanitized receipts/u })
    .click()
  const exportedReceipts = await downloadText(await downloadPromise)
  expect(exportedReceipts).not.toContain('"claims"')
  expect(exportedReceipts).not.toContain('"txBlob"')
  expect(exportedReceipts).not.toContain('"issuerTrust"')
  expect(exportedReceipts).not.toContain(canonicalPayload)
  const receiptExport = JSON.parse(exportedReceipts) as {
    receipts: Array<Record<string, unknown>>
  }
  const acceptanceReceipt = receiptExport.receipts.find(
    (receipt) => receipt.transactionType === 'CredentialAccept',
  )
  expect(acceptanceReceipt).toMatchObject({
    account: SUBJECT,
    transactionType: 'CredentialAccept',
    businessConfirmation: 'confirmed',
    business: {
      action: 'credential-accept',
      issuer: ISSUER,
      subject: SUBJECT,
      schemaUid: SCHEMA_UID,
      generationId: credentialLifecycle.generationId,
    },
    businessEvidence: {
      transactionHash: credentialLifecycle.acceptedTransactionHash,
      generationId: credentialLifecycle.generationId,
      eventType: 'accepted',
      accepted: true,
    },
  })

  await acceptanceOperation.getByTestId('operation-credential-link').click()
  await expect(page).toHaveURL(`/credentials/${credentialLifecycle.generationId}`)
  await page.locator('[data-client-ready="true"]').waitFor()
  const removeLink = page.getByTestId('credential-subject-action')
  await expect(removeLink).toContainText(/Retirer cette génération|Remove this generation/u)
  await expect(removeLink).toHaveAttribute(
    'href',
    `/accept?profile=${PROFILE_ID}&issuer=${ISSUER}&schema=${SCHEMA_UID}&generation=${credentialLifecycle.generationId}&action=remove`,
  )

  let subjectMutationVerifyRequests = 0
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (request.method() === 'POST' && url.pathname === `${API_PREFIX}/v1/verify`) {
      subjectMutationVerifyRequests += 1
    }
  })
  const payloadRequestsBeforeRemoval = payloadRequestCount
  await removeLink.click()
  await expect(page).toHaveURL(/action=remove$/u)
  await connectSyntheticWallet(page, 'subject')
  await page
    .getByRole('button', { name: /Charger, relire et préparer|Load, review and prepare/u })
    .click()

  const removalPreview = page.getByTestId('transaction-preview')
  await expect(removalPreview).toContainText('CredentialDelete')
  await expect(removalPreview).toContainText(SUBJECT)
  await expect(removalPreview).toContainText(ISSUER)
  await expect(page.getByTestId('issuer-trust-acknowledgement')).toHaveCount(0)
  await expect(page.getByLabel(/consens|consent/iu)).toHaveCount(0)
  expect(subjectMutationVerifyRequests).toBe(0)
  expect(payloadRequestCount).toBe(payloadRequestsBeforeRemoval)

  await page.getByTestId('transaction-sign').click()
  await expect(page.getByTestId('xrpl-finality')).toContainText('tesSUCCESS')
  await expect(page.getByTestId('xcs-confirmed')).toBeVisible()
  await expect(page.getByTestId('business-finality')).toContainText('deleted')
  await expect(page.getByTestId('business-finality')).toContainText('subject_removed')
  expect(subjectMutationVerifyRequests).toBe(0)
  expect(payloadRequestCount).toBe(payloadRequestsBeforeRemoval)
  expect(credentialLifecycle.state).toBe('deleted')
  expect(credentialLifecycle.removedTransactionHash).toMatch(/^[0-9a-f]{64}$/u)

  await page.getByTestId('subject-result-permalink').click()
  await expect(page).toHaveURL(`/credentials/${credentialLifecycle.generationId}`)
  await expect(page.getByText('deleted', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('subject_removed', { exact: true })).toBeVisible()
  await expect(page.getByTestId('credential-subject-action')).toHaveCount(0)
  expect(payloadRequestCount).toBe(payloadRequestsBeforeRemoval)

  await page.goto('/operations')
  const removalOperation = page
    .getByTestId('operation-card')
    .filter({ hasText: 'credential-remove' })
    .first()
  await expect(removalOperation.getByTestId('operation-xcs-result')).toContainText('confirmed')
  const removalDownloadPromise = page.waitForEvent('download')
  await page
    .getByRole('button', { name: /Exporter les reçus minimisés|Export sanitized receipts/u })
    .click()
  const removalExport = JSON.parse(await downloadText(await removalDownloadPromise)) as {
    receipts: Array<Record<string, unknown>>
  }
  const removalReceipt = removalExport.receipts.find(
    (receipt) =>
      (receipt.business as { action?: string } | undefined)?.action === 'credential-remove',
  )
  expect(removalReceipt).toMatchObject({
    receiptVersion: '0.2',
    account: SUBJECT,
    transactionType: 'CredentialDelete',
    businessConfirmation: 'confirmed',
    business: {
      action: 'credential-remove',
      issuer: ISSUER,
      subject: SUBJECT,
      schemaUid: SCHEMA_UID,
      generationId: credentialLifecycle.generationId,
    },
    businessEvidence: {
      transactionHash: credentialLifecycle.removedTransactionHash,
      generationId: credentialLifecycle.generationId,
      eventType: 'deleted',
      accepted: true,
      deletionCause: 'subject_removed',
    },
  })
})

test('rejects a pending credential without loading payload or trust', async ({ page }) => {
  const credentialLifecycle: BrowserCredentialLifecycle = {
    generationId: PERMALINK_GENERATION_ID,
    state: 'pending',
    accepted: false,
    acceptedTransactionHash: null,
  }
  await installApiMock(page, {
    credentialLifecycle,
    credentialUri: CREDENTIAL_URI,
    pendingCredentialRejection: true,
  })
  let payloadRequestCount = 0
  let verifyRequestCount = 0
  await page.route(PAYLOAD_URL, async (route) => {
    payloadRequestCount += 1
    await route.abort('blockedbyclient')
  })
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      new URL(request.url()).pathname === `${API_PREFIX}/v1/verify`
    ) {
      verifyRequestCount += 1
    }
  })

  await page.goto(
    `/accept?profile=${PROFILE_ID}&issuer=${ISSUER}&schema=${SCHEMA_UID}&generation=${PERMALINK_GENERATION_ID}&action=reject`,
  )
  await connectSyntheticWallet(page, 'subject')
  await page
    .getByRole('button', { name: /Charger, relire et préparer|Load, review and prepare/u })
    .click()

  await expect(page.getByTestId('transaction-preview')).toContainText('CredentialDelete')
  await expect(page.getByTestId('issuer-trust-acknowledgement')).toHaveCount(0)
  await expect(page.getByLabel(/consens|consent/iu)).toHaveCount(0)
  expect(payloadRequestCount).toBe(0)
  expect(verifyRequestCount).toBe(0)

  await page.getByTestId('transaction-sign').click()
  await expect(page.getByTestId('xcs-confirmed')).toBeVisible()
  await expect(page.getByTestId('business-finality')).toContainText('deleted')
  await expect(page.getByTestId('business-finality')).toContainText('subject_rejected')
  expect(payloadRequestCount).toBe(0)
  expect(verifyRequestCount).toBe(0)
  expect(credentialLifecycle.state).toBe('deleted')
})

test('reveals an exact diploma permalink only after bound payload consent', async ({ page }) => {
  const credentialLifecycle: BrowserCredentialLifecycle = {
    generationId: PERMALINK_GENERATION_ID,
    state: 'active',
    accepted: true,
    acceptedTransactionHash: PERMALINK_ACCEPTED_TRANSACTION_HASH,
  }
  await installApiMock(page, {
    credentialLifecycle,
    credentialUri: CREDENTIAL_URI,
  })

  let payloadRequestCount = 0
  const requestTrace: string[] = []
  const verifyBodies: Record<string, unknown>[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.href === PAYLOAD_URL) {
      requestTrace.push('issuer')
      return
    }
    if (!url.pathname.startsWith(`${API_PREFIX}/v1/`)) return
    const apiPath = url.pathname.slice(API_PREFIX.length)
    if (apiPath === '/v1/networks') requestTrace.push('networks')
    if (apiPath.includes('/credential-generations/')) requestTrace.push('generation')
    if (apiPath.includes('/schemas/')) requestTrace.push('schema')
    if (apiPath === '/v1/verify') {
      const body = request.postDataJSON() as Record<string, unknown>
      verifyBodies.push(body)
      requestTrace.push(Object.hasOwn(body, 'payload') ? 'verify:payload' : 'verify:metadata')
    }
  })
  await page.route(PAYLOAD_URL, async (route) => {
    payloadRequestCount += 1
    await route.fulfill({
      body: CANONICAL_PAYLOAD,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
    })
  })

  await page.goto(`/credentials/${PERMALINK_GENERATION_ID}`)
  await page.locator('[data-client-ready="true"]').waitFor()
  await expect(page.getByRole('heading', { level: 1, name: SCHEMA.name })).toBeVisible()
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex,nofollow')
  await expect(page.getByTestId('credential-dimension-on-chain')).toContainText('active')
  await expect(page.getByTestId('credential-dimension-schema')).toContainText('valid')
  await expect(page.getByTestId('credential-dimension-payload')).toContainText('not_checked')
  await expect(page.getByTestId('credential-dimension-trust')).toContainText('unknown')
  await expect(page.getByTestId('credential-claims')).toHaveCount(0)
  expect(payloadRequestCount).toBe(0)

  const consent = page
    .getByTestId('credential-consent')
    .getByRole('checkbox', { name: /Je consens au chargement|I consent to fetching/u })
  await expect(consent).not.toBeChecked()
  await consent.check()
  expect(payloadRequestCount).toBe(0)
  const postConsentTraceStart = requestTrace.length
  await page
    .getByRole('button', {
      name: /Charger et vérifier le payload public|Fetch and verify public payload/u,
    })
    .click()

  await expect(page.getByTestId('credential-payload-checked')).toBeVisible()
  await expect(page.getByTestId('credential-claims')).toBeVisible()
  expect(payloadRequestCount).toBe(1)
  const postConsentTrace = requestTrace.slice(postConsentTraceStart)
  const issuerIndex = postConsentTrace.indexOf('issuer')
  expect(issuerIndex).toBeGreaterThan(-1)
  for (const metadataRequest of ['networks', 'generation', 'schema', 'verify:metadata']) {
    const metadataIndex = postConsentTrace.indexOf(metadataRequest)
    expect(metadataIndex, `${metadataRequest} must be re-read before issuer fetch`).toBeGreaterThan(
      -1,
    )
    expect(metadataIndex).toBeLessThan(issuerIndex)
  }
  expect(postConsentTrace.indexOf('verify:payload')).toBeGreaterThan(issuerIndex)
  expect(verifyBodies.some((body) => body.resolvePayload === true)).toBe(false)
  const payloadVerifications = verifyBodies.filter((body) => Object.hasOwn(body, 'payload'))
  expect(payloadVerifications).toHaveLength(1)
  expect(payloadVerifications[0]).toEqual({
    network: PROFILE_ID,
    issuer: ISSUER,
    subject: SUBJECT,
    schemaUid: SCHEMA_UID,
    payload: JSON.parse(CANONICAL_PAYLOAD),
  })

  for (const [name, type, value] of [
    ['programId', 'string', CLAIMS.programId],
    ['programName', 'string', CLAIMS.programName],
    ['awardedAt', 'string', CLAIMS.awardedAt],
    ['diplomaId', 'string', CLAIMS.diplomaId],
    ['honors', 'string', CLAIMS.honors],
  ] as const) {
    const row = page.getByTestId(`credential-claim-${name}`)
    await expect(row).toContainText(type)
    await expect(row).toContainText(value)
  }
  await expect(page.getByTestId('credential-dimension-on-chain')).toContainText('active')
  await expect(page.getByTestId('credential-dimension-schema')).toContainText('valid')
  await expect(page.getByTestId('credential-dimension-payload')).toContainText('valid')
  await expect(page.getByTestId('credential-dimension-trust')).toContainText('unknown')
})

test('keeps a replaced historical generation readable without payload consent', async ({
  page,
}) => {
  await installApiMock(page, {
    credentialLifecycle: {
      generationId: PERMALINK_GENERATION_ID,
      state: 'active',
      accepted: true,
      acceptedTransactionHash: PERMALINK_ACCEPTED_TRANSACTION_HASH,
    },
    credentialUri: CREDENTIAL_URI,
  })
  let payloadRequestCount = 0
  await page.route(PAYLOAD_URL, async (route) => {
    payloadRequestCount += 1
    await route.fulfill({
      body: CANONICAL_PAYLOAD,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
    })
  })

  await page.goto(`/credentials/${HISTORICAL_GENERATION_ID}`)
  await page.locator('[data-client-ready="true"]').waitFor()
  await expect(page.getByRole('heading', { level: 1, name: SCHEMA.name })).toBeVisible()
  await expect(
    page.locator('.explorer-metadata').getByText(HISTORICAL_GENERATION_ID, { exact: true }),
  ).toBeVisible()
  await expect(page.getByTestId('credential-verification-unavailable')).toBeVisible()
  await expect(page.getByTestId('credential-consent')).toHaveCount(0)
  await expect(page.getByTestId('credential-dimensions')).toHaveCount(0)
  await expect(page.getByTestId('credential-subject-action')).toHaveCount(0)
  await expect(page.getByText('issuer_revoked', { exact: true })).toBeVisible()
  expect(payloadRequestCount).toBe(0)
})
