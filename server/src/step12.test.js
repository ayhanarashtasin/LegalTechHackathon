import assert from 'node:assert/strict'
import { generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto'
import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, unlink, rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import mongoose from 'mongoose'
import app from './app.js'
import * as models from './models/index.js'
import { canonicalSettlement, settlementHash } from './services/settlementCrypto.js'
import { hashPassword } from './utils/password.js'

const databaseName = `dlas_step12_test_${randomBytes(6).toString('hex')}`
const server = createServer(app)
const previousSetting = process.env.SETTLEMENT_AI
process.env.SETTLEMENT_AI = 'off'
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
    if (mongoose.connection.name !== databaseName || !/^dlas_step12_test_[a-f0-9]{12}$/.test(databaseName)) throw new Error('Refusing to remove a non-test database.')
    await mongoose.connection.dropDatabase()
    await mongoose.disconnect()
  }
  if (previousSetting === undefined) delete process.env.SETTLEMENT_AI
  else process.env.SETTLEMENT_AI = previousSetting
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

async function post(path, token, body = {}) { return request(path, { method: 'POST', token, body }) }

async function witnessedCheck(code, applicationId, token, mode = 'IN_PERSON') {
  const started = await post('/api/mediation-signing/verification/begin', null, { code, mode, consent: true })
  assert.equal(started.status, 200)
  const decision = { verificationId: started.data.id, status: 'VERIFIED', reason: 'Fictional party presented their original fictional ID at the test office; no helper signed for them.', idReviewed: true, personMatched: true, challengeChecked: true }
  assert.equal((await post(`/api/applications/${applicationId}/mediation/identity/review`, token, decision)).status, 200)
  return started.data
}

async function acceptedApplication(token) {
  const submitted = await post('/api/applications', token, { applicantName: 'Fictional Step 12 maintenance applicant' })
  assert.equal(submitted.status, 201)
  const { applicationId } = submitted.data
  assert.equal((await post(`/api/applications/${applicationId}/review`, token, {
    reviewState: 'READY_FOR_DECISION', reason: 'A human DLAO officer reviewed this fictional maintenance application.',
  })).status, 200)
  const accepted = await post(`/api/applications/${applicationId}/accept`, token, { reason: 'A human DLAO officer accepted this fictional matter.' })
  assert.equal(accepted.status, 200)
  return applicationId
}

