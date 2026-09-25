import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { steps } from '../../client/src/utils/voiceScript.js'
import { expand, signIn } from './support.js'

// The fake microphone loops 1 s of speech-like sound and 5 s of silence, so a pause ends each spoken answer.
const rate = 48000
const seconds = 6
const pcm = Buffer.alloc(rate * seconds * 2)
for (let i = 0; i < rate * seconds; i++) {
  const t = i / rate
  const voiced = t < 1 ? Math.abs(Math.sin(Math.PI * 4 * t)) * (Math.sin(2 * Math.PI * 180 * t) + 0.5 * Math.sin(2 * Math.PI * 360 * t) + 0.3 * Math.sin(2 * Math.PI * 900 * t)) * 0.25 : 0
  pcm.writeInt16LE(Math.round(voiced * 32767), i * 2)
}
const header = Buffer.alloc(44)
header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVE', 8); header.write('fmt ', 12)
header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(rate, 24)
header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(pcm.length, 40)
const microphone = join(tmpdir(), 'dlas-voice-microphone.wav')
writeFileSync(microphone, Buffer.concat([header, pcm]))

test.use({ launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${microphone}`] } })

// What the (stubbed) voice service "heard" for each question. Choices use words or a bare key number.
const heard = {
  service: { text: 'অভিযোগ', values: { service: 'COMPLAINT' } },
  callerRole: { text: 'দুই', values: {} }, // a bare number: matched to key 2 by the page, not the model
  callerName: { text: 'রিপন', values: { callerName: 'Ripon (fictional)' } },
  relationship: { text: 'ভাই', values: { relationship: 'Brother' } },
  applicantName: { text: 'ময়ূরী', values: { applicantName: 'Moyuri (fictional)' } },
  district: { text: 'জয়পুরহাট', values: { district: 'Joypurhat' } },
  nidKnown: { text: 'হ্যাঁ', values: { nidKnown: true } },
  // Whisper's real transcript of a spoken NID, spelled by ear; the model returned nothing for it, as it really did.
  nid: { text: 'এক, দুই, তিন, চার, পাচ, শুন্ন, নই, আট, শাত, ছা', values: {} },
  problem: { text: 'পারিবারিক বিরোধ', values: { problem: 'Fictional family dispute report.' } },
  urgent: { text: 'না', values: { urgent: false } },
  contactChannel: { text: 'ফোনে', values: { contactChannel: 'PHONE' } },
  contactValue: { text: 'শূন্য, এক, সাত, শূন্য, শূন্য, শূন্য, শূন্য, শূন্য, শূন্য, শূন্য, শূন্য', values: { contactValue: '01700000000' } },
  safeTime: { text: 'সন্ধ্যায়', values: { safeTime: 'Evening' } },
  confirm: { text: 'হ্যাঁ', values: { confirm: true } },
}

// The E2E server runs with VOICE_AI=off, so speaking an answer hits a real 503 from our own API.
test('when voice understanding is unavailable, the caller keeps answering by keyboard', async ({ page }) => {
  await page.goto('/voice')
  await page.getByRole('button', { name: 'বাংলা', exact: true }).click()
  await page.getByRole('button', { name: 'কল করুন', exact: true }).click()
  await expect(page.getByRole('heading', { name: steps.service.prompt })).toBeFocused()
  await page.keyboard.press('1') // a complaint; a key answers a choice straight away
  await expect(page.getByRole('heading', { name: steps.callerRole.prompt })).toBeFocused()
  await page.keyboard.press('1') // for myself
  await expect(page.getByRole('heading', { name: steps.callerName.prompt })).toBeFocused()

  await page.keyboard.press('#') // skip the question clip; the beep starts the recording
  await expect(page.getByText(/শুনছি/)).toBeVisible()
  await page.waitForTimeout(1500) // record long enough for the fake microphone to produce real audio
  const answered = page.waitForResponse('**/api/voice/answers**')
  await page.keyboard.press('#')
  expect((await answered).status()).toBe(503)
  await expect(page.getByText(/এখন আপনার বলা উত্তরটি বোঝা যাচ্ছে না/)).toBeVisible()

  // The draft survives and the same question continues as a typed answer.
  const name = page.getByRole('textbox', { name: steps.callerName.prompt })
  await expect(name).toBeFocused()
  await name.fill('Fictional Moyuri')
  await page.getByRole('button', { name: 'উত্তর দিন', exact: true }).click()
  // Once voice is known to be off, spoken questions open straight into the typed answer.
  await expect(page.getByRole('textbox', { name: steps.district.prompt })).toBeVisible()
  await expect(page.getByRole('button', { name: 'লিখে উত্তর দিন' })).toHaveCount(0)
})

test('the whole call can be answered by voice, with each number read back and the submit said aloud', async ({ page }) => {
  test.setTimeout(300000)
  const asked = []
  await page.route('**/audio/{digit*,numberConfirm}.mp3', (route) => route.fulfill({ status: 200, contentType: 'audio/mpeg', body: '' }))
  // The first yes/no to a read-back is unclear, then "হ্যাঁ ঠিক হয়েছে" arrives with nothing from the model: the page's own
  // yes/no words must carry it, and the unclear reply must ask the yes/no again, not the number.
  const confirms = [{ text: 'আঁ', values: {} }, { text: 'হ্যাঁ ঠিক হয়েছে', values: {} }]
  await page.route('**/api/voice/answers**', (route) => {
    const field = new URL(route.request().url()).searchParams.get('fields')
    asked.push(field)
    return route.fulfill({ json: { ...(field === 'confirm' && confirms.length ? confirms.shift() : heard[field]), sensitive: false } })
  })
  await page.goto('/voice')
  await page.getByRole('button', { name: 'বাংলা', exact: true }).click()
  await page.getByRole('button', { name: 'কল করুন', exact: true }).click()

  const answer = async (fields) => {
    for (const field of fields) {
      await expect(page.getByRole('heading', { name: field === 'urgentConfirm' ? /নিরাপত্তার প্রশ্নটি আবার বলুন/ : steps[field].prompt, exact: field !== 'urgentConfirm' })).toBeFocused({ timeout: 30000 })
      await page.keyboard.press('#') // skip the clip to the beep; the pause then ends the answer
    }
  }
  // A spoken number is read back (clips stubbed) and confirmed by voice, with no key.
  const readBack = (digits) => expect(page.getByRole('heading', { name: `আপনার বলা নম্বর: ${digits}` })).toBeFocused({ timeout: 30000 })
  await answer(['service', 'callerRole', 'callerName', 'relationship', 'applicantName', 'district', 'nidKnown', 'nid'])
  await readBack('১২৩৪৫০৯৮৭৬')
  await expect.poll(() => asked.filter((field) => field === 'confirm').length, { timeout: 30000 }).toBe(1)
  await readBack('১২৩৪৫০৯৮৭৬') // asked again with the number kept, not back to the NID question
  await answer(['problem', 'urgent', 'urgentConfirm', 'contactChannel', 'contactValue'])
  await readBack('০১৭০০০০০০০০')
  await answer(['safeTime'])
  await expect(page.getByRole('heading', { name: 'আপনার উত্তরগুলো শুনে বা পড়ে মিলিয়ে নিন' })).toBeFocused({ timeout: 30000 })
  const submitted = page.waitForRequest('**/api/voice/intakes', { timeout: 30000 })
  await page.keyboard.press('#')
  const body = (await submitted).postDataJSON()
  expect(asked).toEqual(['service', 'callerRole', 'callerName', 'relationship', 'applicantName', 'district', 'nidKnown', 'nid', 'confirm', 'confirm',
    'problem', 'urgent', 'urgent', 'contactChannel', 'contactValue', 'confirm', 'safeTime', 'confirm'])
  expect(body.mode).toBe('INTAKE')
  expect(body.confirmation).toBe('VOICE')
  expect(body.answers).toMatchObject({ callerRole: 'REPRESENTATIVE', nidKnown: true, nid: '1234509876', urgent: false, contactChannel: 'PHONE', contactValue: '01700000000' })
  expect(body.aiFields).toEqual(expect.arrayContaining(['callerRole', 'nidKnown', 'nid', 'urgent', 'contactValue']))
  expect(body.transcript).toHaveLength(asked.length) // one turn per answer
  await expect(page.getByRole('heading', { name: /আবেদন জমা হয়েছে/ })).toBeVisible({ timeout: 30000 })
})

test('an uncertain spoken safety answer reaches a DLAO officer with its context', async ({ page }) => {
  test.setTimeout(180000)
  const heard = [{ text: 'না', values: { urgent: false }, sensitive: false },
    { text: 'জানি না', values: { urgent: 'UNKNOWN' }, sensitive: false }]
  await page.route('**/audio/*.mp3', (route) => route.fulfill({ status: 200, contentType: 'audio/mpeg', body: '' }))
  await page.route('**/api/voice/answers**', (route) => route.fulfill({ json: heard.shift() }))
  await page.goto('/voice')
  await page.getByRole('button', { name: 'বাংলা', exact: true }).click()
  await page.getByRole('button', { name: 'কল করুন', exact: true }).click()
  const choice = async (field, key) => {
    await expect(page.getByRole('heading', { name: steps[field].prompt, exact: true })).toBeFocused()
    await page.keyboard.press(key)
  }
  const typed = async (field, value) => {
    await expect(page.getByRole('heading', { name: steps[field].prompt, exact: true })).toBeFocused()
    await page.getByRole('button', { name: 'লিখে উত্তর দিন' }).click()
    await page.getByRole('textbox', { name: steps[field].prompt, exact: true }).fill(value)
    await page.getByRole('button', { name: 'উত্তর দিন', exact: true }).click()
  }
  await choice('service', '1')
  await choice('callerRole', '1')
  await typed('callerName', 'Fictional Rahima')
  await typed('district', 'Barguna')
  await choice('nidKnown', '2')
  await typed('problem', 'Fictional caller says a neighbour made threats yesterday.')
  await expect(page.getByRole('heading', { name: steps.urgent.prompt, exact: true })).toBeFocused()
  for (const heading of [steps.urgent.prompt, /নিরাপত্তার প্রশ্নটি আবার বলুন/]) {
    await expect(page.getByRole('heading', { name: heading })).toBeFocused()
    await page.keyboard.press('#')
    await expect(page.getByText(/শুনছি/)).toBeVisible()
    await page.waitForTimeout(900) // fake microphone must record for the minimum spoken-answer duration
    await page.keyboard.press('#')
  }
  await choice('contactChannel', '2') // safe in-person contact through a UDC
  await typed('safeTime', 'Weekday morning')
  await expect(page.getByRole('heading', { name: 'আপনার উত্তরগুলো শুনে বা পড়ে মিলিয়ে নিন' })).toBeFocused()
  await expect(page.getByText('নিশ্চিত নই—কর্মকর্তা যাচাই করবেন')).toBeVisible()
  await page.keyboard.press('1')
  const done = page.getByRole('heading', { name: /^আবেদন জমা হয়েছে: APP-\d{4}-\d{6}$/ })
  await expect(done).toBeVisible({ timeout: 30000 })
  const applicationId = (await done.textContent()).match(/APP-\d{4}-\d{6}/)[0]
  await signIn(page, 'DLAO_OFFICER')
  const queueEntry = page.getByRole('link', { name: new RegExp(applicationId) })
  await expect(queueEntry).toContainText('Safety answer needs human verification')
  await queueEntry.click()
  await expand(page, /^Tasks/)
  await expect(page.getByRole('region', { name: /^Tasks/ })).toContainText('Safety was unclear')
  await expand(page, /^Call/)
  await expect(page.getByRole('region', { name: /^Call/ })).toContainText('জানি না')
})
