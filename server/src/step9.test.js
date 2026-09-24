import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { after, before, test } from 'node:test'
import mongoose from 'mongoose'
import app from './app.js'
import * as models from './models/index.js'
import { sweepOverdueLawyerUpdates } from './services/lawyerService.js'
import { hashPassword } from './utils/password.js'

const databaseName = `dlas_step9_test_${randomBytes(6).toString('hex')}`
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
    if (mongoose.connection.name !== databaseName || !/^dlas_step9_test_[a-f0-9]{12}$/.test(databaseName)) throw new Error('Refusing to remove a non-test database.')
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

test('Step 9: status, missed updates, temporary hold, separate human reassignment, and reconciliation', async () => {
  const officer = await actor('test9.officer', 'DLAO_OFFICER')
  const outsideOfficer = await actor('test9.outside', 'DLAO_OFFICER', 'OTHER')
  const helpline = await actor('test9.helpline', 'HELPLINE_AGENT')
  const lawyer = await actor('test9.lawyer', 'PANEL_LAWYER')
  const replacement = await actor('test9.replacement', 'PANEL_LAWYER')

  async function acceptedApplication(applicantName) {
    const submitted = await request('/api/applications', { method: 'POST', token: helpline.token, body: { applicantName } })
    assert.equal(submitted.status, 201)
    const { applicationId, lookupCode } = submitted.data
    assert.equal((await request(`/api/applications/${applicationId}/review`, { method: 'POST', token: officer.token, body: { reviewState: 'READY_FOR_DECISION', reason: 'Fictional intake reviewed by the authorised demo officer.' } })).status, 200)
    const accepted = await request(`/api/applications/${applicationId}/accept`, { method: 'POST', token: officer.token, body: { reason: 'Fictional case accepted after human review.' } })
    assert.equal(accepted.status, 200)
    return { applicationId, caseId: accepted.data.caseId, lookupCode }
  }

  const { applicationId, caseId, lookupCode } = await acceptedApplication('Fictional Malek Step 9')
  const base = `/api/applications/${applicationId}`
  assert.equal((await request(`${base}/safe-contact`, { method: 'POST', token: officer.token, body: {
    allowedChannels: ['IN_PERSON'], prohibitedChannels: ['PHONE', 'SMS'], safeTimeWindow: 'Caller-initiated in-person lookup only', smsSafe: false, neutralWordingRequired: true,
  } })).status, 201)
  const failedContact = await request(`${base}/contact-attempts`, { method: 'POST', token: officer.token, body: {
    channel: 'PHONE', outcome: 'UNKNOWN_PERSON', reason: 'Fictional shop contact attempt: another person answered; nothing about the case was disclosed.',
  } })
  assert.equal(failedContact.data.disclosedSensitive, false)
  assert.ok((await request(`${base}/tasks`, { token: officer.token })).data.some(({ kind, status }) => kind === 'FOLLOW_UP' && status === 'OPEN'))

  const hearing = new Date(Date.now() + 14 * 86400000).toISOString()
  const nextAction = 'Visit the office before the hearing; confirm a safe travel plan first.'
  assert.equal((await request(`/api/lawyers/applications/${applicationId}/case-plan`, { method: 'POST', token: officer.token, body: {
    nextHearingAt: hearing, nextAction, reason: 'Fictional case plan recorded by a human officer.',
  } })).status, 200)
  const offered = await request(`/api/lawyers/applications/${applicationId}/assignments`, { method: 'POST', token: officer.token, body: {
    lawyerUserId: lawyer.user.id, reason: 'Fictional panel assignment after case acceptance.',
  } })
  assert.equal(offered.status, 201)
  assert.equal((await request(`/api/lawyers/assignments/${offered.data.assignmentId}/respond`, { method: 'POST', token: lawyer.token, body: {
    decision: 'ACCEPT', reason: 'I accept this fictional panel-lawyer assignment.',
  } })).data.status, 'ACCEPTED')

  for (const offset of [30000, 31000]) {
    const scheduled = await request(`/api/lawyers/applications/${applicationId}/update-schedules`, { method: 'POST', token: officer.token, body: {
      assignmentId: offered.data.assignmentId, dueAt: new Date(Date.now() + offset).toISOString(), instruction: 'Send a mandatory case progress update to the DLAO.',
    } })
    assert.equal(scheduled.status, 201)
  }
  const sweepAt = new Date(Date.now() + 60000)
  assert.equal(await sweepOverdueLawyerUpdates(sweepAt), 2)
  assert.equal(await sweepOverdueLawyerUpdates(sweepAt), 0)
  const hold = await models.PanelLawyerHold.findOne({ lawyerUserId: lawyer.user._id }).lean()
  assert.equal(hold.newAssignmentHold, true)
  assert.equal(hold.reviewState, 'PENDING_REVIEW')
  assert.equal(hold.missedUpdateIds.length, 2)
  assert.equal(await models.Task.countDocuments({ applicationId, kind: 'LAWYER_PATTERN_REVIEW', status: 'OPEN' }), 1)
  assert.equal((await models.LawyerAssignment.findById(offered.data.assignmentId)).status, 'ACCEPTED')
  assert.equal((await models.Case.findOne({ applicationId })).status, 'OPEN')

  const statusLookup = (contactChannel, callerVerified = true) => request('/api/applications/status-lookup', { method: 'POST', token: helpline.token, body: {
    identifier: caseId, lookupCode, callerVerified, contactChannel,
  } })
  assert.equal((await statusLookup('PHONE')).data.error.code, 'UNSAFE_CONTACT')
  assert.equal((await statusLookup('IN_PERSON', false)).status, 400)
  const status = await statusLookup('IN_PERSON')
  assert.equal(status.data.nextHearingAt, hearing)
  assert.equal(status.data.nextAction, nextAction)
  assert.equal(Object.hasOwn(status.data, 'complaint'), false)
  const worklist = await request('/api/lawyers/worklist', { token: lawyer.token })
  assert.equal(worklist.data.records.find(({ caseId: id }) => id === caseId).updates.length, 2)

  const change = await request(`/api/lawyers/applications/${applicationId}/change-requests`, { method: 'POST', token: helpline.token, body: {
    lookupCode, callerVerified: true, contactChannel: 'IN_PERSON', reason: 'The applicant asks for another lawyer to review the file.',
  } })
  assert.equal(change.status, 201)
  assert.equal(change.data.status, 'OPEN')
  assert.equal((await models.LawyerAssignment.findById(offered.data.assignmentId)).status, 'ACCEPTED')
  assert.equal((await request(`/api/lawyers/applications/${applicationId}/change-requests/${change.data.requestId}/review`, { method: 'POST', token: officer.token, body: {
    decision: 'APPROVE', reason: 'DLAO reviewed the request; a replacement offer is a separate action.',
  } })).data.reassignmentRequired, true)
  const replacementOffer = await request(`/api/lawyers/applications/${applicationId}/assignments`, { method: 'POST', token: officer.token, body: {
    lawyerUserId: replacement.user.id, changeRequestId: change.data.requestId, reason: 'Human DLAO offers a replacement after approving the request.',
  } })
  assert.equal(replacementOffer.status, 201)
  assert.equal((await models.LawyerAssignment.findById(offered.data.assignmentId)).status, 'ACCEPTED')
  assert.equal((await request(`/api/lawyers/assignments/${replacementOffer.data.assignmentId}/respond`, { method: 'POST', token: replacement.token, body: {
    decision: 'ACCEPT', reason: 'I accept the replacement panel assignment.',
  } })).data.status, 'ACCEPTED')
  const oldAssignment = await models.LawyerAssignment.findById(offered.data.assignmentId)
  assert.equal(oldAssignment.status, 'REASSIGNED')
  assert.equal(oldAssignment.active, false)
  assert.equal((await models.Case.findOne({ applicationId })).status, 'OPEN')
  const payment = await request(`/api/lawyers/assignments/${oldAssignment.id}/payment-status`, { method: 'POST', token: officer.token, body: {
    stage: 'HEARING_ATTENDANCE', status: 'UNDER_REVIEW', reason: 'Reconcile recorded work for the prior accepted assignment.',
  } })
  assert.equal(payment.status, 201)
  assert.equal(payment.data.moneyMoved, false)
  const secondPayment = await request(`/api/lawyers/assignments/${oldAssignment.id}/payment-status`, { method: 'POST', token: officer.token, body: {
    stage: 'RECONCILIATION', status: 'RECONCILED', reason: 'Human officer recorded a separate reconciliation stage.',
  } })
  assert.equal(secondPayment.status, 201)
  const paymentView = await request(`/api/lawyers/applications/${applicationId}`, { token: officer.token })
  const oldPaymentHistory = paymentView.data.assignments.find(({ id }) => id === oldAssignment.id).paymentHistory
  assert.deepEqual(oldPaymentHistory.map(({ stage }) => stage), ['RECONCILIATION', 'HEARING_ATTENDANCE'])

  const second = await acceptedApplication('Fictional second case')
  const assign = (body) => request(`/api/lawyers/applications/${second.applicationId}/assignments`, { method: 'POST', token: officer.token, body })
  const blocked = await assign({ lawyerUserId: lawyer.user.id, reason: 'Attempt to assign the temporarily held panel lawyer.' })
  assert.equal(blocked.status, 409)
  assert.equal(blocked.data.error.code, 'LAWYER_ON_HOLD')
  const reviewHold = (decision, reason) => request(`/api/lawyers/holds/${lawyer.user.id}/review`, { method: 'POST', token: officer.token, body: { decision, reason } })
  assert.equal((await reviewHold('CONTINUE', 'Continue the temporary hold pending human review.')).data.newAssignmentHold, true)
  assert.equal((await assign({ lawyerUserId: lawyer.user.id, reason: 'Attempt remains blocked while the human reviewer continues the hold.' })).data.error.code, 'LAWYER_ON_HOLD')
  assert.equal((await reviewHold('LIFT', 'Lift the temporary hold after human review.')).data.newAssignmentHold, false)
  assert.equal((await assign({ lawyerUserId: lawyer.user.id, reason: 'DLAO issued a separate offer after human hold review.' })).status, 201)

  assert.equal((await request(`/api/lawyers/applications/${applicationId}`, { token: outsideOfficer.token })).status, 403)
  const trail = await request(`${base}/audit`, { token: officer.token })
  assert.equal(trail.data.valid, true)
  for (const action of ['LAWYER_UPDATE_MISSED', 'LAWYER_NEW_ASSIGNMENT_HOLD_TRIGGERED', 'LAWYER_CHANGE_REQUEST_REVIEWED', 'PANEL_LAWYER_ACCEPTED', 'LAWYER_PAYMENT_STATUS_RECORDED', 'LAWYER_ASSIGNMENT_HOLD_REVIEWED']) assert.ok(trail.data.events.some(({ action: value }) => value === action), action)
  const serialized = JSON.stringify(trail.data.events).toLowerCase()
  assert.equal(serialized.includes('guilty'), false)
  assert.equal(serialized.includes('misconduct established'), false)
})

