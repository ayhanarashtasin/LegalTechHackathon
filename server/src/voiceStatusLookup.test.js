import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { after, before, test } from 'node:test'
import mongoose from 'mongoose'
import app from './app.js'
import * as models from './models/index.js'
import { lookupHash } from './services/applicationService.js'
import { hashPassword } from './utils/password.js'

// The spoken status route against a real record: the same ID-and-code check as the typed tracker, a fixed-template
// sentence that names nobody, and a per-ID lockout that holds even when attempts come from many addresses.
const databaseName = `dlas_voicestatus_test_${randomBytes(6).toString('hex')}`
const server = createServer(app)
const spoken = []
const speech = createServer((request, response) => {
  let body = ''
  request.on('data', (chunk) => { body += chunk })
  request.on('end', () => {
    spoken.push(JSON.parse(body).text)
    response.writeHead(200, { 'content-type': 'audio/mpeg' }).end('fake-mp3')
  })
})
let baseUrl

before(async () => {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/dlas', { dbName: databaseName, serverSelectionTimeoutMS: 10000 })
  await Promise.all(Object.values(models).map((item) => item.init()))
  await Promise.all([server, speech].map((listener) => new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve))))
  baseUrl = `http://127.0.0.1:${server.address().port}`
  process.env.TTS_URL = `http://127.0.0.1:${speech.address().port}`
  delete process.env.VOICE_TTS
})

after(async () => {
  for (const listener of [server, speech]) { listener.closeAllConnections(); listener.close() }
  if (mongoose.connection.readyState === 1) {
    if (mongoose.connection.name !== databaseName || !/^dlas_voicestatus_test_[a-f0-9]{12}$/.test(databaseName)) throw new Error('Refusing to remove a non-test database.')
    await mongoose.connection.dropDatabase()
    await mongoose.disconnect()
  }
})

async function request(path, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { status: response.status, data: await response.json() }
}

test('a caller hears the status of their own record, and wrong codes lock that ID', async () => {
  const password = randomBytes(24).toString('base64url')
  const user = await models.User.create({ username: 'voice.helpline', displayName: 'Fictional HELPLINE_AGENT', passwordHash: await hashPassword(password) })
  await models.RoleAssignment.create({ userId: user._id, role: 'HELPLINE_AGENT', officeCode: 'DEMO' })
  const { token } = (await request('/api/auth/login', { method: 'POST', body: { username: 'voice.helpline', password } })).data
  const submitted = await request('/api/applications', { method: 'POST', token, body: { applicantName: 'Fictional Voice Caller' } })
  assert.equal(submitted.status, 201)
  const { applicationId } = submitted.data
  // The caller holds a spoken 6-digit PIN, as the seeded Malek case does.
  await models.Application.updateOne({ applicationId }, { $set: { lookupCodeHash: lookupHash('482915') } })
  const status = (lookupCode, identifier = applicationId) => request('/api/voice/status', { method: 'POST', body: { identifier, lookupCode } })

  const heard = await status('482915')
  assert.equal(heard.status, 200)
  assert.equal(heard.data.result.applicationId, applicationId)
  assert.equal(heard.data.sentence, 'আপনার আবেদনটি একজন কর্মকর্তা যাচাই করছেন। এখনো কোনো সিদ্ধান্ত হয়নি।')
  assert.equal(Buffer.from(heard.data.audio, 'base64').toString(), 'fake-mp3')
  assert.deepEqual(spoken, [heard.data.sentence])

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const wrong = await status(String(100000 + attempt))
    assert.equal(wrong.status, 404)
    assert.equal(wrong.data.error.code, 'NOT_FOUND')
  }
  assert.equal(spoken.length, 1, 'nothing is spoken for a wrong code')
  // Locked: even the right code is refused, on the spoken and the typed route alike.
  assert.equal((await status('482915')).data.error.code, 'TOO_MANY_ATTEMPTS')
  const typed = await request('/api/applications/track', { method: 'POST', body: { identifier: applicationId, lookupCode: '482915' } })
  assert.equal(typed.data.error.code, 'TOO_MANY_ATTEMPTS')
  // Another ID is not locked, and an ID that does not exist answers like any wrong code.
  assert.equal((await status('482915', 'APP-2026-999999')).data.error.code, 'NOT_FOUND')
})
