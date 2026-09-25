/* global process */
import { expect, test } from '@playwright/test'
import { expand, signIn } from './support.js'

test('Step 10: DLAO links common evidence once and reviews duplicate suggestions without merging', async ({ page, request }) => {
  test.setTimeout(150000)
  const actors = JSON.parse(process.env.E2E_ACTORS)
  const login = async () => ({ authorization: `Bearer ${(await (await request.post('/api/auth/login', { data: actors.DLAO_OFFICER })).json()).token}` })
  const officer = await login()

  async function acceptedCase(name) {
    const submitted = await request.post('/api/applications', { headers: officer, data: { applicantName: name } })
    expect(submitted.status()).toBe(201)
    const { applicationId } = await submitted.json()
    expect((await request.post(`/api/applications/${applicationId}/review`, { headers: officer, data: {
      reviewState: 'READY_FOR_DECISION', reason: 'Fictional application reviewed by a human DLAO officer.',
    } })).ok()).toBeTruthy()
    const accepted = await request.post(`/api/applications/${applicationId}/accept`, { headers: officer, data: {
      reason: 'Fictional Application accepted by a human DLAO officer.',
    } })
    expect(accepted.ok()).toBeTruthy()
    return { applicationId, caseId: (await accepted.json()).caseId }
  }

  const cases = [
    await acceptedCase('Fictional fire claimant one'),
    await acceptedCase('Fictional fire claimant two'),
    await acceptedCase('Fictional fire claimant three'),
  ]
  const document = await request.post(`/api/applications/${cases[0].applicationId}/documents`, { headers: officer, data: {
    label: 'Fictional fire inspection note', qualityState: 'READABLE', filename: 'fictional-fire.txt',
    textContent: 'Synthetic tabletop exercise only: a simulated alarm activated in the east packing area.', sensitivity: 'STANDARD',
  } })
  expect(document.ok()).toBeTruthy()

  await signIn(page, 'DLAO_OFFICER')
  async function openApplication(applicationId) {
    await page.getByRole('link', { name: /provider workspace home/i }).click()
    await page.getByLabel('Application or Case ID').fill(applicationId)
    await page.getByRole('button', { name: 'Find record' }).click()
    await expect(page.getByRole('heading', { name: applicationId })).toBeVisible()
  }
  await openApplication(cases[0].applicationId)
  await expand(page, /^Related cases/)
  await expand(page, 'Link cases')
  await page.getByLabel('Group label').fill('Fictional fire claims')
  await page.getByLabel('Two or more other accepted Application IDs').fill(`${cases[1].applicationId}, ${cases[2].applicationId}`)
  await page.getByLabel('Why these Cases are related').fill('These fictional applicants report the same tabletop factory event.')
  await page.getByRole('button', { name: 'Link Cases, do not merge' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'No records were merged' })).toBeVisible()
  await page.getByRole('link', { name: 'Fictional fire claims' }).click()
  await expect(page.getByRole('heading', { name: 'Fictional fire claims' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Separate Case records' })).toBeVisible()
  for (const item of cases) await expect(page.locator('.plain-list li').filter({ hasText: item.caseId }).first()).toBeVisible()
  await page.getByLabel('Reason this common evidence is relevant').fill('One fictional exercise note is relevant to each separate Case.')
  await page.getByRole('button', { name: 'Share existing evidence reference' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'No document copy was created' })).toBeVisible()
  await expect(page.getByText('Fictional fire inspection note', { exact: true })).toBeVisible()
  await page.getByText('Read common evidence text').click()
  await expect(page.getByText(/Synthetic tabletop exercise only/)).toBeVisible()

  await signIn(page, 'CASE_SUPPORT')
  await openApplication(cases[0].applicationId)
  await expand(page, /^Related cases/)
  await page.getByRole('link', { name: 'Fictional fire claims' }).click()
  await expect(page.getByRole('heading', { name: 'Fictional fire claims' })).toBeVisible()
  await expect(page.getByText(/Synthetic tabletop exercise only/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Share existing evidence reference' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Link cases, do not merge' })).toHaveCount(0)
  await signIn(page, 'DLAO_OFFICER')

  const examples = [
    ['Amina Rahman', '00000000001', '1990-02-03', 'DEMO NORTH'],
    ['Amina Rahman', '00000000001', '1990-02-03', 'DEMO NORTH'],
    ['Amina Rehman', '00000000001', '1990-02-03', 'DEMO NORTH'],
    ['Salma Khatun', '00000000004', '1985-01-01', 'DEMO SOUTH'],
    ['Salma Khatun', '00000000005', '1994-04-02', 'DEMO SOUTH'],
    ['Rahima Begum', '00000000006', '1984-03-04', 'DEMO WEST'],
    ['Rahima Begum', '00000000006', '1978-11-18', 'DEMO WEST'],
  ]
  const duplicateIds = []
  for (const [name, phone, dob, district] of examples) {
    const submitted = await request.post('/api/applications', { headers: officer, data: { applicantName: name } })
    expect(submitted.status()).toBe(201)
    const { applicationId } = await submitted.json()
    duplicateIds.push(applicationId)
    for (const [field, value] of [['contact.phone', phone], ['person.date_of_birth', dob], ['location.district', district]]) {
      expect((await request.post(`/api/applications/${applicationId}/facts`, { headers: officer, data: { field, value, sourceType: 'STAFF_ENTERED' } })).ok()).toBeTruthy()
    }
  }

  await openApplication(duplicateIds[0])
  await expand(page, /^Possible duplicates/)
  const reviewPanel = page.locator('section[aria-labelledby="duplicate-title"]')
  const exactCard = reviewPanel.locator('article').filter({ hasText: duplicateIds[1] })
  await expect(exactCard).toContainText('100/100')
  await expect(exactCard.locator('tr').filter({ hasText: 'Contact number' })).toContainText('Same')
  await exactCard.getByLabel('Review reason').fill('The matching synthetic profile was confirmed by the human reviewer.')
  await exactCard.getByRole('button', { name: 'Same person (keep separate)' }).click()
  await expect(reviewPanel.getByRole('status').filter({ hasText: 'kept separate' }).last()).toBeVisible()

  await openApplication(duplicateIds[3])
  await expand(page, /^Possible duplicates/)
  const trapCard = page.locator('section[aria-labelledby="duplicate-title"] article').filter({ hasText: duplicateIds[4] })
  await expect(trapCard).toContainText('55/100')
  await expect(trapCard).toContainText('Date of birth')
  await trapCard.getByLabel('Review reason').fill('Same fictional name and district do not establish the same person.')
  await trapCard.getByRole('button', { name: 'Different people' }).click()
  await expect(trapCard.getByRole('status')).toContainText(/different people/i)
})
