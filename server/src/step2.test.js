import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { after, before, test } from 'node:test'
import mongoose from 'mongoose'
import app from './app.js'
import * as models from './models/index.js'
import { hashPassword } from './utils/password.js'
import { submitVoiceIntake } from './services/applicationService.js'
import { getSession } from './services/authService.js'

// Live voice AI stays off here even when server/.env has a Groq key: no paid calls, and results stay deterministic.
// The AI outline test below turns it on against a stubbed Groq response.
process.env.VOICE_AI = 'off'
const databaseName = `dlas_step2_test_${randomBytes(6).toString('hex')}`
const server = createServer(app)
let baseUrl

before(async () => {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/dlas'
  await mongoose.connect(uri, { dbName: databaseName, serverSelectionTimeoutMS: 10000 })
  await Promise.all(Object.values(models).map((item) => item.init()))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  server.closeAllConnections()
  server.close()
  if (mongoose.connection.readyState === 1) {
    if (mongoose.connection.name !== databaseName || !/^dlas_step2_test_[a-f0-9]{12}$/.test(databaseName)) throw new Error('Refusing to remove a non-test database.')
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

async function actor(username, role) {
  const password = randomBytes(24).toString('base64url')
  const user = await models.User.create({ username, displayName: `Fictional ${role}`, passwordHash: await hashPassword(password) })
  await models.RoleAssignment.create({ userId: user._id, role, officeCode: 'DEMO' })
  const result = await request('/api/auth/login', { method: 'POST', body: { username, password } })
  assert.equal(result.status, 200)
  return { user, token: result.data.token, password }
}

test('Step 2–3 shared record, workflow, server authority, provenance, and audit', async (t) => {
  const officer = await actor('test.officer', 'DLAO_OFFICER')
  const helpline = await actor('test.helpline', 'HELPLINE_AGENT')
  const udc = await actor('test.udc', 'UDC_OPERATOR')
  const lawyer = await actor('test.lawyer', 'PANEL_LAWYER')
  const otherLawyer = await actor('test.otherlawyer', 'PANEL_LAWYER')
  const support = await actor('test.support', 'CASE_SUPPORT')
  const mediator = await actor('test.mediator', 'MEDIATOR')
  const receiving = await actor('test.receiving', 'RECEIVING_DLAO')
  const clao = await actor('test.clao', 'CLAO')
  let applicationId
  let caseId

  await t.test('login reads roles from server and rejects role spoofing', async () => {
    assert.equal((await request('/api/auth/login', { method: 'POST', body: { username: 'test.officer', password: 'wrong' } })).status, 401)
    assert.equal((await request('/api/auth/me', { token: officer.token })).data.user.assignments[0].role, 'DLAO_OFFICER')
    const spoof = await request('/api/applications', { method: 'POST', token: helpline.token, body: { applicantName: 'Fictional applicant', role: 'DLAO_OFFICER' } })
    assert.equal(spoof.status, 400)
    const environment = process.env.NODE_ENV
    const staffLoginEnv = process.env.STAFF_LOGIN_ENABLED
    try {
      process.env.NODE_ENV = 'production'
      delete process.env.STAFF_LOGIN_ENABLED
      assert.equal((await request('/api/auth/me', { token: officer.token })).status, 401)
      assert.equal((await request('/api/auth/login', { method: 'POST', body: { username: 'test.officer', password: officer.password } })).status, 503)
    } finally {
      process.env.NODE_ENV = environment
      if (staffLoginEnv === undefined) delete process.env.STAFF_LOGIN_ENABLED
      else process.env.STAFF_LOGIN_ENABLED = staffLoginEnv
    }
  })

  await t.test('submission has an Application ID but no Case ID; acceptance is human and role gated', async () => {
    const submitted = await request('/api/applications', { method: 'POST', token: helpline.token, body: { applicantName: 'Fictional applicant' } })
    assert.equal(submitted.status, 201)
    applicationId = submitted.data.applicationId
    assert.match(applicationId, /^APP-\d{4}-\d{6}$/)
    assert.equal(submitted.data.caseId, null)
    assert.equal(submitted.data.identityStatus, 'INCOMPLETE')
    assert.equal((await models.Case.countDocuments({ applicationId })), 0)
    assert.equal((await request(`/api/applications/${applicationId}`, { token: udc.token })).status, 403)
    assert.equal((await request(`/api/applications/${applicationId}`, { token: officer.token })).status, 200)
    const body = { reason: 'Officer reviewed the fictional application.' }
    assert.equal((await request(`/api/applications/${applicationId}/accept`, { method: 'POST', body })).status, 401)
    assert.equal((await request(`/api/applications/${applicationId}/accept`, { method: 'POST', token: helpline.token, body })).status, 403)
    assert.equal((await request(`/api/applications/${applicationId}/accept`, { method: 'POST', token: officer.token, body })).data.error.code, 'REVIEW_REQUIRED')
    assert.equal((await request(`/api/applications/${applicationId}/review`, { method: 'POST', token: udc.token, body: { reviewState: 'READY_FOR_DECISION', reason: 'Review denied for UDC role.' } })).status, 403)
    assert.equal((await request(`/api/applications/${applicationId}/review`, { method: 'POST', token: officer.token, body: { reviewState: 'NEEDS_INFORMATION', reason: 'Identity and provenance need a human follow-up.' } })).status, 200)
    assert.equal((await request(`/api/applications/${applicationId}/review`, { method: 'POST', token: officer.token, body: { reviewState: 'READY_FOR_DECISION', reason: 'Officer completed the review of available information.' } })).status, 200)
    assert.equal((await request(`/api/applications/${applicationId}/review`, { method: 'POST', token: officer.token, body: { reviewState: 'NEEDS_INFORMATION', reason: 'Change a ready decision without override.' } })).data.error.code, 'OVERRIDE_REQUIRED')
    assert.equal((await request(`/api/applications/${applicationId}/review-override`, { method: 'POST', token: officer.token, body: { reviewState: 'NEEDS_INFORMATION', reason: 'New fictional information requires additional review.' } })).status, 200)
    assert.equal((await request(`/api/applications/${applicationId}/review`, { method: 'POST', token: officer.token, body: { reviewState: 'READY_FOR_DECISION', reason: 'Officer completed a second review of the record.' } })).status, 200)
    const accepted = await request(`/api/applications/${applicationId}/accept`, { method: 'POST', token: officer.token, body })
    assert.equal(accepted.status, 200)
    caseId = accepted.data.caseId
    assert.match(caseId, /^CASE-\d{4}-\d{6}$/)
    assert.equal((await models.Case.countDocuments({ applicationId })), 1)
    assert.equal((await request(`/api/applications/${applicationId}/accept`, { method: 'POST', token: officer.token, body })).status, 409)
  })

  await t.test('tasks, exact-ID search, dashboard scope, and document versions use the same record', async () => {
    assert.equal((await request(`/api/applications/search?identifier=${applicationId}`, { token: officer.token })).data.applicationId, applicationId)
    assert.equal((await request(`/api/applications/search?identifier=${caseId}`, { token: support.token })).data.applicationId, applicationId)
    assert.equal((await request(`/api/applications/search?identifier=${caseId}`, { token: udc.token })).status, 403)
    assert.equal((await request(`/api/workspace?role=DLAO_OFFICER`, { token: udc.token })).status, 403)
    const queue = await request('/api/workspace?role=DLAO_OFFICER', { token: officer.token })
    assert.equal(queue.status, 200)
    assert.ok(queue.data.records.some((record) => record.applicationId === applicationId && record.caseId === caseId))
    for (const [role, token] of [['MEDIATOR', mediator.token], ['RECEIVING_DLAO', receiving.token]]) {
      const shell = await request(`/api/workspace?role=${role}`, { token })
      assert.equal(shell.status, 200)
      assert.deepEqual(shell.data.records, [])
    }
    // The CLAO sees the same office queue as the DLAO, read-only.
    const claoView = await request('/api/workspace?role=CLAO', { token: clao.token })
    assert.equal(claoView.data.readOnly, true)
    assert.deepEqual(claoView.data.records.map((record) => record.applicationId), queue.data.records.map((record) => record.applicationId))
    assert.equal((await request(`/api/applications/${applicationId}/tasks`, { token: udc.token })).status, 403)
    const tasks = await request(`/api/applications/${applicationId}/tasks`, { token: support.token })
    assert.ok(tasks.data.some((task) => task.kind === 'INTAKE_REVIEW' && task.status === 'DONE'))
    assert.ok(tasks.data.some((task) => task.kind === 'FOLLOW_UP' && task.status === 'OPEN'))
    const manual = await request(`/api/applications/${applicationId}/tasks`, { method: 'POST', token: support.token, body: { title: 'Check fictional file', ownerRole: 'CASE_SUPPORT', nextAction: 'Review the file metadata.' } })
    assert.equal(manual.status, 201)
    assert.equal((await request(`/api/applications/${applicationId}/tasks/${manual.data._id}/complete`, { method: 'POST', token: support.token })).data.status, 'DONE')
    assert.equal((await request(`/api/applications/${applicationId}/tasks/${manual.data._id}/complete`, { method: 'POST', token: support.token })).status, 409)
    const oversizedText = await request(`/api/applications/${applicationId}/documents`, { method: 'POST', token: officer.token, body: {
      label: 'Oversized fictional note', qualityState: 'READABLE', filename: 'oversized-note.txt', textContent: 'ক'.repeat(17000),
    } })
    assert.equal(oversizedText.status, 400)
    const document = await request(`/api/applications/${applicationId}/documents`, { method: 'POST', token: officer.token, body: { label: 'Fictional application note', qualityState: 'PENDING_REVIEW' } })
    assert.equal(document.status, 201)
    assert.equal((await request(`/api/documents/${document.data.id}/versions`, { method: 'POST', token: officer.token, body: { label: 'Fictional application note, clarified', qualityState: 'READABLE', note: 'Metadata only; no file uploaded.' } })).data.version, 2)
    assert.deepEqual((await request(`/api/documents/${document.data.id}/versions`, { token: officer.token })).data.map(({ version }) => version), [1, 2])
    assert.equal((await request(`/api/applications/${applicationId}/documents`, { token: support.token })).data[0].currentVersion, 2)
  })

  await t.test('unassigned lawyer and helpline cannot read protected material', async () => {
    assert.equal((await request(`/api/cases/${caseId}`, { token: lawyer.token })).status, 403)

    // A pending assignment shows the case summary but redacts contact details, transcript, recording, and documents:
    const assignment = await models.LawyerAssignment.create({ applicationId, caseId, lawyerUserId: lawyer.user._id, status: 'PENDING' })
    const pendingCase = await request(`/api/cases/${caseId}`, { token: lawyer.token })
    assert.equal(pendingCase.status, 200)
    assert.equal(pendingCase.data.assignmentStatus, 'PENDING')
    assert.equal('safeContact' in pendingCase.data, false)
    assert.equal('transcript' in pendingCase.data, false)
    assert.equal('hasRecording' in pendingCase.data, false)
    assert.equal('documents' in pendingCase.data, false)
    assert.equal((await request(`/api/applications/${applicationId}/recording`, { token: lawyer.token })).status, 403)
    assert.equal((await request(`/api/applications/${applicationId}/safe-contact`, { token: lawyer.token })).status, 403)
    assert.equal((await request(`/api/applications/${applicationId}/transcript`, { token: lawyer.token })).status, 403)

    // Once accepted, the case route opens documents, updates, and protected access:
    await models.LawyerAssignment.updateOne({ _id: assignment._id }, { status: 'ACCEPTED' })
    const acceptedCase = await request(`/api/cases/${caseId}`, { token: lawyer.token })
    assert.equal(acceptedCase.status, 200)
    assert.equal(acceptedCase.data.assignmentStatus, 'ACCEPTED')
    assert.equal(Array.isArray(acceptedCase.data.documents), true)
    assert.equal((await request(`/api/cases/${caseId}`, { token: otherLawyer.token })).status, 403)
    assert.equal((await request(`/api/applications/${applicationId}/safe-contact`, { token: otherLawyer.token })).status, 403)
    assert.equal((await request(`/api/applications/${applicationId}/recording`, { token: otherLawyer.token })).status, 403)

    const document = await models.Document.create({ applicationId, caseId, label: 'Fictional restricted evidence metadata', sensitivity: 'RESTRICTED', accessState: 'EXPLICIT_GRANT', allowedUserIds: [officer.user._id] })
    assert.equal((await request(`/api/documents/${document.id}`, { token: helpline.token })).status, 403)
    assert.equal((await request(`/api/documents/${document.id}`, { token: support.token })).status, 403)
    assert.equal((await request(`/api/documents/${document.id}`, { token: officer.token })).status, 200)
  })

  await t.test('applicant correction appends provenance and keeps representative report', async () => {
    const representation = await request(`/api/applications/${applicationId}/representations`, { method: 'POST', token: officer.token, body: { representativeName: 'Fictional representative', relationship: 'sibling', scope: 'Initial report only' } })
    assert.equal(representation.status, 201)
    assert.equal(representation.data.authorityStatus, 'PENDING')
    const reported = await request(`/api/applications/${applicationId}/facts`, { method: 'POST', token: officer.token, body: { field: 'complaint.summary', value: 'Representative version', sourceType: 'REPRESENTATIVE_REPORTED', sourcePersonId: representation.data.representativePersonId } })
    assert.equal(reported.status, 201)
    assert.equal(reported.data.applicantConfirmed, false)
    const spoof = await request(`/api/applications/${applicationId}/facts`, { method: 'POST', token: officer.token, body: { field: 'complaint.summary', value: 'Forged confirmation', sourceType: 'REPRESENTATIVE_REPORTED', sourcePersonId: representation.data.representativePersonId, applicantConfirmed: true } })
    assert.equal(spoof.status, 400)
    assert.equal((await request(`/api/applications/${applicationId}/facts/${reported.data._id}/corrections`, { method: 'POST', token: udc.token, body: { value: 'Applicant correction', attestation: 'Officer heard the applicant directly.' } })).status, 403)
    const corrected = await request(`/api/applications/${applicationId}/facts/${reported.data._id}/corrections`, { method: 'POST', token: officer.token, body: { value: 'Applicant correction', attestation: 'Officer heard the applicant directly.' } })
    assert.equal(corrected.status, 201)
    assert.equal(corrected.data.applicantConfirmed, true)
    assert.equal(corrected.data.sourceType, 'APPLICANT_CONFIRMED')
    const facts = (await request(`/api/applications/${applicationId}/facts`, { token: officer.token })).data
    assert.equal(facts.length, 2)
    assert.equal(facts[0].value, 'Representative version')
    assert.equal(facts[0].applicantConfirmed, false)
    assert.equal(facts[1].supersedesFactId, reported.data._id)
  })

  await t.test('safe-contact changes remain versioned and audit is integrity-checkable', async () => {
    const first = { allowedChannels: ['WEB'], prohibitedChannels: ['PHONE', 'SMS'], safeTimeWindow: 'Demo morning', smsSafe: false, neutralWordingRequired: true }
    assert.equal((await request(`/api/applications/${applicationId}/safe-contact`, { method: 'POST', token: officer.token, body: first })).status, 201)
    assert.equal((await request(`/api/applications/${applicationId}/safe-contact`, { method: 'POST', token: officer.token, body: { ...first, safeTimeWindow: 'Demo afternoon' } })).status, 201)
    assert.equal(await models.SafeContactProfile.countDocuments({ applicationId }), 2)
    const unsafeReached = await request(`/api/applications/${applicationId}/contact-attempts`, { method: 'POST', token: officer.token, body: { channel: 'PHONE', outcome: 'APPLICANT_REACHED', reason: 'This prohibited route must not be recorded as a completed contact.', statusExplained: true } })
    assert.equal(unsafeReached.status, 409)
    assert.equal(unsafeReached.data.error.code, 'UNSAFE_CONTACT')
    const contact = await request(`/api/applications/${applicationId}/contact-attempts`, { method: 'POST', token: officer.token, body: { channel: 'PHONE', outcome: 'BLOCKED_UNSAFE', reason: 'Phone is prohibited by the current safe-contact profile.' } })
    assert.equal(contact.status, 201)
    assert.equal(contact.data.disclosedSensitive, false)
    assert.equal(contact.data.safeContactVersion, 2)
    assert.equal((await request(`/api/applications/${applicationId}/contact-attempts`, { token: support.token })).data.length, 1)
    const consent = { scope: 'CONTACT', state: 'GRANTED', attestation: 'Fictional applicant gave explicit contact consent.' }
    assert.equal((await request(`/api/applications/${applicationId}/consents`, { method: 'POST', token: udc.token, body: consent })).status, 403)
    assert.equal((await request(`/api/applications/${applicationId}/consents`, { method: 'POST', token: officer.token, body: consent })).data.revision, 1)
    assert.equal((await request(`/api/applications/${applicationId}/consents`, { method: 'POST', token: officer.token, body: { ...consent, state: 'WITHDRAWN', attestation: 'Fictional applicant withdrew contact consent.' } })).data.revision, 2)
    assert.deepEqual((await models.ConsentRecord.find({ applicationId, scope: 'CONTACT' }).sort({ revision: 1 }).lean()).map(({ state }) => state), ['GRANTED', 'WITHDRAWN'])
    const audit = await request(`/api/applications/${applicationId}/audit`, { token: officer.token })
    assert.equal(audit.status, 200)
    assert.equal(audit.data.valid, true)
    assert.ok(audit.data.events.some((event) => event.action === 'APPLICATION_ACCEPTED' && event.reason))
    assert.ok(audit.data.events.some((event) => event.action === 'APPLICANT_CORRECTION_ATTESTED'))
    assert.ok(audit.data.events.some((event) => event.action === 'HUMAN_REVIEW_OVERRIDE'))
    assert.ok(audit.data.events.some((event) => event.action === 'DOCUMENT_VERSION_ADDED'))
    await models.AuditEvent.collection.updateOne({ _id: new mongoose.Types.ObjectId(audit.data.events[0]._id) }, { $set: { action: 'CHANGED_AFTER_WRITE' } })
    assert.equal((await request(`/api/applications/${applicationId}/audit`, { token: officer.token })).data.valid, false)
  })

  await t.test('concurrent submissions have distinct IDs and role revocation takes effect immediately', async () => {
    const results = await Promise.all(Array.from({ length: 12 }, () => request('/api/applications', { method: 'POST', token: helpline.token, body: { applicantName: 'Fictional intake' } })))
    assert.ok(results.every(({ status }) => status === 201))
    assert.equal(new Set(results.map(({ data }) => data.applicationId)).size, 12)
    assert.ok(results.every(({ data }) => data.caseId === null))
    const helplineRecord = results[0].data.applicationId
    assert.ok((await request('/api/workspace?role=DLAO_OFFICER', { token: officer.token })).data.records.some(({ applicationId: id }) => id === helplineRecord))
    assert.equal((await request(`/api/applications/${helplineRecord}`, { token: officer.token })).data.applicationId, helplineRecord)
    await models.RoleAssignment.updateOne({ userId: helpline.user._id }, { $set: { active: false } })
    assert.equal((await request('/api/applications', { method: 'POST', token: helpline.token, body: { applicantName: 'Fictional intake' } })).status, 403)
  })
})

test('Step 4 voice intake keeps representative provenance, the recording notice, safe contact, and audit', async () => {
  const officer = await actor('test4.officer', 'DLAO_OFFICER')
  const ripon = {
    mode: 'INTAKE',
    answers: {
      callerRole: 'REPRESENTATIVE', callerName: 'Fictional Ripon', relationship: 'Brother', applicantName: 'Fictional Moyuri',
      district: 'Joypurhat', nidKnown: false, problem: 'Fictional representative report.', urgent: false,
      contactChannel: 'PHONE', contactValue: '01700000000', safeTime: 'Weekday morning',
    },
    correctedFields: ['district'],
  }
  const post = (body) => request('/api/voice/intakes', { method: 'POST', body })
  assert.equal((await post({ ...ripon, answers: { ...ripon.answers, applicantConfirmed: true } })).status, 400)
  assert.equal((await post({ ...ripon, consents: { AUDIO_STORAGE: 'DENIED' } })).status, 400) // every call is recorded; no opt-out field exists
  const withoutCaller = { ...ripon.answers }
  delete withoutCaller.callerName
  assert.equal((await post({ ...ripon, answers: withoutCaller })).status, 400)
  assert.equal((await fetch(`${baseUrl}/api/voice/intakes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' })).status, 400)
  // The old danger shortcut is gone: a reported danger continues the intake instead.
  assert.equal((await post({ mode: 'CALLBACK', callbackReason: 'URGENT_HANDOFF', answers: { contactValue: '01800000000', safeTime: 'Evening', district: 'Barguna', urgent: true } })).status, 400)

  const submitted = await post(ripon)
  assert.equal(submitted.status, 201)
  const { applicationId } = submitted.data
  assert.match(applicationId, /^APP-\d{4}-\d{6}$/)
  assert.match(submitted.data.lookupCode, /^\d{6}$/) // a PIN the caller can hear and say back
  assert.equal(await models.Application.countDocuments({ applicationId, caseId: { $exists: true } }), 0)
  const representation = await models.Representation.findOne({ applicationId }).lean()
  assert.equal(representation.authorityStatus, 'PENDING')
  const facts = await models.CaseFact.find({ applicationId }).lean()
  assert.deepEqual(facts.map((fact) => fact.field).sort(), ['complaint.summary', 'contact.preference', 'identity.nid_known', 'location.district', 'safety.urgent'])
  assert.ok(facts.every((fact) => fact.sourceType === 'REPRESENTATIVE_REPORTED' && fact.callerConfirmed && !fact.applicantConfirmed && fact.sourcePersonId.equals(representation.representativePersonId)))
  // Only a signed-in citizen complaining for themselves is linked as the applicant.
  const citizen = await actor('test4.citizen', 'CITIZEN')
  const self = { ...ripon.answers, callerRole: 'SELF' }
  for (const key of ['relationship', 'applicantName']) delete self[key]
  const linked = async (who, body) => (await submitVoiceIntake(body, await getSession(who.token))).authenticated
  assert.equal(await linked(officer, ripon), false)
  assert.equal(await linked(citizen, ripon), false)
  assert.equal(await linked(citizen, { ...ripon, answers: self }), true)
  assert.equal((await models.Person.findById(representation.applicantPersonId).lean()).identityStatus, 'INCOMPLETE')
  assert.equal(await models.ConsentRecord.countDocuments({ applicationId }), 0)
  const profile = await models.SafeContactProfile.findOne({ applicationId }).lean()
  assert.deepEqual([profile.allowedChannels, profile.prohibitedChannels, profile.smsSafe, profile.neutralWordingRequired], [['PHONE'], ['SMS'], false, true])
  assert.ok(profile.contactOwnerPersonId.equals(representation.representativePersonId))
  const record = await request(`/api/applications/${applicationId}`, { token: officer.token })
  assert.equal(record.data.channel, 'VOICE_SIM')
  assert.deepEqual(record.data.representation, { representativeName: 'Fictional Ripon', relationship: 'Brother', authorityStatus: 'PENDING' })
  assert.deepEqual(record.data.vulnerability, ['REPRESENTATIVE_CALLER', 'NID_UNKNOWN'])
  assert.equal(record.data.nextTask.title, 'Review 16699 voice intake')
  assert.match(record.data.nextTask.nextAction, /NID not known: the caller was advised to verify identity at the nearest UDC\. .*No SMS or voicemail\./)
  assert.equal((await request('/api/workspace?role=DLAO_OFFICER', { token: officer.token })).data.records.filter((item) => item.applicationId === applicationId).length, 1)

  const unknown = await request(`/api/applications/${applicationId}/contact-attempts`, { method: 'POST', token: officer.token, body: { channel: 'PHONE', outcome: 'UNKNOWN_PERSON', reason: 'Simulated call: an unknown person answered.', disclosedSensitive: false } })
  assert.equal(unknown.status, 201)
  assert.equal(unknown.data.disclosedSensitive, false)
  for (const secret of [applicationId, 'Moyuri', 'Joypurhat', 'legal', 'আইনি']) assert.ok(!unknown.data.neutralScript.includes(secret))
  assert.equal((await models.Task.findById(unknown.data.followUpTaskId).lean()).title, 'Plan safer follow-up')
  const audit = (await request(`/api/applications/${applicationId}/audit`, { token: officer.token })).data
  assert.equal(audit.valid, true)
  for (const action of ['APPLICATION_SUBMITTED', 'REPRESENTATION_RECORDED', 'RECORDING_NOTICE_GIVEN', 'FACT_RECORDED', 'SAFE_CONTACT_UPDATED', 'TASK_CREATED', 'CONTACT_ATTEMPT_LOGGED']) {
    assert.ok(audit.events.some((event) => event.action === action), action)
  }

  // A late upload is refused even with the right PIN: the recording must arrive with the call.
  await models.Application.collection.updateOne({ applicationId }, { $set: { createdAt: new Date(Date.now() - 16 * 60 * 1000) } })
  const late = await fetch(`${baseUrl}/api/voice/intakes/${applicationId}/recording`, { method: 'POST', headers: { 'content-type': 'audio/webm', 'x-lookup-code': submitted.data.lookupCode }, body: Buffer.alloc(2000) })
  assert.equal(late.status, 403)

  // A caller in danger keeps going: the NID and the story are kept, the risk is flagged for the officer, and the
  // NID never enters the audit trail. (Service calls, so the public per-IP limit stays for the route checks above.)
  assert.equal((await post({ ...ripon, answers: { ...ripon.answers, nidKnown: true, nid: '12345' } })).status, 400)
  const danger = await submitVoiceIntake({ mode: 'INTAKE', answers: {
    callerRole: 'SELF', callerName: 'Fictional Rahima', district: 'Barguna', nidKnown: true, nid: '0000000000',
    problem: 'Fictional account: threatened at home last night.', urgent: true, contactChannel: 'UDC', safeTime: 'Evening after 6 pm',
  } })
  const dangerFacts = Object.fromEntries((await models.CaseFact.find({ applicationId: danger.applicationId }).lean()).map((fact) => [fact.field, fact]))
  assert.equal(dangerFacts['identity.nid'].value, '0000000000')
  assert.equal(dangerFacts['safety.urgent'].value, 'YES')
  assert.ok(dangerFacts['identity.nid'].applicantConfirmed && dangerFacts['identity.nid'].sourceType === 'APPLICANT_REPORTED')
  assert.equal((await models.SafeContactProfile.findOne({ applicationId: danger.applicationId }).lean()).allowedChannels[0], 'IN_PERSON') // UDC: met in person
  const dangerAudit = await models.AuditEvent.find({ applicationId: danger.applicationId }).lean()
  assert.ok(!JSON.stringify(dangerAudit).includes('0000000000'))
  assert.equal(dangerAudit.find((event) => event.action === 'APPLICATION_SUBMITTED').newState.nidProvided, true)
  const queued = (await request('/api/workspace?role=DLAO_OFFICER', { token: officer.token })).data.records.find((item) => item.applicationId === danger.applicationId)
  assert.deepEqual(queued.vulnerability, ['SAFETY_RISK'])
  assert.ok(queued.flags.some((flag) => flag.code === 'URGENT_RECOMMENDATION'))
  assert.equal((await models.Person.findById((await models.Application.findOne({ applicationId: danger.applicationId }).lean()).applicantPersonId).lean()).identityStatus, 'PENDING_REVIEW')

  // A trusted person is reached on their own phone, and that person is recorded as the number's owner.
  const trusted = await submitVoiceIntake({ mode: 'INTAKE', answers: { ...self, contactChannel: 'TRUSTED_PERSON', contactValue: undefined, trustedPerson: 'Fictional aunt', trustedPhone: '01900000000' } })
  const trustedProfile = await models.SafeContactProfile.findOne({ applicationId: trusted.applicationId }).populate('contactOwnerPersonId', 'displayName').lean()
  assert.deepEqual([trustedProfile.contactValue, trustedProfile.contactOwnerPersonId.displayName, trustedProfile.prohibitedChannels], ['01900000000', 'Fictional aunt', ['SMS']])
})

test('16699 advice request: a helpline callback closes it or turns the same record into a complaint for DLAO review', async () => {
  const officer = await actor('advice.officer', 'DLAO_OFFICER')
  const helpline = await actor('advice.helpline', 'HELPLINE_AGENT')
  const ask = (adviceTopic) => submitVoiceIntake({ mode: 'ADVICE', answers: { adviceTopic, contactValue: '01700000000', safeTime: 'Weekday afternoon' } })
  const wages = await ask('Fictional question about unpaid wages.')
  const land = await ask('Fictional question about a land deed.')
  const dlaoQueue = async () => (await request('/api/workspace?role=DLAO_OFFICER', { token: officer.token })).data.records.map((item) => item.applicationId)
  const callbacks = async () => (await request('/api/workspace?role=HELPLINE_AGENT', { token: helpline.token })).data.records
  assert.ok(!(await dlaoQueue()).includes(wages.applicationId)) // advice waits for the helpline, not the DLAO queue
  const waiting = (await callbacks()).find((item) => item.applicationId === wages.applicationId)
  assert.deepEqual([waiting.topic, waiting.contactValue, waiting.safeTime], ['Fictional question about unpaid wages.', '01700000000', 'Weekday afternoon'])
  const facts = await models.CaseFact.find({ applicationId: wages.applicationId }).lean()
  assert.deepEqual(facts.map((fact) => [fact.field, fact.sourceType]), [['advice.topic', 'UNKNOWN_OR_UNVERIFIED']])

  const outcome = (id, body, token = helpline.token) => request(`/api/applications/${id}/advice-outcome`, { method: 'POST', token, body })
  const guidance = 'Explained the wage claim steps and the documents to keep.'
  assert.equal((await outcome(wages.applicationId, { outcome: 'FORMAL_ASSISTANCE', guidance })).status, 400) // needs the applicant
  assert.equal((await outcome(wages.applicationId, { outcome: 'INFORMATION_PROVIDED', guidance, applicantName: 'Fictional' })).status, 400)
  assert.equal((await outcome(wages.applicationId, { outcome: 'INFORMATION_PROVIDED', guidance }, officer.token)).status, 403)
  assert.equal((await outcome(wages.applicationId, { outcome: 'FORMAL_ASSISTANCE', guidance, applicantName: 'Fictional Karim', district: 'Khulna', nid: '1234' })).status, 400)
  const formal = await outcome(wages.applicationId, { outcome: 'FORMAL_ASSISTANCE', guidance, applicantName: 'Fictional Karim', district: 'Khulna', nid: '0000000000000' })
  assert.equal(formal.status, 200)
  assert.equal(formal.data.service, 'COMPLAINT')
  assert.equal((await outcome(wages.applicationId, { outcome: 'INFORMATION_PROVIDED', guidance })).status, 409)
  assert.ok((await dlaoQueue()).includes(wages.applicationId))
  const record = (await request(`/api/applications/${wages.applicationId}`, { token: officer.token })).data
  assert.deepEqual([record.applicantName, record.identityStatus, record.nextTask.title], ['Fictional Karim', 'PENDING_REVIEW', 'Review new application'])
  assert.equal(await models.Task.countDocuments({ applicationId: wages.applicationId, kind: 'ADVICE_CALLBACK', status: 'DONE' }), 1)

  assert.equal((await outcome(land.applicationId, { outcome: 'INFORMATION_PROVIDED', guidance: 'Explained where to get a certified copy of the deed.' })).status, 200)
  assert.ok(!(await callbacks()).some((item) => [wages.applicationId, land.applicationId].includes(item.applicationId)))
  assert.ok(!(await dlaoQueue()).includes(land.applicationId))
  for (const id of [wages.applicationId, land.applicationId]) {
    const audit = (await request(`/api/applications/${id}/audit`, { token: officer.token })).data
    assert.equal(audit.valid, true)
    assert.ok(audit.events.some((event) => event.action === 'ADVICE_OUTCOME_RECORDED'))
  }
})

test('Step 5 voice AI: transcription route guards, AI provenance, transcript, and the stored call recording', async () => {
  const officer = await actor('test5.officer', 'DLAO_OFFICER')
  const post = (path, body) => request(path, { method: 'POST', body })
  const audio = (path, { type = 'audio/webm', bytes = 2000 } = {}) => fetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'content-type': type }, body: Buffer.alloc(bytes) })

  // The public audio route accepts only known questions and real audio, and fails safe when the AI is off.
  assert.equal((await audio('/api/voice/answers?fields=problem,district')).status, 503)
  assert.equal((await audio('/api/voice/answers?fields=confirm')).status, 503) // a read-back yes/no is a known question
  assert.equal((await audio('/api/voice/answers?fields=role')).status, 400)
  assert.equal((await audio('/api/voice/answers?fields=problem', { type: 'application/json' })).status, 400)
  assert.equal((await audio('/api/voice/answers?fields=problem', { bytes: 10 })).status, 400)

  const intake = {
    mode: 'INTAKE', confirmation: 'VOICE', aiSensitive: true,
    answers: { callerRole: 'REPRESENTATIVE', callerName: 'Fictional Ripon', relationship: 'Brother', applicantName: 'Fictional Moyuri', district: 'Joypurhat', nidKnown: false, problem: 'Fictional spoken report.', urgent: false, contactChannel: 'UDC', safeTime: 'Weekday morning' },
    aiFields: ['problem', 'district', 'callerRole'],
    transcript: [{ speaker: 'ASSISTANT', text: 'আপনি কার জন্য ফোন করছেন?' }, { speaker: 'CALLER', text: 'আমার বোনের জন্য।' }],
  }
  assert.equal((await post('/api/voice/intakes', { ...intake, audio: 'UklGRg==' })).status, 400)
  assert.equal((await post('/api/voice/intakes', { ...intake, aiFields: ['role'] })).status, 400)
  assert.equal((await post('/api/voice/intakes', { ...intake, transcript: [{ speaker: 'DLAO_OFFICER', text: 'Approved' }] })).status, 400)

  const submitted = await post('/api/voice/intakes', intake)
  assert.equal(submitted.status, 201)
  const { applicationId } = submitted.data
  const facts = await models.CaseFact.find({ applicationId }).lean()
  const byField = Object.fromEntries(facts.map((fact) => [fact.field, fact]))
  assert.equal(byField['complaint.summary'].aiInferred, true)
  assert.equal(byField['identity.nid_known'].aiInferred, false)
  assert.ok(facts.every((fact) => fact.sourceType === 'REPRESENTATIVE_REPORTED' && !fact.applicantConfirmed))
  const record = await request(`/api/applications/${applicationId}`, { token: officer.token })
  assert.match(record.data.nextTask.nextAction, /AI flagged possible violence/)
  assert.ok(record.data.vulnerability.includes('SAFETY_UNVERIFIED'))
  const transcript = await request(`/api/applications/${applicationId}/transcript`, { token: officer.token })
  assert.equal(transcript.data.turns.length, 2)
  const audit = (await request(`/api/applications/${applicationId}/audit`, { token: officer.token })).data
  assert.equal(audit.valid, true)
  const submittedEvent = audit.events.find((event) => event.action === 'APPLICATION_SUBMITTED')
  assert.equal(submittedEvent.newState.aiAssisted, true)
  assert.equal(submittedEvent.newState.aiSensitive, true)
  assert.equal(submittedEvent.newState.confirmation, 'VOICE')
  assert.ok(audit.events.some((event) => event.action === 'TRANSCRIPT_STORED'))
  assert.equal((await request(`/api/applications/${applicationId}/transcript`)).status, 401)

  // An unclear safety reply remains unconfirmed and reaches the officer with a review reason and transcript.
  const uncertain = await post('/api/voice/intakes', { ...intake, confirmation: 'BUTTON', aiSensitive: false,
    answers: { ...intake.answers, urgent: 'UNKNOWN' }, aiFields: ['urgent'] })
  assert.equal(uncertain.status, 201)
  const safetyFact = await models.CaseFact.findOne({ applicationId: uncertain.data.applicationId, field: 'safety.urgent' }).lean()
  assert.equal(safetyFact.value, 'UNKNOWN')
  assert.equal(safetyFact.sourceType, 'UNKNOWN_OR_UNVERIFIED')
  assert.equal(safetyFact.callerConfirmed, false)
  assert.equal(safetyFact.applicantConfirmed, false)
  const humanHandoff = await request(`/api/applications/${uncertain.data.applicationId}`, { token: officer.token })
  assert.ok(humanHandoff.data.vulnerability.includes('SAFETY_UNVERIFIED'))
  assert.match(humanHandoff.data.nextTask.nextAction, /Safety was unclear/)
  const queue = await request('/api/workspace?role=DLAO_OFFICER', { token: officer.token })
  assert.ok(queue.data.records.find(({ applicationId: id }) => id === uncertain.data.applicationId).flags
    .some(({ code, reason }) => code === 'URGENT_RECOMMENDATION' && /human verification/.test(reason)))

  // The full call recording attaches once, only with this submission's one-time code; an officer and the accepted panel lawyer can play it.
  const upload = (headers, bytes = 4000) => fetch(`${baseUrl}/api/voice/intakes/${applicationId}/recording`, { method: 'POST', headers: { 'content-type': 'audio/webm;codecs=opus', ...headers }, body: Buffer.alloc(bytes, 7) })
  const code = submitted.data.lookupCode
  assert.equal((await upload({})).status, 400)
  assert.equal((await upload({ 'x-lookup-code': 'f'.repeat(24) })).status, 403)
  assert.equal((await upload({ 'x-lookup-code': code }, 10)).status, 400)
  assert.equal((await upload({ 'x-lookup-code': code })).status, 201)
  assert.equal((await upload({ 'x-lookup-code': code })).status, 201) // a retried identical upload is harmless
  const played = await fetch(`${baseUrl}/api/applications/${applicationId}/recording`, { headers: { authorization: `Bearer ${officer.token}` } })
  assert.equal(played.status, 200)
  assert.equal(played.headers.get('content-type'), 'audio/webm')
  assert.deepEqual(Buffer.from(await played.arrayBuffer()), Buffer.alloc(4000, 7))
  assert.equal((await fetch(`${baseUrl}/api/applications/${applicationId}/recording`)).status, 401)

  // A lawyer without an accepted assignment cannot access the recording; once accepted, they can play it.
  const lawyerActor = await actor('test5.lawyer', 'PANEL_LAWYER')
  assert.equal((await fetch(`${baseUrl}/api/applications/${applicationId}/recording`, { headers: { authorization: `Bearer ${lawyerActor.token}` } })).status, 403)
  const lawyerAssignment = await models.LawyerAssignment.create({ applicationId, caseId: 'CASE-STEP5-RECORDING', lawyerUserId: lawyerActor.user._id, status: 'PENDING' })
  assert.equal((await fetch(`${baseUrl}/api/applications/${applicationId}/recording`, { headers: { authorization: `Bearer ${lawyerActor.token}` } })).status, 403)
  await models.LawyerAssignment.updateOne({ _id: lawyerAssignment._id }, { status: 'ACCEPTED' })
  const lawyerPlayed = await fetch(`${baseUrl}/api/applications/${applicationId}/recording`, { headers: { authorization: `Bearer ${lawyerActor.token}` } })
  assert.equal(lawyerPlayed.status, 200)
  assert.deepEqual(Buffer.from(await lawyerPlayed.arrayBuffer()), Buffer.alloc(4000, 7))

  const trail = (await request(`/api/applications/${applicationId}/audit`, { token: officer.token })).data
  assert.equal(trail.valid, true)
  assert.equal(trail.events.find((event) => event.action === 'CALL_RECORDING_STORED').newState.bytes, 4000)
})

test('the AI outline of a complaint is kept as unverified suggestions and never blocks the submission', async () => {
  const realFetch = globalThis.fetch
  const realKey = process.env.GROQ_API_KEY
  const answers = { callerRole: 'SELF', callerName: 'Fictional Shila', district: 'Rangpur', nidKnown: false, problem: 'Fictional account: the employer has not paid wages for three months.', urgent: false, contactChannel: 'UDC', safeTime: 'Morning' }
  // Only Groq is stubbed; calls to this test's own server pass through.
  const withGroq = async (reply, work) => {
    process.env.VOICE_AI = 'on'
    process.env.GROQ_API_KEY = realKey || 'test-key'
    globalThis.fetch = (url, init) => String(url).startsWith('https://api.groq.com/') ? Promise.resolve(reply()) : realFetch(url, init)
    try { return await work() } finally {
      globalThis.fetch = realFetch
      process.env.VOICE_AI = 'off'
      if (realKey === undefined) delete process.env.GROQ_API_KEY
      else process.env.GROQ_API_KEY = realKey
    }
  }
  const outline = { what: 'মজুরি দেওয়া হয়নি', when: 'তিন মাস ধরে', where: null, who: 'মালিক', type: 'MURDER', legalNeed: 'বকেয়া মজুরি আদায়ে সহায়তা' }
  const kept = await withGroq(() => Response.json({ choices: [{ message: { content: JSON.stringify(outline) } }] }), () => submitVoiceIntake({ mode: 'INTAKE', answers }))
  const aiFacts = await models.CaseFact.find({ applicationId: kept.applicationId, sourceType: 'AI_INFERRED' }).lean()
  // An unknown type and an empty place are dropped; the rest stay unconfirmed AI output.
  assert.deepEqual(aiFacts.map((fact) => fact.field).sort(), ['complaint.legal_need', 'incident.what', 'incident.when', 'incident.who'])
  assert.ok(aiFacts.every((fact) => fact.aiInferred && fact.captureMethod === 'AI' && !fact.callerConfirmed && !fact.applicantConfirmed))
  const failed = await withGroq(() => new Response('', { status: 500 }), () => submitVoiceIntake({ mode: 'INTAKE', answers }))
  assert.equal(await models.CaseFact.countDocuments({ applicationId: failed.applicationId, sourceType: 'AI_INFERRED' }), 0)
  assert.equal(await models.CaseFact.countDocuments({ applicationId: failed.applicationId }), 5) // the caller's answers are all there
})

test('Step 6 queue, human priority override, case reconstruction, and bounded helpline lookup', async () => {
  const officer = await actor('test6.officer', 'DLAO_OFFICER')
  const support = await actor('test6.support', 'CASE_SUPPORT')
  const helpline = await actor('test6.helpline', 'HELPLINE_AGENT')
  const outside = await actor('test6.outside', 'HELPLINE_AGENT')
  await models.RoleAssignment.updateOne({ userId: outside.user._id }, { $set: { officeCode: 'OTHER' } })
  const submitted = await request('/api/applications', { method: 'POST', token: helpline.token, body: { applicantName: 'Fictional Queue Applicant' } })
  assert.equal(submitted.status, 201)
  const { applicationId, lookupCode } = submitted.data
  assert.match(lookupCode, /^[a-f0-9]{24}$/)
  const status = (code, token = helpline.token, callerVerified = true, identifier = applicationId) => request('/api/applications/status-lookup', { method: 'POST', token, body: { identifier, lookupCode: code, callerVerified } })
  assert.equal((await status(lookupCode, helpline.token, false)).status, 400)
  assert.equal((await status(lookupCode)).data.error.code, 'UNSAFE_CONTACT')
  assert.equal((await status('0'.repeat(24))).status, 404)
  assert.equal((await status(lookupCode, support.token)).status, 403)
  assert.equal((await status(lookupCode, outside.token)).status, 404)
  const safe = await request(`/api/applications/${applicationId}/safe-contact`, { method: 'POST', token: officer.token, body: { allowedChannels: ['PHONE'], prohibitedChannels: ['SMS'], contactValue: '01700000000', smsSafe: false, neutralWordingRequired: true } })
  assert.equal(safe.status, 201)
  const fact = await request(`/api/applications/${applicationId}/facts`, { method: 'POST', token: officer.token, body: { field: 'safety.urgent', value: 'YES', sourceType: 'STAFF_ENTERED' } })
  assert.equal(fact.status, 201)
  const queue = await request('/api/workspace?role=DLAO_OFFICER', { token: officer.token })
  const item = queue.data.records.find((record) => record.applicationId === applicationId)
  assert.ok(item.flags.some((flag) => flag.code === 'URGENT_RECOMMENDATION' && /urgent fact/.test(flag.reason)))
  assert.equal(queue.data.report.counts.URGENT_RECOMMENDATION > 0, true)
  assert.deepEqual(queue.data.unavailableQueues, [])
  assert.equal(queue.data.report.counts.LAWYER_UPDATE_OVERDUE, 0)
  assert.equal((await request(`/api/applications/${applicationId}/priority-override`, { method: 'POST', token: support.token, body: { priorityDecision: 'ROUTINE', reason: 'Support may not decide human priority.' } })).status, 403)
  const overridden = await request(`/api/applications/${applicationId}/priority-override`, { method: 'POST', token: officer.token, body: { priorityDecision: 'ROUTINE', reason: 'Officer assessed the fictional urgency report.' } })
  assert.equal(overridden.status, 200)
  assert.equal((await request(`/api/applications/${applicationId}`, { token: officer.token })).data.priorityDecision, 'ROUTINE')
  const history = await request(`/api/applications/${applicationId}/history`, { token: support.token })
  assert.equal(history.data.valid, true)
  assert.ok(history.data.events.some((event) => event.action === 'HUMAN_PRIORITY_OVERRIDE'))
  assert.ok(history.data.events.every((event) => !('reason' in event) && !('newState' in event)))
  const result = await status(lookupCode)
  assert.equal(result.status, 200)
  assert.deepEqual(Object.keys(result.data).sort(), ['applicationId', 'caseId', 'nextAction', 'nextHearingAt', 'nextStep', 'status'])
  assert.equal(result.data.nextAction, null)
  assert.equal(result.data.nextHearingAt, null)
  assert.equal(result.data.status, 'SUBMITTED')
  assert.equal((await request(`/api/applications/${applicationId}/review`, { method: 'POST', token: officer.token, body: { reviewState: 'READY_FOR_DECISION', reason: 'Officer reviewed the fictional queue record.' } })).status, 200)
  const accepted = await request(`/api/applications/${applicationId}/accept`, { method: 'POST', token: officer.token, body: { reason: 'Officer accepted the fictional reviewed record.' } })
  assert.equal(accepted.status, 200)
  const byCase = await status(lookupCode, helpline.token, true, accepted.data.caseId)
  assert.equal(byCase.data.status, 'ACCEPTED')
  assert.equal(byCase.data.caseId, accepted.data.caseId)
  const contacts = await request(`/api/applications/${applicationId}/contact-attempts`, { token: support.token })
  assert.ok(contacts.data.some((attempt) => attempt.outcome === 'STATUS_LOOKUP' && attempt.disclosedSensitive === false))
  const audit = await request(`/api/applications/${applicationId}/audit`, { token: officer.token })
  assert.equal(audit.data.valid, true)
  assert.ok(audit.data.events.some((event) => event.action === 'HELPLINE_STATUS_LOOKUP'))
})

test('public case tracking shows progress only to the holder of the record lookup code', async () => {
  const officer = await actor('track.officer', 'DLAO_OFFICER')
  const helpline = await actor('track.helpline', 'HELPLINE_AGENT')
  const submitted = await request('/api/applications', { method: 'POST', token: helpline.token, body: { applicantName: 'Fictional Tracking Applicant' } })
  const { applicationId, lookupCode } = submitted.data
  const track = (identifier, code) => request('/api/applications/track', { method: 'POST', body: { identifier, lookupCode: code } })
  assert.equal((await request('/api/applications/track', { method: 'POST', body: { identifier: applicationId } })).status, 400)
  assert.equal((await track(applicationId, '0'.repeat(24))).data.error.code, 'NOT_FOUND')
  const tracked = await track(applicationId, lookupCode)
  assert.equal(tracked.status, 200)
  assert.equal(tracked.data.applicationId, applicationId)
  assert.equal(tracked.data.currentPhase, 2)
  assert.equal('lookupCodeHash' in tracked.data, false)
  assert.equal(JSON.stringify(tracked.data).includes('Fictional Tracking Applicant'), false)
  assert.equal((await track(String(Number(applicationId.slice(-6))), lookupCode.toUpperCase())).data.applicationId, applicationId)
  await request(`/api/applications/${applicationId}/review`, { method: 'POST', token: officer.token, body: { reviewState: 'READY_FOR_DECISION', reason: 'Officer reviewed the fictional tracking record.' } })
  const accepted = await request(`/api/applications/${applicationId}/accept`, { method: 'POST', token: officer.token, body: { reason: 'Officer accepted the fictional tracking record.' } })
  const byCase = await track(accepted.data.caseId, lookupCode)
  assert.equal(byCase.data.caseId, accepted.data.caseId)
  assert.equal(byCase.data.currentPhase, 3)
})

test('Step 7 assisted offline sync is idempotent, provenance-safe, and conflicts require human resolution', async () => {
  const udc = await actor('test7.udc', 'UDC_OPERATOR')
  const otherUdc = await actor('test7.otherudc', 'UDC_OPERATOR')
  const officer = await actor('test7.officer', 'DLAO_OFFICER')
  assert.equal((await request('/api/applications', { method: 'POST', token: udc.token, body: {} })).status, 403)
  const payload = (number) => ({
    temporaryId: randomUUID(), clientMutationId: randomUUID(), offlineCreatedAt: new Date().toISOString(),
    applicantName: `Fictional Nuching ${number}`, translatorName: 'Fictional Marma translator', typistName: 'Fictional UDC typist',
    helperPhone: '01700000000', originalLanguage: 'Marma', originalStatement: `Original Marma statement ${number}`,
    translatedStatement: `Translated Bangla statement ${number}`, caseType: 'LAND',
    consentAttestation: 'The fictional applicant gave oral consent through the named translator.',
    originalConfirmed: true, translationConfirmed: false, contactChannel: 'IN_PERSON', safeTime: 'Weekday morning',
  })
  const created = []
  for (let i = 1; i <= 3; i += 1) {
    const input = payload(i)
    const first = await request('/api/assisted', { method: 'POST', token: udc.token, body: input })
    assert.equal(first.status, 201)
    const replay = await request('/api/assisted', { method: 'POST', token: udc.token, body: input })
    assert.equal(replay.data.applicationId, first.data.applicationId)
    assert.equal(Boolean(replay.data.lookupCode), false)
    const storedMutation = await models.ClientMutation.findOne({ clientMutationId: input.clientMutationId }).lean()
    assert.equal(JSON.stringify(storedMutation.result).includes(first.data.lookupCode), false)
    created.push({ input, applicationId: first.data.applicationId })
  }
  assert.equal(await models.Application.countDocuments({ applicationId: { $in: created.map(({ applicationId }) => applicationId) } }), 3)
  const { input, applicationId } = created[0]
  assert.equal((await request('/api/assisted', { method: 'POST', token: udc.token, body: { ...input, originalStatement: 'Different text using same mutation ID' } })).data.error.code, 'IDEMPOTENCY_CONFLICT')
  assert.equal((await request(`/api/assisted/${applicationId}`, { token: otherUdc.token })).status, 403)
  const profile = await models.SafeContactProfile.findOne({ applicationId }).lean()
  assert.deepEqual(profile.allowedChannels, ['IN_PERSON'])
  assert.equal(profile.contactValue, undefined)
  const assistance = await models.AssistanceRecord.findOne({ applicationId }).lean()
  assert.equal(assistance.helperPhone, '01700000000')
  assert.notEqual(assistance.applicantPersonId.toString(), assistance.helperPersonId.toString())
  const facts = await models.CaseFact.find({ applicationId }).lean()
  assert.equal(facts.find((fact) => fact.field === 'complaint.original').sourceType, 'APPLICANT_REPORTED')
  assert.equal(facts.find((fact) => fact.field === 'complaint.translation').sourceType, 'INTERMEDIARY_TRANSLATED')
  assert.equal(facts.find((fact) => fact.field === 'complaint.translation').applicantConfirmed, false)
  assert.equal((await request(`/api/applications/${applicationId}/facts`, { token: udc.token })).status, 403)

  const revised = await request(`/api/assisted/${applicationId}/revisions`, { method: 'POST', token: udc.token, body: {
    temporaryId: input.temporaryId, clientMutationId: randomUUID(), baseVersion: 1,
    originalStatement: 'First corrected Marma account', translatedStatement: 'First corrected Bangla account',
    originalConfirmed: true, translationConfirmed: false,
  } })
  assert.equal(revised.status, 200)
  const stale = await request(`/api/assisted/${applicationId}/revisions`, { method: 'POST', token: udc.token, body: {
    temporaryId: input.temporaryId, clientMutationId: randomUUID(), baseVersion: 1,
    originalStatement: 'Second local Marma account', translatedStatement: 'Second local Bangla account',
    originalConfirmed: false, translationConfirmed: false,
  } })
  assert.equal(stale.status, 409)
  assert.equal(stale.data.kind, 'CONFLICT')
  assert.equal(stale.data.server.originalStatement, 'First corrected Marma account')
  assert.equal(stale.data.local.originalStatement, 'Second local Marma account')
  const resolution = {
    temporaryId: input.temporaryId, clientMutationId: randomUUID(), conflictMutationId: stale.data.conflictMutationId,
    expectedVersion: stale.data.serverVersion, choice: 'LOCAL', reason: 'A human compared both fictional versions and chose the corrected local account.',
  }
  const resolved = await request(`/api/assisted/${applicationId}/conflicts/resolve`, { method: 'POST', token: udc.token, body: resolution })
  assert.equal(resolved.status, 200)
  const resolutionReplay = await request(`/api/assisted/${applicationId}/conflicts/resolve`, { method: 'POST', token: udc.token, body: resolution })
  assert.equal(resolutionReplay.data.version, resolved.data.version)
  const snapshot = await request(`/api/assisted/${applicationId}`, { token: udc.token })
  assert.equal(snapshot.data.originalStatement, 'Second local Marma account')
  assert.equal(snapshot.data.integrityValid, true)
  assert.equal((await request(`/api/applications/${applicationId}/audit`, { token: officer.token })).data.events.some((event) => event.action === 'OFFLINE_CONFLICT_RESOLVED'), true)
})

test('Step 7 document briefing cites readable fictional text, exposes missing/uncertain items, and requires officer approval', async () => {
  const previousAi = process.env.DOCUMENT_AI
  process.env.DOCUMENT_AI = 'off'
  try {
    const udc = await actor('test7.docsudc', 'UDC_OPERATOR')
    const officer = await actor('test7.docsofficer', 'DLAO_OFFICER')
    const support = await actor('test7.docssupport', 'CASE_SUPPORT')
    const created = await request('/api/assisted', { method: 'POST', token: udc.token, body: {
      temporaryId: randomUUID(), clientMutationId: randomUUID(), applicantName: 'Fictional Nuching',
      translatorName: 'Fictional translator', typistName: 'Fictional typist', originalLanguage: 'Marma',
      originalStatement: 'Fictional original Marma account.', translatedStatement: 'Fictional Bangla account about land.',
      caseType: 'LAND', consentAttestation: 'Fictional oral consent was given after translation.',
      originalConfirmed: true, translationConfirmed: false, contactChannel: 'IN_PERSON',
    } })
    assert.equal(created.status, 201)
    const { applicationId } = created.data
    const samples = [
      ['Identity note', 'Applicant identity evidence', 'Fictional identity note for Nuching.\nIdentity remains incomplete.', 'READABLE'],
      ['Land deed scan', 'Land record or deed', 'Unclear scan; characters cannot be read.', 'UNREADABLE'],
      ['Plot location', 'Location or plot details', 'Fictional plot is in a named village.\nLocation requires officer confirmation.', 'READABLE'],
      ['Village meeting note', 'Other context', 'Fictional meeting note only.', 'READABLE'],
      ['UDC receipt', 'Other context', 'Fictional free-service receipt.', 'READABLE'],
      ['Map note', 'Other context', 'Fictional map note with no legal conclusion.', 'READABLE'],
    ]
    const uploaded = []
    for (const [label, checklistItem, textContent, qualityState] of samples) {
      const result = await request(`/api/applications/${applicationId}/documents`, { method: 'POST', token: officer.token,
        body: { label, checklistItem, filename: `${label.replaceAll(' ', '-')}.txt`, textContent, qualityState } })
      assert.equal(result.status, 201)
      uploaded.push(result.data)
    }
    assert.equal((await models.Document.countDocuments({ applicationId })), 6)
    assert.equal((await request(`/api/applications/${applicationId}/briefing`, { token: udc.token })).status, 403)
    const proposed = await request(`/api/applications/${applicationId}/briefing`, { method: 'POST', token: officer.token })
    assert.equal(proposed.status, 201)
    assert.equal(proposed.data.status, 'PROPOSED')
    assert.equal(proposed.data.model, 'deterministic-mock')
    assert.ok(proposed.data.missing.includes('Witness or other supporting record'))
    assert.ok(proposed.data.unreadable.includes('Land deed scan'))
    assert.ok(proposed.data.uncertain.includes('Land record or deed'))
    assert.equal(proposed.data.checklist.find(({ item }) => item === 'Land record or deed').status, 'UNCERTAIN')
    assert.equal(proposed.data.checklist.find(({ item }) => item === 'Applicant identity evidence').status, 'PRESENT_FOR_REVIEW')
    assert.equal(proposed.data.checklist.find(({ item }) => item === 'Witness or other supporting record').status, 'MISSING')
    assert.equal(proposed.data.points.length, 5)
    const sources = new Map(proposed.data.citations.map((citation) => [citation.sourceId, citation]))
    for (const point of proposed.data.points) {
      assert.ok(sources.has(point.sourceId))
      assert.ok(sources.get(point.sourceId).excerpt.includes(point.text))
      assert.ok(!/land deed scan/i.test(sources.get(point.sourceId).label))
    }
    assert.ok(proposed.data.citations.some((item) => item.label === 'Identity note' && item.line === 1))
    assert.ok(proposed.data.citations.every((item) => item.label !== 'Land deed scan'))
    const source = await request(`/api/documents/${uploaded[0].id}/versions/1/text`, { token: officer.token })
    assert.equal(source.status, 200)
    assert.match(source.data.textContent, /Identity remains incomplete/)
    assert.equal((await request(`/api/documents/${uploaded[0].id}/versions/1/text`, { token: support.token })).status, 403)
    assert.equal((await request(`/api/documents/${uploaded[1].id}/versions/1/text`, { token: officer.token })).status, 404)
    assert.equal((await request(`/api/applications/${applicationId}/briefing`, { token: support.token })).status, 200)
    assert.equal((await request(`/api/applications/${applicationId}/briefing`, { method: 'POST', token: support.token })).status, 403)
    assert.equal((await request(`/api/applications/${applicationId}/briefing/approve`, { method: 'POST', token: support.token, body: { reason: 'I checked the files.' } })).status, 403)
    await models.RoleAssignment.updateOne({ userId: support.user._id }, { $set: { officeCode: 'OTHER-DEMO' } })
    assert.equal((await request(`/api/applications/${applicationId}/briefing`, { token: support.token })).status, 403)
    const revised = await request(`/api/documents/${uploaded[0].id}/versions`, { method: 'POST', token: officer.token,
      body: { label: 'Identity note revised', checklistItem: 'Applicant identity evidence', filename: 'Identity-revised.txt', textContent: 'New fictional identity note.', qualityState: 'READABLE' } })
    assert.equal(revised.status, 201)
    const approval = { reason: 'Officer checked each fictional citation and its current source version.' }
    assert.equal((await request(`/api/applications/${applicationId}/briefing/approve`, { method: 'POST', token: officer.token, body: approval })).data.error.code, 'STALE_BRIEFING')
    assert.equal((await request(`/api/applications/${applicationId}/briefing`, { method: 'POST', token: officer.token })).status, 201)
    assert.equal((await request(`/api/applications/${applicationId}/briefing/approve`, { method: 'POST', token: officer.token, body: approval })).data.status, 'APPROVED')
    assert.equal((await request(`/api/applications/${applicationId}/audit`, { token: officer.token })).data.valid, true)
  } finally { if (previousAi === undefined) delete process.env.DOCUMENT_AI; else process.env.DOCUMENT_AI = previousAi }
})

test('Step 8 Nabila: urgency reasons, restricted evidence, tracked referral, overdue follow-up, and human routing after ping-pong', async () => {
  const officer = await actor('test8.officer', 'DLAO_OFFICER')
  const colleague = await actor('test8.colleague', 'DLAO_OFFICER')
  const support = await actor('test8.support', 'CASE_SUPPORT')
  const jhenaidah = await actor('test8.jhenaidah', 'RECEIVING_DLAO')
  const magura = await actor('test8.magura', 'RECEIVING_DLAO')
  const sameOffice = await actor('test8.sameoffice', 'RECEIVING_DLAO')
  await models.RoleAssignment.updateOne({ userId: jhenaidah.user._id }, { $set: { officeCode: 'JHENAIDAH-DEMO' } })
  await models.RoleAssignment.updateOne({ userId: magura.user._id }, { $set: { officeCode: 'MAGURA-DEMO' } })
  const post = (path, token, body) => request(path, { method: 'POST', token, body })

  const { applicationId } = (await post('/api/applications', officer.token, { applicantName: 'Fictional Nabila' })).data
  const base = `/api/applications/${applicationId}`
  assert.equal((await post(`${base}/facts`, officer.token, { field: 'safety.urgent', value: 'YES', sourceType: 'STAFF_ENTERED' })).status, 201)
  assert.equal((await post(`${base}/documents`, officer.token, { label: 'Fictional message log', qualityState: 'READABLE', sensitivity: 'SECRET' })).status, 400)
  const evidence = await post(`${base}/documents`, officer.token, { label: 'Synthetic placeholder for altered-image evidence', qualityState: 'READABLE', note: 'Harmless synthetic placeholder; no real image.', sensitivity: 'RESTRICTED' })
  assert.equal(evidence.status, 201)
  const log = await post(`${base}/documents`, officer.token, { label: 'Fictional message log summary', qualityState: 'READABLE' })
  assert.equal((await post(`/api/documents/${evidence.data.id}/versions`, officer.token, { label: 'Reclassify', qualityState: 'READABLE', sensitivity: 'STANDARD' })).status, 400)

  const record = (await request(base, { token: officer.token })).data
  assert.ok(record.urgencyReasons.some((reason) => /urgent fact is recorded/.test(reason)))
  assert.ok(record.urgencyReasons.some((reason) => /1 restricted sensitive-evidence item/.test(reason)))
  assert.equal(record.priorityDecision, null)
  const queueItem = (await request('/api/workspace?role=DLAO_OFFICER', { token: officer.token })).data.records.find((item) => item.applicationId === applicationId)
  assert.match(queueItem.flags.find((flag) => flag.code === 'URGENT_RECOMMENDATION').reason, /restricted sensitive-evidence.*Human decision: not recorded/)

  // Office role alone never opens restricted evidence; denials and grants are both logged.
  const supportDocs = (await request(`${base}/documents`, { token: support.token })).data
  assert.deepEqual(supportDocs.find((item) => item.id === evidence.data.id), { id: evidence.data.id, label: 'Restricted evidence (no access grant)', sensitivity: 'RESTRICTED', redacted: true })
  assert.equal((await request(`/api/documents/${evidence.data.id}`, { token: support.token })).status, 403)
  assert.equal((await request(`/api/documents/${evidence.data.id}`, { token: colleague.token })).status, 403)
  assert.equal((await request(`/api/documents/${evidence.data.id}`, { token: officer.token })).status, 200)

  const deadline = () => new Date(Date.now() + 86400000).toISOString()
  const referral = (receiver, extra = {}) => ({
    responsibleUserId: receiver.user.id, reason: 'Fictional altered-image harassment may need another competent authority.',
    history: 'Walk-in intake; urgent fact recorded; officer set urgent priority.', expectedAction: 'Acknowledge and confirm whether your office can act.',
    dueAt: deadline(), documentIds: [log.data.id], sensitiveDocumentIds: [], ...extra,
  })
  assert.equal((await post(`${base}/referrals`, officer.token, referral(jhenaidah))).data.error.code, 'CASE_REQUIRED')
  assert.equal((await post(`${base}/review`, officer.token, { reviewState: 'READY_FOR_DECISION', reason: 'Officer reviewed the fictional Nabila intake.' })).status, 200)
  assert.equal((await post(`${base}/accept`, officer.token, { reason: 'Officer accepted the fictional urgent matter.' })).status, 200)
  assert.equal((await post(`${base}/priority-override`, officer.token, { priorityDecision: 'URGENT', reason: 'Officer confirmed urgency from the recorded reasons.' })).status, 200)
  assert.equal((await post(`${base}/routing-decision`, officer.token, { route: 'REFER', officeCode: 'JHENAIDAH-DEMO', reason: 'Attempted route before escalation.' })).data.error.code, 'ROUTING_DECISION_NOT_DUE')

  assert.equal((await post(`${base}/referrals`, support.token, referral(jhenaidah))).status, 403)
  assert.equal((await post(`${base}/referrals`, officer.token, referral(sameOffice))).data.error.code, 'INVALID_RECEIVER')
  await models.User.updateOne({ _id: magura.user.id }, { $set: { active: false } })
  assert.equal((await post(`${base}/referrals`, officer.token, referral(magura))).data.error.code, 'INVALID_RECEIVER')
  await models.User.updateOne({ _id: magura.user.id }, { $set: { active: true } })
  assert.equal((await post(`${base}/referrals`, officer.token, { ...referral(jhenaidah), dueAt: '2020-01-01T00:00:00.000Z' })).status, 400)
  assert.equal((await post(`${base}/referrals`, officer.token, referral(jhenaidah, { documentIds: [evidence.data.id] }))).data.error.code, 'INVALID_DOCUMENT')
  assert.equal((await post(`${base}/referrals`, officer.token, referral(jhenaidah, { sensitiveDocumentIds: [evidence.data.id] }))).status, 400)
  assert.equal((await post(`${base}/referrals`, colleague.token, referral(jhenaidah, { sensitiveDocumentIds: [evidence.data.id], sensitiveAccessReason: 'Ungranted colleague tries to share evidence.' }))).status, 403)

  // Referral 1 carries no restricted evidence; the receiving office cannot open it.
  const first = await post(`${base}/referrals`, officer.token, referral(jhenaidah))
  assert.equal(first.status, 201)
  assert.equal((await post(`${base}/referrals`, officer.token, referral(magura))).data.error.code, 'REFERRAL_ACTIVE')
  assert.equal((await request(`/api/referrals/${first.data.id}`, { token: magura.token })).status, 403)
  const pkg = (await request(`/api/referrals/${first.data.id}`, { token: jhenaidah.token })).data
  assert.deepEqual([pkg.applicantName, pkg.reason, pkg.expectedAction, pkg.sendingOfficeCode, pkg.receivingOfficeCode, pkg.responsibleName, pkg.status],
    ['Fictional Nabila', referral(jhenaidah).reason, referral(jhenaidah).expectedAction, 'DEMO', 'JHENAIDAH-DEMO', 'Fictional RECEIVING_DLAO', 'SENT'])
  assert.deepEqual(pkg.documents.map(({ label }) => label), ['Fictional message log summary'])
  assert.equal(pkg.restrictedEvidenceCount, 0)
  assert.equal((await request(`/api/documents/${log.data.id}`, { token: jhenaidah.token })).status, 200)
  assert.equal((await request(`/api/documents/${evidence.data.id}`, { token: jhenaidah.token })).status, 403)
  assert.equal((await request('/api/workspace?role=RECEIVING_DLAO', { token: jhenaidah.token })).data.records[0].referralId, first.data.id)
  const waiting = (await request('/api/workspace?role=DLAO_OFFICER', { token: officer.token })).data.records.find((item) => item.applicationId === applicationId)
  assert.match(waiting.flags.find((flag) => flag.code === 'REFERRAL_WAITING').reason, /Awaiting acknowledgement from JHENAIDAH-DEMO/)

  // Non-acknowledgement: the sweep creates exactly one follow-up, however often it runs.
  const { sweepOverdueReferrals } = await import('./services/referralService.js')
  const late = new Date(Date.now() + 2 * 86400000)
  assert.equal(await sweepOverdueReferrals(late), 1)
  assert.equal(await sweepOverdueReferrals(late), 0)
  assert.equal(await models.Task.countDocuments({ applicationId, title: 'Referral not acknowledged: follow up', status: 'OPEN' }), 1)

  const respond = (id, token, body) => post(`/api/referrals/${id}/respond`, token, body)
  assert.equal((await respond(first.data.id, magura.token, { action: 'ACKNOWLEDGE' })).status, 403)
  assert.equal((await respond(first.data.id, jhenaidah.token, { action: 'RETURN' })).status, 400)
  assert.equal((await respond(first.data.id, jhenaidah.token, { action: 'ACKNOWLEDGE' })).data.status, 'ACKNOWLEDGED')
  assert.equal((await respond(first.data.id, jhenaidah.token, { action: 'ACKNOWLEDGE' })).status, 409)
  const firstReturn = await respond(first.data.id, jhenaidah.token, { action: 'RETURN', reason: 'Fictional: this office lacks jurisdiction over the online harm.' })
  assert.deepEqual([firstReturn.data.returns, firstReturn.data.escalated], [1, false])

  // Referral 2 shares restricted evidence only with its named responsible actor, and only while live.
  const second = await post(`${base}/referrals`, officer.token, referral(magura, { sensitiveDocumentIds: [evidence.data.id], sensitiveAccessReason: 'Receiving office must assess the synthetic image evidence to act.' }))
  assert.equal(second.status, 201)
  assert.equal((await request(`/api/referrals/${second.data.id}`, { token: magura.token })).data.documents.some(({ sensitivity }) => sensitivity === 'RESTRICTED'), true)
  assert.equal((await request(`/api/documents/${evidence.data.id}`, { token: magura.token })).status, 200)
  assert.equal((await request(`/api/documents/${evidence.data.id}`, { token: jhenaidah.token })).status, 403)
  const secondReturn = await respond(second.data.id, magura.token, { action: 'RETURN', reason: 'Fictional: returned; the first office should act.' })
  assert.deepEqual([secondReturn.data.returns, secondReturn.data.escalated], [2, true])
  assert.equal((await request(`/api/documents/${evidence.data.id}`, { token: magura.token })).status, 403)

  // Escalation blocks further transfers until an authorised human decides the route.
  const referrals = (await request(`${base}/referrals`, { token: officer.token })).data
  assert.equal(referrals.returns, 2)
  assert.match(referrals.escalation.title, /authorised routing decision required/)
  assert.deepEqual(referrals.referrals.map(({ responseReason }) => responseReason), ['Fictional: this office lacks jurisdiction over the online harm.', 'Fictional: returned; the first office should act.'])
  assert.equal((await post(`${base}/referrals`, officer.token, referral(jhenaidah))).data.error.code, 'ROUTING_DECISION_REQUIRED')
  const escalationTask = await models.Task.findOne({ applicationId, kind: 'ROUTING_DECISION', status: 'OPEN' })
  await models.Task.updateOne({ _id: escalationTask.id }, { $set: { status: 'DONE' } })
  assert.equal((await post(`${base}/referrals`, officer.token, referral(jhenaidah))).data.error.code, 'ROUTING_DECISION_REQUIRED')
  await models.Task.updateOne({ _id: escalationTask.id }, { $set: { status: 'OPEN' } })
  assert.equal((await post(`${base}/routing-decision`, support.token, { route: 'REFER', officeCode: 'JHENAIDAH-DEMO', reason: 'Support cannot decide routing.' })).status, 403)
  assert.equal((await post(`${base}/routing-decision`, officer.token, { route: 'REFER', officeCode: 'NOWHERE', reason: 'Office without a receiving DLAO.' })).status, 400)
  assert.equal((await post(`${base}/routing-decision`, officer.token, { route: 'REFER', officeCode: 'JHENAIDAH-DEMO', reason: 'Authorised officer decided Jhenaidah must act on the fictional matter.' })).status, 200)
  assert.equal((await post(`${base}/routing-decision`, officer.token, { route: 'RETAIN', reason: 'Attempted to overwrite the recorded route without a new return.' })).data.error.code, 'ROUTING_DECISION_NOT_DUE')
  assert.equal((await post(`${base}/referrals`, officer.token, referral(magura))).data.error.code, 'ROUTE_MISMATCH')
  const routed = await post(`${base}/referrals`, officer.token, referral(jhenaidah))
  assert.equal(routed.status, 201)
  assert.equal((await request(`/api/referrals/${routed.data.id}`, { token: jhenaidah.token })).data.previousReturns.length, 2)
  assert.equal((await respond(routed.data.id, jhenaidah.token, { action: 'ACCEPT', reason: 'Fictional: accepted as directed by the routing decision.' })).data.status, 'ACCEPTED')

  // A later return reopens review; the previous human decision cannot silently authorise another transfer.
  const later = await post(`${base}/referrals`, officer.token, referral(jhenaidah))
  assert.equal(later.status, 201)
  assert.deepEqual([(await respond(later.data.id, jhenaidah.token, { action: 'RETURN', reason: 'Fictional: the directed office returned the matter again.' })).data.returns,
    (await request(`${base}/referrals`, { token: officer.token })).data.escalation?.title],
  [3, 'Jurisdiction escalation: authorised routing decision required'])
  assert.equal((await post(`${base}/referrals`, officer.token, referral(jhenaidah))).data.error.code, 'ROUTING_DECISION_REQUIRED')
  assert.equal((await post(`${base}/routing-decision`, officer.token, { route: 'RETAIN', reason: 'Authorised officer keeps the fictional case with the sending office.' })).status, 200)
  assert.equal((await post(`${base}/referrals`, officer.token, referral(jhenaidah))).data.error.code, 'ROUTE_RETAINED')

  const access = (await request(`${base}/evidence-access`, { token: officer.token })).data
  assert.deepEqual(new Set(access.map(({ outcome, basis }) => `${outcome}:${basis}`)), new Set(['DENIED:NONE', 'GRANTED:EXPLICIT_GRANT', 'GRANTED:REFERRAL']))
  assert.equal((await request(`${base}/evidence-access`, { token: support.token })).status, 403)
  const audit = (await request(`${base}/audit`, { token: officer.token })).data
  assert.equal(audit.valid, true)
  for (const action of ['REFERRAL_SENT', 'REFERRAL_ACK_OVERDUE', 'REFERRAL_ACKNOWLEDGED', 'REFERRAL_RETURNED', 'JURISDICTION_ESCALATED', 'HUMAN_ROUTING_DECISION', 'REFERRAL_ACCEPTED']) {
    assert.ok(audit.events.some((event) => event.action === action), action)
  }
  assert.equal(audit.events.find((event) => event.action === 'JURISDICTION_ESCALATED').actorRole, 'SYSTEM')
  assert.equal(audit.events.find((event) => event.action === 'HUMAN_ROUTING_DECISION').actorRole, 'DLAO_OFFICER')
})
