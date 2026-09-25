import { expect, test } from 'vitest'
import { appendTranscript, applyExtraction, digitsFromWords, parseAnswer, pauseDetector, spokenDigits, spokenKey, spokenUncertain, spokenYesNo } from './voiceAgent.js'
import { activeFields, answer, correct, nextField, notices, payload, startCall } from './voiceScript.js'


test('extracted answers are validated against the same script the keyboard uses', () => {
  const { call, accepted } = applyExtraction(startCall(), {
    service: 'COMPLAINT',
    callerRole: 'REPRESENTATIVE',
    nidKnown: 'MAYBE', // not an allowed answer, and not asked yet
    callerName: 'Ripon', // the next question once the caller is a representative, so it lands in the same pass
    LIVE_VOICE: 'DENIED', // not a question in the script
    role: 'DLAO_OFFICER', // injected field
    applicantConfirmed: true, // injected field
  })
  expect(accepted).toEqual(['service', 'callerRole', 'callerName'])
  expect(call.answers.nidKnown).toBeUndefined()
  expect(call.answers.LIVE_VOICE).toBeUndefined()
  expect(call.aiFields).toEqual(['service', 'callerRole', 'callerName'])
  expect(Object.keys(call.answers)).not.toContain('role')
})

test('the first choice picks the path, and each notice plays once its answer is given', () => {
  let call = answer(startCall(), 'service', 'ADVICE')
  expect(activeFields(call)).toEqual(['service', 'adviceTopic', 'contactValue', 'safeTime'])
  expect(notices(call)).toEqual(['greeting', 'adviceIntro'])
  expect(payload(call).mode).toBe('ADVICE')

  call = answer(startCall(), 'service', 'COMPLAINT')
  for (const [field, value] of [['callerRole', 'REPRESENTATIVE'], ['nidKnown', false], ['urgent', true], ['contactChannel', 'TRUSTED_PERSON']]) call = answer(call, field, value)
  // A reported danger no longer cuts the intake short; an unknown NID skips only the number.
  expect(activeFields(call)).toEqual(['service', 'callerRole', 'callerName', 'relationship', 'applicantName', 'district', 'nidKnown',
    'problem', 'urgent', 'contactChannel', 'trustedPerson', 'trustedPhone', 'safeTime'])
  expect(notices(call)).toEqual(['greeting', 'nidUnknown', 'safetyAlert'])
  expect(payload(call).mode).toBe('INTAKE')
  expect(payload(call).answers).not.toHaveProperty('service') // the choice travels as `mode`
  expect(activeFields(answer(answer(call, 'nidKnown', true), 'contactChannel', 'PHONE'))).toEqual(expect.arrayContaining(['nid', 'contactValue']))
})

test('a spoken answer fills only the question being asked', () => {
  let call = startCall()
  for (const [field, value] of [['service', 'COMPLAINT'], ['callerRole', 'SELF']]) call = answer(call, field, value)
  // Mentioning the complaint while giving a name does not skip ahead to it.
  let result = applyExtraction(call, { callerName: 'Moyuri', problem: 'স্বামী মারধর করে।', urgent: true })
  expect(result.accepted).toEqual(['callerName'])
  call = answer(answer(result.call, 'district', 'Joypurhat'), 'nidKnown', false)
  expect(nextField(call)).toBe('problem')
  // Telling the complaint does not re-answer the keypad question, so it gets no AI flag and no voice clip.
  result = applyExtraction(call, { callerRole: 'SELF', problem: 'আমি নিজের জন্য ফোন করছি। স্বামী মারধর করে।' })
  expect(result.accepted).toEqual(['problem'])
  expect(result.call.aiFields).not.toContain('callerRole')
})

