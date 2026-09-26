import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { after, before, test } from 'node:test'
import mongoose from 'mongoose'
import app from './app.js'
import * as models from './models/index.js'
import { hashPassword } from './utils/password.js'

// A hearing listed for today surfaces in the DLAO daily queue: the record carries the hearing date and a
// HEARING_TODAY flag with a human-review reason, while cases without a hearing stay unflagged.
const databaseName = `dlas_hearingtoday_test_${randomBytes(6).toString('hex')}`
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
    if (mongoose.connection.name !== databaseName || !/^dlas_hearingtoday_test_[a-f0-9]{12}$/.test(databaseName)) throw new Error('Refusing to remove a non-test database.')
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

async function actor(username, role, officeCode = 'DEMO') {
  const password = randomBytes(24).toString('base64url')
  const user = await models.User.create({ username, displayName: `Fictional ${role}`, passwordHash: await hashPassword(password) })
  await models.RoleAssignment.create({ userId: user._id, role, officeCode })
  const result = await request('/api/auth/login', { method: 'POST', body: { username, password } })
  assert.equal(result.status, 200)
  return { user, token: result.data.token }
}

test('a hearing listed for today appears in the DLAO daily queue with a HEARING_TODAY flag', async (context) => {
  context.mock.timers.enable({ apis: ['Date'], now: new Date('2030-09-26T06:00:00.000Z') })
  const officer = await actor('hearing.officer', 'DLAO_OFFICER')
  const helpline = await actor('hearing.helpline', 'HELPLINE_AGENT')

  async function acceptedApplication(applicantName) {
    const submitted = await request('/api/applications', { method: 'POST', token: helpline.token, body: { applicantName } })
    assert.equal(submitted.status, 201)
    const { applicationId } = submitted.data
    assert.equal((await request(`/api/applications/${applicationId}/review`, { method: 'POST', token: officer.token, body: { reviewState: 'READY_FOR_DECISION', reason: 'Fictional intake reviewed by the authorised demo officer.' } })).status, 200)
    const accepted = await request(`/api/applications/${applicationId}/accept`, { method: 'POST', token: officer.token, body: { reason: 'Fictional case accepted after human review.' } })
    assert.equal(accepted.status, 200)
    return { applicationId, caseId: accepted.data.caseId }
  }

  const today = await acceptedApplication('Fictional Hearing Today')
  const plain = await acceptedApplication('Fictional No Hearing')

  // A fixed midday clock keeps the future hearing on today's Dhaka calendar day.
  const hearingAt = new Date(Date.now() + 2 * 3600000).toISOString()
  assert.equal((await request(`/api/lawyers/applications/${today.applicationId}/case-plan`, { method: 'POST', token: officer.token, body: {
    nextHearingAt: hearingAt, nextAction: 'Appear with the file and confirm the applicant-safe next step.', reason: 'Fictional hearing listed for today by a human officer.',
  } })).status, 200)

  const queue = (await request('/api/workspace?role=DLAO_OFFICER', { token: officer.token })).data
  const listed = queue.records.find((record) => record.applicationId === today.applicationId)
  assert.equal(new Date(listed.nextHearingAt).toISOString(), hearingAt)
  assert.match(listed.flags.find(({ code }) => code === 'HEARING_TODAY').reason, /^A court hearing is listed for today;/)
  assert.equal(queue.report.counts.HEARING_TODAY, 1)

  const unlisted = queue.records.find((record) => record.applicationId === plain.applicationId)
  assert.equal(unlisted.nextHearingAt, null)
  assert.equal(unlisted.flags.some(({ code }) => code === 'HEARING_TODAY'), false)
})
