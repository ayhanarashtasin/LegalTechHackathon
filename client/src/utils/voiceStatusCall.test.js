import { expect, test } from 'vitest'
import { applicationNumber, digitsFromWords, spokenStatusRequest, spokenYesNo } from './voiceAgent.js'
import { runStatusCall } from './voiceStatusCall.js'

// A fake call: each turn hears the next scripted reply, and the log shows what was said and looked up. `wantsStatus`
// is the model's answer when the opening's words match no status word; `modelRead` records what it was sent.
function fakeCall(replies, outcomes = [], wantsStatus = undefined) {
  const log = []
  const hints = []
  const modelRead = []
  const io = {
    hear: async (prompts, { hint }) => {
      log.push(prompts.map(({ key, digits }) => (digits ? `${key}:${digits}` : key)).join('+'))
      hints.push(hint ?? 'none')
      return replies.shift() ?? ''
    },
    understand: async (text) => {
      modelRead.push(text)
      return wantsStatus
    },
    showNumber: (number) => log.push(`show:${number}`),
    tellStatus: async (number, pin) => {
      log.push(`lookup:${number}/${pin}`)
      return outcomes.shift() ?? 'FOUND'
    },
    finish: async ({ key }) => { log.push(`end:${key}`) },
  }
  return { io, log, hints, modelRead }
}

test('the model reads the opening only when no status word matched, and only its clear yes skips the question', async () => {
  const matched = fakeCall(['আমার কেসের অবস্থা জানতে চাই', 'তিন নয়', 'হ্যাঁ', 'হ্যাঁ', '482915'], [], true)
  await runStatusCall(matched.io)
  expect(matched.modelRead).toEqual([])

  const ownWords = fakeCall(['আমার কেসটার কী হলো একটু বলেন', 'তিন নয়', 'হ্যাঁ', 'হ্যাঁ', '482915'], [], true)
  await runStatusCall(ownWords.io)
  expect(ownWords.modelRead).toEqual(['আমার কেসটার কী হলো একটু বলেন'])
  expect(ownWords.log.slice(0, 2)).toEqual(['welcome', 'askNumber'])

  for (const answer of [false, null, undefined]) { // "no", unclear, or the model unavailable: the caller is asked
    const unsure = fakeCall(['প্রাক্ষন প্রাক্ষন', 'না'], [], answer)
    await runStatusCall(unsure.io)
    expect(unsure.log).toEqual(['welcome', 'confirmStatus', 'end:onlyStatus'])
  }
})

test('Whisper is primed for yes/no and digit turns, not for the caller\'s own words', async () => {
  const { io, hints } = fakeCall(['কী বলব', 'হ্যাঁ।', 'শূন্য, শুন্য, ছয়।', 'হ্যাঁ।', 'হ্যাঁ।', 'এক, দুই, তিন, চার, পাঁচ, ছয়।'])
  await runStatusCall(io)
  expect(hints).toEqual(['none', 'yesNo', 'number', 'yesNo', 'yesNo', 'number'])
})

test('the answers Whisper actually returned for a short হ্যাঁ, না, and অবস্থা are understood', () => {
  // Unprimed Groq transcripts of these words, 2026-09-25.
  expect(spokenYesNo('হ্যাদ')).toBe(true)
  expect(spokenYesNo('হুম হ্যাক্')).toBe(true)
  expect(spokenYesNo('ন')).toBe(false)
  expect(spokenStatusRequest('আমার কেশের অভোস্থা জান্তে চাইত.')).toBe(true)
  // Narrow on purpose: a greeting, a longer word, or noise is not a yes.
  expect(spokenYesNo('হ্যালো')).toBeUndefined()
  expect(spokenYesNo('হ্যান্ডেল')).toBeUndefined()
  expect(spokenYesNo('হানেডনি কোনা অন্যালে এক্রতায় কেন্টা হয়.')).toBeUndefined()
})

test('Malek asks in his own words, confirms his number, gives his PIN, and hears the status', async () => {
  const { io, log } = fakeCall(['আমার কেসের অবস্থা জানতে চাই', 'শূন্য শূন্য শূন্য শূন্য শূন্য ছয়', 'হ্যাঁ', 'হ্যাঁ', 'এক দুই তিন চার পাঁচ ছয়'])
  await runStatusCall(io)
  expect(log).toEqual(['welcome', 'askNumber', 'show:000006', 'confirmNumber:000006', 'privateCheck', 'askPin', 'lookup:000006/123456'])
})

test('a number said in the first sentence is read back without asking for it again', async () => {
  const { io, log } = fakeCall(['আমার কেস নম্বর শূন্য শূন্য তিন নয়, অবস্থা জানতে চাই', 'জি', 'জি', '৪৮২৯১৫'])
  await runStatusCall(io)
  expect(log).toEqual(['welcome', 'show:0039', 'confirmNumber:0039', 'privateCheck', 'askPin', 'lookup:0039/482915'])
})

test('an unclear request is asked about, and a "no" ends with where else to call', async () => {
  const { io, log } = fakeCall(['আমি একটা অভিযোগ করতে চাই', 'না'])
  await runStatusCall(io)
  expect(log).toEqual(['welcome', 'confirmStatus', 'end:onlyStatus'])
})

