import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { after, before, test } from 'node:test'
import mongoose from 'mongoose'
import app from './app.js'
import * as models from './models/index.js'
import { hashPassword } from './utils/password.js'

const databaseName = `dlas_step11_test_${randomBytes(6).toString('hex')}`
const server = createServer(app)
const originalTriageSetting = process.env.TRIAGE_AI
process.env.TRIAGE_AI = 'off'
let baseUrl

before(async () => {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/dlas', { dbName: databaseName, serverSelectionTimeoutMS: 10000 })
  await Promise.all(Object.values(models).map((model) => model.init()))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  server.closeAllConnections()
  server.close()
  if (mongoose.connection.readyState === 1) {
    if (mongoose.connection.name !== databaseName || !/^dlas_step11_test_[a-f0-9]{12}$/.test(databaseName)) throw new Error('Refusing to remove a non-test database.')
    await mongoose.connection.dropDatabase()
    await mongoose.disconnect()
  }
  if (originalTriageSetting === undefined) delete process.env.TRIAGE_AI
  else process.env.TRIAGE_AI = originalTriageSetting
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

async function acceptedApplication(name, token) {
  const submitted = await request('/api/applications', { method: 'POST', token, body: { applicantName: name } })
  assert.equal(submitted.status, 201)
  const { applicationId } = submitted.data
  assert.equal((await request(`/api/applications/${applicationId}/review`, { method: 'POST', token, body: {
    reviewState: 'READY_FOR_DECISION', reason: 'Fictional triage test case reviewed by a DLAO officer.',
  } })).status, 200)
  const accepted = await request(`/api/applications/${applicationId}/accept`, { method: 'POST', token, body: {
    reason: 'Fictional triage test case accepted by a human DLAO officer.',
  } })
  assert.equal(accepted.status, 200)
  return applicationId
}

async function fact(applicationId, token, field, value) {
  const result = await request(`/api/applications/${applicationId}/facts`, { method: 'POST', token, body: { field, value, sourceType: 'STAFF_ENTERED' } })
  assert.equal(result.status, 201, JSON.stringify(result.data))
}

async function priority(applicationId, token, priorityDecision) {
  const result = await request(`/api/applications/${applicationId}/priority-override`, { method: 'POST', token, body: {
    priorityDecision, reason: 'Fictional priority recorded by a human officer for triage review.',
  } })
  assert.equal(result.status, 200, JSON.stringify(result.data))
}

test('Step 11: five fictional cases run through three components; conflict requires a human decision', async () => {
  const officer = await actor('test11.officer', 'DLAO_OFFICER')
  const outsideOfficer = await actor('test11.outside', 'DLAO_OFFICER', 'OTHER')
  const helpline = await actor('test11.helpline', 'HELPLINE_AGENT')
  const examples = [
    ['Fictional triage labour one', 'LABOUR', 'NO', 'ROUTINE'],
    ['Fictional triage family two', 'FAMILY', 'NO', 'ROUTINE'],
    ['Fictional triage land three', 'LAND', 'NO', null],
    ['Fictional triage other four', 'OTHER', 'YES', 'URGENT'],
    ['Fictional triage disagreement five', 'LABOUR', 'YES', 'ROUTINE'],
  ]
  const applications = []
  for (const [name, category, urgent, currentPriority] of examples) {
    const applicationId = await acceptedApplication(name, officer.token)
    applications.push(applicationId)
    await fact(applicationId, officer.token, 'triage.case_category', category)
    await fact(applicationId, officer.token, 'safety.urgent', urgent)
    if (currentPriority) await priority(applicationId, officer.token, currentPriority)
  }
  async function returnedReferral(applicationId, respondedAt) {
    const application = await models.Application.findOne({ applicationId }).lean()
    const task = await models.Task.create({
      applicationId, caseId: application.caseId, kind: 'REFERRAL', title: 'Fictional referral task',
      ownerRole: 'DLAO_OFFICER', nextAction: 'Review returned referral.',
    })
    return models.Referral.create({
      applicationId, caseId: application.caseId, sendingOfficeCode: 'DEMO', receivingOfficeCode: 'OTHER',
      sentByUserId: officer.user._id, responsibleUserId: officer.user._id,
      reason: 'Fictional jurisdiction review.', history: 'Fictional referral history.', expectedAction: 'Review and respond.',
      dueAt: new Date('2030-01-01'), status: 'RETURNED', respondedAt, responseReason: 'Fictional return for human review.', taskId: task._id,
    })
  }
  const singleReturn = await returnedReferral(applications[1], new Date('2026-01-01'))
  await returnedReferral(applications[2], new Date('2026-01-01'))
  const latestReturn = await returnedReferral(applications[2], new Date('2026-01-02'))
  const escalation = await models.Task.create({
    applicationId: applications[2], kind: 'ROUTING_DECISION', title: 'Fictional routing escalation',
    ownerRole: 'DLAO_OFFICER', nextAction: 'Authorised officer decides the route.',
  })
  await models.Application.updateOne({ applicationId: applications[3] }, { $set: { routingDecision: {
    route: 'RETAIN', officeCode: 'DEMO', reason: 'Fictional prior human routing decision.',
    returnCount: 0, decidedByUserId: officer.user._id, decidedAt: new Date('2026-01-03'),
  } } })
  assert.equal((await request(`/api/applications/${applications[0]}/triage`, { token: helpline.token })).status, 403)
  assert.equal((await request(`/api/applications/${applications[0]}/triage`, { token: outsideOfficer.token })).status, 403)

  const assessments = []
  for (const applicationId of applications) {
    const response = await request(`/api/applications/${applicationId}/triage`, { method: 'POST', token: officer.token, body: {} })
    assert.equal(response.status, 201, JSON.stringify(response.data))
    assert.equal(response.data.aiAssisted, false)
    assert.equal(response.data.model, 'rules-only')
    assert.equal(response.data.components.length, 3)
    assert.ok(response.data.components.every(({ requiresHumanReview }) => requiresHumanReview))
    assert.equal(response.data.routingReview.requiresHumanReview, true)
    assessments.push(response.data)
  }
  assert.equal(assessments[0].routingReview.status, 'ROUTE_NOT_RECORDED')
  assert.equal(assessments[1].routingReview.status, 'RETURNED_REFERRAL_REVIEW')
  assert.ok(assessments[1].routingReview.evidenceRefs.includes(`referral:${singleReturn.id}`))
  assert.equal(assessments[2].routingReview.status, 'ESCALATION_OPEN')
  assert.ok(assessments[2].routingReview.evidenceRefs.includes(`task:${escalation.id}`))
  assert.ok(assessments[2].routingReview.evidenceRefs.includes(`referral:${latestReturn.id}`))
  assert.equal(assessments[3].routingReview.status, 'HUMAN_ROUTE_RECORDED')
  assert.equal(assessments[1].components.find(({ name }) => name === 'URGENCY_ROUTING').urgencySignal, 'LOW')
  assert.equal((await models.Application.findOne({ applicationId: applications[1] }).lean()).routingDecision?.route, undefined)
  assert.equal((await request(`/api/applications/${applications[2]}/triage`, { token: officer.token })).data[0].routingReview.status, 'ESCALATION_OPEN')
  const conflict = assessments[4]
  assert.equal(conflict.disagreements.length, 1)
  assert.deepEqual(conflict.components.map(({ name }) => name), ['CASE_CATEGORIZER', 'PROCESS_SAFETY', 'URGENCY_ROUTING'])
  assert.equal(conflict.components.find(({ name }) => name === 'PROCESS_SAFETY').urgencySignal, 'HIGH')
  assert.equal(conflict.components.find(({ name }) => name === 'URGENCY_ROUTING').urgencySignal, 'LOW')
  assert.equal((await request(`/api/applications/${applications[0]}/triage`, { method: 'POST', token: officer.token, body: {} })).data.id, assessments[0].id)
  assert.equal(await models.TriageAssessment.countDocuments({ applicationId: applications[0] }), 1)

  await priority(applications[0], officer.token, 'URGENT')
  const stale = await request(`/api/applications/${applications[0]}/triage/${assessments[0].id}/decision`, { method: 'POST', token: officer.token, body: {
    category: 'LABOUR', disposition: 'PRIORITIZE_FOR_HUMAN_REVIEW', reason: 'The assessment is stale after the Application changed.',
  } })
  assert.equal(stale.status, 409)
  assert.equal(stale.data.error.code, 'STALE_TRIAGE')

  const decision = await request(`/api/applications/${applications[4]}/triage/${conflict.id}/decision`, { method: 'POST', token: officer.token, body: {
    category: 'LABOUR', disposition: 'PRIORITIZE_FOR_HUMAN_REVIEW', reason: 'The safety flag is newer than the recorded routine priority; a human will review promptly.',
  } })
  assert.equal(decision.status, 200)
  assert.equal(decision.data.status, 'REVIEWED')
  assert.equal(decision.data.humanDecision.disposition, 'PRIORITIZE_FOR_HUMAN_REVIEW')
  assert.equal((await models.Application.findOne({ applicationId: applications[4] }).lean()).priorityDecision, 'ROUTINE')
  assert.equal(await models.Case.countDocuments({ applicationId: { $in: applications } }), 5)
  for (const applicationId of [applications[4]]) {
    const audit = await request(`/api/applications/${applicationId}/audit`, { token: officer.token })
    assert.equal(audit.data.valid, true)
    assert.ok(audit.data.events.some(({ action }) => action === 'TRIAGE_ASSESSMENT_PROPOSED'))
    assert.ok(audit.data.events.some(({ action }) => action === 'TRIAGE_HUMAN_DECISION_RECORDED'))
  }

  const privateName = 'SYNTHETIC-NAME-DO-NOT-SEND'
  const privateSummary = 'SYNTHETIC-FREE-TEXT-DO-NOT-SEND'
  const privatePhone = '00000000999'
  const privateDob = '1998-01-02'
  const privateApplication = await acceptedApplication(privateName, officer.token)
  await fact(privateApplication, officer.token, 'triage.case_category', 'LABOUR')
  await fact(privateApplication, officer.token, 'safety.urgent', 'YES')
  await fact(privateApplication, officer.token, 'complaint.summary', privateSummary)
  await fact(privateApplication, officer.token, 'contact.phone', privatePhone)
  await fact(privateApplication, officer.token, 'person.date_of_birth', privateDob)
  await priority(privateApplication, officer.token, 'ROUTINE')
  const previousKey = process.env.GROQ_API_KEY
  const previousSetting = process.env.TRIAGE_AI
  const originalFetch = globalThis.fetch
  const providerPayloads = []
  process.env.GROQ_API_KEY = 'step11-test-only-not-a-real-key'
  process.env.TRIAGE_AI = 'on'
  globalThis.fetch = async (url, init) => {
    if (!String(url).startsWith('https://api.groq.com/openai/v1/')) return originalFetch(url, init)
    const body = JSON.parse(init.body)
    const name = body.response_format.json_schema.name
    const input = JSON.parse(body.messages[1].content)
    providerPayloads.push(JSON.stringify(input))
    const reference = input.evidenceRefs?.[0]
    const output = name === 'case_categorizer'
      ? { recommendation: input.category.value, urgencySignal: 'UNKNOWN', reasons: ['Recorded structured category reviewed.'], evidenceRefs: input.evidenceRefs, uncertainty: 'Human review remains required.', requiresHumanReview: true }
      : name === 'process_safety'
        ? { recommendation: 'SAFETY_REVIEW', urgencySignal: 'HIGH', reasons: ['Structured safety flag requires a human check.'], evidenceRefs: reference ? [reference] : [], uncertainty: 'No legal conclusion is made.', requiresHumanReview: true }
        : { recommendation: 'ROUTINE_REVIEW', urgencySignal: 'LOW', reasons: ['Current recorded priority is routine.'], evidenceRefs: reference ? [reference] : [], uncertainty: 'Verify against current safety evidence.', requiresHumanReview: true }
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(output) } }] }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  try {
    const ai = await request(`/api/applications/${privateApplication}/triage`, { method: 'POST', token: officer.token, body: {} })
    assert.equal(ai.status, 201)
    assert.equal(ai.data.aiAssisted, true)
    assert.equal(ai.data.disagreements.length, 1)
    assert.equal(providerPayloads.length, 3)
    const payload = providerPayloads.join('\n')
    for (const privateValue of [privateName, privateSummary, privatePhone, privateDob]) assert.equal(payload.includes(privateValue), false)
    assert.ok(ai.data.components.every(({ requiresHumanReview }) => requiresHumanReview))
  } finally {
    globalThis.fetch = originalFetch
    if (previousKey === undefined) delete process.env.GROQ_API_KEY
    else process.env.GROQ_API_KEY = previousKey
    process.env.TRIAGE_AI = previousSetting
  }
})
