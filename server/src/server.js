import mongoose from 'mongoose'
import app from './app.js'
import { sweepOverdueReferrals } from './services/referralService.js'
import { sweepOverdueLawyerUpdates } from './services/lawyerService.js'
import { ensureAdminUser } from './services/authService.js'
import { ensureDemoAccounts } from './services/demoAccounts.js'

const port = Number(process.env.PORT || 5000)
const host = process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1')
const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/dlas'

// Prepare demo identities before accepting sign-in requests, including on a fresh database.
let server
try {
  await mongoose.connect(uri, { dbName: process.env.MONGODB_DB || 'dlas', serverSelectionTimeoutMS: 5000 })
  await ensureDemoAccounts()
  await ensureAdminUser().catch((err) => console.error('Admin user initialization failed:', err.message))
  server = app.listen(port, host, () => console.log(`DLAS API listening on http://${host}:${port}`))
  // ponytail: in-process timer suits one API instance; move to a scheduled job before running several.
  setInterval(() => Promise.all([sweepOverdueReferrals(), sweepOverdueLawyerUpdates()])
    .catch((error) => console.error('Follow-up sweep failed:', error.name)), Number(process.env.REFERRAL_SWEEP_MS) || 60000).unref()
} catch (error) {
  console.error('MongoDB connection failed:', error.message)
  server?.close()
  server?.closeAllConnections()
  process.exitCode = 1
}