test('a number the caller says is wrong is asked for again', async () => {
  const { io, log } = fakeCall(['অবস্থা জানতে চাই', 'শূন্য শূন্য তিন আট', 'না, ভুল', 'শূন্য শূন্য তিন নয়', 'হ্যাঁ', 'হ্যাঁ', '482915'])
  await runStatusCall(io)
  expect(log).toEqual(['welcome', 'askNumber', 'show:0038', 'confirmNumber:0038', 'askNumber', 'show:0039', 'confirmNumber:0039', 'privateCheck', 'askPin', 'lookup:0039/482915'])
})

test('a PIN is asked again after "not found", and three misses send the caller to 16699', async () => {
  const { io, log } = fakeCall(['খবর জানতে চাই', 'তিন নয়', 'হ্যাঁ', 'হ্যাঁ', '111111', '222222', '333333'], ['NOT_FOUND', 'NOT_FOUND', 'NOT_FOUND'])
  await runStatusCall(io)
  expect(log.slice(3)).toEqual(['confirmNumber:39', 'privateCheck', 'askPin', 'lookup:39/111111', 'notFound+askPin', 'lookup:39/222222', 'notFound+askPin', 'lookup:39/333333', 'end:tryHelpline'])
})

test('a PIN short of six digits gets its own retry, and English digit words count', async () => {
  // Whisper heard "আট" as "আর" (five digits); the caller then reads the PIN out in English.
  const { io, log } = fakeCall(['অবস্থা', 'তিন নয়', 'হ্যাঁ', 'হ্যাঁ', 'আমার পিন নম্বর হলো চার, আর, দুই, নয়, এক, পাঁচ।', 'ফোর এইট টু নাইন ওয়ান ফাইভ'])
  await runStatusCall(io)
  expect(log.slice(4)).toEqual(['privateCheck', 'askPin', 'pinAgain', 'lookup:39/482915'])
})

test('on a phone others can hear, neither the PIN is asked nor the status spoken', async () => {
  // "না", or no clear answer three times, ends the call before the PIN and says nothing about the case.
  for (const replies of [['অবস্থা', 'তিন নয়', 'হ্যাঁ', 'না, দোকানে আছি'], ['অবস্থা', 'তিন নয়', 'হ্যাঁ', '', 'হুম্ম কী', '']]) {
    const { io, log } = fakeCall(replies)
    await runStatusCall(io)
    expect(log.at(-1)).toBe('end:notPrivate')
    expect(log.some((line) => line.startsWith('lookup:') || line.includes('askPin'))).toBe(false)
  }
})

test('English digit words in Bangla script are digits, by exact spelling only', () => {
  expect(digitsFromWords('জিরো ওয়ান টু থ্রি ফোর ফাইভ সিক্স সেভেন এইট নাইন')).toBe('0123456789')
  expect(digitsFromWords('ফোর এইট, ডাবল টু')).toBe('4822')
  // Same outline as থ্রি and ফোর, but not digits: "তার পিন" (his PIN), "পরে বলছি" (I will say it later).
  expect(digitsFromWords('তার পিন')).toBeUndefined()
  expect(digitsFromWords('পরে বলছি')).toBeUndefined()
})

test('a locked ID or an unavailable service ends the call at once', async () => {
  for (const [outcome, ending] of [['LOCKED', 'end:tryHelpline'], ['UNAVAILABLE', 'end:unavailable']]) {
    const { io, log } = fakeCall(['অবস্থা', 'তিন নয়', 'হ্যাঁ', 'হ্যাঁ', '482915'], [outcome])
    await runStatusCall(io)
    expect(log.at(-1)).toBe(ending)
    expect(log.filter((line) => line.startsWith('lookup:'))).toHaveLength(1)
  }
})

test('silence is asked about three times, then the caller is sent to 16699', async () => {
  const { io, log } = fakeCall(['অবস্থা', '', 'হুম', ''])
  await runStatusCall(io)
  expect(log).toEqual(['welcome', 'askNumber', 'notHeard+askNumber', 'notHeard+askNumber', 'end:tryHelpline'])
})

test('status requests, application numbers, and words that only sound like digits', () => {
  for (const text of ['আমার কেসের অবস্থা জানতে চাই', 'মামলার অবস্তা কি', 'আমার কেসের খবর বলেন', 'শুনানির তারিখ কবে', 'case status']) {
    expect(spokenStatusRequest(text), text).toBe(true)
  }
  expect(spokenStatusRequest('আমি একটা অভিযোগ করতে চাই')).toBe(false)
  expect(applicationNumber('39')).toBe('39')
  expect(applicationNumber('2026000039')).toBe('000039')
  expect(applicationNumber('1234567')).toBeUndefined()
  expect(applicationNumber(undefined)).toBeUndefined()
  // "চাই" (want) and "দয়া" (please) are not six and two.
  expect(digitsFromWords('অবস্থা জানতে চাই')).toBeUndefined()
  expect(digitsFromWords('দয়া করে দেখুন, শূন্য তিন নয়')).toBe('039')
})
