import { Person, RoleAssignment, User } from '../models/index.js'
import { hashPassword, verifyPassword } from '../utils/password.js'

export const demoAccounts = [
  ['demo.officer', 'Demo DLAO Officer', 'DLAO_OFFICER', 'dlao'],
  ['demo.mediator', 'Demo Mediator', 'MEDIATOR', 'mediator'],
  ['demo.helpline', 'Demo Helpline Agent', 'HELPLINE_AGENT', 'helpline'],
  ['demo.udc', 'Demo UDC Operator', 'UDC_OPERATOR', 'udc'],
  ['demo.lawyer', 'Adv. Shahana Parveen', 'PANEL_LAWYER', 'lawyer'],
  ['demo2.lawyer', 'Adv. Rafiqul Islam', 'PANEL_LAWYER', 'lawyer'],
  ['demo3.lawyer', 'Adv. Farhana Yasmin', 'PANEL_LAWYER', 'lawyer'],
  ['demo4.lawyer', 'Adv. Kamrul Hasan', 'PANEL_LAWYER', 'lawyer'],
  ['demo5.lawyer', 'Adv. Nasreen Akhter', 'PANEL_LAWYER', 'lawyer'],
  ['demo.receiving', 'Demo Receiving DLAO', 'RECEIVING_DLAO', 'receiving_dlao', 'JHENAIDAH-DEMO'],
  ['demo.support', 'Demo Case Support', 'CASE_SUPPORT', 'case_support'],
  ['demo.clao', 'Demo CLAO', 'CLAO', 'clao'],
  ['demo.citizen', 'Demo Citizen', 'CITIZEN', 'citizen', 'CITIZEN'],
]
export const demoPassword = (username) => username.endsWith('.lawyer') ? '123' : '1234'

const specializations = {
  'demo.lawyer': ['FAMILY_LAW', 'GENDER_BASED_VIOLENCE', 'CHILD_RIGHTS'],
  'demo2.lawyer': ['LAND_PROPERTY', 'CIVIL_LAW'],
  'demo3.lawyer': ['CHILD_RIGHTS', 'HUMAN_RIGHTS', 'FAMILY_LAW'],
  'demo4.lawyer': ['CRIMINAL_LAW', 'HUMAN_RIGHTS'],
  'demo5.lawyer': ['LABOUR_LAW', 'CIVIL_LAW'],
}

// Development demo identities are fixed; production seeding must supply private credentials explicitly.
export async function ensureDemoAccounts(passwords) {
  if (!passwords && process.env.NODE_ENV === 'production') return
  for (const [username, displayName, role, userType, officeCode = 'DEMO'] of demoAccounts) {
    const password = passwords?.[username] ?? demoPassword(username)
    if (typeof password !== 'string' || !password || process.env.NODE_ENV === 'production' && !passwords?.[username]) throw new Error('Demo credential file is incomplete.')
    const existing = await User.findOne({ username }).select('+passwordHash')
    if (existing && !existing.fictional) throw new Error('A demo username belongs to a non-demo account.')
    const update = { displayName, userType, active: true, fictional: true }
    if (!existing || !await verifyPassword(password, existing.passwordHash)) update.passwordHash = await hashPassword(password)
    if (role === 'CITIZEN' && !existing?.personId) {
      const person = await Person.findOneAndUpdate({ displayName, fictional: true }, { $setOnInsert: { identityStatus: 'VERIFIED' } }, { upsert: true, returnDocument: 'after' })
      update.personId = person._id
    }
    if (specializations[username]) update.specializations = specializations[username]
    const user = await User.findOneAndUpdate({ username }, { $set: update }, { upsert: true, returnDocument: 'after' })
    await RoleAssignment.updateOne({ userId: user._id, role, officeCode }, { $set: { active: true } }, { upsert: true })
    await RoleAssignment.updateMany({ userId: user._id, role, officeCode: { $ne: officeCode } }, { $set: { active: false } })
  }
}
