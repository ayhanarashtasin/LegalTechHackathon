import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { after, before, test } from 'node:test'
import mongoose from 'mongoose'
import app from './app.js'
import * as models from './models/index.js'
import { hashPassword } from './utils/password.js'

const databaseName = `dlas_lawyeraccess_test_${randomBytes(6).toString('hex')}`
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
    if (mongoose.connection.name !== databaseName || !/^dlas_lawyeraccess_test_[a-f0-9]{12}$/.test(databaseName)) throw new Error('Refusing to remove a non-test database.')
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
  return { status: response.status, data: response.status === 204 ? null : await response.json() }
}

async function actor(username, role, officeCode = 'DEMO') {
  const password = randomBytes(24).toString('base64url')
  const user = await models.User.create({ username, displayName: `Fictional ${role}`, passwordHash: await hashPassword(password) })
  await models.RoleAssignment.create({ userId: user._id, role, officeCode })
  const result = await request('/api/auth/login', { method: 'POST', body: { username, password } })
  assert.equal(result.status, 200)
  return { user, token: result.data.token }
}

test('a panel lawyer gets the safe number, transcript, and recording only after accepting the case', async () => {
  const officer = await actor('access.officer', 'DLAO_OFFICER')
  const lawyer = await actor('access.lawyer', 'PANEL_LAWYER')
  const otherLawyer = await actor('access.other', 'PANEL_LAWYER')

  const submitted = await request('/api/applications', { method: 'POST', token: officer.token, body: { applicantName: 'Fictional Access Applicant' } })
  const { applicationId } = submitted.data
  const base = `/api/applications/${applicationId}`
  assert.equal((await request(`${base}/safe-contact`, { method: 'POST', token: officer.token, body: {
    allowedChannels: ['PHONE'], prohibitedChannels: ['SMS'], contactValue: '01700000000', smsSafe: false, neutralWordingRequired: true,
  } })).status, 201)
  await request(`${base}/review`, { method: 'POST', token: officer.token, body: { reviewState: 'READY_FOR_DECISION', reason: 'Fictional review for the access test.' } })
  const { caseId } = (await request(`${base}/accept`, { method: 'POST', token: officer.token, body: { reason: 'Fictional acceptance for the access test.' } })).data
  const offer = await request(`/api/lawyers/applications/${applicationId}/assignments`, { method: 'POST', token: officer.token, body: {
    lawyerUserId: lawyer.user.id, reason: 'Fictional offer for the access test.',
  } })
  assert.equal(offer.status, 201)

  // An offer is enough to judge the case, not to hold the applicant's safe number or recorded words.
  for (const path of ['safe-contact', 'transcript', 'recording']) assert.equal((await request(`${base}/${path}`, { token: lawyer.token })).status, 403, path)
  const pendingCase = await request(`/api/cases/${caseId}`, { token: lawyer.token })
  assert.equal(pendingCase.status, 200)
  assert.equal(pendingCase.data.assignmentStatus, 'PENDING')
  for (const hidden of ['safeContact', 'transcript', 'hasRecording']) assert.equal(hidden in pendingCase.data, false, hidden)
  assert.equal(JSON.stringify(pendingCase.data).includes('01700000000'), false)

  assert.equal((await request(`/api/lawyers/assignments/${offer.data.assignmentId}/respond`, { method: 'POST', token: lawyer.token, body: {
    decision: 'ACCEPT', reason: 'Fictional lawyer accepts for the access test.',
  } })).status, 200)
  const safeContact = await request(`${base}/safe-contact`, { token: lawyer.token })
  assert.equal(safeContact.status, 200)
  assert.equal(safeContact.data.contactValue, '01700000000')
  assert.equal((await request(`/api/cases/${caseId}`, { token: lawyer.token })).data.safeContact.contactValue, '01700000000')

  // A lawyer with no assignment on this case sees none of it.
  assert.equal((await request(`${base}/safe-contact`, { token: otherLawyer.token })).status, 403)
  assert.equal((await request(`/api/cases/${caseId}`, { token: otherLawyer.token })).status, 403)
})

test('signing in by a role word reaches only that fixed demo account, never an arbitrary account of that type', async () => {
  const password = randomBytes(24).toString('base64url')
  await models.User.create({ username: 'real.officer', displayName: 'Fictional real officer', userType: 'dlao', passwordHash: await hashPassword(password) })
  // No demo.officer exists in this database, so "dlao" must not fall through to real.officer.
  assert.equal((await request('/api/auth/login', { method: 'POST', body: { username: 'dlao', password } })).status, 401)
  assert.equal((await request('/api/auth/login', { method: 'POST', body: { username: 'real.officer', password } })).status, 200)
})
