import { api } from '../services/api.js'
import { applicationNumber, closeMicrophone, digitsFromWords, openMicrophone, playTone, spokenStatusRequest, spokenYesNo, startRecording } from './voiceAgent.js'

// Spoken status on the Track card (A5), for a caller who cannot read. They say what they want, their Application or
// Case number (read back and confirmed), and their 6-digit PIN (never read back: the phone may be shared), then hear
// the status. Every sentence is one of the server's fixed prompts or its status sentence; this file only decides
// which comes next. Loaded only when the caller presses the voice button.
const MAX_TURN_MS = 12000 // a turn ends here even if the room never goes quiet, like the 16699 call's time limit
const MAX_TRIES = 3

const numberFrom = (text) => applicationNumber(digitsFromWords(text))
// A number inside the opening sentence: only the run of digit words right after "নম্বর" or "আইডি", so a word
// elsewhere in the sentence that sounds like a digit is never taken as part of it.
function numberInSentence(text) {
  const after = (text ?? '').split(/নম্বর|নাম্বার|আইডি|\bid\b/i)[1]
  const run = []
  for (const token of (after ?? '').split(/[\s,।.;:!?'"()-]+/).filter(Boolean)) {
    const digits = digitsFromWords(token)
    if (digits) run.push(digits)
    else if (run.length) break
  }
  return applicationNumber(run.join(''))
}
const pinFrom = (text) => {
  const digits = digitsFromWords(text)
  return /^\d{6}$/.test(digits ?? '') ? digits : undefined
}

// Each kind of turn: how long a pause ends it, how its words are read, which server hint primes Whisper for them
// (a lone "হ্যাঁ" or a run of digits is misheard without one), and what a retry says when the reply did not parse.
// A `typable` turn also takes digits typed on the keypad: Whisper can drop or mishear a digit, and no text step can
// restore a digit the audio lost.
const OPENING = { kind: 'opening', pauseMs: 2000 }
const YES_NO = { kind: 'yesNo', pauseMs: 1500, parse: spokenYesNo, hint: 'yesNo' }
const NUMBER = { kind: 'number', pauseMs: 3000, parse: numberFrom, hint: 'number', typable: true }
const PIN = { kind: 'pin', pauseMs: 3000, parse: pinFrom, hint: 'number', typable: true, retry: 'pinAgain' }

// Asks until a reply parses: `lead` plays only the first time; a retry plays the turn's own retry prompt, or "not
// heard" and the question again. Undefined after three tries.
async function ask(io, prompts, turn, lead = []) {
  for (let tries = 0; tries < MAX_TRIES; tries += 1) {
    const said = !tries ? [...lead, ...prompts] : turn.retry ? [{ key: turn.retry }] : [{ key: 'notHeard' }, ...prompts]
    const value = turn.parse(await io.hear(said, turn))
    if (value !== undefined) return value
  }
  return undefined
}

// The conversation apart from the browser: `io` speaks, listens, and looks up, so tests can drive it with fakes.
export async function runStatusCall(io) {
  const opening = await io.hear([{ key: 'welcome' }], OPENING)
  let number = numberInSentence(opening) // "আমার কেস নম্বর শূন্য শূন্য তিন নয়, অবস্থা জানতে চাই"
  // Word rules first; only words they do not know ("আমার কেসটার কী হলো?") go to the model, and anything short of
  // its clear yes is asked about.
  const wantsStatus = Boolean(number) || spokenStatusRequest(opening) || await io.understand(opening) === true
  if (!wantsStatus && await ask(io, [{ key: 'confirmStatus' }], YES_NO) !== true) {
    return io.finish({ key: 'onlyStatus' })
  }

  let confirmed
  for (let tries = 0; tries < MAX_TRIES && !confirmed; tries += 1) {
    number ??= await ask(io, [{ key: 'askNumber' }], NUMBER)
    if (!number) break
    io.showNumber(number)
    const right = await ask(io, [{ key: 'confirmNumber', digits: number }], YES_NO)
    if (right === undefined) break
    if (right) confirmed = number
    number = undefined
  }
  if (!confirmed) return io.finish({ key: 'tryHelpline' })

  // The PIN is about to be said and the status heard aloud, and the phone may be shared (Malek's is a shop's). Only a
  // clear yes goes on; "no" or no clear answer ends the call without a word about the case.
  if (await ask(io, [{ key: 'privateCheck' }], YES_NO) !== true) return io.finish({ key: 'notPrivate' })

  let lead = []
  for (let tries = 0; tries < MAX_TRIES; tries += 1) {
    const pin = await ask(io, [{ key: 'askPin' }], PIN, lead)
    if (!pin) break
    const outcome = await io.tellStatus(confirmed, pin)
    if (outcome === 'FOUND') return undefined
    if (outcome !== 'NOT_FOUND') return io.finish({ key: outcome === 'LOCKED' ? 'tryHelpline' : 'unavailable' })
    lead = [{ key: 'notFound' }]
  }
  return io.finish({ key: 'tryHelpline' })
}

// Page CSP allows blob: media, not data:, so speech arrives as base64 and plays from an object URL.
const audioUrl = (base64) => (base64
  ? URL.createObjectURL(new Blob([Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))], { type: 'audio/mpeg' }))
  : null)

