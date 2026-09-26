import { transcribeClip } from '../services/ai/groq.js'
import { HttpError } from '../utils/httpError.js'
import { createAssisted, getAssisted, resolveAssisted, reviseAssisted } from '../services/assistedService.js'

export async function create(request, response) {
  response.status(201).json(await createAssisted(request.body, request.auth))
}

export async function read(request, response) {
  response.json(await getAssisted(request.params.applicationId, request.auth))
}

export async function revise(request, response) {
  const result = await reviseAssisted(request.params.applicationId, request.body, request.auth)
  response.status(result.kind === 'CONFLICT' ? 409 : 200).json(result)
}

export async function resolve(request, response) {
  response.json(await resolveAssisted(request.params.applicationId, request.body, request.auth))
}

// Marma/original-words voice fill: the clip is transcribed with language auto-detect and discarded.
// Marma has no dedicated Whisper model, so the text is best-effort and always needs translator verification.
export async function transcribeOriginal(request, response) {
  const heard = await transcribeClip(request.body, request.get('content-type'), { language: null })
  const text = typeof heard.text === 'string' ? heard.text.trim().slice(0, 4000) : ''
  if (!text) throw new HttpError(422, 'VALIDATION_ERROR', 'No speech was understood. Please try again or type the original words.')
  response.json({ text, detectedLanguage: heard.language ?? null, unverified: true })
}
