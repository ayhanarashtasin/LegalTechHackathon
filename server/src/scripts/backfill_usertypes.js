import mongoose from 'mongoose'
import { User, RoleAssignment } from '../models/index.js'

await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.MONGODB_DB })

console.log('--- Backfilling userType for all users in database ---')
const users = await User.find({})

for (const user of users) {
  let userType = user.userType
  if (!userType || user.username.startsWith('system.') || user.username === 'demo.citizen') {
    const roles = await RoleAssignment.find({ userId: user._id, active: true }).lean()
    const primaryRole = roles[0]?.role

    if (user.username.startsWith('system.')) {
      userType = 'system'
    } else if (primaryRole === 'CITIZEN' || user.username.includes('citizen')) {
      userType = 'citizen'
    } else if (primaryRole === 'DLAO_OFFICER' || user.username.includes('officer')) {
      userType = 'dlao'
    } else if (primaryRole === 'PANEL_LAWYER' || user.username.includes('lawyer')) {
      userType = 'lawyer'
    } else if (primaryRole === 'MEDIATOR' || user.username.includes('mediator')) {
      userType = 'mediator'
    } else if (primaryRole === 'HELPLINE_AGENT' || user.username.includes('helpline')) {
      userType = 'helpline'
    } else if (primaryRole === 'UDC_OPERATOR' || user.username.includes('udc')) {
      userType = 'udc'
    } else if (primaryRole === 'RECEIVING_DLAO' || user.username.includes('receiving')) {
      userType = 'receiving_dlao'
    } else if (primaryRole === 'CASE_SUPPORT' || user.username.includes('support')) {
      userType = 'case_support'
    } else if (primaryRole === 'CLAO' || user.username.includes('clao')) {
      userType = 'clao'
    } else if (primaryRole === 'ADMIN' || user.username.includes('admin')) {
      userType = 'admin'
    } else {
      userType = 'citizen'
    }
  }

  await User.updateOne({ _id: user._id }, { $set: { userType } })
  console.log(`User: ${user.username} (${user.displayName}) -> userType: ${userType}`)
}

console.log('--- Backfill complete ---')
await mongoose.disconnect()
