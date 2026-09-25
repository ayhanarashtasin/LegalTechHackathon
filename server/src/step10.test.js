import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { after, before, test } from 'node:test'
import mongoose from 'mongoose'
import app from './app.js'
import * as models from './models/index.js'
import { hashPassword } from './utils/password.js'

const databaseName = `dlas_step10_test_${randomBytes(6).toString('hex')}`
const server = createServer(app)
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
    if (mongoose.connection.name !== databaseName || !/^dlas_step10_test_[a-f0-9]{12}$/.test(databaseName)) throw new Error('Refusing to remove a non-test database.')
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

async function acceptedApplication(applicantName, token) {
  const submitted = await request('/api/applications', { method: 'POST', token, body: { applicantName } })
  assert.equal(submitted.status, 201)
  const { applicationId } = submitted.data
  assert.equal((await request(`/api/applications/${applicationId}/review`, { method: 'POST', token, body: {
    reviewState: 'READY_FOR_DECISION', reason: 'Fictional case reviewed by an authorised human DLAO officer.',
  } })).status, 200)
  const accepted = await request(`/api/applications/${applicationId}/accept`, { method: 'POST', token, body: {
    reason: 'Fictional case accepted by a human DLAO officer.',
  } })
  assert.equal(accepted.status, 200)
  return { applicationId, caseId: accepted.data.caseId }
}

async function duplicateApplication({ name, phone, dob, district }, token) {
  const submitted = await request('/api/applications', { method: 'POST', token, body: { applicantName: name } })
  assert.equal(submitted.status, 201)
  const { applicationId } = submitted.data
  for (const [field, value] of [['contact.phone', phone], ['person.date_of_birth', dob], ['location.district', district]]) {
    const fact = await request(`/api/applications/${applicationId}/facts`, { method: 'POST', token, body: { field, value, sourceType: 'STAFF_ENTERED' } })
    assert.equal(fact.status, 201, `${field}: ${JSON.stringify(fact.data)}`)
  }
  return applicationId
}