// Runs one call in the browser. `onLine` shows each sentence as it is said; `onTurn` gives the caller's current turn
// ({ kind, listening }, or null between turns); `onHeard` shows what was heard, for every turn but the PIN; `onNumber`
// fills the ID box with the number heard; and `onResult` receives the tracked record, its spoken sentence, and the
// sentence's audio (an object URL the caller of this function owns and revokes).
// Returns { stop, done, typing, type }: `typing()` stops listening on a number or PIN turn so the keypad can answer
// it, and `type(value)` gives that answer.
export async function startStatusCall({ onLine, onTurn, onHeard, onNumber, onResult }) {
  const controller = new AbortController()
  const { signal } = controller
  const stream = await openMicrophone()
  const context = new AudioContext()
  const player = new Audio()
  let recording = null
  let stopListening = null
  let keypad = null // { started, resolve } while a typable turn is open
  const halt = () => { if (signal.aborted) throw new DOMException('The call ended.', 'AbortError') }
  const aborted = new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('The call ended.', 'AbortError')), { once: true }))
  aborted.catch(() => {})

  const play = (url) => new Promise((resolve) => {
    if (!url) return resolve()
    const done = () => { signal.removeEventListener('abort', done); resolve() }
    player.onended = done
    player.onerror = done
    signal.addEventListener('abort', done)
    player.src = url
    player.play().catch(done)
  })

  async function say(prompts) {
    // Fetched together, spoken in order.
    const spoken = await Promise.all(prompts.map((prompt) => api('/api/voice/prompts', { method: 'POST', body: prompt, signal })))
    for (const { text, audio } of spoken) {
      halt()
      onLine(text)
      const url = audioUrl(audio)
      await play(url)
      if (url) URL.revokeObjectURL(url)
    }
  }

  // Records one reply after the beep; it ends on a pause, at the time limit, when the caller turns to the keypad, or
  // when the call is stopped. Resolves null when the clip is not to be used.
  const record = (pauseMs) => new Promise((resolve) => {
    let finished = false
    const end = async (keep) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      stopListening = null
      const clip = await recording.stop()
      recording = null
      resolve(keep ? clip : null)
    }
    const abort = () => end(false)
    playTone(context, [1000], 200)
    recording = startRecording(stream, { context, pauseMs, onPause: () => { playTone(context, [480], 150); end(true) } })
    const timer = setTimeout(() => end(true), MAX_TURN_MS)
    signal.addEventListener('abort', abort)
    stopListening = () => end(false)
  })

  const io = {
    async hear(prompts, turn) {
      await say(prompts)
      halt()
      const typed = turn.typable ? new Promise((resolve) => { keypad = { started: false, resolve } }) : null
      onTurn({ kind: turn.kind, listening: true })
      const clip = await record(turn.pauseMs)
      halt()
      if (keypad?.started) {
        onTurn({ kind: turn.kind, listening: false })
        const text = await Promise.race([typed, aborted])
        keypad = null
        onTurn(null)
        return text
      }
      keypad = null
      onTurn(null)
      const { text } = await api(`/api/voice/transcripts${turn.hint ? `?hint=${turn.hint}` : ''}`, { method: 'POST', audio: clip, signal })
      if (turn.kind !== 'pin') onHeard(text) // a PIN is never shown, even as heard
      return text
    },
    async understand(text) {
      if (!text?.trim()) return undefined
      try {
        return (await api('/api/voice/requests', { method: 'POST', body: { text: text.trim().slice(0, 500) }, signal })).wantsStatus
      } catch (failure) {
        if (failure.name === 'AbortError') throw failure
        return undefined // the model is only a second chance; without it the caller is simply asked
      }
    },
    showNumber: onNumber,
    async tellStatus(identifier, lookupCode) {
      let found
      try {
        found = await api('/api/voice/status', { method: 'POST', body: { identifier, lookupCode }, signal })
      } catch (failure) {
        if (failure.name === 'AbortError') throw failure
        return failure.status === 404 ? 'NOT_FOUND' : failure.status === 429 ? 'LOCKED' : 'UNAVAILABLE'
      }
      const url = audioUrl(found.audio)
      onResult(found.result, found.sentence, url)
      onLine(found.sentence)
      await play(url)
      return 'FOUND'
    },
    finish: (prompt) => say([prompt]),
  }

  const done = runStatusCall(io)
    .catch((failure) => { if (failure.name !== 'AbortError') throw failure })
    .finally(() => {
      recording?.cancel()
      player.pause()
      closeMicrophone(stream)
      context.close()
    })
  return {
    stop: () => controller.abort(),
    done,
    typing() {
      if (!keypad || keypad.started) return
      keypad.started = true
      stopListening?.()
    },
    type(value) {
      if (keypad?.started && value.trim()) keypad.resolve(value.trim())
    },
  }
}
