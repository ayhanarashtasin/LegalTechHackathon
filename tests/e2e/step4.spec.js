import { expect, test } from '@playwright/test'
import { steps } from '../../client/src/utils/voiceScript.js'
import { expand, signIn } from './support.js'

// Nonvisual proof: every control is reached with Tab by accessible name and used with Enter; no mouse, no positions.
async function tabTo(page, control) {
  for (let presses = 0; presses < 40; presses += 1) {
    if (await control.evaluate((element) => element === document.activeElement)) return
    await page.keyboard.press('Tab')
  }
  throw new Error('Control is not reachable with the Tab key.')
}

const prompt = (page, field) => page.getByRole('heading', { name: steps[field].prompt, exact: true })

const bn = (text) => text.replace(/[0-9]/g, (digit) => '০১২৩৪৫৬৭৮৯'[digit])

async function press(page, name) {
  await tabTo(page, page.getByRole('button', { name, exact: true }))
  await page.keyboard.press('Enter')
}

// Choices are answered on the keypad: option N is key N, named by its digit and label.
async function choose(page, field, value) {
  await expect(prompt(page, field)).toBeFocused()
  const index = steps[field].choices.findIndex(([option]) => option === value)
  await press(page, `${bn(String(index + 1))} ${steps[field].choices[index][1]}`)
}

// Spoken questions: this keyboard-only caller picks the typed answer instead of speaking.
async function say(page, field, words, previous) {
  await expect(prompt(page, field)).toBeFocused()
  await press(page, 'লিখে উত্তর দিন')
  const box = page.getByRole('textbox', { name: steps[field].prompt, exact: true })
  await expect(box).toBeFocused()
  if (previous) await expect(box).toHaveValue(previous)
  await page.keyboard.press('Control+A')
  await page.keyboard.type(words)
  await press(page, 'উত্তর দিন')
}

// A number (safe phone or NID) is dialled with the number keys, then #.
async function dial(page, field, number) {
  await expect(prompt(page, field)).toBeFocused()
  await page.keyboard.type(number)
  await expect(page.getByRole('status', { name: steps[field].label })).toHaveText(bn(number))
  await page.keyboard.press('#')
}

const readbackHeading = (page) => page.getByRole('heading', { name: 'আপনার উত্তরগুলো শুনে বা পড়ে মিলিয়ে নিন' })

// A full complaint call is a dozen questions and one Atlas transaction, then a DLAO review in the same test.
test.describe.configure({ timeout: 90000 })