async function signature(draft, signerRole) {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  return {
    signerRole, draftVersion: draft.version, documentHash: settlementHash(draft),
    publicKeyJwk: publicKey.export({ format: 'jwk' }),
    signature: sign('sha256', Buffer.from(canonicalSettlement(draft)), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url'),
    clientMutationId: randomUUID(), clientSignedAt: new Date().toISOString(),
  }
}

test('Step 12: one Case flows through mediator review, async signatures, integrity checks, and gated CLAO certification', async () => {
  const officer = await actor('test12.officer', 'DLAO_OFFICER')
  const mediator = await actor('test12.mediator', 'MEDIATOR')
  const clao = await actor('test12.clao', 'CLAO')
  const outsideMediator = await actor('test12.outside', 'MEDIATOR', 'OTHER')
  const unrelatedMediator = await actor('test12.unrelated', 'MEDIATOR')
  const applicationId = await acceptedApplication(officer.token)
  const start = await post(`/api/applications/${applicationId}/mediation`, officer.token)
  assert.equal(start.status, 201)
  const caseId = start.data.caseId
  assert.equal(start.data.stage, 'REGISTRATION')
  assert.equal((await post(`/api/applications/${applicationId}/mediation`, officer.token)).status, 201)
  assert.equal((await request(`/api/applications/${applicationId}/mediation`, { token: outsideMediator.token })).status, 403)

  assert.equal((await post(`/api/applications/${applicationId}/mediation/claim`, mediator.token)).data.mediatorUserId, String(mediator.user._id))
  let result = await post(`/api/applications/${applicationId}/mediation/schedule`, mediator.token, {
    mode: 'REMOTE', scheduledAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    inPersonFallback: 'Meet at the fictional district legal-aid office if remote access fails.',
    notices: ['PARTY_A', 'PARTY_B'].map((party) => ({ party, deliveryState: 'DELIVERED', reason: 'A human used the separately verified safe contact route.' })),
  })
  assert.equal(result.data.stage, 'SCHEDULING_NOTICES')
  assert.equal((await post(`/api/applications/${applicationId}/mediation/advance`, mediator.token)).data.stage, 'DOCUMENT_REVIEW')
  assert.equal((await post(`/api/applications/${applicationId}/mediation/documents/review`, mediator.token, { reason: 'The mediator reviewed the fictional record and explained that no document was legally verified.' })).status, 200)
  assert.equal((await post(`/api/applications/${applicationId}/mediation/advance`, mediator.token)).data.stage, 'ATTENDANCE')
  assert.equal((await post(`/api/applications/${applicationId}/mediation/attendance`, mediator.token, {
    partyA: 'ATTENDED', partyB: 'REPRESENTED', reason: 'Both fictional parties or their representatives were recorded as present.',
  })).status, 200)
  assert.equal((await post(`/api/applications/${applicationId}/mediation/advance`, mediator.token)).data.stage, 'MEDIATION')
  assert.equal((await post(`/api/applications/${applicationId}/mediation/outcome`, mediator.token, {
    outcome: 'AGREEMENT_REACHED', reason: 'The mediator recorded the parties’ fictional agreement; no legal effect is inferred.',
  })).status, 200)

  const sourceNotes = 'SyntheticStep12NotesOnly: monthly amount 500; first due date 2026-08-20; review date 2026-08-10.'
  const originalFetch = globalThis.fetch
  const previousKey = process.env.GROQ_API_KEY
  const previousAi = process.env.SETTLEMENT_AI
  let providerBody
  process.env.GROQ_API_KEY = 'step12-test-only-not-a-real-key'
  process.env.SETTLEMENT_AI = 'on'
  globalThis.fetch = async (url, init) => {
    if (!String(url).startsWith('https://api.groq.com/openai/v1/')) return originalFetch(url, init)
    providerBody = JSON.parse(init.body)
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
      arrangement: 'Fictional monthly maintenance arrangement.', amount: '500 each month', firstDueDate: '2026-08-20',
      paymentMethod: 'Not recorded in the mediator notes.', reviewDate: '2026-08-10',
      inconsistencies: ['Review date comes before the first due date; the mediator must confirm both dates.'],
    }) } }] }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  try {
    result = await post(`/api/applications/${applicationId}/mediation/draft`, mediator.token, { template: 'MAINTENANCE', notes: sourceNotes, identifiersRemoved: true })
  } finally {
    globalThis.fetch = originalFetch
    if (previousKey === undefined) delete process.env.GROQ_API_KEY
    else process.env.GROQ_API_KEY = previousKey
    process.env.SETTLEMENT_AI = previousAi
  }
  assert.equal(result.status, 201)
  assert.equal(result.data.stage, 'DRAFT_OUTCOME')
  assert.equal(result.data.draft.aiAssisted, true)
  assert.equal(result.data.draft.templateRevision, 'demo-1')
  assert.equal(result.data.draft.templateApprovalState, 'LEGAL_APPROVAL_PENDING')
  assert.match(result.data.draft.templateExample, /Party A and Party B/)
  assert.equal(result.data.draft.model.startsWith('groq:'), true)
  assert.equal(result.data.draft.sections.find(({ key }) => key === 'paymentMethod').aiFilled, false)
  assert.ok(result.data.draft.sections.filter(({ key }) => key !== 'paymentMethod').every(({ aiFilled }) => aiFilled))
  assert.match(result.data.draft.inconsistencies[0], /review date comes before/i)
  assert.ok(result.data.draft.inconsistencies.some((warning) => /payment method is missing/i.test(warning)))
  const aiSchema = providerBody.response_format.json_schema.schema
  assert.equal(aiSchema.additionalProperties, false)
  assert.deepEqual(Object.keys(aiSchema.properties).sort(), ['arrangement', 'amount', 'firstDueDate', 'inconsistencies', 'paymentMethod', 'reviewDate'].sort())
  const providerInput = JSON.parse(providerBody.messages[1].content)
  assert.equal(providerInput.mediatorNotes, sourceNotes)
  assert.equal(JSON.stringify(providerBody).includes('Fictional Step 12 maintenance applicant'), false)
  assert.equal(JSON.stringify(await models.SettlementDraft.findOne({ applicationId }).lean()).includes(sourceNotes), false)
  assert.equal((await models.Case.find({ applicationId })).length, 1)
  assert.equal((await models.Mediation.find({ applicationId })).length, 1)

  const notConsented = await post(`/api/applications/${applicationId}/mediation/draft/review`, mediator.token, {
    partyAUnderstands: true, partyAConsents: true, partyBUnderstands: true, partyBConsents: false,
    reason: 'Party B has not confirmed understanding and consent; keep this in human review.',
  })
  assert.equal(notConsented.data.stage, 'DRAFT_OUTCOME')
  assert.equal(notConsented.data.draft.status, 'HUMAN_REVIEW')
  assert.equal((await post(`/api/applications/${applicationId}/mediation/draft/review`, mediator.token, {
    partyAUnderstands: true, partyAConsents: true, partyBUnderstands: true, partyBConsents: true,
    reason: 'The mediator reviewed the proposed draft but has not acknowledged its warnings.',
  })).data.error.code, 'WARNINGS_NOT_REVIEWED')
  result = await post(`/api/applications/${applicationId}/mediation/draft/review`, mediator.token, {
    partyAUnderstands: true, partyAConsents: true, partyBUnderstands: true, partyBConsents: true,
    warningsReviewed: true,
    reason: 'Both parties separately confirmed understanding and consent with the mediator.',
  })
  assert.equal(result.data.stage, 'SIGNATURES')

  const draft = result.data.draft
  const partyA = await signature(draft, 'PARTY_A')
  const partyAInvitation = await post(`/api/applications/${applicationId}/mediation/signing-invitations`, mediator.token, { signerRole: 'PARTY_A' })
  assert.equal(partyAInvitation.status, 201)
  assert.equal(partyAInvitation.data.code.length, 43)
  assert.equal(JSON.stringify(partyAInvitation.data.mediation).includes(partyAInvitation.data.code), false)
  const code = partyAInvitation.data.code
  assert.equal((await post('/api/mediation-signing/open', null, { code })).data.error.code, 'IDENTITY_VERIFICATION_REQUIRED')
  assert.equal((await post('/api/mediation-signing/sign', null, { code, ...partyA, partyConfirmed: true })).data.error.code, 'IDENTITY_VERIFICATION_REQUIRED')
  assert.equal((await post('/api/mediation-signing/verification/begin', null, { code, mode: 'REMOTE_VIDEO', consent: false })).status, 400)
  const remote = await post('/api/mediation-signing/verification/begin', null, { code, mode: 'REMOTE_VIDEO', consent: true })
  assert.equal(remote.data.status, 'CAPTURING')
  assert.match(remote.data.challenge, /\d{4}/)
  const upload = async (slot, mime, bytes) => fetch(`${baseUrl}/api/mediation-signing/verification/evidence/${slot}`, { method: 'POST', headers: { 'X-Signing-Code': code, 'Content-Type': mime }, body: bytes })
  assert.equal((await upload('ID', 'image/png', Buffer.alloc(32))).status, 400)
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0uoAAAAASUVORK5CYII=', 'base64')
  const idUpload = await upload('ID', 'image/png', image)
  assert.equal(idUpload.status, 201)
  const idEvidence = await idUpload.json()
  const stored = await models.PartyEvidence.findById(idEvidence.id).select('+ciphertext')
  assert.equal(stored.ciphertext.equals(image), false)
  assert.equal((await models.PartyEvidence.findById(idEvidence.id).lean()).ciphertext, undefined)
  const folder = await mkdtemp(join(tmpdir(), 'dlas-test-video-'))
  const videoPath = join(folder, 'fictional.webm')
  try {
    await promisify(execFile)('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=160x120:r=10', '-t', '5', '-c:v', 'libvpx', videoPath], { windowsHide: true })
    assert.equal((await upload('VIDEO', 'video/webm', await readFile(videoPath))).status, 201)
    await promisify(execFile)('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=160x120:r=10', '-t', '1', '-c:v', 'libvpx', videoPath], { windowsHide: true })
    assert.equal((await upload('VIDEO', 'video/webm', await readFile(videoPath))).status, 400)
  } finally { await unlink(videoPath).catch(() => {}); await rmdir(folder) }
  const privatePath = `/api/mediation-signing/verification/evidence/${idEvidence.id}`
  assert.equal((await fetch(`${baseUrl}${privatePath}`)).status, 403)
  const ownEvidence = await fetch(`${baseUrl}${privatePath}`, { headers: { 'X-Signing-Code': code } })
  assert.equal(ownEvidence.headers.get('cache-control'), 'no-store')
  assert.equal(Buffer.from(await ownEvidence.arrayBuffer()).equals(image), true)
  assert.equal((await request(`/api/applications/${applicationId}/mediation/identity`, { token: officer.token })).status, 403)
  assert.equal((await request(`/api/applications/${applicationId}/mediation/identity`, { token: outsideMediator.token })).status, 403)
  assert.equal((await request(`/api/applications/${applicationId}/mediation/identity`, { token: unrelatedMediator.token })).status, 403)
  assert.equal((await post('/api/mediation-signing/verification/submit', null, { code, documentType: 'PASSPORT' })).data.status, 'PENDING_REVIEW')
  const review = { verificationId: remote.data.id, status: 'VERIFIED', reason: 'Synthetic video and fictional document checked for this automated check only.', idReviewed: true, personMatched: true, challengeChecked: true }
  assert.equal((await post(`/api/applications/${applicationId}/mediation/identity/review`, officer.token, review)).status, 403)
  assert.equal((await post(`/api/applications/${applicationId}/mediation/identity/review`, mediator.token, { ...review, personMatched: false })).status, 400)
  assert.equal((await post(`/api/applications/${applicationId}/mediation/identity/review`, mediator.token, review)).status, 200)
  assert.equal((await post('/api/mediation-signing/open', null, { code })).data.documentHash, partyA.documentHash)
  assert.equal((await post(`/api/applications/${applicationId}/mediation/identity/review`, mediator.token, { ...review, status: 'MANUAL_REVIEW_REQUIRED' })).status, 200)
  assert.equal((await post('/api/mediation-signing/open', null, { code })).status, 403)
  const restarted = await witnessedCheck(code, applicationId, mediator.token)
  assert.notEqual(restarted.id, remote.data.id)
  await models.PartyVerification.updateOne({ _id: restarted.id }, { expiresAt: new Date(Date.now() - 1000) })
  assert.equal((await post('/api/mediation-signing/open', null, { code })).status, 403)
  await models.PartyVerification.updateOne({ _id: restarted.id }, { expiresAt: partyAInvitation.data.expiresAt })
  assert.equal((await post(`/api/applications/${applicationId}/mediation/signatures`, mediator.token, partyA)).data.error.code, 'PARTY_SIGNING_CODE_REQUIRED')
  const invalid = { ...partyA, signature: `${partyA.signature.startsWith('A') ? 'B' : 'A'}${partyA.signature.slice(1)}` }
  assert.equal((await post('/api/mediation-signing/sign', null, { code: partyAInvitation.data.code, ...invalid, partyConfirmed: true })).data.error.code, 'INVALID_SIGNATURE')
  assert.equal((await post('/api/mediation-signing/sign', null, { code: partyAInvitation.data.code, ...partyA, partyConfirmed: false })).status, 400)
  const mediatorFirst = await signature(draft, 'MEDIATOR')
  assert.equal((await post(`/api/applications/${applicationId}/mediation/signatures`, mediator.token, mediatorFirst)).data.error.code, 'PARTIES_MUST_SIGN_FIRST')
  const replacedA = await post(`/api/applications/${applicationId}/mediation/signing-invitations`, mediator.token, { signerRole: 'PARTY_A' })
  assert.equal(replacedA.status, 201)
  assert.equal((await post('/api/mediation-signing/open', null, { code: partyAInvitation.data.code })).status, 404)
  assert.equal((await post('/api/mediation-signing/open', null, { code: replacedA.data.code })).status, 403)
  assert.equal((await fetch(`${baseUrl}${privatePath}`, { headers: { 'X-Signing-Code': replacedA.data.code } })).status, 403)
  await witnessedCheck(replacedA.data.code, applicationId, mediator.token)
  assert.equal((await fetch(`${baseUrl}/api/mediation-signing/verification/evidence/SIGNATURE`, { method: 'POST', headers: { 'X-Signing-Code': replacedA.data.code, 'Content-Type': 'image/png' }, body: image })).status, 201)
  assert.equal((await post('/api/mediation-signing/sign', null, { code: replacedA.data.code, ...partyA, partyConfirmed: true })).status, 201)
  assert.equal((await post('/api/mediation-signing/sign', null, { code: replacedA.data.code, ...partyA, partyConfirmed: true })).status, 201)
  assert.equal(await models.SignatureRecord.countDocuments({ applicationId }), 1)
  const recordedParty = await models.SignatureRecord.findOne({ applicationId, signerRole: 'PARTY_A' })
  assert.ok(recordedParty.identityVerificationId)
  assert.ok(recordedParty.signatureEvidenceId)
  assert.equal((await post('/api/mediation-signing/open', null, { code: replacedA.data.code })).status, 404)
  const partyBInvitation = await post(`/api/applications/${applicationId}/mediation/signing-invitations`, mediator.token, { signerRole: 'PARTY_B' })
  assert.equal(partyBInvitation.status, 201)
  const assisted = await witnessedCheck(partyBInvitation.data.code, applicationId, mediator.token, 'ASSISTED')
  assert.equal(assisted.mode, 'ASSISTED')
  assert.equal((await fetch(`${baseUrl}${privatePath}`, { headers: { 'X-Signing-Code': partyBInvitation.data.code } })).status, 403)
  assert.equal((await post('/api/mediation-signing/sign', null, { code: partyBInvitation.data.code, ...await signature(draft, 'PARTY_B'), partyConfirmed: true })).status, 201)
  result = await post(`/api/applications/${applicationId}/mediation/signatures`, mediator.token, await signature(draft, 'MEDIATOR'))
  assert.equal(result.data.stage, 'PENDING_CLAO_CERTIFICATION')
  assert.equal(result.data.legalEffectState, 'LEGAL_EFFECT_REQUIRES_AUTHORISED_REVIEW')
  assert.equal((await models.SignatureRecord.find({ applicationId }).lean()).some(({ privateKey }) => Boolean(privateKey)), false)
  assert.deepEqual(Object.fromEntries((await models.SignatureRecord.find({ applicationId }).lean()).map(({ signerRole, authorizationMethod }) => [signerRole, authorizationMethod])), { PARTY_A: 'PARTY_CODE', PARTY_B: 'PARTY_CODE', MEDIATOR: 'MEDIATOR_SESSION' })

  const initialVerification = await post(`/api/applications/${applicationId}/mediation/verify`, mediator.token)
  assert.equal(initialVerification.data.allValid, true)
  assert.equal(initialVerification.data.signatures.length, 3)
  assert.equal((await post(`/api/applications/${applicationId}/mediation/legal-applicability`, clao.token, {
    applicability: 'APPLICABLE_VERIFIED', basis: 'Fictional authorised legal review and applicable Gazette/date/area reference recorded for this test only.',
  })).data.legalEffectState, 'PENDING_CLAO_CERTIFICATION')
  assert.equal((await models.Mediation.findOne({ applicationId }).lean()).stage, 'PENDING_CLAO_CERTIFICATION')
  const originalSections = result.data.draft.sections
  const changedSections = originalSections.map((section, index) => index ? section : { ...section, text: `${section.text} changed` })
  await models.SettlementDraft.updateOne({ applicationId }, { $set: { sections: changedSections } })
  assert.equal((await post(`/api/applications/${applicationId}/mediation/verify`, mediator.token)).data.allValid, false)
  assert.equal((await post(`/api/applications/${applicationId}/mediation/certify`, clao.token, { reason: 'Try certification with a changed signed document.', signature: await signature(draft, 'CLAO') })).data.error.code, 'SIGNATURE_VERIFICATION_FAILED')
  await models.SettlementDraft.updateOne({ applicationId }, { $set: { sections: originalSections } })
  assert.equal((await post(`/api/applications/${applicationId}/mediation/verify`, mediator.token)).data.allValid, true)
  const reason = 'CLAO independently reviewed the fictional file and records certification.'
  // Certification needs the CLAO's own signature over the same document; a reason alone or a forged signature is refused.
  assert.equal((await post(`/api/applications/${applicationId}/mediation/certify`, clao.token, { reason })).status, 400)
  assert.equal((await post(`/api/applications/${applicationId}/mediation/certify`, clao.token, { reason, signature: await signature(draft, 'MEDIATOR') })).status, 400)
  const forged = { ...await signature(draft, 'CLAO'), signature: (await signature(draft, 'CLAO')).signature }
  assert.equal((await post(`/api/applications/${applicationId}/mediation/certify`, clao.token, { reason, signature: forged })).data.error.code, 'INVALID_SIGNATURE')
  assert.equal((await post(`/api/applications/${applicationId}/mediation/certify`, officer.token, { reason, signature: await signature(draft, 'CLAO') })).status, 403)
  const pendingWorkspace = await request('/api/workspace?role=CLAO', { token: clao.token })
  assert.deepEqual(pendingWorkspace.data.certifications.map(({ applicationId: id, stage }) => [id, stage]), [[applicationId, 'PENDING_CLAO_CERTIFICATION']])
  const certified = await post(`/api/applications/${applicationId}/mediation/certify`, clao.token, { reason, signature: await signature(draft, 'CLAO') })
  assert.equal(certified.data.stage, 'CERTIFIED_FINAL')
  assert.equal(certified.data.signatures.filter(({ signerRole }) => signerRole === 'CLAO').length, 1)
  assert.equal((await models.SignatureRecord.findOne({ applicationId, signerRole: 'CLAO' }).lean()).authorizationMethod, 'CLAO_SESSION')
  const finalCheck = await post(`/api/applications/${applicationId}/mediation/verify`, clao.token)
  assert.equal(finalCheck.data.allValid, true)
  assert.equal(finalCheck.data.signatures.length, 4)
  const audit = await request(`/api/applications/${applicationId}/audit`, { token: officer.token })
  assert.equal(audit.data.valid, true)
  assert.equal(JSON.stringify(audit.data.events).includes(sourceNotes), false)
  assert.ok(audit.data.events.some(({ action }) => action === 'MEDIATION_SIGNATURE_RECORDED'))
  assert.ok(audit.data.events.some(({ action }) => action === 'CLAO_CERTIFICATION_RECORDED'))
  assert.equal((await models.Application.findOne({ applicationId }).lean()).caseId, caseId)
})

