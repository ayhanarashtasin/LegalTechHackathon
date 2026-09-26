import mongoose from 'mongoose'
import { hashPassword } from '../utils/password.js'
import {
  Application,
  Case,
  CaseFact,
  LawyerAssignment,
  Person,
  RoleAssignment,
  SafeContactProfile,
  User,
  VoiceTranscript,
} from '../models/index.js'

await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.MONGODB_DB })

console.log('--- 1. Seeding 5 Panel Lawyers ---')
const lawyers = [
  { username: 'demo.lawyer', displayName: 'Adv. Shahana Parveen', acceptingCases: true },
  { username: 'demo2.lawyer', displayName: 'Adv. Rafiqul Islam', acceptingCases: true },
  { username: 'demo3.lawyer', displayName: 'Adv. Farhana Yasmin', acceptingCases: false },
  { username: 'demo4.lawyer', displayName: 'Adv. Kamrul Hasan', acceptingCases: true },
  { username: 'demo5.lawyer', displayName: 'Adv. Nasreen Akhter', acceptingCases: true },
]

const passwordHash = await hashPassword('123')

for (const law of lawyers) {
  const user = await User.findOneAndUpdate(
    { username: law.username },
    {
      $set: {
        displayName: law.displayName,
        passwordHash,
        userType: 'lawyer',
        active: true,
        acceptingCases: law.acceptingCases,
        fictional: true,
      },
    },
    { upsert: true, returnDocument: 'after' },
  )
  await RoleAssignment.updateOne(
    { userId: user._id, role: 'PANEL_LAWYER', officeCode: 'DEMO' },
    { $set: { active: true } },
    { upsert: true },
  )
  console.log(`Seeded panel lawyer: ${law.username} (${law.displayName}) - acceptingCases: ${law.acceptingCases}`)
}

console.log('\n--- 2. Ensuring Accepted Cases Have Lawyer Assignments ---')

const acceptedApps = await Application.find({ status: 'ACCEPTED', caseId: { $exists: true, $ne: null } })
const primaryLawyer = await User.findOne({ username: 'demo.lawyer' })

for (const app of acceptedApps) {
  if (primaryLawyer) {
    const existingAssign = await LawyerAssignment.findOne({ caseId: app.caseId, active: true })
    if (!existingAssign) {
      await LawyerAssignment.create({
        applicationId: app.applicationId,
        caseId: app.caseId,
        officeCode: 'DEMO',
        lawyerUserId: primaryLawyer._id,
        active: true,
        status: 'ACCEPTED',
        acceptedAt: new Date(),
      })
      console.log(`Assigned case ${app.caseId} (${app.applicationId}) to ${primaryLawyer.displayName}`)
    }
  }
}

console.log('\n--- Complete! ---')
await mongoose.disconnect()
