import { expect, test } from '@playwright/test'
import { expand, signIn, signOut } from './support.js'

test('helpline intake becomes one reviewed DLAO case and provider shells stay bounded', async ({ page, request }) => {
  test.setTimeout(60000) // signs in as eight roles in turn
  await page.goto('/')
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused()

  await signIn(page, 'HELPLINE_AGENT')
  await page.getByLabel('Fictional applicant name').fill('Fictional Browser Applicant')
  await page.getByRole('button', { name: 'Submit application' }).click()
  const submitted = page.getByText(/Application APP-\d{4}-\d{6} submitted to the DLAO queue/)
  await expect(submitted).toBeVisible()
  const applicationId = (await submitted.textContent()).match(/APP-\d{4}-\d{6}/)[0]
  // The helpline list holds only 16699 advice callbacks, never the application it just submitted.
  await expect(page.getByText('No advice requests are waiting for a callback.')).toBeVisible()

  await signOut(page)
  await signIn(page, 'DLAO_OFFICER')
  await page.getByRole('link', { name: new RegExp(applicationId) }).click()
  await expect(page.getByRole('heading', { name: applicationId })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Accept application' })).toBeDisabled()
  await page.getByLabel('Review outcome').selectOption('READY_FOR_DECISION')
  await page.getByRole('region', { name: /^Decision/ }).getByLabel(/^Reason/).fill('Officer reviewed the fictional helpline intake.')
  await page.getByRole('button', { name: 'Record review' }).click()
  await expect(page.getByRole('button', { name: 'Accept application' })).toBeEnabled()
  await page.getByLabel('Decision reason').fill('Officer accepted the fictional reviewed application.')
  await page.getByRole('button', { name: 'Accept application' }).click()
  const caseText = page.getByText(/^CASE-\d{4}-\d{6}$/).first()
  await expect(caseText).toBeVisible()
  const caseId = await caseText.textContent()
  await expand(page, /^History/)
  await expect(page.getByRole('region', { name: /^History/ }).getByText(/Application accepted/)).toBeVisible()

  await page.getByRole('link', { name: '← Workspace' }).click()
  await page.getByLabel('Application or Case ID').fill(caseId)
  await page.getByRole('button', { name: 'Find record' }).click()
  await expect(page.getByRole('heading', { name: applicationId })).toBeVisible()

  const links = await page.locator('a[href]').evaluateAll((items) => items.map((item) => item.getAttribute('href')).filter((href) => href && href.startsWith('/')))
  for (const href of new Set(links)) expect((await request.get(href)).ok(), `Internal link ${href} is dead`).toBeTruthy()

  for (const role of ['CASE_SUPPORT', 'UDC_OPERATOR', 'PANEL_LAWYER', 'MEDIATOR', 'RECEIVING_DLAO', 'CLAO']) {
    await signOut(page)
    await signIn(page, role)
    // Case support and the CLAO (read-only) see the office queue; other provider shells stay bounded.
    if (role !== 'CASE_SUPPORT' && role !== 'CLAO') await expect(page.getByText(applicationId)).toHaveCount(0)
  }

  await page.setViewportSize({ width: 375, height: 700 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
})