test('T7: property and labour drafts use their controlled examples, date warnings, and human review', async () => {
  const officer = await actor('test12.t7.officer', 'DLAO_OFFICER')
  const mediator = await actor('test12.t7.mediator', 'MEDIATOR')
  const proposals = {
    PROPERTY: {
      propertyDescription: 'Fictional plot recorded in the notes', proposedSteps: 'Exchange the fictional title copies',
      responsibleParty: 'Party A and Party B will exchange their own copies', completionDate: '2026-10-20', followUpDate: '2026-10-10',
      inconsistencies: ['The mediator must confirm the property description with both parties.'],
    },
    LABOUR: {
      workDescription: 'Fictional wage issue recorded in the notes', amount: 'Not recorded in the mediator notes; mediator completion required.',
      paymentSchedule: 'One payment after the wage record is checked', dueDate: '2026-10-20', followUpDate: '2026-10-10',
      inconsistencies: [],
    },
  }
  for (const template of ['PROPERTY', 'LABOUR']) {
    const applicationId = await acceptedApplication(officer.token)
    const path = `/api/applications/${applicationId}/mediation`
    assert.equal((await post(path, officer.token)).status, 201)
    assert.equal((await post(`${path}/claim`, mediator.token)).status, 200)
    assert.equal((await post(`${path}/schedule`, mediator.token, {
      mode: 'IN_PERSON', scheduledAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(), venue: 'Fictional DLAO room',
      notices: ['PARTY_A', 'PARTY_B'].map((party) => ({ party, deliveryState: 'DELIVERED', reason: 'A human recorded fictional delivery.' })),
    })).status, 200)
    assert.equal((await post(`${path}/advance`, mediator.token)).data.stage, 'DOCUMENT_REVIEW')
    assert.equal((await post(`${path}/documents/review`, mediator.token, { reason: 'A human reviewed the fictional documents.' })).status, 200)
    assert.equal((await post(`${path}/advance`, mediator.token)).data.stage, 'ATTENDANCE')
    assert.equal((await post(`${path}/attendance`, mediator.token, {
      partyA: 'ATTENDED', partyB: 'ATTENDED', reason: 'Both fictional parties attended in person.',
    })).status, 200)
    assert.equal((await post(`${path}/advance`, mediator.token)).data.stage, 'MEDIATION')
    assert.equal((await post(`${path}/outcome`, mediator.token, { outcome: 'AGREEMENT_REACHED', reason: 'The mediator recorded a fictional agreement.' })).status, 200)

    const originalFetch = globalThis.fetch
    const previousKey = process.env.GROQ_API_KEY
    const previousAi = process.env.SETTLEMENT_AI
    process.env.GROQ_API_KEY = 'step12-t7-test-only-not-a-real-key'
    process.env.SETTLEMENT_AI = 'on'
    globalThis.fetch = async (url, init) => String(url).startsWith('https://api.groq.com/openai/v1/')
      ? new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(proposals[template]) } }] }), { status: 200, headers: { 'content-type': 'application/json' } })
      : originalFetch(url, init)
    let result
    try {
      result = await post(`${path}/draft`, mediator.token, {
        template, notes: `Fictional ${template.toLowerCase()} notes: completion or due date 2026-10-20; follow-up 2026-10-10.`, identifiersRemoved: true,
      })
    } finally {
      globalThis.fetch = originalFetch
      if (previousKey === undefined) delete process.env.GROQ_API_KEY
      else process.env.GROQ_API_KEY = previousKey
      process.env.SETTLEMENT_AI = previousAi
    }
    assert.equal(result.status, 201)
    assert.equal(result.data.draft.template, template)
    assert.equal(result.data.draft.templateRevision, 'demo-1')
    assert.match(result.data.draft.templateExample, /Party A and Party B/)
    assert.equal(result.data.draft.aiAssisted, true)
    assert.ok(result.data.draft.inconsistencies.some((warning) => /comes before/.test(warning)))
    if (template === 'PROPERTY') {
      const sections = result.data.draft.sections.map(({ key, text }) => ({ key, text: key === 'followUpDate' ? '2026-10-30' : text }))
      result = await post(`${path}/draft/amend`, mediator.token, { template, sections, reason: 'The mediator corrected the fictional follow-up date.' })
      assert.equal(result.status, 200)
      assert.equal(result.data.draft.version, 2)
      assert.deepEqual(result.data.draft.inconsistencies, proposals.PROPERTY.inconsistencies)
      assert.equal(result.data.draft.sections.find(({ key }) => key === 'followUpDate').aiFilled, false)
    } else {
      assert.equal(result.data.draft.sections.find(({ key }) => key === 'amount').aiFilled, false)
      assert.ok(result.data.draft.inconsistencies.some((warning) => /amount.*missing/i.test(warning)))
      assert.equal((await post(`${path}/draft/review`, mediator.token, {
        partyAUnderstands: true, partyAConsents: true, partyBUnderstands: true, partyBConsents: true,
        reason: 'The mediator has not acknowledged the draft warnings.',
      })).data.error.code, 'WARNINGS_NOT_REVIEWED')
    }
    result = await post(`${path}/draft/review`, mediator.token, {
      partyAUnderstands: true, partyAConsents: true, partyBUnderstands: true, partyBConsents: true,
      warningsReviewed: true,
      reason: 'The mediator reviewed the fictional text and both parties recorded understanding and consent.',
    })
    assert.equal(result.status, 200)
    assert.equal(result.data.stage, 'SIGNATURES')
  }
})