test('T1 citizen portal: owner request, human replacement, stage history, and audit', async () => {
  const officer = await actor('test9.portal.officer', 'DLAO_OFFICER')
  const lawyer = await actor('test9.portal.lawyer', 'PANEL_LAWYER')
  const replacement = await actor('test9.portal.replacement', 'PANEL_LAWYER')
  const register = (username) => request('/api/auth/register', { method: 'POST', body: {
    username, password: 'fictional-test-password', name: 'Fictional Citizen Malek',
  } })
  const owner = await register('test9.portal.owner')
  const other = await register('test9.portal.other')
  assert.equal(owner.status, 201)
  assert.equal(other.status, 201)
  const submitted = await request('/api/citizen/applications', { method: 'POST', token: owner.data.token, body: {
    applicantName: 'Fictional Abdul Malek', problem: 'The appointed panel lawyer has not responded about the hearing.',
    district: 'Barguna', urgent: false, identityDocument: 'NONE', contactPhone: '',
  } })
  assert.equal(submitted.status, 201)
  const { applicationId } = submitted.data
  const casePath = `/api/citizen/cases/${applicationId}/lawyer-change`
  const ownCases = await request('/api/citizen/cases', { token: owner.data.token })
  assert.equal(ownCases.data.cases[0].applicantName, 'Fictional Abdul Malek')
  assert.equal(ownCases.data.cases[0].intakeChannel, 'WEB')
  assert.equal((await request('/api/citizen/cases', { token: other.data.token })).data.cases.length, 0)
  assert.equal((await request(`/api/applications/${applicationId}/audit`, { token: officer.token })).data.valid, true)

  assert.equal((await request(`/api/applications/${applicationId}/review`, { method: 'POST', token: officer.token, body: {
    reviewState: 'READY_FOR_DECISION', reason: 'Fictional citizen application reviewed by the DLAO officer.',
  } })).status, 200)
  const accepted = await request(`/api/applications/${applicationId}/accept`, { method: 'POST', token: officer.token, body: {
    reason: 'Fictional citizen application accepted after human review.',
  } })
  assert.equal(accepted.status, 200)
  const offer = await request(`/api/lawyers/applications/${applicationId}/assignments`, { method: 'POST', token: officer.token, body: {
    lawyerUserId: lawyer.user.id, reason: 'DLAO offers the first fictional panel assignment.',
  } })
  assert.equal(offer.status, 201)
  assert.equal((await request(casePath, { method: 'POST', token: owner.data.token, body: { reason: 'A pending offer is not representation.' } })).data.error.code, 'NO_ACTIVE_LAWYER')
  assert.equal((await request(`/api/lawyers/assignments/${offer.data.assignmentId}/respond`, { method: 'POST', token: lawyer.token, body: {
    decision: 'ACCEPT', reason: 'Fictional lawyer accepts the panel assignment.',
  } })).status, 200)
  assert.equal((await request(casePath, { method: 'POST', token: other.data.token, body: {
    reason: 'I must not change another citizen case.',
  } })).status, 404)
  assert.equal((await request(casePath, { method: 'POST', token: owner.data.token, body: {
    reason: 'x', unexpected: true,
  } })).status, 400)
  assert.equal((await request('/api/citizen/cases/APP-bad/lawyer-change', { method: 'POST', token: owner.data.token, body: {
    reason: 'The lawyer has not responded.',
  } })).status, 400)
  assert.equal(await models.LawyerChangeRequest.countDocuments({ applicationId }), 0)

  const change = await request(casePath, { method: 'POST', token: owner.data.token, body: {
    reason: 'The assigned lawyer missed two hearings and is unreachable.',
  } })
  assert.equal(change.status, 201)
  assert.equal(change.data.status, 'OPEN')
  assert.equal(await models.Task.countDocuments({ applicationId, kind: 'LAWYER_CHANGE_REVIEW', status: 'OPEN' }), 1)
  assert.equal((await request(casePath, { method: 'POST', token: owner.data.token, body: {
    reason: 'This request is already in progress.',
  } })).data.error.code, 'REQUEST_IN_PROGRESS')
  const review = await request(`/api/lawyers/applications/${applicationId}/change-requests/${change.data.requestId}/review`, { method: 'POST', token: officer.token, body: {
    decision: 'APPROVE', reason: 'DLAO approved a separate replacement offer after case review.',
  } })
  assert.equal(review.data.reassignmentRequired, true)
  assert.equal((await request(casePath, { method: 'POST', token: owner.data.token, body: {
    reason: 'The approved request still awaits a replacement.',
  } })).data.error.code, 'REQUEST_IN_PROGRESS')
  const reviewedCases = await request('/api/citizen/cases', { token: owner.data.token })
  assert.equal(reviewedCases.data.cases[0].changeRequests[0].status, 'APPROVED')
  assert.equal(reviewedCases.data.cases[0].lawyer.lawyerName, lawyer.user.displayName)

  const replacementOffer = await request(`/api/lawyers/applications/${applicationId}/assignments`, { method: 'POST', token: officer.token, body: {
    lawyerUserId: replacement.user.id, changeRequestId: change.data.requestId,
    reason: 'DLAO separately offers the replacement after approval.',
  } })
  assert.equal(replacementOffer.status, 201)
  assert.equal((await request(`/api/lawyers/assignments/${replacementOffer.data.assignmentId}/respond`, { method: 'POST', token: replacement.token, body: {
    decision: 'ACCEPT', reason: 'Fictional replacement accepts the case.',
  } })).status, 200)
  assert.equal((await models.LawyerAssignment.findById(offer.data.assignmentId)).status, 'REASSIGNED')
  const completedCases = await request('/api/citizen/cases', { token: owner.data.token })
  assert.equal(completedCases.data.cases[0].changeRequests[0].status, 'COMPLETED')
  assert.equal(completedCases.data.cases[0].lawyer.lawyerName, replacement.user.displayName)
  assert.equal(completedCases.data.cases[0].caseRecord.caseNumber, accepted.data.caseId)

  for (const [stage, status, reason] of [
    ['CASE_PREPARATION', 'SUBMITTED', 'Fictional preparation claim submitted for review.'],
    ['CASE_PREPARATION', 'UNDER_REVIEW', 'Fictional preparation claim under human review.'],
    ['RECONCILIATION', 'RECONCILED', 'Fictional old assignment reconciliation recorded.'],
  ]) {
    const payment = await request(`/api/lawyers/assignments/${offer.data.assignmentId}/payment-status`, { method: 'POST', token: officer.token, body: { stage, status, reason } })
    assert.equal(payment.status, 201)
    assert.equal(payment.data.moneyMoved, false)
  }
  const management = await request(`/api/lawyers/applications/${applicationId}`, { token: officer.token })
  const history = management.data.assignments.find(({ id }) => id === offer.data.assignmentId).paymentHistory
  assert.deepEqual(history.map(({ stage }) => stage), ['RECONCILIATION', 'CASE_PREPARATION', 'CASE_PREPARATION'])
  assert.equal((await request(`/api/applications/${applicationId}/audit`, { token: officer.token })).data.valid, true)
})

