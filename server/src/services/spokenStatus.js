// What the spoken status route (A5) says to a caller who cannot read. Every sentence comes from the fixed templates
// below and the verified record, never from a language model. It says only the permitted status, stage, hearing date,
// and applicant-facing next step: a name, the legal matter, the lawyer, or the office could be overheard on a shared
// phone. The speech model skips digits, so every number is spoken as Bangla words.

const NUMBER_WORDS = ('শূন্য এক দুই তিন চার পাঁচ ছয় সাত আট নয় দশ এগারো বারো তেরো চোদ্দ পনেরো ষোলো সতেরো আঠারো উনিশ '
  + 'বিশ একুশ বাইশ তেইশ চব্বিশ পঁচিশ ছাব্বিশ সাতাশ আঠাশ ঊনত্রিশ ত্রিশ একত্রিশ বত্রিশ তেত্রিশ চৌত্রিশ পঁয়ত্রিশ ছত্রিশ সাঁইত্রিশ '
  + 'আটত্রিশ ঊনচল্লিশ চল্লিশ একচল্লিশ বিয়াল্লিশ তেতাল্লিশ চুয়াল্লিশ পঁয়তাল্লিশ ছেচল্লিশ সাতচল্লিশ আটচল্লিশ ঊনপঞ্চাশ পঞ্চাশ '
  + 'একান্ন বাহান্ন তিপ্পান্ন চুয়ান্ন পঞ্চান্ন ছাপ্পান্ন সাতান্ন আটান্ন ঊনষাট ষাট একষট্টি বাষট্টি তেষট্টি চৌষট্টি পঁয়ষট্টি ছেষট্টি '
  + 'সাতষট্টি আটষট্টি ঊনসত্তর সত্তর একাত্তর বাহাত্তর তিয়াত্তর চুয়াত্তর পঁচাত্তর ছিয়াত্তর সাতাত্তর আটাত্তর ঊনআশি আশি একাশি '
  + 'বিরাশি তিরাশি চুরাশি পঁচাশি ছিয়াশি সাতাশি অষ্টাশি ঊননব্বই নব্বই একানব্বই বিরানব্বই তিরানব্বই চুরানব্বই পঁচানব্বই ছিয়ানব্বই '
  + 'সাতানব্বই আটানব্বই নিরানব্বই').split(' ')
const MONTHS = 'জানুয়ারি ফেব্রুয়ারি মার্চ এপ্রিল মে জুন জুলাই আগস্ট সেপ্টেম্বর অক্টোবর নভেম্বর ডিসেম্বর'.split(' ')
const WEEKDAYS = 'রবিবার সোমবার মঙ্গলবার বুধবার বৃহস্পতিবার শুক্রবার শনিবার'.split(' ')
const FIRST_DAYS = ['', 'পয়লা', 'দোসরা', 'তেসরা', 'চৌঠা']

const asciiDigits = (text) => String(text).replace(/[০-৯]/g, (digit) => '০১২৩৪৫৬৭৮৯'.indexOf(digit))

// An ID, PIN, or phone number is read digit by digit, as a caller would say it back.
export const spokenDigits = (digits) => [...asciiDigits(digits)].map((digit) => NUMBER_WORDS[digit]).join(' ')

export function spokenNumber(value) {
  const number = Number(asciiDigits(value))
  if (number < 100) return NUMBER_WORDS[number]
  if (number >= 2000 && number < 2100) return `দুই হাজার${number > 2000 ? ` ${NUMBER_WORDS[number - 2000]}` : ''}`
  return spokenDigits(value)
}

// Bangla dates are ordinal: পয়লা to চৌঠা, then পাঁচই to আঠারোই, then উনিশে to একত্রিশে.
const spokenDay = (day) => FIRST_DAYS[day] || `${NUMBER_WORDS[day]}${day <= 18 ? 'ই' : 'ে'}`
// Bangladesh keeps UTC+6 all year, so the UTC fields of this shifted date are the calendar date in Dhaka.
const inDhaka = (value) => new Date(new Date(value).getTime() + 6 * 60 * 60 * 1000)
const dhakaDay = (value) => inDhaka(value).toISOString().slice(0, 10)

export function spokenDate(value, now = new Date()) {
  const date = inDhaka(value)
  const year = date.getUTCFullYear() === inDhaka(now).getUTCFullYear() ? '' : `${spokenNumber(date.getUTCFullYear())} সালের `
  return `${year}${spokenDay(date.getUTCDate())} ${MONTHS[date.getUTCMonth()]}, ${WEEKDAYS[date.getUTCDay()]}`
}

