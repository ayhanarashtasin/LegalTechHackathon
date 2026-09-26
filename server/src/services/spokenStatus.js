// What the spoken status route (A5) says to a caller who cannot read. Every sentence comes from the fixed templates
// below and the verified record, never from a language model. It says only the permitted status, stage, hearing date,
// and applicant-facing next step: a name, the legal matter, the lawyer, or the office could be overheard on a shared
// phone. The speech model skips digits, so every number is spoken as Bangla words. The call can also run in English
// (`lang` 'en', decided 2026-09-26): the same templates in English, spoken by the caller's browser.

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
const DIGITS_EN = 'zero one two three four five six seven eight nine'.split(' ')
const MONTHS_EN = 'January February March April May June July August September October November December'.split(' ')
const WEEKDAYS_EN = 'Sunday Monday Tuesday Wednesday Thursday Friday Saturday'.split(' ')
const ORDINALS_EN = ('first second third fourth fifth sixth seventh eighth ninth tenth eleventh twelfth thirteenth fourteenth '
  + 'fifteenth sixteenth seventeenth eighteenth nineteenth twentieth').split(' ')
const ordinalEn = (day) => (day <= 20 ? ORDINALS_EN[day - 1] : day === 30 ? 'thirtieth' : `${day < 30 ? 'twenty' : 'thirty'}-${ORDINALS_EN[(day % 10) - 1]}`)

const asciiDigits = (text) => String(text).replace(/[০-৯]/g, (digit) => '০১২৩৪৫৬৭৮৯'.indexOf(digit))

// An ID, PIN, or phone number is read digit by digit, as a caller would say it back.
export const spokenDigits = (digits, lang = 'bn') => [...asciiDigits(digits)].map((digit) => (lang === 'en' ? DIGITS_EN : NUMBER_WORDS)[digit]).join(' ')

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

