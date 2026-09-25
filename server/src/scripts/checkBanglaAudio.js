import { readFileSync } from 'node:fs'
import { extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { steps } from '../../../client/src/utils/voiceScript.js'
import { transcribeAnswer, voiceAiEnabled } from '../services/ai/groq.js'

// Default: check a supplied, fictional Bangla prompt against the approved script.
// To check a fictional caller recording, pass its path and the expected spoken words:
// npm run check:voice-bangla -- recordings/fictional-answer.wav "expected Bangla words"
const defaultSample = fileURLToPath(new URL('../../../client/public/audio/urgent.mp3', import.meta.url))
const path = process.argv[2] || defaultSample
const expected = process.argv[3] || (path === defaultSample ? steps.urgent.prompt : '')
const types = { '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.webm': 'audio/webm', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg' }
const mimeType = types[extname(path).toLowerCase()]
if (!voiceAiEnabled() || !mimeType || (process.argv[2] && !expected)) {
  console.error('Bangla audio check needs enabled Groq voice AI, a supported audio file, and expected words for a custom recording.')
  process.exitCode = 1
} else {
  try {
    const transcript = await transcribeAnswer(readFileSync(path), mimeType)
    const words = (value) => value.toLocaleLowerCase('bn').split(/[^\p{L}\p{M}]+/u).filter((word) => word.length > 1)
    const reference = new Set(words(expected))
    const heard = new Set(words(transcript))
    const overlap = [...reference].filter((word) => heard.has(word)).length / Math.max(reference.size, 1)
    const bengaliLetters = (transcript.match(/[\u0980-\u09ff]/g) || []).length
    const passed = bengaliLetters >= 15 && overlap >= 0.4
    console.log(`Bangla transcription check: ${passed ? 'PASS' : 'FAIL'}; Bangla characters ${bengaliLetters}; expected-word overlap ${Math.round(overlap * 100)}%.`)
    process.exitCode = passed ? 0 : 1
  } catch (error) {
    console.error(`Bangla transcription check failed: ${error.message}`)
    process.exitCode = 1
  }
}