// Free text (an officer's next step) as the speech service accepts it: numbers become words, and anything that is not
// Bangla text or plain punctuation is dropped. Short numbers are said as numbers ("দশটায়"), long ones digit by digit.
export function speakable(text) {
  return asciiDigits(text)
    .replace(/\d+/g, (digits) => (digits.length <= 2 || /^20\d\d$/.test(digits) ? spokenNumber(digits) : spokenDigits(digits)))
    .replace(/[^ঀ-৥ৰ-৿‌‍\s,.?!।;:'"()\-–]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const mostlyBangla = (text) => {
  const letters = text.match(/\p{L}/gu) ?? []
  return letters.length > 0 && letters.filter((letter) => /[ঀ-৿]/.test(letter)).length / letters.length >= 0.8
}

const APPROVED = 'আপনার আইনগত সহায়তার আবেদন মঞ্জুর হয়েছে।'

// The sentence for one tracked record (the result of trackApplicationStatus), short enough to hear in one go.
export function spokenStatus(track, now = new Date()) {
  const sentences = []
  if (track.currentPhase >= 6) sentences.push('আপনার আইনগত সহায়তার কাজ সম্পন্ন হয়েছে।')
  else if (track.lawyer?.status === 'ACCEPTED') sentences.push('আপনার মামলায় একজন প্যানেল আইনজীবী দায়িত্ব নিয়েছেন।')
  else if (track.lawyer) sentences.push('আপনার মামলার জন্য একজন প্যানেল আইনজীবী নিয়োগের কাজ চলছে।')
  // Stage 4 without a lawyer means mediation; stage 5 only means a hearing is set.
  else if (track.currentPhase === 4) sentences.push('আপনার বিষয়টি আপস-মীমাংসার জন্য মধ্যস্থতায় পাঠানো হয়েছে।')
  else if (track.currentPhase === 5) sentences.push(APPROVED)
  else if (track.currentPhase === 3) sentences.push(`${APPROVED} আইনজীবী নিয়োগের কাজ চলছে।`)
  else if (track.reviewState === 'NEEDS_INFORMATION') sentences.push('আপনার আবেদনের জন্য আরও কিছু তথ্য দরকার। অফিস নিরাপদ উপায়ে আপনার সঙ্গে যোগাযোগ করবে।')
  else if (track.currentPhase === 2) sentences.push('আপনার আবেদনটি একজন কর্মকর্তা যাচাই করছেন। এখনো কোনো সিদ্ধান্ত হয়নি।')
  else sentences.push('আপনার আবেদনটি গ্রহণ করা হয়েছে।')

  if (track.nextHearingAt) {
    // A past date is never read as the next hearing: the caller might travel for it.
    sentences.push(dhakaDay(track.nextHearingAt) >= dhakaDay(now)
      ? `আপনার পরবর্তী শুনানির তারিখ ${spokenDate(track.nextHearingAt, now)}।`
      : 'শুনানির নতুন তারিখ এখনো রেকর্ড করা হয়নি।')
  }
  // The next step is officer-written free text; it is read only when it is Bangla and short enough to follow.
  const nextStep = track.nextAction && mostlyBangla(track.nextAction) ? speakable(track.nextAction) : ''
  if (nextStep && nextStep.length <= 200) sentences.push(`করণীয়: ${nextStep}${/[।?!.]$/.test(nextStep) ? '' : '।'}`)
  return sentences.join(' ')
}

// The fixed turns of the spoken status call. Only these are ever sent to the speech service, so no caller-supplied
// text is spoken; the one variable is the number the caller said, and that is read back as digit words.
const PROMPTS = {
  welcome: 'বলুন, আপনি কী জানতে চান?',
  confirmStatus: 'আপনি কি আপনার মামলার অবস্থা জানতে চান? হ্যাঁ বা না বলুন।',
  askNumber: 'আপনার আবেদন নম্বর বা মামলা নম্বরটি একটি একটি সংখ্যা করে বলুন।',
  askPin: 'এবার আপনার ছয় সংখ্যার পিনটি একটি একটি সংখ্যা করে বলুন।',
  pinAgain: 'দুঃখিত, ছয়টি সংখ্যা পাইনি। পিনের ছয়টি সংখ্যা একটি একটি করে আবার বলুন।',
  notHeard: 'দুঃখিত, বুঝতে পারিনি। আরেকবার বলুন।',
  notFound: 'এই নম্বর ও পিনে কোনো আবেদন পাওয়া যায়নি। আরেকবার চেষ্টা করুন।',
  tryHelpline: `দুঃখিত, মিলছে না। সাহায্যের জন্য ${spokenDigits('16699')} নম্বরে কল করুন।`,
  unavailable: 'দুঃখিত, এখন তথ্য জানানো যাচ্ছে না। একটু পরে আবার চেষ্টা করুন।',
  onlyStatus: `এখানে শুধু আবেদন ও মামলার অবস্থা জানা যায়। অন্য সাহায্যের জন্য ${spokenDigits('16699')} নম্বরে কল করুন।`,
}
export const promptKeys = [...Object.keys(PROMPTS), 'confirmNumber']

// Words Whisper is primed with for a short reply. Unprimed, a lone "হ্যাঁ" came back as "হাই" or "হ্যাদ", "না" as
// "ন", and one "শূন্য" of six was dropped; primed, all were exact, and silence or noise still did not become a word
// from the hint (checked against Groq on 2026-09-25). The browser names a hint; it never sends its own text.
export const TRANSCRIPT_HINTS = {
  yesNo: 'হ্যাঁ। না। জি। ঠিক আছে।',
  number: 'শূন্য, এক, দুই, তিন, চার, পাঁচ, ছয়, সাত, আট, নয়।',
}

export const promptText = (key, digits) => (key === 'confirmNumber'
  ? `আপনি বলেছেন ${spokenDigits(digits)}। ঠিক থাকলে হ্যাঁ, ভুল হলে না বলুন।`
  : PROMPTS[key])
