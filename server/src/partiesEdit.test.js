import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { after, before, test } from 'node:test'
import mongoose from 'mongoose'
import app from './app.js'
import * as models from './models/index.js'
import { ensureDemoAccounts } from './services/demoAccounts.js'
import { hashPassword } from './utils/password.js'

// The DLAO officer edits both parties in place, and each demo lawyer stands for exactly one practice domain.
const databaseName = `dlas_partiesedit_test_${randomBytes(6).toString('hex')}`
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
    if (mongoose.connection.name !== databaseName || !/^dlas_partiesedit_test_[a-f0-9]{12}$/.test(databaseName)) throw new Error('Refusing to remove a non-test database.')
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

test('the DLAO officer edits both parties, can clear a field, and every edit is audited', async () => {
  const officer = await actor('parties.officer', 'DLAO_OFFICER')
  const support = await actor('parties.support', 'CASE_SUPPORT')
  const { applicationId } = (await request('/api/applications', { method: 'POST', token: officer, body: { applicantName: 'Fictional Rahela' } })).data
  const edit = (body, token = officer) => request(`/api/applications/${applicationId}/case-info`, { method: 'PUT', token, body })

  let result = await edit({
    petitioner: { name: 'Fictional Rahela Begum', phone: '01700000001', address: 'Fictional village', nid: '1234567890' },
    respondent: { name: 'Fictional Karim', phone: '01700000002', address: 'Fictional town', relationship: 'Husband' },
    reason: 'Recorded parties from the intake call.',
  })
  assert.equal(result.status, 200)
  assert.equal(result.data.petitioner.nid, '1234567890')
  assert.equal(result.data.respondent.relationship, 'Husband')

  // A blank field clears a wrong value; a missing field keeps its value; a name is never blanked.
  result = await edit({ respondent: { name: '', phone: '' }, reason: 'The respondent phone was wrong.' })
  assert.equal(result.status, 200)
  assert.equal(result.data.respondent.phone, '')
  assert.equal(result.data.respondent.name, 'Fictional Karim')
  assert.equal(result.data.respondent.address, 'Fictional town')

  assert.equal((await edit({ respondent: { phone: 'not a phone' }, reason: 'Invalid phone.' })).status, 400)
  assert.equal((await edit({ petitioner: { nid: '12' }, reason: 'Invalid NID.' })).status, 400)
  assert.equal((await edit({ respondent: { name: 'Someone' }, reason: 'Support cannot edit.' }, support)).status, 403)
  assert.equal((await edit({ respondent: { name: 'Someone' } })).status, 400)
  const events = await models.AuditEvent.find({ applicationId, action: 'CASE_INFORMATION_EDITED' }).lean()
  assert.equal(events.length, 2)
  assert.equal(events[1].previousState.respondent.phone, '01700000002')
})

test('each practice domain has exactly one demo lawyer', async () => {
  await ensureDemoAccounts()
  const lawyers = await models.User.find({ username: /^demo\d?\.lawyer$/ }).lean()
  assert.equal(lawyers.length, 8)
  const domains = lawyers.flatMap(({ specializations }) => specializations)
  assert.deepEqual(domains.toSorted(), ['CHILD_RIGHTS', 'CIVIL_LAW', 'CRIMINAL_LAW', 'FAMILY_LAW', 'GENDER_BASED_VIOLENCE', 'HUMAN_RIGHTS', 'LABOUR_LAW', 'LAND_PROPERTY'])
})
