import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { after, before, test } from 'node:test'
import mongoose from 'mongoose'
import app from './app.js'
import * as models from './models/index.js'
import { hashPassword } from './utils/password.js'

// The category the applicant chooses only puts things in front of people: a flag for the officer, restricted documents
// for criminal legal aid, a helpline callback for advice, or a task for the officer to choose the category.
const databaseName = `dlas_casecategory_test_${randomBytes(6).toString('hex')}`
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
    if (mongoose.connection.name !== databaseName || !/^dlas_casecategory_test_[a-f0-9]{12}$/.test(databaseName)) throw new Error('Refusing to remove a non-test database.')
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

test('each chosen category flags, restricts, or routes as agreed, and never decides the case', async () => {
  const citizen = await actor('category.citizen', 'CITIZEN')
  const officer = await actor('category.officer', 'DLAO_OFFICER')
  const helpline = await actor('category.helpline', 'HELPLINE_AGENT')
  const photo = { filename: 'evidence.jpg', dataUrl: `data:image/jpeg;base64,${Buffer.from('fictional-evidence').toString('base64')}` }
  const submit = (category, extra = {}) => request('/api/citizen/applications', { method: 'POST', token: citizen, body: {
    applicantName: 'Fictional Applicant', problem: 'Fictional description of the matter.', district: 'Dhaka', urgent: false,
    identityDocument: 'NONE', contactPhone: '01700000000', ...(category ? { category } : {}), ...extra,
  } })
  const record = async (applicationId) => (await request(`/api/applications/${applicationId}`, { token: officer })).data

  assert.equal((await submit()).status, 400)
  assert.equal((await submit('NOT_A_CATEGORY')).status, 400)

  // Family: sensitive, and the officer is asked to review urgency; still a normal intake review.
  const family = (await submit('FAMILY_DOMESTIC')).data
  const familyRecord = await record(family.applicationId)
  assert.equal(familyRecord.category, 'FAMILY_DOMESTIC')
  assert.ok(familyRecord.urgencyReasons.some((reason) => reason.includes('family / domestic')))
  assert.ok(familyRecord.vulnerability.includes('SENSITIVE_CATEGORY'))
  assert.equal(familyRecord.priorityDecision, null)

  // Criminal legal aid: documents start restricted.
  const criminal = (await submit('CRIMINAL_AID', { extraDocuments: [{ label: 'Fictional charge sheet', ...photo }] })).data
  const documents = await models.Document.find({ applicationId: criminal.applicationId }).lean()
  assert.equal(documents.length, 1)
  assert.equal(documents[0].sensitivity, 'RESTRICTED')
  assert.ok((await record(criminal.applicationId)).vulnerability.includes('RESTRICTED_CATEGORY'))

  // Labour: a group-claim hint only; nothing is linked.
  assert.ok((await record((await submit('LABOUR_WAGE')).data.applicationId)).vulnerability.includes('GROUP_CLAIM_POSSIBLE'))

  // Advice only: a helpline callback, outside the DLAO case queue.
  const advice = (await submit('ADVICE_ONLY')).data
  assert.equal(advice.service, 'ADVICE')
  assert.equal((await models.Application.findOne({ applicationId: advice.applicationId }).lean()).service, 'ADVICE')
  const helplineQueue = (await request('/api/workspace?role=HELPLINE_AGENT', { token: helpline })).data
  assert.ok(helplineQueue.records.some((item) => item.applicationId === advice.applicationId))
  const dlaoQueue = (await request('/api/workspace?role=DLAO_OFFICER', { token: officer })).data
  assert.ok(!dlaoQueue.records.some((item) => item.applicationId === advice.applicationId))
  assert.equal(dlaoQueue.records.find((item) => item.applicationId === family.applicationId).category, 'FAMILY_DOMESTIC')

  // Other: the officer is asked to choose the category.
  const other = (await submit('OTHER')).data
  const tasks = await models.Task.find({ applicationId: other.applicationId, status: 'OPEN' }).lean()
  assert.deepEqual(tasks.map(({ kind }) => kind).sort(), ['INTAKE_REVIEW', 'MANUAL'])
  assert.ok(tasks.some(({ title }) => title === 'Choose the case category'))
})

