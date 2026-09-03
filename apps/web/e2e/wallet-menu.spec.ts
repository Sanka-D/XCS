import { expect, test, type Page } from '@playwright/test'

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

test('reopens the wallet chooser after disconnecting and navigating', async ({ page }) => {
  await page.goto('/learn')
  await page.locator('[data-client-ready="true"]').waitFor()

  const trigger = page.getByTestId('wallet-toggle')
  await trigger.click()
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')
  await page.locator('[data-wallet-id="xcs-browser-e2e"]').click()
  await expect(trigger).toContainText('rHb9CJ')

  await trigger.click()
  await expect(trigger).toContainText(/Connecter un wallet|Connect wallet/u)

  await page.goto('/accept')
  await page.locator('[data-client-ready="true"]').waitFor()
  await page.getByTestId('wallet-toggle').click()
  await expect(page.getByTestId('wallet-toggle')).toHaveAttribute('aria-expanded', 'true')
  await expect(page.locator('[data-wallet-id="xcs-browser-e2e-subject"]')).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(page.getByTestId('wallet-toggle')).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByTestId('wallet-toggle')).toBeFocused()
})

test('keeps a dismissed wallet chooser closed after slow discovery', async ({ page }) => {
  await page.goto('/studio')
  await page.locator('[data-client-ready="true"]').waitFor()
  await page.evaluate(() => {
    const controls = globalThis as typeof globalThis & {
      __xcsBrowserE2eWalletDiscoveryDelayMs?: number
    }
    controls.__xcsBrowserE2eWalletDiscoveryDelayMs = 150
  })

  const trigger = page.getByTestId('wallet-toggle')
  await trigger.click()
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)

  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  await expect(page.locator('#wallet-menu')).toHaveCount(0)
  await expect(trigger).toBeFocused()
})

test('shows transaction-specific Credential compatibility in the wallet chooser', async ({
  page,
}) => {
  await page.goto('/studio')
  await page.locator('[data-client-ready="true"]').waitFor()
  await page.getByTestId('wallet-toggle').click()

  await expect(page.locator('[data-wallet-choice="gemwallet"]')).toContainText(
    /Schémas uniquement|Schemas only/u,
  )
  await expect(page.locator('[data-credential-support="unverified"]').first()).toContainText(
    /non validée|not validated/u,
  )
})

test('keeps the wallet chooser inside a 320px viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 })
  await page.goto('/studio')
  await page.locator('[data-client-ready="true"]').waitFor()

  await page.getByTestId('wallet-toggle').click()
  const chooser = page.locator('#wallet-menu')
  await expect(chooser).toBeVisible()
  const bounds = await chooser.boundingBox()

  expect(bounds).not.toBeNull()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320)
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(320)
})
