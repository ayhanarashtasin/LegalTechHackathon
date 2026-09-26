import { answer, nextField, steps } from './voiceScript.js'

// Boundary between the AI and the intake draft. Whatever the model extracted from the caller's speech is
// checked here against the same script the keyboard uses: only the question being asked and only allowed values.
// So a later question is never skipped, and an earlier answer (a keypad choice included) is never overwritten or
// given this clip; earlier answers change only through a correction, which makes that question current again.
// The server validates the whole payload again before anything is saved.
const toolCode = (value) => (value === true ? 'YES' : value === false ? 'NO' : value)
const asciiDigits = (text) => text.replace(/[০-৯]/g, (digit) => '০১২৩৪৫৬৭৮৯'.indexOf(digit))

export function parseAnswer(field, raw) {
  const step = steps[field]
  if (!step) return undefined
  if (typeof raw === 'boolean') return step.choices?.some(([option]) => option === raw) ? raw : undefined
  if (typeof raw !== 'string') return undefined
  // A number keeps only its digits (Bangla digits become ASCII); the question's own pattern decides if it is whole.
  const value = step.digits ? asciiDigits(raw.trim()).replace(/[\s-]/g, '') : raw.trim()
  if (step.choices) return step.choices.map(([option]) => option).find((option) => toolCode(option) === value.toUpperCase())
  if (value.length < (step.min ?? 2) || value.length > (step.max ?? 20)) return undefined
  if (step.digits && !step.digits.test(value)) return undefined
  return value
}