// In English: "Sunday, the fourth of October", with the year only when it is not this year.
export function spokenDate(value, now = new Date(), lang = 'bn') {
  const date = inDhaka(value)
  const sameYear = date.getUTCFullYear() === inDhaka(now).getUTCFullYear()
  if (lang === 'en') {
    return `${WEEKDAYS_EN[date.getUTCDay()]}, the ${ordinalEn(date.getUTCDate())} of ${MONTHS_EN[date.getUTCMonth()]}${sameYear ? '' : `, ${date.getUTCFullYear()}`}`
  }
  const year = sameYear ? '' : `${spokenNumber(date.getUTCFullYear())} সালের `
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

// Whether text is mostly in the call's own script: Bangla letters for a Bangla call, Latin ones for an English call.
const mostlyIn = (text, lang) => {
  const letters = text.match(/\p{L}/gu) ?? []
  const own = lang === 'en' ? /[A-Za-z]/ : /[ঀ-৿]/
  return letters.length > 0 && letters.filter((letter) => own.test(letter)).length / letters.length >= 0.8
}
// The browser's English voice reads digits itself, so only symbols it would read out oddly are dropped.
const speakableEn = (text) => text.replace(/[^A-Za-z0-9\s,.?!;:'"()\-–]/g, ' ').replace(/\s+/g, ' ').trim()

const STATUS_LINES = {
  bn: {
    done: 'আপনার আইনগত সহায়তার কাজ সম্পন্ন হয়েছে।',
    lawyerAccepted: 'আপনার মামলায় একজন প্যানেল আইনজীবী দায়িত্ব নিয়েছেন।',
    lawyerPending: 'আপনার মামলার জন্য একজন প্যানেল আইনজীবী নিয়োগের কাজ চলছে।',
    mediation: 'আপনার বিষয়টি আপস-মীমাংসার জন্য মধ্যস্থতায় পাঠানো হয়েছে।',
    approved: 'আপনার আইনগত সহায়তার আবেদন মঞ্জুর হয়েছে।',
    appointing: 'আইনজীবী নিয়োগের কাজ চলছে।',
    needsInformation: 'আপনার আবেদনের জন্য আরও কিছু তথ্য দরকার। অফিস নিরাপদ উপায়ে আপনার সঙ্গে যোগাযোগ করবে।',
    reviewing: 'আপনার আবেদনটি একজন কর্মকর্তা যাচাই করছেন। এখনো কোনো সিদ্ধান্ত হয়নি।',
    received: 'আপনার আবেদনটি গ্রহণ করা হয়েছে।',
    hearing: (date) => `আপনার পরবর্তী শুনানির তারিখ ${date}।`,
    noNewHearing: 'শুনানির নতুন তারিখ এখনো রেকর্ড করা হয়নি।',
    nextStep: 'করণীয়:',
    stop: '।',
  },
  en: {
    done: 'Your legal aid work has been completed.',
    lawyerAccepted: 'A panel lawyer has taken on your case.',
    lawyerPending: 'A panel lawyer is being appointed for your case.',
    mediation: 'Your matter has been sent to mediation to try to settle it.',
    approved: 'Your application for legal aid has been approved.',
    appointing: 'A lawyer is being appointed.',
    needsInformation: 'More information is needed for your application. The office will contact you in a safe way.',
    reviewing: 'An officer is checking your application. No decision has been made yet.',
    received: 'Your application has been received.',
    hearing: (date) => `Your next hearing is on ${date}.`,
    noNewHearing: 'A new hearing date has not been recorded yet.',
    nextStep: 'Next step:',
    stop: '.',
  },
}

// The sentence for one tracked record (the result of trackApplicationStatus), short enough to hear in one go.
export function spokenStatus(track, now = new Date(), lang = 'bn') {
  const line = STATUS_LINES[lang]
  const sentences = []
  if (track.currentPhase >= 6) sentences.push(line.done)
  else if (track.lawyer?.status === 'ACCEPTED') sentences.push(line.lawyerAccepted)
  else if (track.lawyer) sentences.push(line.lawyerPending)
  // Stage 4 without a lawyer means mediation; stage 5 only means a hearing is set.
  else if (track.currentPhase === 4) sentences.push(line.mediation)
  else if (track.currentPhase === 5) sentences.push(line.approved)
  else if (track.currentPhase === 3) sentences.push(`${line.approved} ${line.appointing}`)
  else if (track.reviewState === 'NEEDS_INFORMATION') sentences.push(line.needsInformation)
  else if (track.currentPhase === 2) sentences.push(line.reviewing)
  else sentences.push(line.received)

  if (track.nextHearingAt) {
    // A past date is never read as the next hearing: the caller might travel for it.
    sentences.push(dhakaDay(track.nextHearingAt) >= dhakaDay(now) ? line.hearing(spokenDate(track.nextHearingAt, now, lang)) : line.noNewHearing)
  }
  // The next step is officer-written free text; it is read only when it is in the call's language and short enough
  // to follow.
  const nextStep = track.nextAction && mostlyIn(track.nextAction, lang) ? (lang === 'en' ? speakableEn : speakable)(track.nextAction) : ''
  if (nextStep && nextStep.length <= 200) sentences.push(`${line.nextStep} ${nextStep}${/[।?!.]$/.test(nextStep) ? '' : line.stop}`)
  return sentences.join(' ')
}

// The fixed turns of the spoken status call. Only these are ever sent to the speech service, so no caller-supplied
// text is spoken; the one variable is the number the caller said, and that is read back as digit words.
const PROMPTS_BN = {
  welcome: 'বলুন, আপনি কী জানতে চান?',
  confirmStatus: 'আপনি কি আপনার মামলার অবস্থা জানতে চান? হ্যাঁ বা না বলুন।',
  askNumber: 'আপনার আবেদন নম্বর বা মামলা নম্বরটি একটি একটি সংখ্যা করে বলুন।',
  // Asked before the PIN: on a shared phone a bystander must hear neither the PIN nor the status. Asked as a positive
  // question, since "না, কেউ নেই" (no, nobody is here) to "nobody can hear, right?" would read as a "no".
  privateCheck: 'এরপর আপনার পিন বলতে হবে, আর আপনার মামলার তথ্য শোনানো হবে। আপনি কি এমন জায়গায় আছেন, যেখানে অন্য কেউ শুনতে পাবে না? হ্যাঁ বা না বলুন।',
  notPrivate: 'ঠিক আছে, এখন কিছু জানানো হবে না। নিরিবিলি জায়গা থেকে পরে আবার চেষ্টা করুন।',
  askPin: 'এবার আপনার ছয় সংখ্যার পিনটি একটি একটি সংখ্যা করে বলুন।',
  pinAgain: 'দুঃখিত, ছয়টি সংখ্যা পাইনি। পিনের ছয়টি সংখ্যা একটি একটি করে আবার বলুন।',
  notHeard: 'দুঃখিত, বুঝতে পারিনি। আরেকবার বলুন।',
  notFound: 'এই নম্বর ও পিনে কোনো আবেদন পাওয়া যায়নি। আরেকবার চেষ্টা করুন।',
  tryHelpline: `দুঃখিত, মিলছে না। সাহায্যের জন্য ${spokenDigits('16699')} নম্বরে কল করুন।`,
  unavailable: 'দুঃখিত, এখন তথ্য জানানো যাচ্ছে না। একটু পরে আবার চেষ্টা করুন।',
  onlyStatus: `এখানে শুধু আবেদন ও মামলার অবস্থা জানা যায়। অন্য সাহায্যের জন্য ${spokenDigits('16699')} নম্বরে কল করুন।`,
}
// The same turns in English. Numbers are written as words, so the browser's voice reads 16699 digit by digit.
// The privacy question asks whether only the caller can hear: an honest "No, nobody can hear me" to "Can anyone
// hear you?" would read as a no, as its Bangla twin notes.
const PROMPTS_EN = {
  welcome: 'Hello. What would you like to know?',
  confirmStatus: 'Do you want to know the status of your case? Please say yes or no.',
  askNumber: 'Please say your application number or case number, one digit at a time.',
  privateCheck: 'Next you will say your PIN, and your case information will be read out. Are you in a private place where only you can hear? Please say yes or no.',
  notPrivate: 'All right, nothing will be shared now. Please try again later from a private place.',
  askPin: 'Now please say your six-digit PIN, one digit at a time.',
  pinAgain: 'Sorry, I did not get six digits. Please say the six digits of your PIN again, one at a time.',
  notHeard: 'Sorry, I did not understand. Please say that again.',
  notFound: 'No application matches this number and PIN. Please try again.',
  tryHelpline: `Sorry, that does not match. For help, please call ${spokenDigits('16699', 'en')}.`,
  unavailable: 'Sorry, the information cannot be shared right now. Please try again a little later.',
  onlyStatus: `Only application and case status is available here. For other help, please call ${spokenDigits('16699', 'en')}.`,
}
const PROMPTS = { bn: PROMPTS_BN, en: PROMPTS_EN }
export const promptKeys = [...Object.keys(PROMPTS_BN), 'confirmNumber']

// Words Whisper is primed with for a short reply, per language. Unprimed, a lone "হ্যাঁ" came back as "হাই" or "হ্যাদ",
// "না" as "ন", and one "শূন্য" of six was dropped; primed, all were exact, and silence or noise still did not become a
// word from the hint (checked against Groq on 2026-09-25). The browser names a hint; it never sends its own text.
export const TRANSCRIPT_HINTS = {
  yesNo: { bn: 'হ্যাঁ। না। জি। ঠিক আছে।', en: 'Yes. No. Yeah. Okay.' },
  number: { bn: 'শূন্য, এক, দুই, তিন, চার, পাঁচ, ছয়, সাত, আট, নয়।', en: 'Zero, one, two, three, four, five, six, seven, eight, nine.' },
}

export const promptText = (key, digits, lang = 'bn') => {
  if (key !== 'confirmNumber') return PROMPTS[lang][key]
  return lang === 'en'
    ? `You said ${spokenDigits(digits, 'en')}. Say yes if that is right, or no if it is wrong.`
    : `আপনি বলেছেন ${spokenDigits(digits)}। ঠিক থাকলে হ্যাঁ, ভুল হলে না বলুন।`
}