test('Ripon reports for Moyuri by keyboard; the DLAO sees one pending representative record and unknown answers fail safe', async ({ page }) => {
  await page.goto('/voice')
  await page.getByRole('button', { name: 'বাংলা', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('লিগ্যাল এইড হেল্পলাইন')
  await expect(page.getByText('ওয়েবে তৈরি নমুনা কল · আসল ১৬৬৯৯ ফোনসেবা নয়')).toBeVisible()
  // A clean call screen: one call button, no instructions, consent questions, or placeholder notes.
  await expect(page.getByRole('button')).toHaveText(['বাংলা', 'English', 'হালকা মোড', 'কল করুন'])
  await press(page, 'কল করুন')
  await expect(page.getByText('কলটি রেকর্ড হচ্ছে')).toBeVisible()
  await expect(page.getByRole('button', { name: 'মানুষের সাথে কথা বলতে চাই' })).toHaveCount(0)
  await choose(page, 'service', 'COMPLAINT')
  await choose(page, 'callerRole', 'REPRESENTATIVE')
  await say(page, 'callerName', 'Ripon (fictional)')
  await say(page, 'relationship', 'Brother')
  await say(page, 'applicantName', 'Moyuri (fictional)')
  await say(page, 'district', 'Jaipurhat')
  await choose(page, 'nidKnown', false)
  await expect(page.getByText(/নিকটস্থ ইউডিসি অফিসে পরিচয় যাচাই করা যাবে/)).toBeVisible() // shown as well as spoken
  await say(page, 'problem', 'Fictional report about a family dispute.')
  await choose(page, 'urgent', false)
  await choose(page, 'contactChannel', 'PHONE')
  await dial(page, 'contactValue', '01700000000')
  await say(page, 'safeTime', 'Weekdays 10:00-12:00')

  const readback = readbackHeading(page)
  await expect(readback).toBeFocused()
  await expect(page.getByText(/তথ্যগুলো প্রতিনিধি জানিয়েছেন/)).toBeVisible()
  await press(page, 'সংশোধন করুন জেলা')
  await say(page, 'district', 'Joypurhat', 'Jaipurhat')
  await expect(readback).toBeFocused()
  const recordingUploaded = page.waitForResponse('**/api/voice/intakes/*/recording')
  await press(page, '১ জমা দিন')

  const done = page.getByRole('heading', { name: /^আবেদন জমা হয়েছে: APP-\d{4}-\d{6}$/ })
  // Submission is one database transaction of many writes; on a slow Atlas link it has taken over 15 seconds.
  await expect(done).toBeFocused({ timeout: 30000 })
  const applicationId = (await done.textContent()).match(/APP-\d{4}-\d{6}/)[0]
  await expect(page.getByText(/^অগ্রগতি জানার গোপন পিন: [০-৯]{6}$/)).toBeVisible() // a PIN the caller can hear and say back
  expect((await recordingUploaded).status()).toBe(201)
  await expect(page.getByText('কলটি রেকর্ড হচ্ছে')).toHaveCount(0) // the call has ended and the microphone is released

  await signIn(page, 'DLAO_OFFICER')
  const queueEntry = page.getByRole('link', { name: new RegExp(applicationId) })
  await expect(queueEntry).toHaveCount(1)
  await expect(queueEntry).toContainText('Reported by a representative · NID unknown: verify at a UDC')
  await queueEntry.click()
  await expect(page.getByRole('heading', { name: applicationId })).toBeVisible()
  await expect(page.getByText(/Ripon \(fictional\) · Brother · authority/)).toContainText('Pending')
  await expect(page.getByText(/After acceptance/)).toBeVisible()
  await expand(page, /^Call/)
  await expect(page.getByLabel('Full call recording')).toBeVisible()
  await expand(page, /^Facts and sources/)
  const facts = page.getByRole('region', { name: /^Facts and sources/ }).locator('tbody tr')
  await expect(facts).toHaveCount(5)
  for (const fact of await facts.all()) {
    await expect(fact).toContainText('Representative reported')
    await expect(fact).toContainText(/Caller Yes.*Applicant No/)
  }
  await expect(facts.filter({ hasText: 'District' })).toContainText('Joypurhat')
  await expect(facts.filter({ hasText: 'NID known' })).toContainText('No')

  // The simulated call opens the log form with the neutral words; the officer states what happened and plans a retry.
  await page.getByRole('button', { name: 'Simulate call: unknown person answers' }).click()
  const script = page.getByRole('figure', { name: 'Neutral script' }).locator('blockquote')
  await expect(script).toBeVisible()
  for (const secret of [applicationId, 'Moyuri', 'Ripon', 'Joypurhat', 'family dispute', 'legal', 'আইনি', 'লিগ্যাল']) await expect(script).not.toContainText(secret)
  const contactLog = page.getByRole('region', { name: /^Contact log/ })
  await expect(contactLog.getByLabel(/^Who answered/)).toBeFocused()
  await contactLog.getByLabel(/^Who answered/).fill('Shop owner')
  await contactLog.getByRole('radio', { name: 'No, nothing' }).check()
  const retry = new Date(Date.now() + 86400000)
  const retryLocal = `${retry.getFullYear()}-${String(retry.getMonth() + 1).padStart(2, '0')}-${String(retry.getDate()).padStart(2, '0')}T15:00`
  await contactLog.getByLabel('Next attempt').fill(retryLocal)
  await contactLog.getByRole('button', { name: 'Log attempt' }).click()
  await expect(contactLog).toContainText('Someone else answered')
  await expect(contactLog).toContainText('Someone else (Shop owner)')
  await expect(contactLog.locator('dd').filter({ hasText: /^No$/ })).toHaveCount(1)
  await expect(page.getByRole('region', { name: /^Tasks/ })).toContainText('Plan safer follow-up')
  await expect(page.getByRole('region', { name: /^History/ })).toContainText('Integrity check passed')
})

test('wrong keys repeat the question, hanging up discards the call, and a caller in danger continues the full intake', async ({ page }) => {
  await page.goto('/voice')
  await page.getByRole('button', { name: 'বাংলা', exact: true }).click()
  await press(page, 'কল করুন')
  await expect(prompt(page, 'service')).toBeFocused()
  await page.keyboard.press('9') // not an option: the wrong-key clip plays and the same question comes back
  await expect(prompt(page, 'service')).toBeFocused()
  await expect(prompt(page, 'callerRole')).toHaveCount(0)
  await choose(page, 'service', 'COMPLAINT')
  page.once('dialog', (dialog) => dialog.accept())
  await press(page, 'কল শেষ করুন')
  await expect(page.getByRole('button', { name: 'কল করুন' })).toBeVisible()

  await press(page, 'কল করুন')
  await choose(page, 'service', 'COMPLAINT')
  await choose(page, 'callerRole', 'SELF')
  await say(page, 'callerName', 'Rahima (fictional)')
  await say(page, 'district', 'Barguna')
  await choose(page, 'nidKnown', true)
  await page.keyboard.type('12345') // not 10, 13, or 17 digits: # asks again
  await page.keyboard.press('#')
  await expect(prompt(page, 'nid')).toBeFocused()
  await expect(page.getByRole('status', { name: steps.nid.label })).toHaveText('')
  // Not "no answer": the caller sees what arrived and why it was not taken.
  await expect(page.getByText('আপনার দেওয়া নম্বর: ১২৩৪৫ (৫ অঙ্ক)। NID নম্বর ১০, ১৩ বা ১৭ অঙ্কের হয়।')).toBeVisible()
  // As the clip says, a pause ends a typed number: no # needed.
  await page.keyboard.type('0000000000')
  await expect(prompt(page, 'problem')).toBeFocused({ timeout: 10000 })
  await say(page, 'problem', 'Fictional account of threats at home last night.')
  await choose(page, 'urgent', true)
  await expect(page.getByText(/জীবন ঝুঁকিতে থাকলে এখনই ৯৯৯/)).toBeVisible()
  await choose(page, 'contactChannel', 'UDC')
  await say(page, 'safeTime', 'Evening after 6 pm')
  await expect(readbackHeading(page)).toBeFocused()
  await expect(page.getByRole('term').filter({ hasText: new RegExp(`^${steps.problem.label}$`) })).toBeVisible() // the story is taken, not skipped
  await expect(page.getByText('0000000000')).toBeVisible()
  await page.setViewportSize({ width: 375, height: 700 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
  await page.keyboard.press('1') // the read-back is confirmed on the keypad too
  await expect(page.getByText('আবেদন জমা হচ্ছে…')).toBeVisible()
  await expect(page.getByRole('heading', { name: /^আবেদন জমা হয়েছে: APP-\d{4}-\d{6}$/ })).toBeFocused({ timeout: 30000 })
})

test('an advice call waits for a helpline callback, and the helpline records the outcome', async ({ page }) => {
  await page.goto('/voice')
  await page.getByRole('button', { name: 'বাংলা', exact: true }).click()
  await press(page, 'কল করুন')
  await choose(page, 'service', 'ADVICE')
  await say(page, 'adviceTopic', 'Fictional question about unpaid wages.')
  await dial(page, 'contactValue', '01700000000')
  await say(page, 'safeTime', 'Weekday afternoon')
  await expect(readbackHeading(page)).toBeFocused()
  await page.keyboard.press('1')
  await expect(page.getByRole('heading', { name: 'প্রশ্ন গ্রহণ করা হয়েছে' })).toBeFocused({ timeout: 30000 })
  await expect(page.getByText(/গোপন পিন/)).toHaveCount(0) // no application yet, so no status PIN

  await signIn(page, 'HELPLINE_AGENT')
  const request = page.getByRole('article').filter({ hasText: 'Fictional question about unpaid wages.' })
  await expect(request).toContainText('01700000000')
  await request.getByLabel('Information given on the call').fill('Explained the wage claim steps and the documents to keep.')
  await request.getByRole('button', { name: 'Record outcome' }).click()
  await expect(page.getByRole('status').filter({ hasText: /closed: information given/ })).toBeVisible()
  await expect(page.getByText('No advice requests are waiting for a callback.')).toBeVisible()
})
