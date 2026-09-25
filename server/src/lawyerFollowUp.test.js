import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { after, before, test } from 'node:test'
import mongoose from 'mongoose'
import app from './app.js'
import * as models from './models/index.js'
import { sweepOverdueLawyerUpdates } from './services/lawyerService.js'
import { hashPassword } from './utils/password.js'

// An overdue panel-lawyer update: the officer sees how late it is, asks for it with one click instead of a phone
// call (a reminder on the lawyer's own worklist, at most once a day), and can review the lawyer's record across cases.
const databaseName = `dlas_lawyerfollowup_test_${randomBytes(6).toString('hex')}`
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
    if (mongoose.connection.name !== databaseName || !/^dlas_lawyerfollowup_test_[a-f0-9]{12}$/.test(databaseName)) throw new Error('Refusing to remove a non-test database.')
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

async function actor(username, role, officeCode = 'DEMO', displayName = `Fictional ${role}`) {
  const password = randomBytes(24).toString('base64url')
  const user = await models.User.create({ username, displayName, passwordHash: await hashPassword(password) })
  await models.RoleAssignment.create({ userId: user._id, role, officeCode })
  return { user, token: (await request('/api/auth/login', { method: 'POST', body: { username, password } })).data.token }
}

test('an update five days overdue is shown as such, requested once a day without a call, and seen by the lawyer', async () => {
  const officer = await actor('follow.officer', 'DLAO_OFFICER')
  const outsider = await actor('follow.outsider', 'DLAO_OFFICER', 'OTHER')
  const helpline = await actor('follow.helpline', 'HELPLINE_AGENT')
  const lawyer = await actor('follow.lawyer', 'PANEL_LAWYER', 'DEMO', 'Fictional Adv. Rahman')

  const { applicationId } = (await request('/api/applications', { method: 'POST', token: helpline.token, body: { applicantName: 'Fictional Abdul Malek' } })).data
  await request(`/api/applications/${applicationId}/review`, { method: 'POST', token: officer.token, body: { reviewState: 'READY_FOR_DECISION', reason: 'Fictional intake reviewed by the demo officer.' } })
  const { caseId } = (await request(`/api/applications/${applicationId}/accept`, { method: 'POST', token: officer.token, body: { reason: 'Fictional case accepted after human review.' } })).data
  const { assignmentId } = (await request(`/api/lawyers/applications/${applicationId}/assignments`, { method: 'POST', token: officer.token, body: { lawyerUserId: lawyer.user.id, reason: 'Fictional panel assignment for the follow-up test.' } })).data
  await request(`/api/lawyers/assignments/${assignmentId}/respond`, { method: 'POST', token: lawyer.token, body: { decision: 'ACCEPT', reason: 'I accept this fictional assignment.' } })
  const schedule = async (offset) => (await request(`/api/lawyers/applications/${applicationId}/update-schedules`, { method: 'POST', token: officer.token, body: {
    assignmentId, dueAt: new Date(Date.now() + offset).toISOString(), instruction: 'Report the fictional hearing preparation.',
  } })).data.id
  const overdueId = await schedule(60000)
  const upcomingId = await schedule(7 * 86400000)
  // Required on 20 September, today 25 September: five whole days late.
  await models.LawyerUpdate.updateOne({ _id: overdueId }, { $set: { dueAt: new Date(Date.now() - 5 * 86400000 - 3600000) } })
  assert.equal(await sweepOverdueLawyerUpdates(new Date()), 1)

  const queue = (await request('/api/workspace?role=DLAO_OFFICER', { token: officer.token })).data.records.find((record) => record.applicationId === applicationId)
  assert.match(queue.flags.find(({ code }) => code === 'LAWYER_UPDATE_OVERDUE').reason, /^1 mandatory panel-lawyer update is overdue \(the oldest by 5 days\);/)
  const management = (await request(`/api/lawyers/applications/${applicationId}`, { token: officer.token })).data
  assert.equal(management.applicantName, 'Fictional Abdul Malek')
  assert.deepEqual(management.updates.map(({ status, reminderCount }) => [status, reminderCount]), [['MISSED', 0], ['PENDING', 0]])

  // Only an officer of the owning office can ask, only for an overdue update, and at most once a day.
  const remind = (token, updateId = overdueId) => request(`/api/lawyers/applications/${applicationId}/updates/${updateId}/reminders`, { method: 'POST', token })
  assert.equal((await remind(lawyer.token)).status, 403)
  assert.equal((await remind(outsider.token)).status, 403)
  assert.equal((await remind(officer.token, upcomingId)).data.error.code, 'UPDATE_NOT_OVERDUE')
  const sent = await remind(officer.token)
  assert.equal(sent.status, 201)
  assert.deepEqual([sent.data.daysOverdue, sent.data.reminderCount], [5, 1])
  assert.equal((await remind(officer.token)).data.error.code, 'REMINDER_RECENT')

  // The lawyer sees the request on their worklist and case page: how often and when, not which officer.
  const worklist = (await request('/api/lawyers/worklist', { token: lawyer.token })).data.records.find((record) => record.applicationId === applicationId)
  assert.equal(worklist.updates.find(({ id }) => id === overdueId).reminderCount, 1)
  const lawyerCase = (await request(`/api/cases/${caseId}`, { token: lawyer.token })).data
  const seen = lawyerCase.updates.find(({ _id }) => _id === overdueId)
  assert.equal(seen.reminderCount, 1)
  assert.ok(seen.lastRemindedAt)
  assert.equal('reminders' in seen, false)

  const activityPath = `/api/lawyers/panel-lawyers/${lawyer.user.id}/activity`
  const activity = (await request(activityPath, { token: officer.token })).data
  assert.equal(activity.lawyerName, 'Fictional Adv. Rahman')
  assert.deepEqual([activity.activeCases, activity.pastCases, activity.remindersSent, activity.lastReportAt, activity.hold], [1, 0, 1, null, null])
  assert.deepEqual(activity.updates, { onTime: 0, late: 0, overdue: 1, upcoming: 1 })
  assert.deepEqual(activity.cases, [{ caseId, assignmentStatus: 'ACCEPTED', overdueUpdates: 1, oldestOverdueDays: 5 }])
  assert.equal((await request(activityPath, { token: outsider.token })).status, 404)
  assert.equal((await request(activityPath, { token: lawyer.token })).status, 403)

  // Once the lawyer reports, the update is late but no longer requestable.
  await request(`/api/lawyers/assignments/${assignmentId}/updates/${overdueId}`, { method: 'POST', token: lawyer.token, body: {
    report: 'The fictional hearing preparation is complete.', nextAction: 'The officer confirms the next safe step.',
  } })
  assert.equal((await remind(officer.token)).data.error.code, 'UPDATE_NOT_OVERDUE')
  assert.deepEqual((await request(activityPath, { token: officer.token })).data.updates, { onTime: 0, late: 1, overdue: 0, upcoming: 1 })
  const audit = (await request(`/api/applications/${applicationId}/audit`, { token: officer.token })).data
  assert.equal(audit.valid, true)
  assert.ok(audit.events.some(({ action, newState }) => action === 'LAWYER_UPDATE_REMINDER_SENT' && newState.daysOverdue === 5 && newState.reminderCount === 1))
})