test('online harassment is urgent with a reason, keywords flag it too, and its evidence opens only to the assigned officer', async () => {
  const citizen = await actor('harass.citizen', 'CITIZEN')
  const officer = await actor('harass.officer', 'DLAO_OFFICER')
  const colleague = await actor('harass.colleague', 'DLAO_OFFICER')
  const photo = { filename: 'screenshot.jpg', dataUrl: `data:image/jpeg;base64,${Buffer.from('fictional-screenshot').toString('base64')}` }
  const submit = (category, problem) => request('/api/citizen/applications', { method: 'POST', token: citizen, body: {
    applicantName: 'Fictional Nabila', problem, district: 'Dhaka', urgent: false, identityDocument: 'NONE', contactPhone: '01700000000',
    category, extraDocuments: [{ label: 'Fictional screenshot', ...photo }],
  } })
  const record = async (applicationId, token = officer) => (await request(`/api/applications/${applicationId}`, { token })).data
  const documents = async (applicationId, token) => (await request(`/api/applications/${applicationId}/documents`, { token })).data

  // The category, not an AI guess, raises the flag; the officer still decides the priority.
  const chosen = (await submit('ONLINE_HARASSMENT', 'Fictional account of a stranger messaging me.')).data
  const chosenRecord = await record(chosen.applicationId)
  assert.ok(chosenRecord.urgencyReasons.some((reason) => reason.includes('non-consensual imagery')))
  assert.ok(chosenRecord.vulnerability.includes('RESTRICTED_CATEGORY'))
  assert.equal(chosenRecord.priorityDecision, null)
  assert.equal(chosenRecord.assignedOfficer, null)

  // Matching words in another category get the same visible reason and restriction.
  const worded = (await submit('FAMILY_DOMESTIC', 'Fictional: my ex-husband threatens to leak my photos online; ছবি ভাইরাল করার হুমকি।')).data
  const wordedRecord = await record(worded.applicationId)
  assert.ok(wordedRecord.urgencyReasons.some((reason) => reason.includes('description mentions non-consensual imagery')))
  assert.equal((await models.Document.findOne({ applicationId: worded.applicationId }).lean()).sensitivity, 'RESTRICTED')
  const plain = (await submit('LAND_PROPERTY', 'Fictional boundary dispute with a neighbour.')).data
  assert.equal((await models.Document.findOne({ applicationId: plain.applicationId }).lean()).sensitivity, 'STANDARD')

  // Before anyone is assigned, general staff see only that restricted evidence exists.
  assert.equal((await documents(chosen.applicationId, officer))[0].redacted, true)
  const [evidence] = await models.Document.find({ applicationId: chosen.applicationId }).lean()
  assert.equal((await request(`/api/documents/${evidence._id}`, { token: officer })).status, 403)

  const taken = await request(`/api/applications/${chosen.applicationId}/assigned-officer`, { method: 'POST', token: officer, body: {} })
  assert.equal(taken.status, 200)
  assert.equal((await documents(chosen.applicationId, officer))[0].label, 'Fictional screenshot')
  assert.equal((await request(`/api/documents/${evidence._id}`, { token: officer })).status, 200)
  assert.equal((await documents(chosen.applicationId, colleague))[0].redacted, true)
  assert.equal((await record(chosen.applicationId)).assignedOfficer.name, 'Fictional DLAO_OFFICER')

  // Taking over needs a reason and moves the access; the audit keeps both names.
  assert.equal((await request(`/api/applications/${chosen.applicationId}/assigned-officer`, { method: 'POST', token: colleague, body: {} })).status, 400)
  assert.equal((await request(`/api/applications/${chosen.applicationId}/assigned-officer`, { method: 'POST', token: colleague, body: { reason: 'Fictional: first officer is on leave.' } })).status, 200)
  assert.equal((await documents(chosen.applicationId, officer))[0].redacted, true)
  assert.equal((await documents(chosen.applicationId, colleague))[0].label, 'Fictional screenshot')
  const events = await models.AuditEvent.find({ applicationId: chosen.applicationId, action: 'OFFICER_ASSIGNED' }).lean()
  assert.equal(events.length, 2)
  assert.equal(events[1].reason, 'Fictional: first officer is on leave.')
})
