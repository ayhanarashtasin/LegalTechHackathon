import { randomBytes, randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import mongoose from 'mongoose'
import * as models from '../models/index.js'
import { Application, Case, CaseFact, ContactAttempt, LawyerAssignment, LawyerUpdate, Person, RoleAssignment, SafeContactProfile, User } from '../models/index.js'
import { acceptApplication, addFact, createDocumentMetadata, lookupHash, newVoicePin, overridePriority, recordContactAttempt, reviewApplication, setSafeContact, submitApplication, submitVoiceIntake } from '../services/applicationService.js'
import { createAssisted } from '../services/assistedService.js'
import { assignLawyer, respondToAssignment, scheduleLawyerUpdate, updateCasePlan } from '../services/lawyerService.js'
import { ensureAdminUser } from '../services/authService.js'
import { hashPassword } from '../utils/password.js'

const accounts = [
  ['demo.officer', 'Demo DLAO Officer', 'DLAO_OFFICER'],
  ['demo.mediator', 'Demo Mediator', 'MEDIATOR'],
  ['demo.helpline', 'Demo Helpline Agent', 'HELPLINE_AGENT'],
  ['demo.udc', 'Demo UDC Operator', 'UDC_OPERATOR'],
  ['demo.lawyer', 'Demo Panel Lawyer', 'PANEL_LAWYER'],
  // A separate office so referrals leave the sending DLAO.
  ['demo.receiving', 'Demo Receiving DLAO', 'RECEIVING_DLAO', 'JHENAIDAH-DEMO'],
  ['demo.support', 'Demo Case Support', 'CASE_SUPPORT'],
  ['demo.clao', 'Demo CLAO', 'CLAO'],
  ['demo.citizen', 'Demo Citizen', 'CITIZEN', 'CITIZEN'],
]

const credentialsFile = new URL('../../.demo-credentials.json', import.meta.url)

async function credentials() {
  let existing = {}
  try {
    existing = JSON.parse(await readFile(credentialsFile, 'utf8'))
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const defaultPassword = process.env.NODE_ENV === 'production'
    ? randomBytes(24).toString('base64url')
    : (process.env.DEMO_USER_PASSWORD || '1234')
  let changed = false
  for (const [username] of accounts) {
    if (!existing[username]) {
      existing[username] = defaultPassword
      changed = true
    }
  }
  if (changed || Object.keys(existing).length === 0) {
    await writeFile(credentialsFile, JSON.stringify(existing, null, 2), { mode: 0o600 })
  }
  return existing
}

async function ensureDemoRecord({ demoSeedKey, applicantName, facts = [] }, actor, accepted = false) {
  let application = await Application.findOne({ demoSeedKey })
  if (!application) {
    const created = await submitApplication({ applicantName, demoSeedKey }, actor)
    application = await Application.findOne({ applicationId: created.applicationId })
  }
  for (const [field, value] of facts) if (!await CaseFact.exists({ applicationId: application.applicationId, field })) {
    await addFact(application.applicationId, { field, value, sourceType: 'STAFF_ENTERED' }, actor)
  }
  if (accepted && application.status !== 'ACCEPTED') {
    if (application.reviewState !== 'READY_FOR_DECISION') await reviewApplication(application.applicationId, {
      reviewState: 'READY_FOR_DECISION', reason: 'Fictional demo Case reviewed by a human DLAO officer.',
    }, actor)
    await acceptApplication(application.applicationId, 'Fictional demo Case accepted by a human DLAO officer.', actor)
  }
  return Application.findOne({ applicationId: application.applicationId })
}

try {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/dlas', { dbName: process.env.MONGODB_DB || 'dlas', serverSelectionTimeoutMS: 10000 })
  await Promise.all(Object.values(models).map((item) => item.init()))
  await ensureAdminUser()
  const passwords = await credentials()
  for (const [username, displayName, role, officeCode = 'DEMO'] of accounts) {
    if (typeof passwords[username] !== 'string') throw new Error('Demo credential file is incomplete.')
    const passwordHash = await hashPassword(passwords[username])
    let personId = undefined
    if (role === 'CITIZEN') {
      let person = await Person.findOne({ displayName })
      if (!person) {
        person = await Person.create({ displayName, identityStatus: 'VERIFIED', fictional: true })
      }
      personId = person._id
    }
    const update = { displayName, passwordHash, active: true, fictional: true }
    if (personId) update.personId = personId
    const user = await User.findOneAndUpdate(
      { username },
      { $set: update },
      { upsert: true, returnDocument: 'after' },
    )
    await RoleAssignment.updateOne(
      { userId: user._id, role, officeCode },
      { $set: { active: true } },
      { upsert: true },
    )
    await RoleAssignment.updateMany({ userId: user._id, role, officeCode: { $ne: officeCode } }, { $set: { active: false } })
  }
  let sample = await Application.findOne({ demoSeedKey: 'STEP3_SIMPLE' })
  if (!sample) {
    const helpline = await User.findOne({ username: 'demo.helpline' })
    const assignment = await RoleAssignment.findOne({ userId: helpline._id, role: 'HELPLINE_AGENT', active: true })
    const submitted = await submitApplication(
      { applicantName: 'Fictional Demo Applicant', demoSeedKey: 'STEP3_SIMPLE' },
      { userId: helpline._id, assignments: [assignment] },
    )
    sample = await Application.findOne({ applicationId: submitted.applicationId })
  }
  if (sample.status === 'SUBMITTED') {
    const officer = await User.findOne({ username: 'demo.officer' })
    const assignment = await RoleAssignment.findOne({ userId: officer._id, role: 'DLAO_OFFICER', active: true })
    const actor = { userId: officer._id, assignments: [assignment] }
    if (sample.reviewState !== 'READY_FOR_DECISION') {
      await reviewApplication(sample.applicationId, {
        reviewState: 'READY_FOR_DECISION',
        reason: 'Fictional seed record reviewed by the demo officer.',
      }, actor)
    }
    await acceptApplication(sample.applicationId, 'Fictional seed record accepted by the demo officer.', actor)
  }
  if (!await Application.exists({ demoSeedKey: 'STEP4_MOYURI_RIPON' })) {
    const submitted = await submitVoiceIntake({
      mode: 'INTAKE',
      answers: {
        callerRole: 'REPRESENTATIVE', callerName: 'Fictional Ripon (demo)', relationship: 'Brother',
        applicantName: 'Fictional Moyuri (demo)', district: 'Joypurhat', nidKnown: false,
        problem: 'Fictional representative report; applicant confirmation remains pending.', urgent: false,
        contactChannel: 'UDC', safeTime: 'Weekday morning at the office',
      },
    })
    await Application.updateOne({ applicationId: submitted.applicationId }, { $set: { demoSeedKey: 'STEP4_MOYURI_RIPON' } })
  }
  if (!await Application.exists({ demoSeedKey: 'VOICE_ADVICE_REQUEST' })) {
    const submitted = await submitVoiceIntake({
      mode: 'ADVICE',
      answers: { adviceTopic: 'Fictional question: how can a worker claim unpaid wages?', contactValue: '01700000000', safeTime: 'Weekday afternoon' },
    })
    await Application.updateOne({ applicationId: submitted.applicationId }, { $set: { demoSeedKey: 'VOICE_ADVICE_REQUEST' } })
  }
  if (!await Application.exists({ demoSeedKey: 'STEP7_NUCHING' })) {
    const udc = await User.findOne({ username: 'demo.udc' })
    const udcRole = await RoleAssignment.findOne({ userId: udc._id, role: 'UDC_OPERATOR', active: true })
    const created = await createAssisted({
      temporaryId: randomUUID(), clientMutationId: randomUUID(), offlineCreatedAt: new Date().toISOString(),
      applicantName: 'Fictional Nuching (demo)', translatorName: 'Fictional Marma translator', typistName: udc.displayName,
      originalLanguage: 'Marma', originalStatement: 'Fictional Marma account: a land record needs review.',
      translatedStatement: 'নমুনা বাংলা অনুবাদ: জমির নথিটি একজন কর্মকর্তার দেখে দেওয়া দরকার।',
      caseType: 'LAND', consentAttestation: 'Fictional applicant gave oral consent to assisted intake.',
      originalConfirmed: false, translationConfirmed: false, contactChannel: 'IN_PERSON', safeTime: 'Weekday morning at the office',
    }, { userId: udc._id, displayName: udc.displayName, assignments: [udcRole] })
    await Application.updateOne({ applicationId: created.applicationId }, { $set: { demoSeedKey: 'STEP7_NUCHING' } })
  }
  if (!await Application.exists({ demoSeedKey: 'STEP8_NABILA' })) {
    const officer = await User.findOne({ username: 'demo.officer' })
    const actor = { userId: officer._id, assignments: [await RoleAssignment.findOne({ userId: officer._id, role: 'DLAO_OFFICER', active: true })] }
    const { applicationId } = await submitApplication({ applicantName: 'Fictional Nabila (demo)', demoSeedKey: 'STEP8_NABILA' }, actor)
    const { applicantPersonId } = await Application.findOne({ applicationId }).lean()
    const reported = { sourceType: 'APPLICANT_REPORTED', sourcePersonId: applicantPersonId.toString() }
    await addFact(applicationId, { field: 'complaint.summary', value: 'Fictional: a former classmate is spreading altered images and pressuring the applicant. The harm is spreading, and another competent authority may need to act.', ...reported }, actor)
    await addFact(applicationId, { field: 'safety.urgent', value: 'YES', ...reported }, actor)
    await setSafeContact(applicationId, { allowedChannels: ['IN_PERSON'], prohibitedChannels: ['PHONE', 'SMS'], safeTimeWindow: 'Weekday office hours', smsSafe: false, neutralWordingRequired: true }, actor)
    await createDocumentMetadata(applicationId, { label: 'Synthetic placeholder: altered-image evidence', qualityState: 'READABLE', note: 'Harmless synthetic placeholder; no real image is stored.', sensitivity: 'RESTRICTED' }, actor)
    await createDocumentMetadata(applicationId, { label: 'Fictional message log summary', qualityState: 'READABLE' }, actor)
    await reviewApplication(applicationId, { reviewState: 'READY_FOR_DECISION', reason: 'Fictional seed: the officer reviewed the Nabila intake.' }, actor)
    await acceptApplication(applicationId, 'Fictional seed: accepted for the Step 8 referral demo.', actor)
  }

  let malek = await Application.findOne({ demoSeedKey: 'STEP9_MALEK' })
  const officer = await User.findOne({ username: 'demo.officer' })
  const officerRole = await RoleAssignment.findOne({ userId: officer._id, role: 'DLAO_OFFICER', active: true })
  const officerActor = { userId: officer._id, assignments: [officerRole] }
  // Malek says his code aloud on the spoken status route, so it is a 6-digit PIN like a 16699 caller's. Only the
  // machine that creates him, or still holds his old 24-character code, issues it: seeding a shared database from
  // another machine never replaces a PIN someone else is using.
  const malekCode = passwords.demo_malek_status_lookup_code
  let issueMalekPin = Boolean(malekCode) && !/^\d{6}$/.test(malekCode)
  if (!malek) {
    const helpline = await User.findOne({ username: 'demo.helpline' })
    const helplineRole = await RoleAssignment.findOne({ userId: helpline._id, role: 'HELPLINE_AGENT', active: true })
    const created = await submitApplication({ applicantName: 'Fictional Malek (demo)', demoSeedKey: 'STEP9_MALEK' }, { userId: helpline._id, assignments: [helplineRole] })
    malek = await Application.findOne({ applicationId: created.applicationId })
    issueMalekPin = true
  }
  if (issueMalekPin) {
    const pin = newVoicePin()
    await Application.updateOne({ applicationId: malek.applicationId }, { $set: { lookupCodeHash: lookupHash(pin) } })
    passwords.demo_malek_status_lookup_code = pin
    await writeFile(credentialsFile, JSON.stringify(passwords, null, 2), { mode: 0o600 })
  }
  if (!await CaseFact.exists({ applicationId: malek.applicationId, field: 'complaint.summary' })) {
    await addFact(malek.applicationId, { field: 'complaint.summary', value: 'Fictional scenario detail: this wage matter has remained unresolved for about seven months. No amount or real employer is recorded.', sourceType: 'STAFF_ENTERED' }, officerActor)
  }
  if (!await SafeContactProfile.exists({ applicationId: malek.applicationId })) {
    await setSafeContact(malek.applicationId, {
      allowedChannels: ['PHONE', 'IN_PERSON'], prohibitedChannels: ['SMS'],
      contactValue: 'Synthetic demo shop number only; not dialable.', safeTimeWindow: 'Caller-initiated status lookup; neutral wording only if another person answers.',
      smsSafe: false, neutralWordingRequired: true,
    }, officerActor)
  }
  if (malek.status === 'SUBMITTED') {
    if (malek.reviewState !== 'READY_FOR_DECISION') await reviewApplication(malek.applicationId, { reviewState: 'READY_FOR_DECISION', reason: 'Fictional Malek scenario reviewed by the demo officer.' }, officerActor)
    await acceptApplication(malek.applicationId, 'Fictional Malek scenario accepted by the demo officer.', officerActor)
  }
  if (!await ContactAttempt.exists({ applicationId: malek.applicationId, outcome: 'UNKNOWN_PERSON' })) {
    await recordContactAttempt(malek.applicationId, { channel: 'PHONE', outcome: 'UNKNOWN_PERSON', reason: 'Fictional shop line: another person answered; neutral wording only and no case facts were disclosed.' }, officerActor)
  }
  // The next step is in Bangla so the spoken status can read it to Malek, and the hearing is on a court working day
  // (Sunday to Thursday in Dhaka) about two weeks out. A plan an officer changed by hand is kept.
  const caseRecord = await Case.findOne({ applicationId: malek.applicationId }).lean()
  const englishSeedStep = 'Visit the DLAO office before the listed hearing to review the file; confirm a safe travel plan first.'
  const dhakaWeekday = (date) => new Date(date.getTime() + 6 * 3600000).getUTCDay()
  const replaceHearing = !caseRecord.nextHearingAt || caseRecord.nextHearingAt < new Date() || [5, 6].includes(dhakaWeekday(caseRecord.nextHearingAt))
  const replaceStep = !caseRecord.nextAction || caseRecord.nextAction === englishSeedStep
  if (replaceHearing || replaceStep) {
    const hearing = new Date(Date.now() + 14 * 86400000)
    hearing.setUTCHours(4, 0, 0, 0) // 10:00 in Dhaka
    while ([5, 6].includes(dhakaWeekday(hearing))) hearing.setUTCDate(hearing.getUTCDate() + 1)
    await updateCasePlan(malek.applicationId, {
      nextHearingAt: (replaceHearing ? hearing : caseRecord.nextHearingAt).toISOString(),
      nextAction: replaceStep ? 'শুনানির আগে ফাইল দেখতে জেলা লিগ্যাল এইড অফিসে আসুন। আসার আগে নিরাপদে যাতায়াতের ব্যবস্থা নিশ্চিত করুন।' : caseRecord.nextAction,
      reason: 'Fictional seven-month case plan for the demo.',
    }, officerActor)
  }
  let assignment = await LawyerAssignment.findOne({ applicationId: malek.applicationId, active: true, status: { $in: ['PENDING', 'ACCEPTED'] } })
  const lawyer = await User.findOne({ username: 'demo.lawyer' })
  const lawyerRole = await RoleAssignment.findOne({ userId: lawyer._id, role: 'PANEL_LAWYER', officeCode: 'DEMO', active: true })
  const lawyerActor = { userId: lawyer._id, assignments: [lawyerRole] }
  if (!assignment) {
    await assignLawyer(malek.applicationId, { lawyerUserId: lawyer._id.toString(), reason: 'Fictional panel assignment for the Malek demo case.' }, officerActor)
    assignment = await LawyerAssignment.findOne({ applicationId: malek.applicationId, active: true, status: 'PENDING' })
  }
  if (assignment.status === 'PENDING') await respondToAssignment(assignment._id.toString(), { decision: 'ACCEPT', reason: 'I accept this fictional panel assignment.' }, lawyerActor)
  if (!await LawyerUpdate.exists({ assignmentId: assignment._id })) {
    await scheduleLawyerUpdate(malek.applicationId, {
      assignmentId: assignment._id.toString(), dueAt: new Date(Date.now() + 3 * 86400000).toISOString(),
      instruction: 'Record the file review and confirm the applicant-safe next step before the hearing.',
    }, officerActor)
  }
  const citizenUser = await User.findOne({ username: 'demo.citizen' })
  if (citizenUser && malek && !malek.citizenUserId) {
    await Application.updateOne({ applicationId: malek.applicationId }, { $set: { citizenUserId: citizenUser._id.toString() } })
  }

  const triageConflict = await ensureDemoRecord({
    demoSeedKey: 'STEP11_TRIAGE_CONFLICT', applicantName: 'Fictional triage disagreement case',
    facts: [
      ['complaint.summary', 'Fictional tabletop case: the initial wage note says no immediate danger was reported.'],
      ['triage.case_category', 'LABOUR'],
    ],
  }, officerActor, true)
  if (!triageConflict.priorityDecision) await overridePriority(triageConflict.applicationId, {
    priorityDecision: 'ROUTINE', reason: 'Fictional initial routine priority recorded.',
  }, officerActor)

  console.log('Seeded fictional provider accounts and exactly 5 distinct representative cases (Moyuri/Ripon audio intake, Nuching pending intake, Nabila urgent case, Malek accepted case, and routine case).')
} catch (error) {
  console.error('Demo account seeding failed:', error.name, error.codeName || error.code || '')
  process.exitCode = 1
} finally {
  await mongoose.disconnect()
}
