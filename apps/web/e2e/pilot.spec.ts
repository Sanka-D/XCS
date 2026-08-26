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
  name: 'Course participation',
  description: 'Attests participation in one deterministic browser test course.',
  fields: {
    programId: { type: 'string' },
    completedAt: { type: 'string' },
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
  programId: 'xcs-browser-e2e',
  completedAt: '2026-08-25T10:00:00Z',
}
const PAYLOAD_URL = 'https://issuer.xcs.invalid/c.json'
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
}

interface BrowserCredentialLifecycle {
  generationId: string | null
  state: 'pending' | 'active'
  acceptedTransactionHash: string | null
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
        body.schemaUid !== SCHEMA_UID
      ) {
        await route.fulfill({ status: 400, json: { error: 'BROWSER_E2E_VERIFY_INPUT_INVALID' } })
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
      const acceptanceEvent =
        lifecycle !== undefined &&
        lifecycle.generationId !== null &&
        lifecycle.generationId !== txHash
      const evidenceConfirmed = options.credentialEvidence?.() === 'confirmed'
      const generationId = acceptanceEvent
        ? lifecycle.generationId!
        : evidenceConfirmed
          ? txHash
          : '34'.repeat(32)
      if (!acceptanceEvent && evidenceConfirmed && lifecycle) lifecycle.generationId = txHash
      if (acceptanceEvent && lifecycle) {
        lifecycle.state = 'active'
        lifecycle.acceptedTransactionHash = txHash
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
            eventType: acceptanceEvent ? 'accepted' : 'created',
            accepted: acceptanceEvent,
            deletionCause: null,
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

test('discovers a schema from aggregate stats and global search', async ({ page }) => {
  await installApiMock(page)

  await page.goto('/')
  const schemaCount = page.getByText('12', { exact: true })
  await expect(schemaCount).toBeVisible()
  await expect(page.getByText(/schémas valides|valid schemas/u)).toBeVisible()

  await page.locator('[data-client-ready="true"]').waitFor()
  const search = page.locator('.explorer-search').filter({ has: page.locator('#explorer-search') })
  await search.getByRole('searchbox').fill('Course')
  await expect(search.getByRole('button')).toBeEnabled()
  await search.getByRole('button').click()
  await expect(page).toHaveURL(/\/(?:en\/)?search\?q=Course$/u)
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
})