test('a spoken correction is tracked and Bangla digits become a usable NID and phone number', () => {
  let call = startCall()
  for (const [field, value] of [['service', 'COMPLAINT'], ['callerRole', 'SELF'], ['callerName', 'Moyuri'], ['district', 'Jaipurhat'],
    ['nidKnown', true], ['nid', '০০০০ ০০০ ০০০'], ['problem', 'স্বামী মারধর করে।'], ['urgent', false], ['contactChannel', 'PHONE'],
    ['contactValue', '০১৭০০০০০০০০'], ['safeTime', 'সকাল ১০টা']]) {
    if (field === 'urgent') call = applyExtraction(call, { urgent: false }).call // first spoken no asks the safety question again
    call = applyExtraction(call, { [field]: value }).call
  }
  expect(call.answers.nid).toBe('0000000000')
  expect(call.answers.contactValue).toBe('01700000000')
  call = applyExtraction(correct(call, 'district'), { district: 'Joypurhat' }).call
  const body = payload(call, { confirmation: 'VOICE', transcript: [{ speaker: 'CALLER', text: 'আমার সমস্যা…' }] })
  expect(body.answers.district).toBe('Joypurhat')
  expect(body.correctedFields).toEqual(['district'])
  expect(body.aiFields).toContain('problem')
  expect(body.transcript).toHaveLength(1)
  expect(JSON.stringify(body)).not.toMatch(/applicantConfirmed|sourceType|"audio"/)
})

test('the payload carries no consent choices or empty transcript, and answers are range-checked', () => {
  const call = answer(startCall(), 'service', 'COMPLAINT')
  expect(payload(call)).not.toHaveProperty('consents')
  expect(payload(call, { transcript: [] })).not.toHaveProperty('transcript')
  expect(payload(call, { transcript: [{ speaker: 'CALLER', text: 'hello' }] }).transcript).toHaveLength(1)
  expect(parseAnswer('problem', 'ok')).toBeUndefined() // shorter than the minimum
  expect(parseAnswer('contactValue', 'not a number')).toBeUndefined()
  expect(parseAnswer('nid', '12345678901')).toBeUndefined() // an NID is 10, 13, or 17 digits
  expect(parseAnswer('urgent', 'YES')).toBe(true)
  expect(parseAnswer('urgent', 'UNKNOWN')).toBe('UNKNOWN')
  expect(appendTranscript([{ speaker: 'CALLER', text: 'না' }], 'CALLER', 'রিপন')).toEqual([{ speaker: 'CALLER', text: 'না' }, { speaker: 'CALLER', text: 'রিপন' }])
})

test('spoken safety uncertainty stays unconfirmed and a negative answer is clarified once', () => {
  let call = startCall()
  for (const [field, value] of [['service', 'COMPLAINT'], ['callerRole', 'SELF'], ['callerName', 'Fictional caller'], ['district', 'Barguna'],
    ['nidKnown', false], ['problem', 'A fictional threat was reported.']]) call = answer(call, field, value)
  const first = applyExtraction(call, { urgent: false })
  expect(first.clarification).toEqual(['urgent'])
  expect(first.accepted).toEqual([])
  expect(nextField(first.call)).toBe('urgent')
  const second = applyExtraction(first.call, { urgent: false })
  expect(second.accepted).toEqual(['urgent'])
  expect(second.call.aiFields).toContain('urgent')
  expect(spokenUncertain('আমি জানি না')).toBe(true)
  expect(spokenUncertain('নিশ্চিত নই')).toBe(true)
  expect(spokenUncertain('না')).toBe(false)
  const unknown = applyExtraction(call, { urgent: 'UNKNOWN' }).call
  expect(unknown.answers.urgent).toBe('UNKNOWN')
  expect(notices(unknown)).toContain('safetyAlert')
})

// Feeds loudness readings every 100 ms, as the page samples the microphone; returns when the answer ends, or null.
function endsAt(segments, pauseMs = 2500) {
  const paused = pauseDetector(pauseMs)
  let now = 0
  for (const [level, ms] of segments) for (let end = now + ms; now < end; now += 100) if (paused(level, now)) return now
  return null
}