// A caller may answer a choice by saying its key number ("দুই"). The model cannot see the key order, so an answer
// that is only a number is matched to its key here, like pressing it.
const numberWords = { এক: 1, দুই: 2, দু: 2, তিন: 3, চার: 4, one: 1, two: 2, three: 3, four: 4 }
export function spokenKey(text) {
  const word = asciiDigits(text ?? '').toLowerCase().replace(/[\s।.,!?'"-]+/g, '')
  return numberWords[word] ?? (/^[1-9]$/.test(word) ? Number(word) : undefined)
}

// Whisper writes a spoken number as Bangla digit words, often spelled by ear ("শুন্ন", "পাচ", "শাত", "নই"), and the
// model will not always turn those into digits. They map to digits here, so a spoken number never depends on the model.
// Words compare by consonant outline, since Whisper's spelling drifts between runs (শূন্য, শুন্ন, শুনো, সুন্ন are one
// word): vowel signs, hasanta, chandrabindu, and nukta are dropped; স/ষ/শ, ণ/ন, and each aspirated letter and its plain
// twin (ঠ/ট, থ/ত, ছ/চ, …; "আঠ" is আট) count as the same letter.
const outline = (word) => word.normalize('NFD').replace(/[\u0981-\u0983\u09BC\u09BE-\u09CD\u09D7\u200C\u200D]/g, '').replace(/[সষ]/g, 'শ').replace(/ণ/g, 'ন')
  .replace(/[ঠথধছফখঘঝভ]/g, (letter) => 'টতদচপকগজব'['ঠথধছফখঘঝভ'.indexOf(letter)])
const DIGIT_WORDS = [
  ['শূন্য', 'শুন্ন', 'শুনো', 'জিরো', 'zero'], ['এক', 'one'], ['দুই', 'দুয়', 'দু', 'two'], ['তিন', 'three'], ['চার', 'four'],
  ['পাঁচ', 'পাছ', 'five'], ['ছয়', 'ছা', 'ছই', 'six'], ['সাত', 'seven'], ['আট', 'আত', 'eight'], ['নয়', 'নই', 'nine'],
]
const digitOfWord = new Map(DIGIT_WORDS.flatMap((words, digit) => words.map((word) => [outline(word), String(digit)])))
// Outline twins that are not digits: "নেই" (none) looks like "নই" (nine) once the vowel sign is gone, "চাই" (want)
// like "ছই" (six), and "দয়া" (please) like "দুয়" (two).
const notDigits = new Set(['নেই', 'চাই', 'দয়া'].map((word) => word.normalize('NFD')))
// English digit words as Whisper writes them in Bangla script ("ফোর এইট টু"), since numbers are often read out in
// English. Matched by exact spelling, not by outline: "থ্রি" shares its outline with "তার" (his), "ফোর" with "পরে",
// and "সিরো" with "সরি" (sorry). সিরো, সেমেন, তু, and দোবল are how Whisper wrote English "zero", "seven", "two", and
// "double" in a Bangla call (Groq, 2026-09-26).
const englishDigits = new Map([['সিরো', 0], ['ওয়ান', 1], ['টু', 2], ['তু', 2], ['থ্রি', 3], ['থ্রী', 3], ['ফোর', 4], ['ফাইভ', 5],
  ['সিক্স', 6], ['সেভেন', 7], ['সেমেন', 7], ['এইট', 8], ['নাইন', 9]].map(([word, digit]) => [word.normalize('NFD'), String(digit)]))
const repeats = new Map([['ডাবল', 2], ['দোবল', 2], ['double', 2], ['ট্রিপল', 3], ['triple', 3]].map(([word, times]) => [outline(word), times]))

// "আমার নম্বর এক, দুই, শুন্ন" → "120", "ডাবল জিরো" → "00". Other words ("আমার নম্বর হলো") are skipped rather than
// failing the number; the caller then hears the digits read back and confirms them, so nothing is taken unheard.
export function digitsFromWords(text) {
  let digits = ''
  let times = 1
  for (const token of (text ?? '').toLowerCase().split(/[\s,।.;:!?'"()-]+/).filter(Boolean)) {
    if (repeats.has(outline(token))) { times = repeats.get(outline(token)); continue }
    const word = token.normalize('NFD')
    const digit = /^[0-9০-৯]+$/.test(token) ? asciiDigits(token) : notDigits.has(word) ? undefined : englishDigits.get(word) ?? digitOfWord.get(outline(token))
    if (digit !== undefined) digits += digit.repeat(times)
    times = 1
  }
  return digits || undefined
}

// A yes or no said aloud, matched here like a key press so it never waits on the model. A reply with both ("ঠিক
// হয়নি", "না না, ঠিক আছে") or neither is left to the model, which sees the whole sentence.
// A lone "না" can come back from Whisper as "ন", and English "yes" in a Bangla call as "যেস" or "যেশ". In English,
// "not" counts as a no, so "not okay" is asked again rather than taken as a yes; "right", "correct", and "sure" are
// left out, since "not right" and "not sure" would be read the same way.
const YES_WORDS = new Set(['হ্যাঁ', 'হ্যা', 'হাঁ', 'হা', 'হুম', 'হুঁ', 'জি', 'জ্বি', 'জী', 'ঠিক', 'সঠিক', 'আছে', 'হয়েছে', 'জমা', 'ওকে', 'যেস', 'যেশ', 'ইয়েস',
  'yes', 'yeah', 'yep', 'yup', 'ok', 'okay'].map((word) => word.normalize('NFD')))
const NO_WORDS = new Set(['না', 'ন', 'নাহ', 'নাই', 'নেই', 'ভুল', 'হয়নি', 'নয়', 'নো', 'no', 'nope', 'not', 'wrong', 'incorrect'].map((word) => word.normalize('NFD')))
// A lone "হ্যাঁ" can come back with one stray consonant ("হ্যাদ", "হ্যাক্"); "হ্যালো" and longer words are not a yes.
const CLIPPED_YES = /^হ্যাঁ?[ক-হ]্?$/
export function spokenYesNo(text) {
  const tokens = (text ?? '').normalize('NFD').toLowerCase().split(/[\s,।.;:!?'"()-]+/).filter(Boolean)
  const yes = tokens.some((token) => YES_WORDS.has(token) || CLIPPED_YES.test(token))
  const no = tokens.some((token) => NO_WORDS.has(token))
  return yes === no ? undefined : yes
}

// "আমার কেসের অবস্থা জানতে চাই": asking how a case stands, matched by its words like a key press, never by the model.
// "অবস্থা" is compared by consonant outline, since Whisper writes it অবস্তা, অভোস্থা, or ওবোস্থা. An unmatched reply
// is asked about again.
const STATUS_WORDS = /খবর|আপডেট|স্ট্যাটাস|অগ্রগতি|শুনানি|কতদূর|কদ্দূর|status|update|progress|hearing|news|obosth/i
const STATUS_STEMS = ['অবস্থা', 'ওবস্থা'].map((word) => outline(word))
export function spokenStatusRequest(text) {
  const tokens = (text ?? '').split(/[\s,।.;:!?'"()-]+/).filter(Boolean)
  return STATUS_WORDS.test(text ?? '') || tokens.some((token) => STATUS_STEMS.some((stem) => outline(token).startsWith(stem)))
}

// The number part of an Application or Case ID, as the tracker takes it: up to six digits, or the ID said whole with
// its year ("দুই শূন্য দুই ছয় শূন্য শূন্য শূন্য শূন্য তিন নয়"), which keeps the last six.
export function applicationNumber(digits) {
  if (/^\d{1,6}$/.test(digits ?? '')) return digits
  if (/^20\d{8}$/.test(digits ?? '')) return digits.slice(4)
  return undefined
}

// Short generated tones (key presses and the "speak now" beep); no audio files needed.
export function playTone(context, frequencies, ms = 120) {
  if (!context || context.state === 'closed') return
  const gain = context.createGain()
  gain.gain.value = 0.06
  gain.connect(context.destination)
  for (const frequency of frequencies) {
    const oscillator = context.createOscillator()
    oscillator.frequency.value = frequency
    oscillator.connect(gain)
    oscillator.start()
    oscillator.stop(context.currentTime + ms / 1000)
  }
}

// An uncertain safety reply must never be treated as the "no" inside "জানি না".
export function spokenUncertain(text) {
  return /জানি\s+না|নিশ্চিত\s+নই|বুঝতে\s+পারছি\s+না|not\s+sure|don'?t\s+know|unsure/i.test(text ?? '')
}

// A spoken number (a phone number or an NID) is kept as digits only and checked like one typed on the keypad.
export function spokenDigits(raw, field = 'contactValue') {
  const value = parseAnswer(field, raw)?.replace(/[^0-9]/g, '')
  return value && steps[field].digits.test(value) ? value : undefined
}

// Applies an extraction result. Returns the new draft plus the fields that were actually accepted.
export function applyExtraction(call, values) {
  const accepted = []
  const clarification = []
  const next = Object.entries(values ?? {}).reduce((draft, [field, raw]) => {
    if (field !== nextField(draft)) return draft
    const value = parseAnswer(field, raw)
    if (value === undefined) return draft
    // A spoken "no" to current danger is checked by asking the approved safety question again.
    if (field === 'urgent' && value === false && !draft.safetyNoPending) {
      clarification.push(field)
      return { ...draft, safetyNoPending: true }
    }
    accepted.push(field)
    return answer(draft, field, value, 'AI')
  }, call)
  return { call: next, accepted, clarification }
}

// One turn per answer, so a long problem description is not cut short by the answers around it.
export const appendTranscript = (turns, speaker, text) => [...turns, { speaker, text: text.slice(0, 2000) }].slice(-300)

// One microphone stream serves the whole call: the full-call recording and each spoken answer share it.
export const openMicrophone = () => navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
export const closeMicrophone = (stream) => stream?.getTracks().forEach((track) => track.stop())

// End of a spoken answer by loudness, like an IVR line: the caller has spoken for a moment and then stayed quiet
// for `pauseMs`. The quietest level heard so far is the room's floor, so steady hum does not count as speech;
// silence before the caller starts (thinking) never ends the answer, and the beep's echo at the start is ignored.
// ponytail: loudness only; a TV or crowd that never goes quiet leaves # and the time limit to end the answer.
// A model VAD (e.g. Silero) if field tests show that happens often.
const SPEECH_LEVEL = 0.015 // lowest RMS that counts as speech: the calibration knob for real phones and microphones
const SPEECH_OVER_FLOOR = 4 // speech must also be this many times louder than the room's floor (about 12 dB)
const MIN_SPEECH_MS = 300 // a cough or a click alone does not start the pause clock
const BEEP_MS = 300 // the "speak now" beep plays as recording starts

export function pauseDetector(pauseMs) {
  let start, last, quietSince
  let floor = Infinity
  let spoken = 0
  return (level, now) => {
    start ??= now
    const elapsed = now - (last ?? now)
    last = now
    const speech = level > Math.max(SPEECH_LEVEL, floor * SPEECH_OVER_FLOOR)
    floor = Math.min(floor, level)
    if (now - start < BEEP_MS) return false
    if (speech) {
      spoken += elapsed
      quietSince = undefined
      return false
    }
    if (spoken < MIN_SPEECH_MS) return false
    quietSince ??= now
    return now - quietSince >= pauseMs
  }
}

// Samples the microphone's loudness ten times a second, in the browser only; returns a function that stops it.
function watchPause(stream, { context, pauseMs, onPause }) {
  const source = context.createMediaStreamSource(stream)
  const analyser = context.createAnalyser()
  source.connect(analyser)
  const samples = new Float32Array(analyser.fftSize)
  const paused = pauseDetector(pauseMs)
  const id = setInterval(() => {
    analyser.getFloatTimeDomainData(samples)
    if (!paused(Math.hypot(...samples) / Math.sqrt(samples.length), performance.now())) return
    clearInterval(id)
    onPause()
  }, 100)
  return () => { clearInterval(id); source.disconnect() }
}

// Records from the open stream until stopped; the caller of this owns the stream and closes it.
// With `pause` ({ context, pauseMs, onPause }), onPause is called once when the caller stops talking.
export function startRecording(stream, pause) {
  const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((type) => MediaRecorder.isTypeSupported(type))
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 24000 } : {})
  const chunks = []
  const clip = () => new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })
  recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data) }
  recorder.start()
  const unwatch = pause ? watchPause(stream, pause) : () => {}
  return {
    stop: () => new Promise((resolve) => {
      unwatch()
      if (recorder.state === 'inactive') return resolve(clip())
      recorder.onstop = () => resolve(clip())
      recorder.stop()
    }),
    cancel: () => { unwatch(); if (recorder.state !== 'inactive') recorder.stop() },
  }
}
