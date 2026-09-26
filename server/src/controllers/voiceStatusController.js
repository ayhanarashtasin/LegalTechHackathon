import { synthesizeSpeech } from '../services/ai/banglaTts.js'
import { transcribeClip, understandStatusRequest } from '../services/ai/groq.js'
import { trackApplicationStatus } from '../services/applicationService.js'
import { promptText, spokenStatus, TRANSCRIPT_HINTS } from '../services/spokenStatus.js'

// Spoken status route (A5): each turn is timed per stage in Server-Timing, and audio travels as base64 MP3 next to
// the words it says, so the page can show the same sentence when speech is unavailable. The call runs in Bangla or
// English (`?lang=`, validated before this). BanglaTTS speaks only Bangla, so an English turn comes back as words only,
// and the caller's browser speaks them.
const since = (started) => Math.round(performance.now() - started)
const base64 = (audio) => audio?.toString('base64') ?? null
const languageOf = (request) => request.query.lang ?? 'bn'
const speak = (text, lang, options) => (lang === 'bn' ? synthesizeSpeech(text, options) : null)

export async function transcribeSpeech(request, response) {
  const started = performance.now()
  // The clip is transcribed and dropped; the browser reads digits and yes/no from the text as the 16699 call does.
  // 'auto' (the caller's first answer) leaves the language to Whisper and reports which one it heard.
  const lang = languageOf(request)
  const heard = await transcribeClip(request.body, request.get('content-type'), lang === 'auto'
    ? { language: null }
    : { language: lang, prompt: TRANSCRIPT_HINTS[request.query.hint]?.[lang] })
  response.set('Server-Timing', `stt;dur=${since(started)}`)
  response.json(heard)
}

// Only after the browser's word rules found no status request in the opening turn.
export async function understandRequest(request, response) {
  const started = performance.now()
  const wantsStatus = await understandStatusRequest(request.body.text)
  response.set('Server-Timing', `llm;dur=${since(started)}`)
  response.json({ wantsStatus })
}

export async function speakPrompt(request, response) {
  const { key, digits } = request.body
  const lang = languageOf(request)
  const text = promptText(key, digits, lang)
  const started = performance.now()
  const audio = await speak(text, lang, { reuse: key !== 'confirmNumber' })
  response.set('Server-Timing', `tts;dur=${since(started)}`)
  response.json({ text, audio: base64(audio) })
}

export async function speakStatus(request, response) {
  let started = performance.now()
  // The same ID-plus-lookup-code check as the typed tracker; a mismatch is a 404 before anything is said.
  const result = await trackApplicationStatus(request.body.identifier, request.body.lookupCode)
  const lookup = since(started)
  const lang = languageOf(request)
  const sentence = spokenStatus(result, new Date(), lang)
  started = performance.now()
  const audio = await speak(sentence, lang)
  response.set('Server-Timing', `lookup;dur=${lookup}, tts;dur=${since(started)}`)
  response.json({ result, sentence, audio: base64(audio) })
}
