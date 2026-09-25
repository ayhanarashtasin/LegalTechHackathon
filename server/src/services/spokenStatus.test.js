import assert from 'node:assert/strict'
import { test } from 'node:test'
import { promptKeys, promptText, speakable, spokenDate, spokenDigits, spokenNumber, spokenStatus } from './spokenStatus.js'

// The same rule tts-service/app.py enforces: Bangla words and punctuation, no digits and no Latin letters.
const SPEAKABLE = /^[ঀ-৥ৰ-৿‌‍\s,.?!।;:'"()\-–]+$/
const now = new Date('2026-09-25T06:00:00Z') // noon in Dhaka
const track = (overrides = {}) => ({
  applicationId: 'APP-2026-000039', caseId: 'CASE-2026-000012', status: 'ACCEPTED', reviewState: 'READY_FOR_DECISION',
  currentPhase: 4, applicantName: 'মালেক', officeCode: 'BRG', legalNeed: 'বকেয়া মজুরি',
  lawyer: { status: 'ACCEPTED', lawyerName: 'রহমান' }, nextHearingAt: null, nextAction: null, ...overrides,
})

test('numbers are spoken as Bangla words, IDs digit by digit', () => {
  assert.equal(spokenNumber(0), 'শূন্য')
  assert.equal(spokenNumber(25), 'পঁচিশ')
  assert.equal(spokenNumber('২৬'), 'ছাব্বিশ')
  assert.equal(spokenNumber(99), 'নিরানব্বই')
  assert.equal(spokenNumber(2000), 'দুই হাজার')
  assert.equal(spokenNumber(2027), 'দুই হাজার সাতাশ')
  assert.equal(spokenNumber(16699), 'এক ছয় ছয় নয় নয়')
  assert.equal(spokenDigits('0039'), 'শূন্য শূন্য তিন নয়')
})

test('hearing dates are ordinal Bangla dates on the Dhaka calendar', () => {
  // 20:00 UTC on the 24th is already Sunday the 25th in Dhaka.
  assert.equal(spokenDate('2026-10-24T20:00:00Z', now), 'পঁচিশে অক্টোবর, রবিবার')
  assert.equal(spokenDate('2027-01-01T03:00:00Z', now), 'দুই হাজার সাতাশ সালের পয়লা জানুয়ারি, শুক্রবার')
  const ordinals = { 1: 'পয়লা', 2: 'দোসরা', 3: 'তেসরা', 4: 'চৌঠা', 5: 'পাঁচই', 18: 'আঠারোই', 19: 'উনিশে', 31: 'একত্রিশে' }
  for (const [day, word] of Object.entries(ordinals)) {
    assert.ok(spokenDate(`2026-10-${day.padStart(2, '0')}T06:00:00Z`, now).startsWith(`${word} অক্টোবর`), word)
  }
})

test('each stage has its own sentence, and none names the person, matter, lawyer, or office', () => {
  const scenarios = [
    [{ status: 'SUBMITTED', reviewState: 'PENDING_REVIEW', currentPhase: 2, lawyer: null }, 'একজন কর্মকর্তা যাচাই করছেন'],
    [{ status: 'SUBMITTED', reviewState: 'NEEDS_INFORMATION', currentPhase: 2, lawyer: null }, 'আরও কিছু তথ্য দরকার'],
    [{ currentPhase: 3, lawyer: null }, 'মঞ্জুর হয়েছে। আইনজীবী নিয়োগের কাজ চলছে'],
    [{ lawyer: { status: 'PENDING', lawyerName: 'রহমান' } }, 'প্যানেল আইনজীবী নিয়োগের কাজ চলছে'],
    [{}, 'প্যানেল আইনজীবী দায়িত্ব নিয়েছেন'],
    [{ currentPhase: 4, lawyer: null }, 'মধ্যস্থতায় পাঠানো হয়েছে'],
    [{ currentPhase: 5, lawyer: null, nextHearingAt: '2026-10-24T20:00:00Z' }, 'মঞ্জুর হয়েছে। আপনার পরবর্তী শুনানির তারিখ পঁচিশে অক্টোবর, রবিবার।'],
    [{ currentPhase: 6 }, 'কাজ সম্পন্ন হয়েছে'],
  ]
  for (const [overrides, expected] of scenarios) {
    const sentence = spokenStatus(track(overrides), now)
    assert.ok(sentence.includes(expected), sentence)
    assert.match(sentence, SPEAKABLE)
    for (const secret of ['মালেক', 'রহমান', 'বকেয়া মজুরি', 'BRG']) assert.ok(!sentence.includes(secret), secret)
  }
})

test('only an upcoming hearing is read as the next hearing', () => {
  assert.ok(spokenStatus(track({ currentPhase: 5, nextHearingAt: '2026-09-25T04:00:00Z' }), now).includes('পঁচিশে সেপ্টেম্বর'))
  const past = spokenStatus(track({ currentPhase: 5, nextHearingAt: '2026-09-24T04:00:00Z' }), now)
  assert.ok(past.includes('শুনানির নতুন তারিখ এখনো রেকর্ড করা হয়নি') && !past.includes('চব্বিশে'), past)
})

test('a Bangla next step is read with its numbers as words; any other next step is left to the screen', () => {
  const bangla = spokenStatus(track({ nextAction: 'শুনানির দিন সকাল ১০টায় আদালতে আসুন' }), now)
  assert.ok(bangla.endsWith('করণীয়: শুনানির দিন সকাল দশটায় আদালতে আসুন।'), bangla)
  assert.ok(!spokenStatus(track({ nextAction: 'Attend court at 10am' }), now).includes('করণীয়'))
  assert.equal(speakable('Bring NID, ২০২৬ সালের কাগজ 3/4'), ', দুই হাজার ছাব্বিশ সালের কাগজ তিন চার')
})

test('every prompt is speakable and the read-back says the digits', () => {
  for (const key of promptKeys) assert.match(promptText(key, '0039'), SPEAKABLE, key)
  assert.ok(promptText('confirmNumber', '0039').includes('শূন্য শূন্য তিন নয়'))
  assert.ok(promptText('tryHelpline').includes('এক ছয় ছয় নয় নয়'))
})
