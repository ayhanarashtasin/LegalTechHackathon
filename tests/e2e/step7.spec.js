/* global process, indexedDB, document */
import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { expand, signIn, signOut } from './support.js'

test('Step 7 Nuching offline intake survives loss, syncs once, resolves a conflict, and has a cited document briefing', async ({ page, request }) => {
  test.setTimeout(60000)
  await signIn(page, 'UDC_OPERATOR')
  await page.getByRole('link', { name: 'Open assisted intake and offline drafts' }).click()
  await expect(page.getByText('Legal aid is free.')).toBeVisible()
  await page.getByLabel('Local draft passphrase').fill('FictionalSecretPhrase!')
  await page.getByRole('button', { name: 'Load fictional Nuching example' }).click()
  await page.getByLabel('Applicant name').fill('Fictional Nuching Offline 1')
  await expect(page.locator('.plain-list li').filter({ hasText: 'Draft' }).first()).toBeVisible()

  await page.context().setOffline(true)
  await expect(page.getByRole('status').filter({ hasText: 'Connection: offline' })).toBeVisible()
  await page.getByLabel(/Original statement/).fill('Fictional Marma account continued after the network was lost.')
  await page.getByRole('button', { name: 'Queue encrypted application' }).click()
  for (const number of [2, 3]) {
    await page.getByRole('button', { name: 'Load fictional Nuching example' }).click()
    await page.getByLabel('Applicant name').fill(`Fictional Nuching Offline ${number}`)
    await page.getByRole('button', { name: 'Queue encrypted application' }).click()
  }
  await expect(page.locator('.plain-list li').filter({ hasText: 'Queued' })).toHaveCount(3)
  await page.getByRole('button', { name: 'Verify local integrity' }).click()
  await expect(page.getByRole('status').filter({ hasText: '3 local encrypted drafts verified' })).toBeVisible()

  await page.context().setOffline(false)
  await expect(page.getByText('No local drafts.')).toBeVisible({ timeout: 30000 })
  const officer = JSON.parse(process.env.E2E_ACTORS).DLAO_OFFICER
  const login = await request.post('/api/auth/login', { data: officer })
  const { token } = await login.json()
  const headers = { authorization: `Bearer ${token}` }
  const queue = await (await request.get('/api/workspace?role=DLAO_OFFICER', { headers })).json()
  const records = queue.records.filter(({ applicantName }) => applicantName.startsWith('Fictional Nuching Offline'))
  expect(records).toHaveLength(3)
  const applicationId = records[0].applicationId

  await page.getByLabel('Application ID').fill(applicationId)
  await page.getByRole('button', { name: 'Open limited correction' }).click()
  await expect(page.getByRole('heading', { name: new RegExp(`Correct ${applicationId}`) })).toBeVisible()
  await page.context().setOffline(true)
  await page.getByLabel(/Original statement/).fill('Fictional corrected Marma words from a local UDC draft.')
  await page.getByRole('button', { name: 'Queue encrypted correction' }).click()
  const task = await request.post(`/api/applications/${applicationId}/tasks`, { headers, data: { title: 'Review fictional file', ownerRole: 'DLAO_OFFICER', nextAction: 'Check translated account with applicant.' } })
  expect(task.ok()).toBeTruthy()
  await page.context().setOffline(false)
  await expect(page.getByRole('heading', { name: 'Human conflict review' })).toBeVisible({ timeout: 30000 })
  await expect(page.getByText('Fictional corrected Marma words from a local UDC draft.')).toBeVisible()
  await page.getByLabel('Reason for human choice').fill('I compared both fictional versions and retained the new local words as a revision.')
  await page.getByRole('button', { name: 'Apply local as new revision' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Human resolution recorded' })).toBeVisible()
  await expect(page.getByText('No local drafts.')).toBeVisible()
  await page.getByRole('button', { name: 'Load fictional Nuching example' }).click()
  await expect(page.locator('.plain-list li').filter({ hasText: 'Draft' }).first()).toBeVisible()
  await signOut(page)
  await expect(page.getByRole('heading', { name: 'One record, every handover.' })).toBeVisible()
  const remaining = await page.evaluate(() => new Promise((resolve, reject) => {
    const opened = indexedDB.open('dlas-offline-v1')
    opened.onerror = () => reject(opened.error)
    opened.onsuccess = () => {
      const counted = opened.result.transaction('drafts').objectStore('drafts').count()
      counted.onsuccess = () => { resolve(counted.result); opened.result.close() }
      counted.onerror = () => reject(counted.error)
    }
  }))
  expect(remaining).toBe(0)

  await signIn(page, 'DLAO_OFFICER')
  await page.getByLabel('Application or Case ID').fill(applicationId)
  await page.getByRole('button', { name: 'Find record' }).click()
  await expand(page, /^Assisted intake/)
  await expect(page.getByText('Fictional Marma translator')).toBeVisible()
  await expand(page, /^Document briefing/)
  await page.getByRole('button', { name: 'Upload six fictional sample documents' }).click()
  await expect(page.getByText('Six fictional documents uploaded.')).toBeVisible({ timeout: 30000 })
  await page.getByRole('button', { name: 'Generate briefing' }).click()
  const briefing = page.getByRole('heading', { name: /^Briefing.*Proposed/ }).locator('..')
  await expect(briefing).toBeVisible()
  await expect(briefing.getByText('Witness or other supporting record')).toBeVisible()
  await expect(briefing.getByText('land deed unreadable').first()).toBeVisible()
  await expect(briefing.getByText(/identity note, version 1, line 1/)).toBeVisible()
  await page.getByRole('button', { name: 'Open source identity note, line 1' }).click()
  await expect(briefing.getByText('Identity has not been legally verified; this sample is not proof of identity.')).toBeVisible()
  await page.getByLabel('Officer verification reason').fill('I checked the cited fictional lines and the listed missing and unreadable items.')
  await page.getByRole('button', { name: 'Approve briefing accuracy only' }).click()
  await expect(page.getByRole('heading', { name: /^Briefing.*Approved/ })).toBeVisible()
  await expand(page, /^History/)
  await expect(page.getByRole('region', { name: /^History/ }).getByText(/Document briefing approved/)).toBeVisible()
})

test('Step 7 assisted intake remains labeled and keyboard reachable on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signIn(page, 'UDC_OPERATOR')
  expect(await page.evaluate(() => globalThis.localStorage.getItem('dlas_token'))).toBeNull()
  await page.getByRole('link', { name: 'Open assisted intake and offline drafts' }).click()
  await expect(page.getByLabel('Local draft passphrase')).toBeVisible()
  await expect(page.getByLabel(/Original statement/)).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  await page.getByLabel('Local draft passphrase').focus()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Sync now' })).toBeFocused()
})

test('T6 briefing links each point to a readable source and reserves approval for the officer', async ({ page, request }) => {
  const actors = JSON.parse(process.env.E2E_ACTORS)
  const login = await request.post('/api/auth/login', { data: actors.UDC_OPERATOR })
  const { token } = await login.json()
  const created = await request.post('/api/assisted', { headers: { authorization: `Bearer ${token}` }, data: {
    temporaryId: randomUUID(), clientMutationId: randomUUID(), applicantName: 'Fictional T6 Browser Applicant',
    translatorName: 'Fictional translator', typistName: 'Fictional typist',
    originalLanguage: 'Marma', originalStatement: 'Fictional land statement.', translatedStatement: 'Fictional Bangla land statement.',
    caseType: 'LAND', consentAttestation: 'Fictional oral consent after translation.',
    originalConfirmed: true, translationConfirmed: false, contactChannel: 'IN_PERSON',
  } })
  expect(created.status()).toBe(201)
  const { applicationId } = await created.json()

  await signIn(page, 'DLAO_OFFICER')
  await page.getByLabel('Application or Case ID').fill(applicationId)
  await page.getByRole('button', { name: 'Find record' }).click()
  await expand(page, /^Document briefing/)
  await page.getByRole('button', { name: 'Upload six fictional sample documents' }).click()
  await expect(page.getByText('Six fictional documents uploaded.')).toBeVisible({ timeout: 30000 })
  await page.getByRole('button', { name: 'Generate briefing' }).click()
  const briefing = page.getByRole('heading', { name: /^Briefing.*Proposed/ }).locator('..')
  await expect(briefing.getByText(/identity note, version 1, line 1/)).toBeVisible()
  await expect(briefing.getByText('Witness or other supporting record')).toBeVisible()
  await expect(briefing.getByText('land deed unreadable').first()).toBeVisible()
  await page.getByRole('button', { name: 'Open source identity note, line 1' }).click()
  await expect(briefing.getByText('Identity has not been legally verified; this sample is not proof of identity.')).toBeVisible()
  await page.getByLabel('Officer verification reason').fill('I checked the full fictional source and the missing and unreadable items.')
  await page.getByRole('button', { name: 'Approve briefing accuracy only' }).click()
  await expect(page.getByRole('heading', { name: /^Briefing.*Approved/ })).toBeVisible()

  await signOut(page)
  await signIn(page, 'CASE_SUPPORT')
  await page.getByLabel('Application or Case ID').fill(applicationId)
  await page.getByRole('button', { name: 'Find record' }).click()
  await expand(page, /^Document briefing/)
  await expect(page.getByRole('heading', { name: /^Briefing.*Approved/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Generate briefing' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Approve briefing accuracy only' })).toHaveCount(0)
})
