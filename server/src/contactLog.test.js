import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { after, before, test } from 'node:test'
import mongoose from 'mongoose'
import app from './app.js'
import * as models from './models/index.js'
import { hashPassword } from './utils/password.js'

// The contact log answers "how often did we try, and what came of it?": who answered, whether anything reached
// someone else (stated, never assumed), whether the status was explained, and a dated next attempt.
const databaseName = `dlas_contactlog_test_${randomBytes(6).toString('hex')}`
const server = createServer(app)
let baseUrl

before(async () => {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/dlas', { dbName: databaseName, serverSelectionTimeoutMS: 10000 })
  await Promise.all(Object.values(models).map((item) => item.init()))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  server.closeAllConnections()
  server.close()
  if (mongoose.connection.readyState === 1) {
    if (mongoose.connection.name !== databaseName || !/^dlas_contactlog_test_[a-f0-9]{12}$/.test(databaseName)) throw new Error('Refusing to remove a non-test database.')
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

async function actor(username, role) {
  const password = randomBytes(24).toString('base64url')
  const user = await models.User.create({ username, displayName: `Fictional ${role}`, passwordHash: await hashPassword(password) })
  await models.RoleAssignment.create({ userId: user._id, role, officeCode: 'DEMO' })
  return (await request('/api/auth/login', { method: 'POST', body: { username, password } })).data.token
}

test('a failed shop-phone call, its dated retry, and the call that reached the applicant are all on the record', async () => {
  const officer = await actor('contact.officer', 'DLAO_OFFICER')
  const helpline = await actor('contact.helpline', 'HELPLINE_AGENT')
  const { applicationId } = (await request('/api/applications', { method: 'POST', token: helpline, body: { applicantName: 'Fictional shop-phone applicant' } })).data
  const base = `/api/applications/${applicationId}`
  assert.equal((await request(`${base}/safe-contact`, { method: 'POST', token: officer, body: {
    allowedChannels: ['PHONE', 'IN_PERSON'], prohibitedChannels: ['SMS'], contactValue: 'Fictional shop number', safeTimeWindow: 'Weekdays 3-5 pm', smsSafe: false, neutralWordingRequired: true,
  } })).status, 201)
  const log = (body) => request(`${base}/contact-attempts`, { method: 'POST', token: officer, body: { channel: 'PHONE', reason: 'Fictional contact attempt for the log test.', ...body } })
  const tomorrow = new Date(Date.now() + 86400000)
  tomorrow.setUTCHours(9, 0, 0, 0)

  // Nothing is assumed: someone else answering needs the officer's word on disclosure; a reached applicant needs
  // whether the status was explained; a next attempt belongs only to an unsuccessful attempt, and in the future.
  for (const body of [
    { outcome: 'UNKNOWN_PERSON' },
    { outcome: 'APPLICANT_REACHED' },
    { outcome: 'NO_ANSWER', disclosedSensitive: false },
    { outcome: 'APPLICANT_REACHED', statusExplained: true, answeredByNote: 'Shop owner' },
    { outcome: 'APPLICANT_REACHED', statusExplained: true, nextAttemptAt: tomorrow.toISOString() },
    { outcome: 'NO_ANSWER', nextAttemptAt: '2020-01-01T09:00:00.000Z' },
  ]) assert.equal((await log(body)).status, 400, JSON.stringify(body))

  const shop = await log({ outcome: 'UNKNOWN_PERSON', answeredByNote: 'Shop owner', disclosedSensitive: false, nextAttemptAt: tomorrow.toISOString() })
  assert.equal(shop.status, 201)
  assert.equal(shop.data.answeredBy, 'SOMEONE_ELSE')
  assert.equal(shop.data.disclosureTaskId, null)
  const retry = await models.Task.findById(shop.data.followUpTaskId).lean()
  assert.equal(retry.title, 'Plan safer follow-up')
  assert.equal(retry.dueAt.toISOString(), tomorrow.toISOString())

  const silent = await log({ outcome: 'NO_ANSWER', nextAttemptAt: tomorrow.toISOString() })
  assert.equal((await models.Task.findById(silent.data.followUpTaskId).lean()).title, 'Try the applicant again')

  // A slip is recorded as one, with its own review task, rather than hidden behind a default "no".
  const slip = await log({ outcome: 'UNKNOWN_PERSON', answeredByNote: 'Neighbour', disclosedSensitive: true })
  assert.equal(slip.data.disclosedSensitive, true)
  const review = await models.Task.findById(slip.data.disclosureTaskId).lean()
  assert.equal(review.title, 'Review a disclosure')
  assert.match((await models.Task.findById(slip.data.followUpTaskId).lean()).nextAction, /case details were disclosed/)

  const reached = await log({ outcome: 'APPLICANT_REACHED', statusExplained: true })
  assert.equal(reached.data.answeredBy, 'APPLICANT')
  assert.equal(reached.data.followUpTaskId, null)

  const history = (await request(`${base}/contact-attempts`, { token: officer })).data
  assert.equal(history.length, 4)
  assert.deepEqual(history.map(({ outcome, answeredBy }) => [outcome, answeredBy]),
    [['APPLICANT_REACHED', 'APPLICANT'], ['UNKNOWN_PERSON', 'SOMEONE_ELSE'], ['NO_ANSWER', 'NOBODY'], ['UNKNOWN_PERSON', 'SOMEONE_ELSE']])
  assert.equal(history.at(-1).answeredByNote, 'Shop owner')
  assert.equal(new Date(history.at(-1).nextAttemptAt).toISOString(), tomorrow.toISOString())
  const audit = (await request(`${base}/audit`, { token: officer })).data
  assert.equal(audit.valid, true)
  assert.ok(audit.events.some(({ action, newState }) => action === 'CONTACT_ATTEMPT_LOGGED' && newState.disclosedSensitive === true && newState.disclosureTaskId))
  assert.equal((await request(`${base}/safe-contact`, { token: officer })).data.neutralScript.includes('পরে আবার ফোন করব'), true)
})
