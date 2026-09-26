import { createHash, randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { DemoSession, RoleAssignment, User } from '../models/index.js'
import { HttpError } from '../utils/httpError.js'
import { hashPassword, verifyPassword } from '../utils/password.js'
import { Person } from '../models/index.js'

export const tokenHash = (token) => createHash('sha256').update(token).digest('hex')

const failedLogins = new Map()
const loginWindowMs = 15 * 60 * 1000
const maxLoginFailures = 10
const maxLoginBuckets = 4096
const demoAccounts = new Map([
  ['DLAO_OFFICER', 'demo.officer'],
  ['MEDIATOR', 'demo.mediator'],
  ['HELPLINE_AGENT', 'demo.helpline'],
  ['UDC_OPERATOR', 'demo.udc'],
  ['PANEL_LAWYER', 'demo.lawyer'],
  ['RECEIVING_DLAO', 'demo.receiving'],
  ['CASE_SUPPORT', 'demo.support'],
  ['CLAO', 'demo.clao'],
  ['CITIZEN', 'demo.citizen'],
])
const staffLoginEnabled = () => process.env.NODE_ENV !== 'production' || process.env.STAFF_LOGIN_ENABLED === 'true'

export async function getDemoCredentials(role) {
  if (process.env.NODE_ENV === 'production') throw new HttpError(503, 'DEMO_AUTH_DISABLED', 'Demo authentication is disabled in production.')
  const username = demoAccounts.get(role) || (Array.from(demoAccounts.values()).includes(role) ? role : null)
  if (!username) throw new HttpError(404, 'DEMO_ACCOUNT_NOT_FOUND', 'That demo role is not available.')

  let credentials
  try {
    credentials = JSON.parse(await readFile(new URL('../../.demo-credentials.json', import.meta.url), 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') throw new HttpError(503, 'DEMO_ACCOUNTS_NOT_SEEDED', 'Demo accounts are not ready. Seed the server demo accounts first.')
    throw error
  }
  const password = credentials?.[username] || '1234'
  return { username, password }
}

export async function registerCitizen(username, password, nid = '', name = '', phone = '') {
  if (!name || !name.trim()) {
    throw new HttpError(400, 'NAME_REQUIRED', 'Name is required.')
  }
  const cleanUsername = (username || '').trim().toLowerCase()
  if (cleanUsername.length < 3 || cleanUsername.length > 50) {
    throw new HttpError(400, 'INVALID_USERNAME', 'Email ID / Phone must be between 3 and 50 characters.')
  }
  if (!password || password.length < 3) {
    throw new HttpError(400, 'INVALID_PASSWORD', 'Password must be at least 3 characters.')
  }
  const existing = await User.findOne({ username: cleanUsername })
  if (existing) {
    throw new HttpError(409, 'USERNAME_TAKEN', 'That Email ID / Phone is already registered.')
  }
  const fullName = name.trim()
  const person = await Person.create({
    displayName: fullName,
    identityStatus: nid?.trim() ? 'PENDING_REVIEW' : 'INCOMPLETE',
    fictional: false,
  })
  const passwordHash = await hashPassword(password)
  const user = await User.create({
    username: cleanUsername,
    displayName: fullName,
    userType: 'citizen',
    passwordHash,
    nid: nid?.trim() || undefined,
    phone: phone?.trim() || (cleanUsername.startsWith('01') || cleanUsername.startsWith('+') ? cleanUsername : undefined),
    personId: person._id,
    active: true,
    fictional: false,
  })
  await RoleAssignment.create({
    userId: user._id,
    role: 'CITIZEN',
    officeCode: 'CITIZEN',
    active: true,
  })
  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000)
  await DemoSession.create({ tokenHash: tokenHash(token), userId: user._id, expiresAt })
  return { token, expiresAt, user: { id: user.id, username: user.username, displayName: user.displayName, userType: 'citizen', role: 'CITIZEN' } }
}

export async function login(username, password, remoteAddress = '') {
  if (!staffLoginEnabled()) throw new HttpError(503, 'DEMO_AUTH_DISABLED', 'Staff sign-in is disabled on this server.')
  const cleanId = (username || '').toLowerCase().trim()
  const key = createHash('sha256').update(`${remoteAddress}\0${cleanId}`).digest('hex')
  const now = Date.now()
  let failures = failedLogins.get(key)
  if (failures?.resetAt <= now) {
    failedLogins.delete(key)
    failures = null
  }
  if (failures?.count >= maxLoginFailures) throw new HttpError(429, 'LOGIN_RATE_LIMITED', 'Too many sign-in attempts. Try again later.')

  const demoRoleUsernames = {
    citizen: 'demo.citizen',
    dlao: 'demo.officer',
    lawyer: 'demo.lawyer',
    mediator: 'demo.mediator',
    helpline: 'demo.helpline',
    udc: 'demo.udc',
    receiving_dlao: 'demo.receiving',
    case_support: 'demo.support',
    clao: 'demo.clao',
    admin: 'admin.com',
  }
  const targetUsername = demoRoleUsernames[cleanId] || cleanId
  let user = await User.findOne({
    $or: [{ username: targetUsername }, { username: cleanId }],
    active: true,
  }).select('+passwordHash')

  if (!user) {
    user = await User.findOne({ userType: cleanId, active: true }).select('+passwordHash')
  }
  const dummyHash = `${'0'.repeat(32)}:${'0'.repeat(128)}`
  if (!await verifyPassword(password, user?.passwordHash ?? dummyHash)) {
    if (!failures) {
      // ponytail: bounded per-process buckets; use a shared limiter before horizontal scaling.
      if (failedLogins.size >= maxLoginBuckets) {
        for (const [entry, value] of failedLogins) if (value.resetAt <= now) failedLogins.delete(entry)
        if (failedLogins.size >= maxLoginBuckets) failedLogins.delete(failedLogins.keys().next().value)
      }
      failures = { count: 0, resetAt: now + loginWindowMs }
    }
    failures.count += 1
    failedLogins.set(key, failures)
    throw new HttpError(401, 'INVALID_CREDENTIALS', 'Invalid credentials.')
  }
  failedLogins.delete(key)
  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000)
  await DemoSession.create({ tokenHash: tokenHash(token), userId: user._id, expiresAt })
  return { token, expiresAt, user: { id: user.id, username: user.username, displayName: user.displayName, userType: user.userType || 'citizen' } }
}

export async function getSession(token) {
  if (!staffLoginEnabled()) return null
  if (!/^[a-f0-9]{64}$/.test(token || '')) return null
  const session = await DemoSession.findOne({ tokenHash: tokenHash(token), expiresAt: { $gt: new Date() } })
  if (!session) return null
  const user = await User.findOne({ _id: session.userId, active: true })
  if (!user) return null
  const assignments = await RoleAssignment.find({ userId: user._id, active: true }).lean()
  return { userId: user._id, username: user.username, displayName: user.displayName, userType: user.userType || 'citizen', acceptingCases: user.acceptingCases ?? true, assignments }
}

export async function ensureAdminUser() {
  // A known admin password must never reach a deployed server: production needs ADMIN_PASSWORD.
  const password = process.env.ADMIN_PASSWORD || (process.env.NODE_ENV === 'production' ? '' : 'admin123')
  if (!password) return null
  const username = 'admin.com'
  const passwordHash = await hashPassword(password)
  const user = await User.findOneAndUpdate(
    { username },
    { $set: { displayName: 'System Administrator', userType: 'admin', passwordHash, active: true, fictional: false } },
    { upsert: true, returnDocument: 'after' },
  )
  await RoleAssignment.updateOne(
    { userId: user._id, role: 'ADMIN', officeCode: 'HEADQUARTERS' },
    { $set: { active: true } },
    { upsert: true },
  )
  return user
}

export async function logout(token) {
  await DemoSession.deleteOne({ tokenHash: tokenHash(token) })
}

export async function changePassword(userId, currentPassword, newPassword) {
  if (!newPassword || newPassword.length < 3) {
    throw new HttpError(400, 'INVALID_PASSWORD', 'New password must be at least 3 characters.')
  }
  const user = await User.findById(userId).select('+passwordHash')
  if (!user) throw new HttpError(404, 'USER_NOT_FOUND', 'User not found.')

  const matches = await verifyPassword(currentPassword || '', user.passwordHash)
  if (!matches) {
    throw new HttpError(401, 'INVALID_CREDENTIALS', 'Current password is incorrect.')
  }

  user.passwordHash = await hashPassword(newPassword)
  await user.save()
  return { success: true, message: 'Password updated successfully.' }
}

