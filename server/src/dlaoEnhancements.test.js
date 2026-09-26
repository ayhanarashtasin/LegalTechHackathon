import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { after, before, test } from 'node:test'
import mongoose from 'mongoose'
import * as models from './models/index.js'
import { User, RoleAssignment, AuditEvent } from './models/index.js'
import { hashPassword } from './utils/password.js'
import { acceptApplication, editCaseInformation, listWorkspace, preMediationVerify, recordNoticeSent, reviewApplication, submitApplication } from './services/applicationService.js'
import { recordMediationSession, startMediation } from './services/mediationService.js'
import { updatePovertyCertificate } from './services/lawyerService.js'

const databaseName = `dlas_dlao_test_${randomBytes(6).toString('hex')}`

before(async () => {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/dlas', { dbName: databaseName, serverSelectionTimeoutMS: 10000 })
  await Promise.all(Object.values(models).map((model) => model.init()))
})

after(async () => {
  if (mongoose.connection.readyState === 1) {
    if (mongoose.connection.name !== databaseName || !/^dlas_dlao_test_[a-f0-9]{12}$/.test(databaseName)) throw new Error('Refusing to remove a non-test database.')
    await mongoose.connection.dropDatabase()
    await mongoose.disconnect()
  }
})

test('DLAO enhancements: case edit, call verification, notices, multi-session mediation, poverty certificate, workspace aggregation', async () => {
  const dlaoUser = await User.create({
    username: 'dlao.officer.test',
    displayName: 'DLAO Test Officer',
    passwordHash: await hashPassword('password123'),
  })
  await RoleAssignment.create({
    userId: dlaoUser._id,
    role: 'DLAO_OFFICER',
    officeCode: 'DEMO',
  })

  const mediatorUser = await User.create({
    username: 'mediator.test',
    displayName: 'Test Mediator',
    passwordHash: await hashPassword('password123'),
  })
  await RoleAssignment.create({
    userId: mediatorUser._id,
    role: 'MEDIATOR',
    officeCode: 'DEMO',
  })

  const dlaoActor = {
    userId: dlaoUser._id,
    role: 'DLAO_OFFICER',
    officeCode: 'DEMO',
    assignments: [{ role: 'DLAO_OFFICER', officeCode: 'DEMO' }],
  }

  const mediatorActor = {
    userId: mediatorUser._id,
    role: 'MEDIATOR',
    officeCode: 'DEMO',
    assignments: [{ role: 'MEDIATOR', officeCode: 'DEMO' }],
  }

  // 1. Submit application
  const submission = await submitApplication({
    applicantName: 'মোসাম্মৎ রহিমা বেগম (Rahima Begum)',
    contactPhone: '01711000111',
    category: 'FAMILY',
    summary: 'Family maintenance and custody dispute',
  }, dlaoActor)
  const appId = submission.applicationId

  // 2. DLAO edits case information with audit trail
  const edited = await editCaseInformation(appId, {
    applicantName: 'মোসাম্মৎ রহিমা খাতুন (Rahima Khatun)',
    petitioner: {
      name: 'মোসাম্মৎ রহিমা খাতুন',
      phone: '01711000111',
      address: 'মিরপুর-১০, ঢাকা',
      nid: '19872612345678901',
    },
    respondent: {
      name: 'মোঃ রফিকুল ইসলাম',
      phone: '01811000222',
      address: 'সাভার, ঢাকা',
      relationship: 'স্বামী (Husband)',
    },
    reason: 'সঠিক জাতীয় পরিচয়পত্র ও ঠিকানা অনুযায়ী বাদী ও বিবাদীর তথ্য সংশোধন করা হলো।',
  }, dlaoActor)

  assert.equal(edited.petitioner.name, 'মোসাম্মৎ রহিমা খাতুন')
  assert.equal(edited.respondent.name, 'মোঃ রফিকুল ইসলাম')
  assert.equal(edited.respondent.phone, '01811000222')

  // Verify audit event exists
  const audits = await AuditEvent.find({ applicationId: appId, action: 'CASE_INFORMATION_EDITED' })
  assert.equal(audits.length, 1)
  assert.equal(audits[0].actorRole, 'DLAO_OFFICER')

  // 3. Pre-mediation verification call
  const verifyRes = await preMediationVerify(appId, {
    petitionerVerified: true,
    petitionerNotes: 'বাদীর সাথে কথা হয়েছে, তিনি মধ্যস্থতায় উপস্থিত হতে প্রস্তুত।',
    respondentVerified: true,
    respondentNotes: 'বিবাদীর সাথে কথা বলে তারিখ নিশ্চিত করা হয়েছে।',
    status: 'VERIFIED',
    reason: 'উভয় পক্ষের সাথে ফোনে যোগাযোগ সম্পন্ন হয়েছে।',
  }, dlaoActor)

  assert.equal(verifyRes.preMediationVerification.petitionerVerified, true)
  assert.equal(verifyRes.preMediationVerification.respondentVerified, true)
  assert.equal(verifyRes.preMediationVerification.status, 'VERIFIED')

  // 4. Record notice sent
  const noticeRes = await recordNoticeSent(appId, {
    recipient: 'RESPONDENT',
    memoNo: 'DLAC-DHK-2026-042',
    deliveryMethod: 'REGISTERED_POST',
    status: 'SENT',
    notes: 'মধ্যস্থতা বৈঠকের নোটিশ রেজিস্ট্রি ডাকযোগে প্রেরণ করা হলো।',
  }, dlaoActor)

  assert.equal(noticeRes.notices.length, 1)
  assert.equal(noticeRes.notices[0].recipient, 'RESPONDENT')
  assert.equal(noticeRes.notices[0].memoNo, 'DLAC-DHK-2026-042')

  // 5. Review & Accept Application so lawyer allocation is permitted
  await reviewApplication(appId, { reviewState: 'READY_FOR_DECISION', reason: 'Review complete, ready for case opening.' }, dlaoActor)
  await acceptApplication(appId, 'Accepted by DLAO officer for legal aid services.', dlaoActor)

  // Poverty certificate submission for lawyer allocation
  const povertyRes = await updatePovertyCertificate(appId, {
    certificateNumber: 'UP-CERT-2026-889',
    issuingAuthority: 'UP_CHAIRMAN',
    issueDate: new Date('2026-02-15'),
    status: 'VERIFIED',
    note: 'দরিদ্র প্রত্যয়নপত্র যাচাইপূর্বক গ্রহণ করা হলো।',
  }, dlaoActor)

  assert.equal(povertyRes.meansTest.verificationStatus, 'VERIFIED')
  assert.equal(povertyRes.meansTest.povertyCertificateSubmitted, true)
  assert.equal(povertyRes.meansTest.povertyCertificateNumber, 'UP-CERT-2026-889')

  // 6. Register mediation on the accepted case and record multiple sessions
  await startMediation(appId, dlaoActor)

  // Add 1st session
  const session1 = await recordMediationSession(appId, {
    sessionNumber: 1,
    scheduledAt: new Date(),
    attendance: { partyA: 'ATTENDED', partyB: 'ATTENDED' },
    summaryNotes: 'উভয় পক্ষ উপস্থিত ছিলেন। দেনমোহর ও ভরণপোষণ নিয়ে আলোচনা হয়েছে।',
    outcome: 'ADJOURNED_NEXT_DATE',
    nextSessionDate: new Date(Date.now() + 7 * 86400000),
  }, mediatorActor)

  assert.equal(session1.sessions.length, 1)
  assert.equal(session1.sessions[0].sessionNumber, 1)
  assert.equal(session1.sessions[0].attendance.partyA, 'ATTENDED')

  // Add 2nd session
  const session2 = await recordMediationSession(appId, {
    sessionNumber: 2,
    scheduledAt: new Date(Date.now() + 7 * 86400000),
    attendance: { partyA: 'ATTENDED', partyB: 'ATTENDED' },
    summaryNotes: 'উভয় পক্ষ আপোষ প্রস্তাবে সম্মত হয়েছেন। খসড়া চুক্তি প্রস্তুত হবে।',
    outcome: 'AGREEMENT_REACHED',
  }, mediatorActor)

  assert.equal(session2.sessions.length, 2)
  assert.equal(session2.sessions[1].sessionNumber, 2)
  assert.equal(session2.sessions[1].outcome, 'AGREEMENT_REACHED')

  // 7. Workspace aggregation returns hearingList, mediationList, lawyerFeedback, and calendarEvents
  const ws = await listWorkspace('DLAO_OFFICER', dlaoActor)
  assert.ok(Array.isArray(ws.hearingList))
  assert.ok(Array.isArray(ws.mediationList))
  assert.ok(Array.isArray(ws.lawyerFeedback))
  assert.ok(Array.isArray(ws.calendarEvents))

  // Find our mediation in workspace
  const foundMediation = ws.mediationList.find(m => m.applicationId === appId)
  assert.ok(foundMediation)
  assert.equal(foundMediation.sessionsCount, 2)

  // Find calendar event
  const calEvent = ws.calendarEvents.find(e => e.applicationId === appId)
  assert.ok(calEvent)
})
