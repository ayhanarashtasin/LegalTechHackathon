import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { after, before, test } from 'node:test'
import mongoose from 'mongoose'
import app from './app.js'
import * as models from './models/index.js'
import { hashPassword } from './utils/password.js'

// A representative's report stays unverified until the applicant herself is reached: only her logged call can verify a
// fact or withdraw the case, and the withdrawal reason is her own statement. Accepting needs no officer justification.
const databaseName = `dlas_applicantconfirm_test_${randomBytes(6).toString('hex')}`
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
    if (mongoose.connection.name !== databaseName || !/^dlas_applicantconfirm_test_[a-f0-9]{12}$/.test(databaseName)) throw new Error('Refusing to remove a non-test database.')
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

test('only the applicant herself can verify a fact or withdraw; acceptance needs no reason', async () => {
  const officer = await actor('confirm.officer', 'DLAO_OFFICER')
  const helpline = await actor('confirm.helpline', 'HELPLINE_AGENT')
  const { applicationId } = (await request('/api/applications', { method: 'POST', token: helpline, body: { applicantName: 'Fictional applicant' } })).data
  const base = `/api/applications/${applicationId}`
  assert.equal((await request(`${base}/safe-contact`, { method: 'POST', token: officer, body: {
    allowedChannels: ['PHONE'], prohibitedChannels: ['SMS'], contactValue: '01700000000', safeTimeWindow: 'Weekday morning', smsSafe: false, neutralWordingRequired: true,
  } })).status, 201)

  // The Bibadi stands in from the case file until an officer records one.
  const who = await request(`${base}/facts`, { method: 'POST', token: officer, body: { field: 'incident.who', value: 'Fictional husband', sourceType: 'STAFF_ENTERED' } })
  assert.equal(who.status, 201)
  assert.equal((await request(base, { token: officer })).data.respondentFromCaseFile, 'Fictional husband')

  // Accepting without a reason works; the audit still carries a standard note.
  assert.equal((await request(`${base}/review`, { method: 'POST', token: officer, body: { reviewState: 'READY_FOR_DECISION', reason: 'Fictional review before acceptance.' } })).status, 200)
  const accepted = await request(`${base}/accept`, { method: 'POST', token: officer, body: {} })
  assert.equal(accepted.status, 200, JSON.stringify(accepted.data))
  const acceptEvent = await models.AuditEvent.findOne({ applicationId, action: 'APPLICATION_ACCEPTED' }).lean()
  assert.equal(acceptEvent.reason, 'Accepted by the DLAO officer.')

  const log = (outcome, extra) => request(`${base}/contact-attempts`, { method: 'POST', token: officer, body: { channel: 'PHONE', outcome, reason: 'Fictional call for the confirmation test.', ...extra } })
  const shop = (await log('UNKNOWN_PERSON', { disclosedSensitive: false })).data
  const verify = (body) => request(`${base}/facts/${who.data._id}/verification`, { method: 'POST', token: officer, body })

  // A call that did not reach her cannot verify anything, and a verification needs its call.
  assert.equal((await verify({ verified: true, contactAttemptId: shop.id, note: 'Fictional confirmation note.' })).status, 409)
  assert.equal((await verify({ verified: true, note: 'Fictional confirmation note.' })).status, 400)

  const reached = (await log('APPLICANT_REACHED', { statusExplained: true })).data
  const verified = await verify({ verified: true, contactAttemptId: reached.id, note: 'She confirmed her husband was involved.' })
  assert.equal(verified.status, 201, JSON.stringify(verified.data))
  assert.equal(verified.data.applicantConfirmed, true)
  assert.equal(verified.data.sourceType, 'APPLICANT_CONFIRMED')
  assert.equal(verified.data.revision, 2)

  // Undo is a new revision that returns the earlier source; the old revision can no longer change.
  assert.equal((await verify({ verified: false, note: 'Fictional undo reason.' })).status, 409)
  const undone = await request(`${base}/facts/${verified.data._id}/verification`, { method: 'POST', token: officer, body: { verified: false, note: 'Recorded against the wrong call.' } })
  assert.equal(undone.status, 201, JSON.stringify(undone.data))
  assert.equal(undone.data.applicantConfirmed, false)
  assert.equal(undone.data.sourceType, 'STAFF_ENTERED')
  assert.equal(await models.CaseFact.countDocuments({ applicationId, field: 'incident.who' }), 3)

  // Withdrawal: refused on someone else's word, recorded with her statement on her own call.
  const withdraw = (contactAttemptId) => request(`${base}/withdrawal`, { method: 'POST', token: officer, body: { contactAttemptId, statement: 'I no longer want to pursue this case.' } })
  assert.equal((await withdraw(shop.id)).status, 409)
  const closed = await withdraw(reached.id)
  assert.equal(closed.status, 200, JSON.stringify(closed.data))
  const record = (await request(base, { token: officer })).data
  assert.equal(record.status, 'CANCELLED')
  assert.equal(record.withdrawal.statement, 'I no longer want to pursue this case.')
  assert.equal((await models.Case.findOne({ applicationId }).lean()).status, 'CANCELLED')
  assert.equal(await models.Task.countDocuments({ applicationId, status: 'OPEN' }), 0)
  const event = await models.AuditEvent.findOne({ applicationId, action: 'APPLICATION_WITHDRAWN_BY_APPLICANT' }).lean()
  assert.equal(event.reason, 'I no longer want to pursue this case.')
  assert.equal(event.newState.withdrawnBy, 'APPLICANT')
  assert.equal((await withdraw(reached.id)).status, 409)
})
