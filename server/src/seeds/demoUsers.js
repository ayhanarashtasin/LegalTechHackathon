import { randomBytes, randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import mongoose from 'mongoose'
import * as models from '../models/index.js'
import { Application, Case, CaseFact, ContactAttempt, LawyerAssignment, LawyerUpdate, Referral, RoleAssignment, SafeContactProfile, User } from '../models/index.js'
import { acceptApplication, addFact, createDocumentMetadata, overridePriority, recordContactAttempt, reviewApplication, setSafeContact, submitApplication, submitVoiceIntake } from '../services/applicationService.js'
import { createAssisted } from '../services/assistedService.js'
import { createRelatedIncidentGroup, linkRelatedIncidentEvidence } from '../services/incidentService.js'
import { assignLawyer, respondToAssignment, scheduleLawyerUpdate, updateCasePlan } from '../services/lawyerService.js'
import { startMediation } from '../services/mediationService.js'
import { createReferral, respondReferral } from '../services/referralService.js'
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
]

const credentialsFile = new URL('../../.demo-credentials.json', import.meta.url)

async function credentials() {
  try {
    return JSON.parse(await readFile(credentialsFile, 'utf8'))
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const generated = Object.fromEntries(accounts.map(([username]) => [username, randomBytes(24).toString('base64url')]))
  await writeFile(credentialsFile, JSON.stringify(generated, null, 2), { flag: 'wx', mode: 0o600 })
  return generated
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
  const passwords = await credentials()
  for (const [username, displayName, role, officeCode = 'DEMO'] of accounts) {
    if (typeof passwords[username] !== 'string') throw new Error('Demo credential file is incomplete.')
    const passwordHash = await hashPassword(passwords[username])
    const user = await User.findOneAndUpdate(
      { username },
      { $set: { displayName, passwordHash, active: true, fictional: true } },
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
