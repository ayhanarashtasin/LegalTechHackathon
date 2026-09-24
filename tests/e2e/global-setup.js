import { randomBytes } from 'node:crypto'
import mongoose from 'mongoose'
import * as models from '../../server/src/models/index.js'
import { hashPassword } from '../../server/src/utils/password.js'
import { roleNames, testDatabase } from './support.js'

// Creates one fictional account per role for all specs; the returned function drops the throwaway database.
export default async function globalSetup() {
  const databaseName = process.env.MONGODB_DB
  if (!testDatabase.test(databaseName || '')) throw new Error('Refusing to run E2E against a non-test database.')
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/dlas', { dbName: databaseName, serverSelectionTimeoutMS: 10000 })
  await Promise.all(Object.values(models).map((model) => model.init()))
  const actors = {}
  for (const role of Object.keys(roleNames)) {
    const username = `e2e.${role.toLowerCase()}`
    const password = randomBytes(24).toString('base64url')
    const user = await models.User.create({ username, displayName: `Fictional ${roleNames[role]}`, passwordHash: await hashPassword(password) })
    await models.RoleAssignment.create({ userId: user._id, role, officeCode: role === 'RECEIVING_DLAO' ? 'JHENAIDAH-DEMO' : 'DEMO' })
    actors[role] = { username, password }
  }
  const secondLawyer = { username: 'e2e.panel_lawyer_alt', password: randomBytes(24).toString('base64url') }
  const secondLawyerUser = await models.User.create({
    username: secondLawyer.username, displayName: 'Fictional second panel lawyer',
    passwordHash: await hashPassword(secondLawyer.password),
  })
  await models.RoleAssignment.create({ userId: secondLawyerUser._id, role: 'PANEL_LAWYER', officeCode: 'DEMO' })
  actors.PANEL_LAWYER_ALT = secondLawyer
  process.env.E2E_ACTORS = JSON.stringify(actors)
  return async () => {
    if (mongoose.connection.name !== databaseName || !testDatabase.test(databaseName)) throw new Error('Refusing to remove a non-test database.')
    await mongoose.connection.dropDatabase()
    await mongoose.disconnect()
  }
}
