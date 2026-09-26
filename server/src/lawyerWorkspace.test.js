import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { after, before, test } from 'node:test'
import mongoose from 'mongoose'
import app from './app.js'
import * as models from './models/index.js'
import { hashPassword } from './utils/password.js'

const databaseName = `dlas_lawyer_workspace_test_${randomBytes(6).toString('hex')}`
const server = createServer(app)
let base
before(async () => {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/dlas', { dbName: databaseName, serverSelectionTimeoutMS: 10000 })
  await Promise.all(Object.values(models).map((model) => model.init()))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${server.address().port}`
})
after(async () => {
  server.closeAllConnections(); server.close()
  if (mongoose.connection.readyState === 1) {
    assert.equal(mongoose.connection.name, databaseName)
    assert.match(databaseName, /^dlas_lawyer_workspace_test_[a-f0-9]{12}$/)
    await mongoose.connection.dropDatabase(); await mongoose.disconnect()
  }
})
async function request(path, token, body, bytes) {
  const response = await fetch(`${base}${path}`, { method: body || bytes ? 'POST' : 'GET', headers: { authorization: `Bearer ${token}`, ...(bytes ? { 'content-type': 'application/pdf' } : body ? { 'content-type': 'application/json' } : {}) }, body: bytes || (body ? JSON.stringify(body) : undefined) })
  return { status: response.status, data: response.headers.get('content-type')?.includes('application/pdf') ? Buffer.from(await response.arrayBuffer()) : await response.json() }
}
async function actor(username, role, officeCode = 'DEMO') {
  const password = randomBytes(20).toString('hex')
  const user = await models.User.create({ username, displayName: `Fictional ${username}`, passwordHash: await hashPassword(password) })
  await models.RoleAssignment.create({ userId: user.id, role, officeCode })
  const result = await request('/api/auth/login', '', { username, password })
  assert.equal(result.status, 200)
  return { user, token: result.data.token }
}

test('lawyer workspace: persistent reports, document permissions, reviewed payments, retries, feedback and human closure', async () => {
  const officer = await actor('workspace.officer', 'DLAO_OFFICER')
  const outside = await actor('workspace.outside', 'DLAO_OFFICER', 'OTHER')
  const colleague = await actor('workspace.colleague', 'DLAO_OFFICER')
  const lawyer = await actor('workspace.lawyer', 'PANEL_LAWYER')
  const otherLawyer = await actor('workspace.otherlawyer', 'PANEL_LAWYER')
  const citizen = await actor('workspace.citizen', 'CITIZEN')
  const stranger = await actor('workspace.stranger', 'CITIZEN')
  const helpline = await actor('workspace.helpline', 'HELPLINE_AGENT')
  const created = await request('/api/applications', helpline.token, { applicantName: 'Fictional Workspace Applicant' })
  assert.equal(created.status, 201)
  const { applicationId } = created.data
  const applicationBase = `/api/applications/${applicationId}`
  assert.equal((await request(`${applicationBase}/review`, officer.token, { reviewState: 'READY_FOR_DECISION', reason: 'Human officer reviewed this fictional application.' })).status, 200)
  const accepted = await request(`${applicationBase}/accept`, officer.token, { reason: 'Human officer accepted this fictional Case.' })
  assert.equal(accepted.status, 200)
  const { caseId } = accepted.data
  await models.Application.updateOne({ applicationId }, { $set: { citizenUserId: citizen.user.id } })
  await models.User.updateOne({ _id: lawyer.user.id }, { $set: { acceptingCases: false } })
  const offerInput = { lawyerUserId: lawyer.user.id, reason: 'Fictional assignment by the responsible officer.' }
  assert.equal((await request(`/api/lawyers/applications/${applicationId}/assignments`, officer.token, offerInput)).data.error.code, 'LAWYER_UNAVAILABLE')
  await models.User.updateOne({ _id: lawyer.user.id }, { $set: { acceptingCases: true } })
  const offer = await request(`/api/lawyers/applications/${applicationId}/assignments`, officer.token, offerInput)
  assert.equal(offer.status, 201)
  const assignmentId = offer.data.assignmentId
  const route = `/api/lawyers/assignments/${assignmentId}`
  assert.equal((await request(`${route}/workspace`, lawyer.token)).status, 403)
  assert.equal((await request(`${route}/respond`, lawyer.token, { decision: 'ACCEPT', reason: 'I accept this fictional panel-lawyer assignment.' })).status, 200)
  assert.equal((await request(`${route}/workspace`, otherLawyer.token)).status, 403)
  assert.equal((await request(`${route}/workspace`, outside.token)).status, 403)

  const pdf = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n')
  const query = (sensitivity) => new URLSearchParams({ label: sensitivity === 'STANDARD' ? 'Fictional hearing sheet' : 'Fictional restricted evidence', filename: 'hearing.pdf', category: 'COURT', sensitivity })
  assert.equal((await request(`${route}/documents?${query('STANDARD')}`, lawyer.token, null, Buffer.from('not a PDF'))).status, 400)
  const uploaded = await request(`${route}/documents?${query('STANDARD')}`, lawyer.token, null, pdf)
  assert.equal(uploaded.status, 201)
  const documentId = uploaded.data.id
  const restricted = await request(`${route}/documents?${query('RESTRICTED')}`, lawyer.token, null, pdf)
  assert.equal(restricted.status, 201)
  assert.deepEqual((await request(`${route}/documents/${documentId}/file`, lawyer.token)).data, pdf)
  assert.equal((await request(`${route}/documents/${restricted.data.id}/file`, outside.token)).status, 403)
  assert.equal((await request(`${route}/documents/${restricted.data.id}/file`, otherLawyer.token)).status, 403)
  assert.equal((await request(`${route}/documents/${restricted.data.id}/file`, officer.token)).status, 200)
  assert.equal((await request(`${route}/documents/${restricted.data.id}/file`, colleague.token)).status, 403)
  assert.equal((await request(`${route}/documents/${restricted.data.id}/review`, colleague.token, { decision: 'APPROVE', reason: 'Same-office role cannot bypass an explicit restricted grant.' })).status, 403)
  assert.ok(await models.EvidenceAccessLog.exists({ documentId: restricted.data.id, userId: colleague.user.id, outcome: 'DENIED' }))
  assert.equal((await request(`${route}/workspace`, colleague.token)).data.documents.some((document) => document._id === restricted.data.id), false)

  const entry = (kind, data, attachmentIds = []) => ({ kind, data, attachmentIds, clientMutationId: randomUUID() })
  const consultation = entry('CONSULTATION', { date: '2026-09-26', mode: 'IN_PERSON_CHAMBER', notes: 'Fictional client meeting and case preparation notes.' })
  assert.equal((await request(`${route}/entries`, lawyer.token, consultation)).status, 201)
  assert.equal((await request(`${route}/entries`, lawyer.token, consultation)).status, 201)
  assert.equal(await models.LawyerCaseEntry.countDocuments({ assignmentId, kind: 'CONSULTATION' }), 1)
  assert.equal((await request(`${route}/entries`, lawyer.token, { ...consultation, data: { ...consultation.data, notes: 'Changed retry payload must fail.' } })).status, 409)
  assert.equal((await request(`${route}/entries`, lawyer.token, entry('CONSULTATION', { ...consultation.data, mode: 'PHONE_SAFE' }))).data.error.code, 'UNSAFE_CONTACT')
  assert.equal((await request(`${route}/entries`, lawyer.token, entry('COURT', { courtName: 'Fictional District Court', courtCaseNo: 'DEMO-17', courtStage: 'PLAINT_SUBMITTED' }))).status, 201)
  assert.equal((await request(`${route}/entries`, lawyer.token, entry('HEARING', { date: '2026-09-26', bench: 'Fictional Court', notes: 'Fictional hearing attended and next steps discussed.' }))).status, 201)
  const progress = entry('PROGRESS', { date: '2026-09-26', stage: 'HEARING_ATTENDED', visitReport: { applicantContacted: true, documentsVerified: true, legalAdviceProvided: true }, report: 'Fictional applicant advised following the hearing.', nextAction: 'Await the next court date.' }, [documentId])
  assert.equal((await request(`${route}/entries`, lawyer.token, { ...progress, data: { ...progress.data, date: '2026-02-31' } })).status, 400)
  assert.equal((await request(`${route}/entries`, lawyer.token, progress)).status, 201)
  const foreignDoc = await models.Document.create({ applicationId: 'APP-2026-999999', label: 'Another case document' })
  assert.equal((await request(`${route}/entries`, lawyer.token, { ...progress, clientMutationId: randomUUID(), attachmentIds: [foreignDoc.id] })).status, 403)
  const workspace = await request(`${route}/workspace`, officer.token)
  assert.equal(workspace.data.entries.some((item) => item.kind === 'PROGRESS' && item.data.visitReport.documentsVerified), true)

  const claimInput = { stage: 'HEARING_ATTENDANCE', amount: 300.25, notes: 'Fictional stage claim with a supporting hearing sheet.', attachmentIds: [documentId], clientMutationId: randomUUID() }
  assert.equal((await request(`${route}/claims`, lawyer.token, { ...claimInput, amount: -1 })).status, 400)
  assert.equal((await request(`${route}/claims`, lawyer.token, { ...claimInput, amount: 0.001 })).status, 400)
  const claim = await request(`${route}/claims`, lawyer.token, claimInput)
  assert.equal(claim.status, 201)
  assert.deepEqual(claim.data.attachmentVersions.map(({ documentId, version }) => ({ documentId, version })), [{ documentId, version: 1 }])
  assert.equal((await request(`${route}/claims`, lawyer.token, claimInput)).data._id, claim.data._id)
  const reviewRoute = `${route}/claims/${claim.data._id}/review`
  const approval = { decision: 'APPROVE', amount: 250.25, reason: 'Officer verified the fictional stage work.', clientMutationId: randomUUID() }
  assert.equal((await request(reviewRoute, lawyer.token, approval)).status, 403)
  assert.equal((await request(reviewRoute, officer.token, approval)).status, 403)
  assert.equal((await request(`${route}/documents/${documentId}/review`, officer.token, { decision: 'APPROVE', reason: 'Officer reviewed the fictional hearing PDF.' })).status, 200)
  assert.equal((await request(reviewRoute, officer.token, approval)).status, 200)
  assert.equal((await request(reviewRoute, officer.token, approval)).status, 200)
  const payment = { decision: 'RECORD_PAYMENT', amount: 100.25, reason: 'Fictional partial payment recorded for reconciliation.', paymentReference: 'DEMO-PAY-1', clientMutationId: randomUUID() }
  assert.equal((await request(reviewRoute, officer.token, payment)).status, 200)
  assert.equal((await request(reviewRoute, officer.token, payment)).status, 200)
  assert.equal((await request(reviewRoute, officer.token, { ...payment, amount: 151, clientMutationId: randomUUID() })).status, 409)
  let latest = (await request(`${route}/workspace`, lawyer.token)).data
  assert.deepEqual(latest.totals, { claimed: 300.25, approved: 250.25, paid: 100.25, pendingApproved: 150 })
  assert.equal(latest.paymentHistory.filter((item) => item.paymentReference === 'DEMO-PAY-1').length, 1)
  assert.equal((await request(reviewRoute, officer.token, { ...payment, amount: 150, paymentReference: 'DEMO-PAY-2', clientMutationId: randomUUID() })).data.status, 'PAID')

  const staleDocument = await request(`${route}/documents?${query('STANDARD')}`, lawyer.token, null, pdf)
  const staleClaim = await request(`${route}/claims`, lawyer.token, { ...claimInput, amount: 50, attachmentIds: [staleDocument.data.id], clientMutationId: randomUUID() })
  assert.equal(staleClaim.status, 201)
  assert.equal((await request(`${route}/documents/${staleDocument.data.id}/review`, officer.token, { decision: 'APPROVE', reason: 'Officer reviewed the first supporting version.' })).status, 200)
  assert.equal((await request(`/api/documents/${staleDocument.data.id}/versions`, officer.token, { label: 'Fictional replacement hearing sheet', qualityState: 'PENDING_REVIEW', filename: 'replacement.txt', textContent: 'Changed fictional supporting document contents.' })).status, 201)
  assert.equal((await models.Document.findById(staleDocument.data.id)).reviewState, 'PENDING')
  assert.deepEqual((await request(`${route}/documents/${staleDocument.data.id}/file?version=1`, lawyer.token)).data, pdf)
  assert.equal((await request(`${route}/documents/${staleDocument.data.id}/review`, officer.token, { decision: 'APPROVE', reason: 'Officer reviewed the updated supporting version.' })).status, 200)
  assert.equal((await request(`${route}/claims/${staleClaim.data._id}/review`, officer.token, { ...approval, amount: 50, clientMutationId: randomUUID() })).data.error.code, 'STALE_DOCUMENT')

  const feedbackInput = { rating: 4, notes: 'Fictional client feedback on timely advice.', clientMutationId: randomUUID() }
  assert.equal((await request(`/api/citizen/assignments/${assignmentId}/feedback`, stranger.token, feedbackInput)).status, 404)
  assert.equal((await request(`/api/citizen/assignments/${assignmentId}/feedback`, citizen.token, feedbackInput)).status, 201)
  assert.equal((await request(`/api/citizen/assignments/${assignmentId}/feedback`, citizen.token, { ...feedbackInput, clientMutationId: randomUUID() })).status, 409)
  assert.equal((await request(`${route}/entries`, officer.token, entry('DOCUMENT_REQUEST', { notes: 'Please upload the fictional final court order.' }))).status, 201)
  let worklist = (await request('/api/lawyers/worklist', lawyer.token)).data
  assert.equal(worklist.stats.activeCases, 1); assert.equal(worklist.stats.clientFeedbackRating, 4)
  assert.equal(worklist.notifications.some((item) => item.type === 'DOCUMENT_REQUEST'), true)

  assert.equal((await request(`/api/lawyers/applications/${applicationId}/update-schedules`, officer.token, { assignmentId, dueAt: new Date(Date.now() + 600000).toISOString(), instruction: 'Send a mandatory progress update.' })).status, 201)
  const outcome = await request(`${route}/entries`, lawyer.token, entry('OUTCOME', { type: 'JUDGMENT', date: '2026-09-26', referenceNo: 'DEMO-ORDER-1', report: 'Fictional judgment reported for officer review.' }, [documentId]))
  assert.equal(outcome.status, 201)
  assert.equal((await models.Case.findOne({ caseId })).status, 'OPEN')
  assert.equal((await request(`${route}/outcomes/${outcome.data._id}/review`, lawyer.token, { decision: 'APPROVE', reason: 'A lawyer cannot close the Case themselves.' })).status, 403)
  const cancellation = await request(`/api/citizen/cases/${applicationId}/cancel`, citizen.token, { reason: 'Fictional applicant cancellation request needs officer review.' })
  assert.equal(cancellation.status, 201)
  assert.equal((await request(`${route}/outcomes/${outcome.data._id}/review`, officer.token, { decision: 'APPROVE', reason: 'Officer cannot bypass an outstanding cancellation request.' })).data.error.code, 'REQUEST_IN_PROGRESS')
  assert.equal((await request(`${applicationBase}/cancellation-requests/${cancellation.data.requestId}/review`, officer.token, { decision: 'DECLINE', reason: 'Officer separately reviewed and declined the cancellation request.' })).status, 200)
  assert.equal((await request(`${route}/outcomes/${outcome.data._id}/review`, officer.token, { decision: 'APPROVE', reason: 'Officer approved the final report after reviewing evidence.' })).status, 200)
  assert.equal((await models.Case.findOne({ caseId })).status, 'CLOSED')
  worklist = (await request('/api/lawyers/worklist', lawyer.token)).data
  assert.equal(worklist.stats.activeCases, 0); assert.equal(worklist.stats.completedCases, 1); assert.equal(worklist.stats.pendingUpdates, 0)
  assert.equal(worklist.records[0].caseStatus, 'CLOSED')
  const activity = (await request(`/api/lawyers/panel-lawyers/${lawyer.user.id}/activity`, officer.token)).data
  assert.equal(activity.activeCases, 0); assert.equal(activity.completedCases, 1); assert.equal(activity.totalAssignedCases, 1); assert.equal(activity.clientFeedbackRating, 4)
  assert.equal((await request(`${route}/entries`, lawyer.token, { ...progress, clientMutationId: randomUUID() })).status, 409)
  assert.equal((await request(`/api/lawyers/applications/${applicationId}/assignments`, officer.token, offerInput)).status, 409)
  assert.equal((await request(`/api/citizen/cases/${applicationId}/lawyer-change`, citizen.token, { reason: 'A completed Case cannot request a replacement lawyer.' })).status, 409)
  assert.equal((await request(`/api/citizen/cases/${applicationId}/cancel`, citizen.token, { reason: 'A completed Case cannot request cancellation.' })).status, 409)
  assert.equal((await request(`${applicationBase}/mediation`, officer.token, {})).status, 409)
  latest = (await request(`${route}/workspace`, officer.token)).data
  assert.equal(latest.totals.paid, 250.25)
  assert.ok(await models.AuditEvent.exists({ applicationId, action: 'LAWYER_FINAL_REPORT_REVIEWED' }))
  await models.LawyerAssignment.updateOne({ _id: assignmentId }, { $set: { active: false, status: 'REASSIGNED' } })
  assert.equal((await request(`${route}/workspace`, lawyer.token)).status, 403)
  assert.equal((await request(`${route}/workspace`, officer.token)).status, 200)
})
