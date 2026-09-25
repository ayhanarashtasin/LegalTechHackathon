import assert from 'node:assert/strict'
import { generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto'
import { createServer } from 'node:http'
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
  assert.equal((await post('/api/mediation-signing/open', null, { code: partyAInvitation.data.code })).data.documentHash, partyA.documentHash)
  assert.equal((await post(`/api/applications/${applicationId}/mediation/signatures`, mediator.token, partyA)).data.error.code, 'PARTY_SIGNING_CODE_REQUIRED')
  const invalid = { ...partyA, signature: `${partyA.signature.startsWith('A') ? 'B' : 'A'}${partyA.signature.slice(1)}` }
  assert.equal((await post('/api/mediation-signing/sign', null, { code: partyAInvitation.data.code, ...invalid, partyConfirmed: true })).data.error.code, 'INVALID_SIGNATURE')
  assert.equal((await post('/api/mediation-signing/sign', null, { code: partyAInvitation.data.code, ...partyA, partyConfirmed: false })).status, 400)
  const mediatorFirst = await signature(draft, 'MEDIATOR')
  assert.equal((await post(`/api/applications/${applicationId}/mediation/signatures`, mediator.token, mediatorFirst)).data.error.code, 'PARTIES_MUST_SIGN_FIRST')
  const replacedA = await post(`/api/applications/${applicationId}/mediation/signing-invitations`, mediator.token, { signerRole: 'PARTY_A' })
  assert.equal(replacedA.status, 201)
  assert.equal((await post('/api/mediation-signing/open', null, { code: partyAInvitation.data.code })).status, 404)
  assert.equal((await post('/api/mediation-signing/sign', null, { code: replacedA.data.code, ...partyA, partyConfirmed: true })).status, 201)
  assert.equal((await post('/api/mediation-signing/sign', null, { code: replacedA.data.code, ...partyA, partyConfirmed: true })).status, 201)
  assert.equal(await models.SignatureRecord.countDocuments({ applicationId }), 1)
  assert.equal((await post('/api/mediation-signing/open', null, { code: replacedA.data.code })).status, 404)
  const partyBInvitation = await post(`/api/applications/${applicationId}/mediation/signing-invitations`, mediator.token, { signerRole: 'PARTY_B' })
  assert.equal(partyBInvitation.status, 201)
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
  assert.equal((await post(`/api/applications/${applicationId}/mediation/certify`, clao.token, { reason: 'Try certification with a changed signed document.' })).data.error.code, 'SIGNATURE_VERIFICATION_FAILED')
  await models.SettlementDraft.updateOne({ applicationId }, { $set: { sections: originalSections } })
  assert.equal((await post(`/api/applications/${applicationId}/mediation/verify`, mediator.token)).data.allValid, true)
  assert.equal((await post(`/api/applications/${applicationId}/mediation/certify`, clao.token, { reason: 'CLAO independently reviewed the fictional file and records certification.' })).data.stage, 'CERTIFIED_FINAL')
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