test('CLAO sees the DLAO office view read-only and cannot take DLAO decisions', async () => {
  const officer = await actor('test12.view.officer', 'DLAO_OFFICER')
  const clao = await actor('test12.view.clao', 'CLAO')
  const outsideClao = await actor('test12.view.outside', 'CLAO', 'OTHER')
  const submitted = await post('/api/applications', officer.token, { applicantName: 'Fictional CLAO view applicant' })
  const { applicationId } = submitted.data
  const pendingId = (await post('/api/applications', officer.token, { applicantName: 'Fictional CLAO pending applicant' })).data.applicationId
  const acceptedId = await acceptedApplication(officer.token)
  const { caseId } = (await request(`/api/applications/${acceptedId}`, { token: officer.token })).data

  const dlao = await request('/api/workspace?role=DLAO_OFFICER', { token: officer.token })
  const view = await request('/api/workspace?role=CLAO', { token: clao.token })
  assert.equal(view.status, 200)
  assert.equal(view.data.readOnly, true)
  assert.deepEqual(view.data.records.map(({ applicationId: id }) => id).sort(), dlao.data.records.map(({ applicationId: id }) => id).sort())
  for (const key of ['hearingList', 'mediationList', 'lawyerFeedback', 'calendarEvents', 'certifications']) assert.ok(Array.isArray(view.data[key]), key)
  assert.equal(dlao.data.certifications, undefined)

  // Reading is allowed in the CLAO's own office, including records with no mediation.
  assert.equal((await request(`/api/applications/${applicationId}`, { token: clao.token })).status, 200)
  assert.deepEqual((await request(`/api/applications/${applicationId}/mediation`, { token: clao.token })).data, { mediation: null })
  assert.equal((await request(`/api/cases/${encodeURIComponent(caseId)}`, { token: clao.token })).data.applicationId, acceptedId)
  assert.equal((await request(`/api/applications/${applicationId}`, { token: outsideClao.token })).status, 403)

  // DLAO decisions stay with the DLAO office.
  assert.equal((await post(`/api/applications/${pendingId}/review`, clao.token, { reviewState: 'READY_FOR_DECISION', reason: 'A CLAO must not record DLAO review decisions.' })).status, 403)
  assert.equal((await post(`/api/applications/${pendingId}/accept`, clao.token, { reason: 'A CLAO must not accept DLAO applications.' })).status, 403)
  assert.equal((await post(`/api/applications/${acceptedId}/mediation`, clao.token)).status, 403)
})
