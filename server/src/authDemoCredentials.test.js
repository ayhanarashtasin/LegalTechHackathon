import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import mongoose from 'mongoose'
import app from './app.js'
import { Person, RoleAssignment, User } from './models/index.js'
import { changePassword, ensureAdminUser, getDemoCredentials, registerCitizen } from './services/authService.js'
import { demoAccounts, demoPassword, ensureDemoAccounts } from './services/demoAccounts.js'
import { hashPassword } from './utils/password.js'

test('demo login credentials are production-disabled and role-allowlisted', async () => {
  const originalEnvironment = process.env.NODE_ENV
  const originalAdminPassword = process.env.ADMIN_PASSWORD
  try {
    process.env.NODE_ENV = 'production'
    assert.equal(await ensureDemoAccounts(), undefined, 'production does not auto-create accounts with public demo passwords')
    await assert.rejects(getDemoCredentials('DLAO_OFFICER'), (error) => error.code === 'DEMO_AUTH_DISABLED')
    delete process.env.ADMIN_PASSWORD
    assert.equal(await ensureAdminUser(), null, 'production never creates admin.com with the known default password')

    process.env.NODE_ENV = 'development'
    await assert.rejects(getDemoCredentials('INVALID_ROLE'), (error) => error.code === 'DEMO_ACCOUNT_NOT_FOUND')
  } finally {
    if (originalAdminPassword !== undefined) process.env.ADMIN_PASSWORD = originalAdminPassword
    if (originalEnvironment === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = originalEnvironment
  }
})

test('every demo account signs in on a fresh database and setup repairs drift without replacing users', async () => {
  const databaseName = `dlas_demo_auth_test_${randomBytes(6).toString('hex')}`
  const originalEnvironment = process.env.NODE_ENV
  const originalAdminPassword = process.env.ADMIN_PASSWORD
  const server = createServer(app)
  try {
    process.env.NODE_ENV = 'development'
    delete process.env.ADMIN_PASSWORD
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/dlas', { dbName: databaseName, serverSelectionTimeoutMS: 10000 })
    await Promise.all([User.init(), RoleAssignment.init(), Person.init()])
    await ensureDemoAccounts()
    await ensureAdminUser()
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${server.address().port}/api/auth`
    const post = (path, body) => fetch(`${base}/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    for (const [username, , role, userType] of demoAccounts) {
      const credential = await getDemoCredentials(username)
      assert.deepEqual(credential, { username, password: demoPassword(username) })
      for (const identifier of username.startsWith('demo.') ? [username, userType] : [username]) {
        const response = await post('login', { username: identifier, password: credential.password })
        assert.equal(response.status, 200, `${identifier} signs in with its displayed demo password`)
        const session = await response.json()
        assert.equal(session.user.username, username)
        const me = await fetch(`${base}/me`, { headers: { authorization: `Bearer ${session.token}` } })
        assert.equal((await me.json()).user.assignments[0].role, role)
      }
    }
    assert.equal((await post('login', { username: 'admin', password: 'admin123' })).status, 200)
    assert.equal((await post('login', { username: 'dlao', password: 'incorrect-password' })).status, 401)
    assert.equal((await post('login', { username: 'constructor', password: 'incorrect-password' })).status, 401)
    const citizen = await User.findOne({ username: 'demo.citizen' }).select('+passwordHash')
    const officer = await User.findOne({ username: 'demo.officer' }).select('+passwordHash')
    const ordinary = await User.create({ username: 'ordinary.citizen', displayName: 'Fictional ordinary citizen', passwordHash: await hashPassword('private-test-password'), fictional: false })
    await User.updateOne({ _id: officer._id }, { $set: { active: false, passwordHash: await hashPassword('outdated-demo-password') } })
    await User.updateOne({ username: 'demo.lawyer' }, { $set: { acceptingCases: false } })
    await RoleAssignment.updateMany({ userId: officer._id }, { $set: { active: false } })
    await ensureDemoAccounts()
    assert.equal((await post('login', { username: 'dlao', password: '1234' })).status, 200)
    assert.equal((await post('login', { username: 'demo.officer', password: 'outdated-demo-password' })).status, 401)
    const restored = await User.findOne({ username: 'demo.officer' })
    assert.equal(restored.id, officer.id)
    assert.equal(await RoleAssignment.countDocuments({ userId: officer._id, active: true }), 1)
    const unchanged = await User.findOne({ username: 'demo.citizen' }).select('+passwordHash')
    assert.equal(unchanged.passwordHash, citizen.passwordHash)
    assert.equal(unchanged.personId.toString(), citizen.personId.toString())
    await assert.rejects(changePassword(citizen.id, '1234', 'changed-demo-password'), (error) => error.code === 'DEMO_PASSWORD_FIXED')
    assert.equal((await post('login', { username: 'citizen', password: '1234' })).status, 200)
    assert.equal((await User.findOne({ username: 'demo.lawyer' })).acceptingCases, false)
    assert.equal((await User.findById(ordinary._id).select('+passwordHash')).passwordHash, ordinary.passwordHash)
    assert.equal((await changePassword(ordinary.id, 'private-test-password', 'new-private-test-password')).success, true)
    assert.equal(await User.countDocuments(), demoAccounts.length + 2)
    await assert.rejects(registerCitizen('dlao', 'test-password', '', 'Fictional user'), (error) => error.code === 'USERNAME_TAKEN')
    await assert.rejects(registerCitizen('demo.officer', 'test-password', '', 'Fictional user'), (error) => error.code === 'USERNAME_TAKEN')
  } finally {
    server.closeAllConnections(); server.close()
    if (mongoose.connection.readyState === 1) {
      assert.equal(mongoose.connection.name, databaseName)
      assert.match(databaseName, /^dlas_demo_auth_test_[a-f0-9]{12}$/)
      await mongoose.connection.dropDatabase()
      await mongoose.disconnect()
    }
    if (originalEnvironment === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = originalEnvironment
    if (originalAdminPassword === undefined) delete process.env.ADMIN_PASSWORD
    else process.env.ADMIN_PASSWORD = originalAdminPassword
  }
})
