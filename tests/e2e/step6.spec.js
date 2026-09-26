import { expect, test } from '@playwright/test'
import { expand, signIn, signOut } from './support.js'

test('Step 6 shared queue, audited human override, case support history, and safe helpline lookup', async ({ page, request }) => {
  await signIn(page, 'HELPLINE_AGENT')
  await page.getByLabel('Fictional applicant name').fill('Fictional Step Six Applicant')
  await page.getByRole('button', { name: 'Submit application' }).click()
  const receipt = page.getByRole('status').filter({ hasText: 'submitted to the DLAO queue' })
  await expect(receipt).toBeVisible()
  const applicationId = (await receipt.textContent()).match(/APP-\d{4}-\d{6}/)[0]
  const lookupCode = (await receipt.textContent()).match(/[a-f0-9]{24}/)[0]

  const officer = JSON.parse(process.env.E2E_ACTORS).DLAO_OFFICER
  const auth = await request.post('/api/auth/login', { data: officer })
  const { token } = await auth.json()
  const headers = { authorization: `Bearer ${token}` }
  expect((await request.post(`/api/applications/${applicationId}/safe-contact`, { headers, data: { allowedChannels: ['PHONE'], prohibitedChannels: ['SMS'], contactValue: '01700000000', smsSafe: false, neutralWordingRequired: true } })).ok()).toBeTruthy()
  expect((await request.post(`/api/applications/${applicationId}/facts`, { headers, data: { field: 'safety.urgent', value: 'YES', sourceType: 'STAFF_ENTERED' } })).ok()).toBeTruthy()
  const representative = await request.post(`/api/applications/${applicationId}/representations`, { headers, data: { representativeName: 'Fictional representative', relationship: 'sibling', scope: 'Initial report only' } })
  expect(representative.status()).toBe(201)
  const { representativePersonId } = await representative.json()
  const problemText = 'A fictional representative reports repeated threats after a boundary dispute. The family is worried that the other party will block its shared access path and is asking for a safe next step. '.repeat(2)
  expect((await request.post(`/api/applications/${applicationId}/facts`, { headers, data: {
    field: 'complaint.summary', value: problemText, sourceType: 'REPRESENTATIVE_REPORTED', sourcePersonId: representativePersonId,
  } })).ok()).toBeTruthy()

  await page.getByLabel('Application or Case ID').fill(applicationId)
  await page.getByLabel('Lookup code').fill(lookupCode)
  await page.getByLabel('I performed the approved human caller-verification procedure.').check()
  await page.getByRole('button', { name: 'Check permitted status' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'awaiting an officer decision' })).toBeVisible()

  await signOut(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await signIn(page, 'DLAO_OFFICER')
  await page.getByRole('button', { name: /^Urgent recommendation/ }).click()
  const queueRecord = page.getByRole('link', { name: new RegExp(applicationId) })
  await expect(queueRecord).toContainText('An urgent fact is recorded')
  await expect(queueRecord).toContainText('Problem')
  await expect(queueRecord).toContainText('Representative')
  await expect(queueRecord).toContainText('Applicant confirmation pending')
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 })
    const mobileLayout = await page.evaluate(() => {
      const preview = document.querySelector('.record-problem-text')
      const bounds = document.querySelector('.record-problem-preview')?.getBoundingClientRect()
      return {
        viewportWidth: document.documentElement.clientWidth,
        documentWidth: document.documentElement.scrollWidth,
        previewLineClamp: preview && getComputedStyle(preview).webkitLineClamp,
        previewHeight: preview && { client: preview.clientHeight, scroll: preview.scrollHeight },
        cardRight: bounds?.right,
      }
    })
    expect(mobileLayout.documentWidth).toBeLessThanOrEqual(mobileLayout.viewportWidth)
    expect(mobileLayout.cardRight).toBeLessThanOrEqual(mobileLayout.viewportWidth)
    expect(mobileLayout.previewLineClamp).toBe('2')
    expect(mobileLayout.previewHeight.scroll).toBeGreaterThan(mobileLayout.previewHeight.client)
  }

  const support = JSON.parse(process.env.E2E_ACTORS).CASE_SUPPORT
  const supportAuth = await request.post('/api/auth/login', { data: support })
  const { token: supportToken } = await supportAuth.json()
  const supportWorkspace = await request.get('/api/workspace?role=CASE_SUPPORT', { headers: { authorization: `Bearer ${supportToken}` } })
  const supportRecord = (await supportWorkspace.json()).records.find((record) => record.applicationId === applicationId)
  expect(supportRecord).toBeTruthy()
  expect(supportRecord).not.toHaveProperty('problemSummary')

  await page.setViewportSize({ width: 1280, height: 800 })
  await queueRecord.click()
  await page.getByLabel('Priority decision').selectOption('ROUTINE')
  await page.getByRole('region', { name: /^Priority/ }).getByLabel(/^Reason/).fill('Officer reviewed the fictional urgent indicator and chose routine handling.')
  await page.getByRole('button', { name: 'Save priority' }).click()
  await expand(page, /^History/)
  await expect(page.getByRole('region', { name: /^History/ }).getByText(/Priority set by officer/)).toBeVisible()

  await signOut(page)
  await signIn(page, 'CASE_SUPPORT')
  await page.getByLabel('Search shown history').fill(applicationId)
  await page.getByRole('link', { name: new RegExp(applicationId) }).click()
  const history = page.getByRole('region', { name: /^History/ })
  await expect(history.getByText(/Priority set by officer/)).toBeVisible()
  await expect(history.getByText(/Helpline status lookup/).first()).toBeVisible()
})