test('a spoken answer ends after the caller speaks and then pauses, not while they think or cough', () => {
  const quiet = 0.002
  // Beep echo, thinking, "আমার নাম … রহিমা খাতুন" with a short gap between words, then quiet: ends 2.5 s after speech.
  expect(endsAt([[0.2, 300], [quiet, 1500], [0.08, 600], [quiet, 500], [0.08, 600], [quiet, 5000]])).toBe(6000)
  expect(endsAt([[quiet, 10000]])).toBeNull() // never spoke: # or the time limit ends it
  expect(endsAt([[quiet, 1000], [0.1, 200], [quiet, 6000]])).toBeNull() // a cough is not an answer
  // Steady room hum louder than the minimum level is the floor, not speech.
  expect(endsAt([[0.03, 2000], [0.3, 1000], [0.03, 4000]])).toBe(5500)
  // The problem question allows longer pauses to think: a 3 s gap does not end it, 4 s of quiet does.
  expect(endsAt([[quiet, 1000], [0.08, 1000], [quiet, 3000], [0.08, 1000], [quiet, 6000]], 4000)).toBe(10000)
})

test('a key number or phone number said aloud is matched like one pressed on the keypad', () => {
  expect(spokenKey('দুই।')).toBe(2)
  expect(spokenKey(' ৩ ')).toBe(3)
  expect(spokenKey('এক')).toBe(1)
  expect(spokenKey('একজন')).toBeUndefined() // a word that only starts like a number is not a key
  expect(spokenKey('নিজের জন্য')).toBeUndefined() // words go to the model instead
  expect(spokenDigits('০১৭০০ ১২৩-৪৫৬')).toBe('01700123456')
  expect(spokenDigits('12345')).toBeUndefined() // too short to be a phone number
  expect(spokenDigits(null)).toBeUndefined()
  expect(spokenDigits('০০০০ ০০০ ০০০ ০০০', 'nid')).toBe('0000000000000') // a 13-digit NID said in groups
  // Whisper's actual transcript of a spoken NID, with words spelled by ear: the page reads it without the model.
  expect(spokenDigits(digitsFromWords('এক, দুই, তিন, চার, পাচ, শুন্ন, নই, আট, শাত, ছা'), 'nid')).toBe('1234509876')
  expect(digitsFromWords('শূন্য এক সাত ডাবল জিরো ৭ ছয়')).toBe('0170076') // "ছয়" with য + nukta, and "ডাবল"
  // Other words around the digits are skipped; the caller confirms the read-back, so nothing is taken unheard.
  expect(spokenDigits(digitsFromWords('আমার এনআইডি নম্বর হলো এক, দুই, তিন, চার, পাচ, শুন্ন, নাই, আট, শাত, ছা'), 'nid')).toBe('1234509876')
  expect(digitsFromWords('আমার নম্বরটা মনে নেই')).toBeUndefined() // no digit words at all
  // Whisper spells zero differently from run to run; all of these were seen or are its usual variants.
  expect(digitsFromWords('এক, দুই, তিন, চার, পাচ, শুনো, নাই, আট, শাত, ছা')).toBe('1234509876')
  expect(digitsFromWords('শূন্য শুন্য শুন্ন শুন্নো সুন্ন শূণ্য জিরো')).toBe('0000000')
  expect(digitsFromWords('এক, দুই, তিন, চার, পাচ, শুন্ন, নয়, আঠ, সাত, ছা')).toBe('1234509876') // "আঠ" for আট, seen in a real run
  expect(digitsFromWords('')).toBeUndefined()
  expect(spokenDigits('০১৭০০০০০০০০', 'nid')).toBeUndefined() // 11 digits: a phone number, not an NID
})

test('a yes or no said aloud is matched without the model, and a mixed or empty reply is left to it', () => {
  for (const yes of ['হ্যাঁ ঠিক হয়েছে', 'হা ঠিক আছে', 'জি', 'হুম', 'জমা দিন', 'হ্যাঁ, জানা আছে']) expect(spokenYesNo(yes)).toBe(true)
  for (const no of ['না', 'না ভুল', 'জানা নেই', 'জানি না']) expect(spokenYesNo(no)).toBe(false)
  expect(spokenYesNo('ঠিক হয়নি')).toBeUndefined() // "ঠিক" and "হয়নি" together: the model reads the whole sentence
  expect(spokenYesNo('রিপন')).toBeUndefined()
  expect(spokenYesNo(undefined)).toBeUndefined()
})