test('Step 10: related factory-fire Cases share one standard document; duplicate review stays human and separate', async () => {
  const officer = await actor('test10.officer', 'DLAO_OFFICER')
  const support = await actor('test10.support', 'CASE_SUPPORT')
  const outsideOfficer = await actor('test10.outside', 'DLAO_OFFICER', 'OTHER')
  const outsideSupport = await actor('test10.outsidesupport', 'CASE_SUPPORT', 'OTHER')
  const first = await acceptedApplication('Fictional factory worker one', officer.token)
  const second = await acceptedApplication('Fictional factory worker two', officer.token)
  const third = await acceptedApplication('Fictional factory worker three', officer.token)
  const members = [first, second, third]
  const createdDocument = await request(`/api/applications/${first.applicationId}/documents`, { method: 'POST', token: officer.token, body: {
    label: 'Fictional factory fire bulletin', qualityState: 'READABLE', filename: 'fire-bulletin.txt',
    textContent: 'Synthetic tabletop exercise only: an alarm activated in the east packing area.', sensitivity: 'STANDARD',
  } })
  assert.equal(createdDocument.status, 201)
  const groupResult = await request(`/api/applications/${first.applicationId}/incidents`, { method: 'POST', token: officer.token, body: {
    applicationIds: members.map(({ applicationId }) => applicationId), title: 'Fictional factory fire claims',
    reason: 'These fictional claims describe one simulated event; each Case remains separate.',
  } })
  assert.equal(groupResult.status, 201)
  assert.equal(groupResult.data.members.length, 3)
  assert.equal((await request(`/api/applications/${first.applicationId}/incidents`, { token: support.token })).status, 200)
  assert.equal((await request(`/api/applications/${first.applicationId}/incidents`, { token: outsideSupport.token })).status, 403)
  assert.equal((await request(`/api/applications/${first.applicationId}/incidents`, { method: 'POST', token: support.token, body: {
    applicationIds: members.map(({ applicationId }) => applicationId), title: 'Case support cannot create a group',
    reason: 'This write must remain restricted to DLAO officers.',
  } })).status, 403)
  assert.equal((await request(`/api/incidents/${groupResult.data.id}`, { token: support.token })).status, 200)
  assert.equal((await request(`/api/incidents/${groupResult.data.id}`, { token: outsideSupport.token })).status, 403)
  assert.equal((await request(`/api/applications/${first.applicationId}/incidents`, { method: 'POST', token: officer.token, body: {
    applicationIds: [second.applicationId, third.applicationId], title: 'Invalid group without route Application',
    reason: 'The request intentionally omits the Application in the route.',
  } })).status, 400)

  const beforeSharing = await request(`/api/incidents/${groupResult.data.id}`, { token: officer.token })
  assert.equal(beforeSharing.status, 200)
  assert.equal(beforeSharing.data.members.length, 3)
  assert.equal(beforeSharing.data.availableDocuments.some(({ id }) => id === createdDocument.data.id), true)
  const linked = await request(`/api/incidents/${groupResult.data.id}/evidence`, { method: 'POST', token: officer.token, body: {
    documentId: createdDocument.data.id, reason: 'This single fictional bulletin is common evidence for all linked Cases.',
  } })
  assert.equal(linked.status, 201)
  assert.equal(linked.data.linkedOnce, true)
  const group = await request(`/api/incidents/${groupResult.data.id}`, { token: officer.token })
  assert.equal(group.data.sharedEvidence.length, 1)
  assert.match(group.data.sharedEvidence[0].textContent, /Synthetic tabletop exercise only/)
  const supportGroup = await request(`/api/incidents/${groupResult.data.id}`, { token: support.token })
  assert.equal(supportGroup.data.canShareEvidence, false)
  assert.deepEqual(supportGroup.data.availableDocuments, [])
  assert.equal(supportGroup.data.sharedEvidence.length, 1)
  assert.equal((await request(`/api/incidents/${groupResult.data.id}/evidence`, { method: 'POST', token: support.token, body: {
    documentId: createdDocument.data.id, reason: 'Case support cannot share another document.',
  } })).status, 403)
  assert.equal(await models.Document.countDocuments({ _id: createdDocument.data.id }), 1)
  assert.equal((await models.RelatedIncidentGroup.findById(groupResult.data.id)).commonDocumentIds.length, 1)
  assert.equal(await models.Case.countDocuments({ applicationId: { $in: members.map(({ applicationId }) => applicationId) } }), 3)
  for (const { applicationId } of members) {
    const audit = await request(`/api/applications/${applicationId}/audit`, { token: officer.token })
    assert.equal(audit.data.valid, true)
    assert.ok(audit.data.events.some(({ action }) => action === 'RELATED_INCIDENT_GROUP_CREATED'))
    assert.ok(audit.data.events.some(({ action }) => action === 'RELATED_INCIDENT_EVIDENCE_LINKED'))
  }
  const restricted = await request(`/api/applications/${first.applicationId}/documents`, { method: 'POST', token: officer.token, body: {
    label: 'Synthetic restricted placeholder', qualityState: 'READABLE', sensitivity: 'RESTRICTED',
  } })
  assert.equal(restricted.status, 201)
  assert.equal((await request(`/api/incidents/${groupResult.data.id}/evidence`, { method: 'POST', token: officer.token, body: {
    documentId: restricted.data.id, reason: 'Attempt to share restricted material is refused.',
  } })).status, 403)
  const supportAfterRestricted = await request(`/api/incidents/${groupResult.data.id}`, { token: support.token })
  assert.equal(supportAfterRestricted.data.sharedEvidence.some(({ label }) => label === 'Synthetic restricted placeholder'), false)
  assert.equal((await request(`/api/incidents/${groupResult.data.id}`, { token: outsideOfficer.token })).status, 403)
  const outsideCase = await acceptedApplication('Fictional outside-office case', outsideOfficer.token)
  assert.equal((await request(`/api/applications/${first.applicationId}/incidents`, { method: 'POST', token: officer.token, body: {
    applicationIds: [first.applicationId, outsideCase.applicationId], title: 'Cross-office group blocked',
    reason: 'This invalid group crosses DLAO office boundaries.',
  } })).status, 403)

  const examples = [
    { name: 'Amina Rahman', phone: '00000000001', dob: '1990-02-03', district: 'DEMO NORTH' },
    { name: 'Amina Rahman', phone: '00000000001', dob: '1990-02-03', district: 'DEMO NORTH' },
    { name: 'Amina Rehman', phone: '00000000001', dob: '1990-02-03', district: 'DEMO NORTH' },
    { name: 'Salma Khatun', phone: '00000000004', dob: '1985-01-01', district: 'DEMO SOUTH' },
    { name: 'Salma Khatun', phone: '00000000005', dob: '1994-04-02', district: 'DEMO SOUTH' },
    { name: 'Rahima Begum', phone: '00000000006', dob: '1984-03-04', district: 'DEMO WEST' },
    { name: 'Rahima Begum', phone: '00000000006', dob: '1978-11-18', district: 'DEMO WEST' },
    { name: 'Rafiq Uddin', phone: '00000000008', dob: '1980-02-09', district: 'DEMO EAST' },
    { name: 'Rafique Uddin', phone: '00000000008', dob: '1980-02-09', district: 'DEMO EAST' },
    { name: 'Sharif Hossain', phone: '00000000010', dob: '1991-07-14', district: 'DEMO CENTRAL' },
    { name: 'Nasima Akter', phone: '00000000011', dob: '1992-11-20', district: 'DEMO CENTRAL' },
    { name: 'Jamal Uddin', phone: '00000000012', dob: '1988-06-16', district: 'DEMO SOUTH' },
  ]
  const duplicateIds = []
  for (const example of examples) duplicateIds.push(await duplicateApplication(example, officer.token))
  assert.equal(duplicateIds.length, 12)
  const exactMatches = await request(`/api/applications/${duplicateIds[0]}/duplicates`, { token: officer.token })
  assert.equal(exactMatches.status, 200)
  const exact = exactMatches.data.find(({ applicationId }) => applicationId === duplicateIds[1])
  assert.equal(exact.score, 100)
  assert.ok(exact.matchingAttributes.includes('Contact number matches exactly'))
  assert.equal((await request(`/api/applications/${duplicateIds[0]}/duplicates`, { token: outsideOfficer.token })).status, 403)

  for (const [sourceIndex, candidateIndex, expectedScore, expectedDifference] of [[3, 4, 55, 'Date of birth'], [5, 6, 80, 'Date of birth']]) {
    const suggestions = await request(`/api/applications/${duplicateIds[sourceIndex]}/duplicates`, { token: officer.token })
    const candidate = suggestions.data.find(({ applicationId }) => applicationId === duplicateIds[candidateIndex])
    assert.equal(candidate.score, expectedScore)
    assert.ok(candidate.differingAttributes.includes(expectedDifference))
    const decision = await request(`/api/applications/${duplicateIds[sourceIndex]}/duplicates/${duplicateIds[candidateIndex]}/review`, { method: 'POST', token: officer.token, body: {
      decision: 'NOT_DUPLICATE', reason: 'Similar names or shared synthetic contact details are not enough; these fictional profiles differ.',
    } })
    assert.equal(decision.status, 200)
    assert.equal(decision.data.recordsRemainSeparate, true)
  }
  const duplicateDecision = await request(`/api/applications/${duplicateIds[0]}/duplicates/${duplicateIds[1]}/review`, { method: 'POST', token: officer.token, body: {
    decision: 'CONFIRMED_DUPLICATE', reason: 'Human reviewer confirmed these two fictional profiles refer to the same person; keep records separate.',
  } })
  assert.equal(duplicateDecision.status, 200)
  assert.equal(duplicateDecision.data.recordsRemainSeparate, true)
  assert.equal(await models.Case.countDocuments({ applicationId: { $in: duplicateIds } }), 0)
  assert.equal(await models.Application.countDocuments({ applicationId: { $in: duplicateIds }, status: 'SUBMITTED' }), 12)
  for (const applicationId of [duplicateIds[0], duplicateIds[1]]) {
    const audit = await request(`/api/applications/${applicationId}/audit`, { token: officer.token })
    assert.equal(audit.data.valid, true)
    assert.ok(audit.data.events.some(({ action }) => action === 'DUPLICATE_CANDIDATE_REVIEWED'))
  }
  assert.equal((await request(`/api/applications/${duplicateIds[0]}/duplicates/${duplicateIds[0]}/review`, { method: 'POST', token: officer.token, body: {
    decision: 'NOT_DUPLICATE', reason: 'This self-comparison must not be accepted as a review.',
  } })).status, 400)
})
