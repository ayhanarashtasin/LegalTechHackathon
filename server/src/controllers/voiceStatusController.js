import { synthesizeSpeech } from '../services/ai/banglaTts.js'
import { transcribeAnswer, understandStatusRequest } from '../services/ai/groq.js'
import { trackApplicationStatus } from '../services/applicationService.js'
import { promptText, spokenStatus, TRANSCRIPT_HINTS } from '../services/spokenStatus.js'

// Spoken status route (A5): each turn is timed per stage in Server-Timing, and audio travels as base64 MP3 next to
// the words it says, so the page can show the same sentence when speech is unavailable.
const since = (started) => Math.round(performance.now() - started)
const base64 = (audio) => audio?.toString('base64') ?? null

export async function transcribeSpeech(request, response) {
  const started = performance.now()
  // The clip is transcribed and dropped; the browser reads digits and yes/no from the text as the 16699 call does.
  const text = await transcribeAnswer(request.body, request.get('content-type'), TRANSCRIPT_HINTS[request.query.hint])
  response.set('Server-Timing', `stt;dur=${since(started)}`)
  response.json({ text })
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
  const text = promptText(key, digits)
  const started = performance.now()
  const audio = await synthesizeSpeech(text, { reuse: key !== 'confirmNumber' })
  response.set('Server-Timing', `tts;dur=${since(started)}`)
  response.json({ text, audio: base64(audio) })
}

export async function speakStatus(request, response) {
  let started = performance.now()
  // The same ID-plus-lookup-code check as the typed tracker; a mismatch is a 404 before anything is said.
  const result = await trackApplicationStatus(request.body.identifier, request.body.lookupCode)
  const lookup = since(started)
  const sentence = spokenStatus(result)
  started = performance.now()
  const audio = await synthesizeSpeech(sentence)
  response.set('Server-Timing', `lookup;dur=${lookup}, tts;dur=${since(started)}`)
  response.json({ result, sentence, audio: base64(audio) })
}
