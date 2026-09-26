import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { after, before, test } from 'node:test'
import mongoose from 'mongoose'
import app from './app.js'
import * as models from './models/index.js'
import { hashPassword } from './utils/password.js'

const databaseName = `dlas_cancellation_test_${randomBytes(6).toString('hex')}`
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
    if (mongoose.connection.name !== databaseName || !/^dlas_cancellation_test_[a-f0-9]{12}$/.test(databaseName)) throw new Error('Refusing to remove a non-test database.')
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

async function citizen(username) {
  const result = await request('/api/auth/register', { method: 'POST', body: { username, password: 'fictional-test-password', name: 'Fictional Citizen' } })
  assert.equal(result.status, 201)
  return result.data
}

test('Cancel: citizen withdraws an un-accepted application immediately, no officer step needed', async () => {
  const owner = await citizen('cancel.owner1')
  const other = await citizen('cancel.other1')

  const submitted = await request('/api/citizen/applications', { method: 'POST', token: owner.token, body: {
    applicantName: 'Fictional Applicant', problem: 'Fictional dispute needing legal aid.', district: 'Dhaka', urgent: false, identityDocument: 'NONE', contactPhone: '',
  } })
  assert.equal(submitted.status, 201)
  const { applicationId } = submitted.data
  const cancelPath = `/api/citizen/cases/${applicationId}/cancel`

  assert.equal((await request(cancelPath, { method: 'POST', token: other.token, body: { reason: 'Not my application.' } })).status, 404)
  assert.equal((await request(cancelPath, { method: 'POST', token: owner.token, body: { reason: 'x' } })).status, 400)

  const cancelled = await request(cancelPath, { method: 'POST', token: owner.token, body: { reason: 'No longer need legal aid; matter resolved privately.' } })
  assert.equal(cancelled.status, 201)
  assert.equal(cancelled.data.status, 'CANCELLED')

  assert.equal((await models.Application.findOne({ applicationId })).status, 'CANCELLED')
  assert.equal(await models.Task.countDocuments({ applicationId, status: 'OPEN' }), 0)

  const again = await request(cancelPath, { method: 'POST', token: owner.token, body: { reason: 'Trying again.' } })
  assert.equal(again.data.error.code, 'ALREADY_CANCELLED')

  const officer = await actor('cancel.officer.audit', 'DLAO_OFFICER')
  const trail = await request(`/api/applications/${applicationId}/audit`, { token: officer.token })
  assert.equal(trail.data.valid, true)
  assert.ok(trail.data.events.some(({ action }) => action === 'APPLICATION_CANCELLED_BY_APPLICANT'))
})