test('T1 threshold needs two consecutive missed mandatory updates', async () => {
  const officer = await actor('test9.threshold.officer', 'DLAO_OFFICER')
  const helpline = await actor('test9.threshold.helpline', 'HELPLINE_AGENT')
  const lawyer = await actor('test9.threshold.lawyer', 'PANEL_LAWYER')
  const submitted = await request('/api/applications', { method: 'POST', token: helpline.token, body: { applicantName: 'Fictional threshold case' } })
  const { applicationId } = submitted.data
  await request(`/api/applications/${applicationId}/review`, { method: 'POST', token: officer.token, body: {
    reviewState: 'READY_FOR_DECISION', reason: 'Fictional case checked by the DLAO officer.',
  } })
  await request(`/api/applications/${applicationId}/accept`, { method: 'POST', token: officer.token, body: {
    reason: 'Fictional case accepted by the DLAO officer.',
  } })
  const offer = await request(`/api/lawyers/applications/${applicationId}/assignments`, { method: 'POST', token: officer.token, body: {
    lawyerUserId: lawyer.user.id, reason: 'Fictional threshold assignment offered by DLAO.',
  } })
  assert.equal(offer.status, 201)
  const assignmentId = offer.data.assignmentId
  assert.equal((await request(`/api/lawyers/assignments/${assignmentId}/respond`, { method: 'POST', token: lawyer.token, body: {
    decision: 'ACCEPT', reason: 'Fictional lawyer accepts this threshold case.',
  } })).status, 200)
  const schedule = async (offset) => {
    const result = await request(`/api/lawyers/applications/${applicationId}/update-schedules`, { method: 'POST', token: officer.token, body: {
      assignmentId, dueAt: new Date(Date.now() + offset).toISOString(), instruction: 'Provide the required fictional progress report.',
    } })
    assert.equal(result.status, 201)
    return result.data.id
  }
  await schedule(30000)
  assert.equal(await sweepOverdueLawyerUpdates(new Date(Date.now() + 60000)), 1)
  assert.equal(await models.PanelLawyerHold.countDocuments({ lawyerUserId: lawyer.user.id }), 0)
  const onTimeId = await schedule(120000)
  const onTime = await request(`/api/lawyers/assignments/${assignmentId}/updates/${onTimeId}`, { method: 'POST', token: lawyer.token, body: {
    report: 'The fictional file has been reviewed on time.', nextAction: 'Officer will confirm the next safe step.',
  } })
  assert.equal(onTime.data.status, 'SUBMITTED_ON_TIME')
  await schedule(180000)
  assert.equal(await sweepOverdueLawyerUpdates(new Date(Date.now() + 240000)), 1)
  assert.equal(await models.PanelLawyerHold.countDocuments({ lawyerUserId: lawyer.user.id }), 0)
  await schedule(300000)
  assert.equal(await sweepOverdueLawyerUpdates(new Date(Date.now() + 360000)), 1)
  assert.equal((await models.PanelLawyerHold.findOne({ lawyerUserId: lawyer.user.id })).newAssignmentHold, true)
})
