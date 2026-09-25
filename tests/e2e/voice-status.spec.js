import { expect, test } from '@playwright/test'

// The Track card's spoken status (A5), with the voice routes answered in the page: the conversation logic is covered
// by Vitest and the routes by the server tests, so this checks the card's wiring with a real (fake-device) microphone.
test('the Track card asks by voice, listens after the first prompt, and stops cleanly', async ({ page }) => {
  const prompts = []
  await page.route('**/api/voice/prompts', async (route) => {
    prompts.push(route.request().postDataJSON())
    await route.fulfill({ json: { text: 'বলুন, আপনি কী জানতে চান?', audio: null } })
  })
  await page.route('**/api/voice/transcripts', (route) => route.fulfill({ json: { text: '' } }))

  await page.goto('/')
  await page.getByRole('button', { name: 'English', exact: true }).click()
  const card = page.getByRole('region', { name: 'Track Application & Case Progress' })
  await card.getByRole('button', { name: 'Ask by Voice' }).click()

  await expect(card.getByText('Listening…')).toBeVisible()
  expect(prompts).toEqual([{ key: 'welcome' }])
  await card.getByRole('button', { name: 'Stop' }).click()
  await expect(card.getByRole('button', { name: 'Ask by Voice' })).toBeVisible()
  await expect(card.getByText('Listening…')).toHaveCount(0)
  await expect(card.getByRole('alert')).toHaveCount(0)
})

test('a caller asks in their own words, types the number and PIN, sees what was heard, and hears the status', async ({ page }) => {
  test.setTimeout(120000) // the opening and yes/no turns wait for the fake microphone's pause or 12-second limit
  const texts = { welcome: 'বলুন, আপনি কী জানতে চান?', askNumber: 'আপনার আবেদন নম্বরটি বলুন।', confirmNumber: 'আপনি বলেছেন ছয়। ঠিক থাকলে হ্যাঁ বলুন।', privateCheck: 'অন্য কেউ শুনতে পাবে না তো?', askPin: 'এবার পিন বলুন।' }
  const lookups = []
  const promptKeys = []
  await page.route('**/api/voice/prompts', (route) => {
    const { key } = route.request().postDataJSON()
    promptKeys.push(key)
    return route.fulfill({ json: { text: texts[key] ?? '…', audio: null } })
  })
  await page.route('**/api/voice/transcripts**', (route) => route.fulfill({ json: { text: route.request().url().includes('hint=yesNo') ? 'হ্যাঁ।' : 'আমার কেসটার কী হলো একটু বলেন' } }))
  await page.route('**/api/voice/requests', (route) => route.fulfill({ json: { wantsStatus: true } }))
  await page.route('**/api/voice/status', async (route) => {
    lookups.push(route.request().postDataJSON())
    await route.fulfill({ json: {
      sentence: 'আপনার মামলায় একজন প্যানেল আইনজীবী দায়িত্ব নিয়েছেন।', audio: null,
      result: { applicationId: 'APP-2026-000006', caseId: null, status: 'ACCEPTED', isUrgent: false, channel: 'HELPLINE_SIM', nextHearingAt: null, nextAction: null,
        applicantName: 'Fictional caller', legalNeed: 'Legal Assistance', officeCode: 'DEMO', lawyer: null, updates: [],
        stages: [{ phase: 1, title: 'Intake Registered', titleBn: 'আবেদন গ্রহণ', description: 'Registered.', descriptionBn: 'নিবন্ধিত।', status: 'COMPLETED', date: null }] },
    } })
  })

  await page.goto('/')
  await page.getByRole('button', { name: 'English', exact: true }).click()
  const card = page.getByRole('region', { name: 'Track Application & Case Progress' })
  await card.getByRole('button', { name: 'Ask by Voice' }).click()

  // The opening's own words matched no status word; the model read them, so the number is asked for next.
  await card.getByLabel('Or type the number').fill('6', { timeout: 20000 })
  await expect(card.getByText('You said: আমার কেসটার কী হলো একটু বলেন')).toBeVisible()
  await card.getByRole('button', { name: 'OK' }).click()
  await expect(card.getByLabel('Application ID or Case ID')).toHaveValue('6')

  // "হ্যাঁ" to the read-back and to the privacy question, then the PIN is typed and never shown as heard.
  await card.getByLabel('Or type the PIN').fill('482915', { timeout: 40000 })
  expect(promptKeys.slice(-2)).toEqual(['privateCheck', 'askPin'])
  await expect(card.getByLabel('Or type the PIN')).toHaveAttribute('type', 'password')
  await card.getByRole('button', { name: 'OK' }).click()
  await expect(card.getByText('আপনার মামলায় একজন প্যানেল আইনজীবী দায়িত্ব নিয়েছেন।').first()).toBeVisible()
  expect(lookups).toEqual([{ identifier: '6', lookupCode: '482915' }])
  await expect(card.getByLabel('Application ID or Case ID')).toHaveValue('APP-2026-000006')
  await expect(card.getByText('482915')).toHaveCount(0)
  await expect(card.getByRole('button', { name: 'Ask by Voice' })).toBeVisible()
})
