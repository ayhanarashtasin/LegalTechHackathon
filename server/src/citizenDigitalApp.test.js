import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { after, before, test } from 'node:test'
import mongoose from 'mongoose'
import app from './app.js'
import * as models from './models/index.js'
import { hashPassword } from './utils/password.js'

const databaseName = `dlas_citizendigital_test_${randomBytes(6).toString('hex')}`
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
    if (mongoose.connection.name !== databaseName || !/^dlas_citizendigital_test_[a-f0-9]{12}$/.test(databaseName)) throw new Error('Refusing to remove a non-test database.')
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

async function citizenActor(username = `citizen_${randomBytes(4).toString('hex')}`) {
  const password = randomBytes(24).toString('base64url')
  const user = await models.User.create({ username, displayName: 'Fictional Citizen Applicant', passwordHash: await hashPassword(password) })
  await models.RoleAssignment.create({ userId: user._id, role: 'CITIZEN', officeCode: 'DEMO' })
  const login = await request('/api/auth/login', { method: 'POST', body: { username, password } })
  return { token: login.data.token, userId: user._id }
}

test('citizen digital application creates facts, NID document, prottayonpotro document, and extra pictures', async () => {
  const citizen = await citizenActor()

  const fakeNidPhotoData = 'data:image/jpeg;base64,' + Buffer.from('fake-nid-photo-bytes').toString('base64')
  const fakeProttayonPhotoData = 'data:image/jpeg;base64,' + Buffer.from('fake-prottayon-photo-bytes').toString('base64')
  const fakeExtraDocPhotoData = 'data:image/jpeg;base64,' + Buffer.from('fake-land-deed-bytes').toString('base64')

  const submission = await request('/api/citizen/applications', {
    method: 'POST',
    token: citizen.token,
    body: {
      applicantName: 'Fictional Rashida Begum',
      problem: 'Dispute over boundary wall and inheritance share; threatened with dispossession.',
      category: 'LAND_PROPERTY',
      district: 'Gazipur',
      contactPhone: '01711002233',
      urgent: true,
      identityDocument: 'NID',
      nidNumber: '19851234567890123',
      nidPhoto: { filename: 'rashida-nid.jpg', dataUrl: fakeNidPhotoData },
      prottayonpotro: {
        status: 'YES',
        issuerType: 'CHAIRMAN',
        issuerName: 'Sreepur Union Parishad',
        memoNumber: 'UP/2026/89',
        issueDate: '2026-09-01',
        photo: { filename: 'prottayon-certificate.jpg', dataUrl: fakeProttayonPhotoData },
      },
      extraDocuments: [
        { label: 'Inheritance Land Deed', filename: 'deed-page1.jpg', dataUrl: fakeExtraDocPhotoData, note: 'CS Porcha copy' }
      ],
    }
  })

  assert.equal(submission.status, 201)
  assert.equal(submission.data.status, 'SUBMITTED')
  assert.equal(submission.data.documentsCount, 3)
  const applicationId = submission.data.applicationId
  assert.match(applicationId, /^APP-2026-\d{6}$/)

  // Verify Application record has no Case ID before acceptance
  const appRecord = await models.Application.findOne({ applicationId })
  assert.ok(appRecord)
  assert.equal(appRecord.caseId, undefined)
  assert.equal(appRecord.status, 'SUBMITTED')

  // Verify CaseFact records
  const facts = await models.CaseFact.find({ applicationId }).lean()
  const factMap = new Map(facts.map(f => [f.field, f.value]))
  assert.equal(factMap.get('complaint.summary'), 'Dispute over boundary wall and inheritance share; threatened with dispossession.')
  assert.equal(factMap.get('location.district'), 'Gazipur')
  assert.equal(factMap.get('safety.urgent'), 'YES')
  assert.equal(factMap.get('identity.document_access'), 'NID')
  assert.equal(factMap.get('identity.nid_number'), '19851234567890123')
  assert.equal(factMap.get('prottayonpotro.status'), 'YES')
  assert.equal(factMap.get('prottayonpotro.issuer_type'), 'CHAIRMAN')
  assert.equal(factMap.get('prottayonpotro.issuer_name'), 'Sreepur Union Parishad')
  assert.equal(factMap.get('prottayonpotro.memo_number'), 'UP/2026/89')
  assert.equal(factMap.get('prottayonpotro.issue_date'), '2026-09-01')
  assert.equal(factMap.get('documents.extra_count'), '1')

  // Verify Documents and DocumentVersions created
  const docs = await models.Document.find({ applicationId }).sort({ createdAt: 1 }).lean()
  assert.equal(docs.length, 3)

  const nidDoc = docs.find(d => d.label === 'National ID (NID) Card')
  assert.ok(nidDoc)
  assert.equal(nidDoc.checklistItem, 'Applicant identity evidence')

  const prottayonDoc = docs.find(d => d.label === 'Prottayonpotro (Chairman/Councilor Certificate)')
  assert.ok(prottayonDoc)
  assert.equal(prottayonDoc.checklistItem, 'Income/Insolvency Certificate (প্রত্যয়নপত্র)')

  const extraDoc = docs.find(d => d.label === 'Inheritance Land Deed')
  assert.ok(extraDoc)

  // Verify DocumentVersion contentHash and fileData
  const nidVersion = await models.DocumentVersion.findOne({ documentId: nidDoc._id }).select('+fileData').lean()
  assert.ok(nidVersion)
  assert.equal(nidVersion.qualityState, 'READABLE')
  assert.equal(nidVersion.fileData, fakeNidPhotoData)
  assert.ok(nidVersion.contentHash)

  // Verify Audit event
  const audits = await models.AuditEvent.find({ applicationId }).sort({ sequence: 1 }).lean()
  const submitAudit = audits.find(a => a.action === 'APPLICATION_SUBMITTED')
  assert.ok(submitAudit)
  assert.equal(submitAudit.newState.documentsAttached, 3)
  assert.equal(submitAudit.newState.identityDocument, 'NID')

  // Verify Citizen Cases query returns documents and metadata
  const citizenCases = await request('/api/citizen/cases', { token: citizen.token })
  assert.equal(citizenCases.status, 200)
  assert.equal(citizenCases.data.cases.length, 1)
  const caseItem = citizenCases.data.cases[0]
  assert.equal(caseItem.applicationId, applicationId)
  assert.equal(caseItem.nidNumber, '19851234567890123')
  assert.equal(caseItem.prottayonpotroStatus, 'YES')
  assert.equal(caseItem.documents.length, 3)
})

