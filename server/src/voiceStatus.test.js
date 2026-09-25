import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { after, before, test } from 'node:test'
import app from './app.js'
import { transcribeAnswer } from './services/ai/groq.js'
import { promptText, TRANSCRIPT_HINTS } from './services/spokenStatus.js'

// Spoken status routes without MongoDB or Groq: a fake speech service stands in for tts-service/app.py.
const server = createServer(app)
const spoken = []
let speechFails = false
const speech = createServer((request, response) => {
  let body = ''
  request.on('data', (chunk) => { body += chunk })
  request.on('end', () => {
    if (speechFails) return response.writeHead(500).end()
    spoken.push(JSON.parse(body).text)
    response.writeHead(200, { 'content-type': 'audio/mpeg' }).end('fake-mp3')
  })
})
let base
before(async () => {
  await Promise.all([server, speech].map((listener) => new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve))))
  base = `http://127.0.0.1:${server.address().port}/api`
  process.env.TTS_URL = `http://127.0.0.1:${speech.address().port}`
  delete process.env.VOICE_TTS
})
after(() => {
  for (const listener of [server, speech]) { listener.closeAllConnections(); listener.close() }
})

const post = (path, body, type = 'application/json') => fetch(`${base}${path}`, {
  method: 'POST', headers: { 'content-type': type }, body: type === 'application/json' ? JSON.stringify(body) : body,
})

test('a fixed prompt comes back as its words and speech, synthesized once', async () => {
  for (let turn = 0; turn < 2; turn += 1) {
    const response = await post('/voice/prompts', { key: 'askPin' })
    assert.equal(response.status, 200)
    const { text, audio } = await response.json()
    assert.equal(text, promptText('askPin'))
    assert.equal(Buffer.from(audio, 'base64').toString(), 'fake-mp3')
  }
  assert.deepEqual(spoken, [promptText('askPin')])
})

test('the read-back speaks only the digits the caller said', async () => {
  const response = await post('/voice/prompts', { key: 'confirmNumber', digits: '0039' })
  assert.equal((await response.json()).text, promptText('confirmNumber', '0039'))
  assert.equal(spoken.at(-1), promptText('confirmNumber', '0039'))
})

test('nothing outside the fixed prompts can be spoken', async () => {
  for (const body of [{ key: 'say' }, { key: 'askPin', text: 'যেকোনো কথা' }, { key: 'confirmNumber' },
    { key: 'askPin', digits: '1' }, { key: 'confirmNumber', digits: '12a' }, { key: 'confirmNumber', digits: '12345678901' }]) {
    assert.equal((await post('/voice/prompts', body)).status, 400, JSON.stringify(body))
  }
})

test('when speech fails or is switched off, the words still come back', async () => {
  speechFails = true
  const failed = await (await post('/voice/prompts', { key: 'welcome' })).json()
  assert.deepEqual(failed, { text: promptText('welcome'), audio: null })
  speechFails = false
  process.env.VOICE_TTS = 'off'
  const off = await (await post('/voice/prompts', { key: 'notHeard' })).json()
  assert.deepEqual(off, { text: promptText('notHeard'), audio: null })
  delete process.env.VOICE_TTS
})

test('a transcript turn accepts audio only, primed by a named hint at most', async () => {
  assert.equal((await post('/voice/transcripts', 'hello', 'text/plain')).status, 400)
  assert.equal((await post('/voice/transcripts', Buffer.alloc(100), 'audio/webm')).status, 400)
  for (const query of ['fields=confirm', 'hint=anything', 'hint=yesNo&hint=number', 'hint=yesNo&prompt=x']) {
    const response = await fetch(`${base}/voice/transcripts?${query}`, { method: 'POST', headers: { 'content-type': 'audio/webm' }, body: Buffer.alloc(600) })
    assert.equal(response.status, 400, query)
  }
})

test('a named hint reaches Whisper as its fixed prompt text', async (t) => {
  const sent = []
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    sent.push(init.body)
    return new Response(JSON.stringify({ text: 'হ্যাঁ।' }), { headers: { 'content-type': 'application/json' } })
  })
  const saved = { key: process.env.GROQ_API_KEY, voice: process.env.VOICE_AI }
  process.env.GROQ_API_KEY = 'test-key'
  delete process.env.VOICE_AI
  try {
    assert.equal(await transcribeAnswer(Buffer.alloc(600), 'audio/webm', TRANSCRIPT_HINTS.yesNo), 'হ্যাঁ।')
    await transcribeAnswer(Buffer.alloc(600), 'audio/webm')
  } finally {
    for (const [name, value] of [['GROQ_API_KEY', saved.key], ['VOICE_AI', saved.voice]]) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
  assert.equal(sent[0].get('prompt'), 'হ্যাঁ। না। জি। ঠিক আছে।')
  assert.equal(sent[1].get('prompt'), null)
})

test('the opening\'s own words are read for a status request only, and fail safe when voice AI is off', async (t) => {
  for (const body of [{}, { text: '' }, { text: 'ক'.repeat(501) }, { text: 'অবস্থা', extra: true }]) {
    assert.equal((await post('/voice/requests', body)).status, 400, JSON.stringify(body).slice(0, 40))
  }
  const realFetch = globalThis.fetch
  const sentToModel = []
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (!String(url).startsWith('https://api.groq.com/')) return realFetch(url, init)
    sentToModel.push(JSON.parse(init.body))
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"wantsStatus":true}' } }] }), { headers: { 'content-type': 'application/json' } })
  })
  const saved = { key: process.env.GROQ_API_KEY, voice: process.env.VOICE_AI }
  process.env.GROQ_API_KEY = 'test-key'
  try {
    delete process.env.VOICE_AI
    const understood = await post('/voice/requests', { text: 'আমার কেসটার কী হলো একটু বলেন' })
    assert.deepEqual(await understood.json(), { wantsStatus: true })
    assert.equal(sentToModel[0].messages.at(-1).content, 'আমার কেসটার কী হলো একটু বলেন')
    assert.equal(sentToModel[0].response_format.json_schema.schema.required.join(), 'wantsStatus')
    process.env.VOICE_AI = 'off'
    assert.equal((await post('/voice/requests', { text: 'আমার কেসটার কী হলো' })).status, 503)
    assert.equal(sentToModel.length, 1)
  } finally {
    for (const [name, value] of [['GROQ_API_KEY', saved.key], ['VOICE_AI', saved.voice]]) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
})

test('typed and spoken status lookups share one guessing budget', async () => {
  // Invalid bodies are rejected after the limiter counts them, so no database is needed.
  for (let attempt = 0; attempt < 10; attempt += 1) {
    assert.equal((await post('/applications/track', { identifier: 'x', lookupCode: 'y' })).status, 400)
    assert.equal((await post('/voice/status', { identifier: 'x', lookupCode: 'y' })).status, 400)
  }
  assert.equal((await post('/voice/status', { identifier: 'x', lookupCode: 'y' })).status, 429)
  assert.equal((await post('/applications/track', { identifier: 'x', lookupCode: 'y' })).status, 429)
})
