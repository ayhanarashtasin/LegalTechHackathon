import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import mongoose from 'mongoose'
import { Application } from '../models/index.js'
import { synthesizeSpeech, ttsEnabled } from '../services/ai/banglaTts.js'
import { trackApplicationStatus } from '../services/applicationService.js'
import { spokenStatus } from '../services/spokenStatus.js'

// Speaks the seeded fictional Malek case through the same lookup, sentence, and speech steps as POST /api/voice/status,
// and saves the reply as an MP3. Needs the Step 9 seed and `npm run tts`:
//   npm run check:voice-status --workspace server -- [output.mp3]
// The lookup code is read from the ignored demo-credentials file and never printed.
const output = process.argv[2] || join(tmpdir(), 'dlas-voice-status.mp3')
const credentials = JSON.parse(readFileSync(new URL('../../.demo-credentials.json', import.meta.url), 'utf8'))

await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/dlas', { dbName: process.env.MONGODB_DB || 'dlas', serverSelectionTimeoutMS: 10000 })
try {
  const malek = await Application.findOne({ demoSeedKey: 'STEP9_MALEK' }).select('applicationId').lean()
  if (!malek || !credentials.demo_malek_status_lookup_code) throw new Error('Seed the Step 9 Malek case first (npm run seed --workspace server).')
  let started = performance.now()
  const result = await trackApplicationStatus(malek.applicationId, credentials.demo_malek_status_lookup_code)
  const lookup = Math.round(performance.now() - started)
  const sentence = spokenStatus(result)
  console.log(`${malek.applicationId}, stage ${result.currentPhase} (lookup ${lookup} ms):\n${sentence}`)
  if (!ttsEnabled()) {
    console.log('VOICE STATUS CHECK: TEXT ONLY — set TTS_URL (and start `npm run tts`) to hear it.')
  } else {
    started = performance.now()
    const audio = await synthesizeSpeech(sentence)
    if (!audio) throw new Error('The speech service did not answer. Is `npm run tts` running?')
    writeFileSync(output, audio)
    console.log(`Spoken in ${Math.round(performance.now() - started)} ms: ${output}`)
    console.log('VOICE STATUS CHECK: PASS')
  }
} catch (error) {
  console.error(`VOICE STATUS CHECK: FAIL — ${error.message}`)
  process.exitCode = 1
} finally {
  await mongoose.disconnect()
}