test('citizen digital application with Birth Certificate and photo', async () => {
  const citizen = await citizenActor()

  const fakeBirthPhoto = 'data:image/jpeg;base64,' + Buffer.from('fake-birth-cert-photo').toString('base64')

  const submission = await request('/api/citizen/applications', {
    method: 'POST',
    token: citizen.token,
    body: {
      applicantName: 'Fictional Kabir Hossain',
      problem: 'Employment wages unpaid for 4 months by construction contractor.',
      category: 'LABOUR_WAGE',
      district: 'Dhaka',
      contactPhone: '01811223344',
      urgent: false,
      identityDocument: 'BIRTH_CERTIFICATE',
      birthCertificateNumber: '20011234567890123',
      birthCertificatePhoto: { filename: 'birth-cert.jpg', dataUrl: fakeBirthPhoto },
      prottayonpotro: { status: 'NOT_AVAILABLE' },
    }
  })

  assert.equal(submission.status, 201)
  const { applicationId } = submission.data

  const facts = await models.CaseFact.find({ applicationId }).lean()
  const factMap = new Map(facts.map(f => [f.field, f.value]))
  assert.equal(factMap.get('identity.birth_certificate_number'), '20011234567890123')
  assert.equal(factMap.get('identity.document_access'), 'BIRTH_CERTIFICATE')
  assert.equal(factMap.get('prottayonpotro.status'), 'NOT_AVAILABLE')

  const docs = await models.Document.find({ applicationId }).lean()
  assert.equal(docs.length, 1)
  assert.equal(docs[0].label, 'Birth Registration Certificate')
})

test('citizen digital application with NONE identity document succeeds gracefully', async () => {
  const citizen = await citizenActor()

  const submission = await request('/api/citizen/applications', {
    method: 'POST',
    token: citizen.token,
    body: {
      applicantName: 'Fictional Salma Khatun',
      problem: 'Tenancy eviction notice without legal reason.',
      category: 'LAND_PROPERTY',
      district: 'Rajshahi',
      contactPhone: '01999887766',
      urgent: false,
      identityDocument: 'NONE',
    }
  })

  assert.equal(submission.status, 201)
  const { applicationId } = submission.data

  const facts = await models.CaseFact.find({ applicationId }).lean()
  const factMap = new Map(facts.map(f => [f.field, f.value]))
  assert.equal(factMap.get('identity.document_access'), 'NONE')
  assert.equal(factMap.get('identity.nid_number'), undefined)

  const docs = await models.Document.find({ applicationId }).lean()
  assert.equal(docs.length, 0)
})