test('Cancel: an accepted case needs DLAO officer approval, is blocked by an active referral, and syncs dependent records once approved', async () => {
  const officer = await actor('cancel.officer2', 'DLAO_OFFICER')
  const outsideOfficer = await actor('cancel.outside2', 'DLAO_OFFICER', 'OTHER')
  const lawyer = await actor('cancel.lawyer2', 'PANEL_LAWYER')
  const owner = await citizen('cancel.owner2')

  const submitted = await request('/api/citizen/applications', { method: 'POST', token: owner.token, body: {
    applicantName: 'Fictional Accepted Applicant', problem: 'Fictional labour dispute.', district: 'Dhaka', urgent: false, identityDocument: 'NONE', contactPhone: '',
  } })
  const { applicationId } = submitted.data
  await request(`/api/applications/${applicationId}/review`, { method: 'POST', token: officer.token, body: {
    reviewState: 'READY_FOR_DECISION', reason: 'Fictional review for cancellation test.',
  } })
  const accepted = await request(`/api/applications/${applicationId}/accept`, { method: 'POST', token: officer.token, body: {
    reason: 'Fictional acceptance for cancellation test.',
  } })
  assert.equal(accepted.status, 200)
  const { caseId } = accepted.data

  const offer = await request(`/api/lawyers/applications/${applicationId}/assignments`, { method: 'POST', token: officer.token, body: {
    lawyerUserId: lawyer.user.id, reason: 'Fictional assignment for cancellation test.',
  } })
  assert.equal((await request(`/api/lawyers/assignments/${offer.data.assignmentId}/respond`, { method: 'POST', token: lawyer.token, body: {
    decision: 'ACCEPT', reason: 'Fictional lawyer accepts.',
  } })).status, 200)
  const scheduled = await request(`/api/lawyers/applications/${applicationId}/update-schedules`, { method: 'POST', token: officer.token, body: {
    assignmentId: offer.data.assignmentId, dueAt: new Date(Date.now() + 86400000).toISOString(), instruction: 'Send a fictional progress update.',
  } })
  assert.equal(scheduled.status, 201)

  const cancelPath = `/api/citizen/cases/${applicationId}/cancel`
  const request1 = await request(cancelPath, { method: 'POST', token: owner.token, body: { reason: 'The dispute has moved to informal mediation outside DLAO.' } })
  assert.equal(request1.status, 201)
  assert.equal(request1.data.status, 'PENDING_REVIEW')
  // The immediate path must not fire once a Case exists.
  assert.equal((await models.Application.findOne({ applicationId })).status, 'ACCEPTED')

  const again = await request(cancelPath, { method: 'POST', token: owner.token, body: { reason: 'Trying again while one is open.' } })
  assert.equal(again.data.error.code, 'REQUEST_IN_PROGRESS')

  // The pending request must be visible in the officer's daily queue, not just on the case's own detail page.
  const workspace = await request('/api/workspace?role=DLAO_OFFICER', { token: officer.token })
  const queued = workspace.data.records.find((record) => record.applicationId === applicationId)
  assert.ok(queued.flags.some((flag) => flag.code === 'CASE_CANCELLATION_REQUESTED'))
  assert.ok(workspace.data.report.counts.CASE_CANCELLATION_REQUESTED >= 1)

  const reviewPath = `/api/applications/${applicationId}/cancellation-requests/${request1.data.requestId}/review`
  assert.equal((await request(reviewPath, { method: 'POST', token: outsideOfficer.token, body: { decision: 'APPROVE', reason: 'Not my office.' } })).status, 403)

  // An active referral must be resolved first; cancellation must not silently orphan the receiving office's work.
  const [referralTask] = await models.Task.create([{
    applicationId, caseId, kind: 'REFERRAL', ownerRole: 'RECEIVING_DLAO', title: 'Fictional referral task', nextAction: 'Acknowledge the fictional referral.',
  }])
  const [referral] = await models.Referral.create([{
    applicationId, caseId, sendingOfficeCode: 'DEMO', receivingOfficeCode: 'OTHER', sentByUserId: officer.user._id, responsibleUserId: officer.user._id,
    reason: 'Fictional referral reason.', history: 'Fictional relevant history.', expectedAction: 'Fictional expected action.',
    dueAt: new Date(Date.now() + 86400000), status: 'SENT', taskId: referralTask._id,
  }])
  const blockedByReferral = await request(reviewPath, { method: 'POST', token: officer.token, body: { decision: 'APPROVE', reason: 'Approve despite open referral.' } })
  assert.equal(blockedByReferral.status, 409)
  assert.equal(blockedByReferral.data.error.code, 'REFERRAL_ACTIVE')
  await models.Referral.updateOne({ _id: referral._id }, { $set: { status: 'RETURNED', respondedAt: new Date(), responseReason: 'Fictional resolution.' } })

  const approved = await request(reviewPath, { method: 'POST', token: officer.token, body: { decision: 'APPROVE', reason: 'Citizen no longer needs legal aid; referral resolved.' } })
  assert.equal(approved.status, 200)
  assert.equal(approved.data.status, 'APPROVED')

  assert.equal((await models.Application.findOne({ applicationId })).status, 'CANCELLED')
  assert.equal((await models.Case.findOne({ caseId })).status, 'CANCELLED')
  assert.equal(await models.Task.countDocuments({ applicationId, status: 'OPEN' }), 0)
  assert.equal((await models.LawyerAssignment.findById(offer.data.assignmentId)).active, false)
  assert.equal((await models.LawyerUpdate.findOne({ assignmentId: offer.data.assignmentId })).status, 'CANCELLED')

  const trail = await request(`/api/applications/${applicationId}/audit`, { token: officer.token })
  assert.equal(trail.data.valid, true)
  for (const action of ['APPLICANT_CASE_CANCELLATION_REQUESTED', 'CASE_CANCELLED']) {
    assert.ok(trail.data.events.some((event) => event.action === action), action)
  }
})

test('Cancel: approval is blocked while a mediation is actively in progress', async () => {
  const officer = await actor('cancel.officer3', 'DLAO_OFFICER')
  const owner = await citizen('cancel.owner3')

  const submitted = await request('/api/citizen/applications', { method: 'POST', token: owner.token, body: {
    applicantName: 'Fictional Mediation Applicant', problem: 'Fictional property dispute.', district: 'Dhaka', urgent: false, identityDocument: 'NONE', contactPhone: '',
  } })
  const { applicationId } = submitted.data
  await request(`/api/applications/${applicationId}/review`, { method: 'POST', token: officer.token, body: {
    reviewState: 'READY_FOR_DECISION', reason: 'Fictional review.',
  } })
  const accepted = await request(`/api/applications/${applicationId}/accept`, { method: 'POST', token: officer.token, body: { reason: 'Fictional acceptance.' } })
  const { caseId } = accepted.data

  await models.Mediation.create({ applicationId, caseId, officeCode: 'DEMO', stage: 'MEDIATION', createdByUserId: officer.user._id })

  const request1 = await request(`/api/citizen/cases/${applicationId}/cancel`, { method: 'POST', token: owner.token, body: { reason: 'Wants to stop the process.' } })
  const reviewPath = `/api/applications/${applicationId}/cancellation-requests/${request1.data.requestId}/review`
  const blocked = await request(reviewPath, { method: 'POST', token: officer.token, body: { decision: 'APPROVE', reason: 'Attempt while mediation is active.' } })
  assert.equal(blocked.status, 409)
  assert.equal(blocked.data.error.code, 'MEDIATION_IN_PROGRESS')

  const declined = await request(reviewPath, { method: 'POST', token: officer.token, body: { decision: 'DECLINE', reason: 'Mediation must conclude first.' } })
  assert.equal(declined.status, 200)
  assert.equal(declined.data.status, 'DECLINED')
  assert.equal((await models.Application.findOne({ applicationId })).status, 'ACCEPTED')
})
