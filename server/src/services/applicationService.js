import mongoose from 'mongoose'
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { Application, AssistanceRecord, AuditEvent, CallRecording, CancellationRequest, Case, CaseFact, ConsentRecord, ContactAttempt, Document, DocumentVersion, EvidenceAccessLog, LawyerAssignment, LawyerPaymentEvent, LawyerUpdate, Mediation, Person, Referral, Representation, RoleAssignment, SafeContactProfile, Task, User, VoiceTranscript } from '../models/index.js'
import { hasOfficeRole } from '../middleware/auth.js'
import { HttpError } from '../utils/httpError.js'
import { daysOverdue } from '../utils/overdue.js'
import { nextRecordId } from '../utils/recordId.js'
import { extractionModel, outlineComplaint, speechModel } from './ai/groq.js'
import { appendAudit, getAuditTrail } from './auditService.js'
import { udcCanOpen } from './assistedService.js'
import { categorySignals, categoryUrgencyReason } from './caseCategories.js'

const intakeChannels = {
  HELPLINE_AGENT: 'HELPLINE_SIM',
  UDC_OPERATOR: 'UDC',
  DLAO_OFFICER: 'DLAO',
  CASE_SUPPORT: 'DLAO',
}
const newLookupCode = () => randomBytes(12).toString('hex')
export const lookupHash = (code) => createHash('sha256').update(code).digest('hex')

// Bangladesh keeps UTC+6 all year, so the UTC date of this shifted value is the calendar day in Dhaka.
const dhakaDay = (value) => new Date(new Date(value).getTime() + 6 * 60 * 60 * 1000).toISOString().slice(0, 10)

// Demo rules only (urgency criteria await law-team approval); the officer's priorityDecision stays the final priority.
export function urgencyReasons({ urgentFact, aiSensitive, safetyNeedsReview, restrictedEvidence, category, harassmentKeywords }) {
  return [
    categoryUrgencyReason(category, harassmentKeywords),
    urgentFact && `An urgent fact is recorded (safety.urgent revision ${urgentFact.revision}, ${urgentFact.sourceType.replaceAll('_', ' ').toLowerCase()}).`,
    aiSensitive && 'AI flagged possible violence or danger in the intake words.',
    safetyNeedsReview && 'The voice safety answer needs human verification before anyone relies on a no-risk response.',
    restrictedEvidence && `${restrictedEvidence} restricted sensitive-evidence item${restrictedEvidence === 1 ? ' is' : 's are'} on file.`,
  ].filter(Boolean)
}

// What an officer weighs first. Each signal comes from a recorded fact or event; none is a judgement made here.
function vulnerabilities({ urgent, representative, nidKnown, aiSensitive, safetyNeedsReview, category, harassmentKeywords }) {
  return [urgent && 'SAFETY_RISK', safetyNeedsReview && 'SAFETY_UNVERIFIED', representative && 'REPRESENTATIVE_CALLER', nidKnown === 'NO' && 'NID_UNKNOWN', aiSensitive && 'AI_FLAGGED_DANGER', ...categorySignals(category, harassmentKeywords)].filter(Boolean)
}
const latestValues = (facts) => { const values = {}; for (const fact of facts) values[fact.field] ??= fact.value; return values }

function intakeAssignment(actor) {
  const assignment = actor.assignments.find(({ role }) => intakeChannels[role])
  if (!assignment) throw new HttpError(403, 'FORBIDDEN', 'This role cannot submit an application.')
  return assignment
}

export async function requireOpenCase(applicationId, session) {
  const caseRecord = await Case.findOne({ applicationId }).session(session)
  if (!caseRecord || caseRecord.status !== 'OPEN') throw new HttpError(409, 'INVALID_TRANSITION', 'This action requires an open Case.')
  return caseRecord
}

export async function officeApplication(applicationId, actor, session) {
  const application = await Application.findOne({ applicationId }).session(session)
  if (!application) throw new HttpError(404, 'NOT_FOUND', 'Application not found.')
  if (!hasOfficeRole(actor, 'DLAO_OFFICER', application.officeCode)) throw new HttpError(403, 'FORBIDDEN', 'This office cannot change the application.')
  return application
}

// Bumps the record once; `events` reserves that many audit sequence numbers for the change.
export async function advance(application, session, changes = {}, events = 1) {
  const updated = await Application.findOneAndUpdate(
    { applicationId: application.applicationId, version: application.version },
    { $set: changes, $inc: { version: 1, auditSequence: events } },
    { returnDocument: 'after', session },
  )
  if (!updated) throw new HttpError(409, 'CONFLICT', 'The application changed. Refresh and retry.')
  return updated
}

export async function submitApplication({ applicantName, demoSeedKey }, actor) {
  const assignment = intakeAssignment(actor)
  const applicationId = await nextRecordId('APP')
  const lookupCode = newLookupCode()
  return mongoose.connection.transaction(async (session) => {
    const [person] = await Person.create([{ displayName: applicantName, identityStatus: 'INCOMPLETE' }], { session })
    const [application] = await Application.create([{
      applicationId,
      demoSeedKey,
      lookupCodeHash: lookupHash(lookupCode),
      applicantPersonId: person._id,
      officeCode: assignment.officeCode,
      channel: intakeChannels[assignment.role],
      submittedByUserId: actor.userId,
    }], { session })
    await Task.create([{
      applicationId,
      kind: 'INTAKE_REVIEW',
      title: 'Review new application',
      ownerRole: 'DLAO_OFFICER',
      nextAction: 'Review intake, identity gaps, provenance, and safe contact before deciding.',
    }], { session })
    await appendAudit({
      applicationId,
      sequence: 1,
      action: 'APPLICATION_SUBMITTED',
      actorUserId: actor.userId,
      actorRole: assignment.role,
      channel: application.channel,
      newState: { status: 'SUBMITTED', applicantPersonId: person.id },
    }, session)
    return { applicationId, status: application.status, caseId: null, identityStatus: person.identityStatus, lookupCode }
  })
}

// ponytail: one demo office receives every voice intake; route by a human-approved district map once real offices exist.
const VOICE_OFFICE = 'DEMO'
// Placeholder wording pending law-team approval. It must never reveal legal aid, the application, or the complaint.
export const NEUTRAL_UNKNOWN_ANSWER = 'হ্যালো, আমি পরে আবার ফোন করব। ধন্যবাদ। (Hello, I will call again later. Thank you.)'

// The public 16699 simulator has no signed-in user; writes are attributed to this disabled automated-channel account.
const voiceChannelUser = () => User.findOneAndUpdate(
  { username: 'system.voice16699' },
  { $setOnInsert: { displayName: '16699 voice simulation (automated channel)', passwordHash: 'login-disabled', active: false } },
  { upsert: true, returnDocument: 'after' },
)

// 16699 caller's status PIN: six digits, so it can be read out on the call and said back to the helpline.
// ponytail: 10^6 codes; guessing is bounded by the public rate limit, the per-ID lockout on the caller-facing status
// lookup (trackApplicationStatus), the 15-minute recording window, and staff-only lookups.
export const newVoicePin = () => String(randomInt(0, 1_000_000)).padStart(6, '0')

// Sentences for the officer's first task; each is translated on the Bangla screen.
function voiceReviewSteps({ representative, answers, aiSensitive, safetyNeedsReview }) {
  return [
    representative ? 'Reported by a representative: authority and applicant confirmation are pending.' : 'Reported by the applicant by voice.',
    answers.nid ? 'NID number given by the caller; verify it before relying on it.' : 'Identity is incomplete.',
    answers.nidKnown === false && 'NID not known: the caller was advised to verify identity at the nearest UDC.',
    answers.urgent === true && 'The caller reported a current threat, violence, or safety risk; decide priority first.',
    safetyNeedsReview && 'Safety was unclear or a spoken no was inferred: review the transcript/recording and verify safety with the caller through the safe-contact route before treating this as no risk.',
    'Contact only through the active safe-contact profile with neutral wording. No SMS or voicemail.',
    aiSensitive && 'AI flagged possible violence or danger in the caller’s words; a human must judge it.',
  ].filter(Boolean).join(' ')
}

// One authoritative record either way: a complaint goes to the DLAO queue; an advice request waits for a helpline
// callback and becomes a complaint only if the officer finds formal legal aid is needed.
export async function submitVoiceIntake({ mode, answers, correctedFields = [], aiFields = [], confirmation = 'BUTTON', transcript, aiSensitive = false }, actor = null) {
  const channelUser = await voiceChannelUser()
  const applicationId = await nextRecordId('APP')
  const lookupCode = newVoicePin()
  const advice = mode === 'ADVICE'
  const safetyNeedsReview = !advice && (answers.urgent === 'UNKNOWN' || (answers.urgent === false && (confirmation === 'VOICE' || aiFields.includes('urgent'))))
  // Outside the transaction: a slow or failed model call never blocks or loses the submission.
  const outline = advice ? null : await outlineComplaint(answers.problem).catch(() => null)
  return mongoose.connection.transaction(async (session) => {
    const representative = answers.callerRole === 'REPRESENTATIVE'
    const trusted = answers.contactChannel === 'TRUSTED_PERSON'
    const safeNumber = answers.contactValue || answers.trustedPhone || answers.phone
    const phone = advice || trusted || answers.contactChannel === 'PHONE' || Boolean(safeNumber)
    const sourceType = advice ? 'UNKNOWN_OR_UNVERIFIED' : representative ? 'REPRESENTATIVE_REPORTED' : 'APPLICANT_REPORTED'
    const applicantName = representative ? answers.applicantName : answers.callerName
    const recordedByUserId = channelUser._id

    let applicant
    let citizenUserId = null

    // Only a citizen complaining for themselves becomes the applicant; staff demos, representatives, and advice stay separate.
    if (!advice && !representative && actor?.assignments?.some(({ role }) => role === 'CITIZEN')) {
      const authUser = await User.findById(actor.userId).session(session)
      if (authUser) {
        citizenUserId = authUser._id.toString()
        if (authUser.personId) {
          applicant = await Person.findById(authUser.personId).session(session)
        }
        if (!applicant) {
          const [createdPerson] = await Person.create([{ displayName: applicantName || authUser.displayName || 'Citizen Applicant' }], { session })
          applicant = createdPerson
          authUser.personId = createdPerson._id
        }
        // Update user profile with intake details if provided
        if (answers.contactValue && !authUser.phone) {
          authUser.phone = answers.contactValue
        }
        if (applicantName && (!authUser.displayName || authUser.displayName === authUser.username)) {
          authUser.displayName = applicantName
          applicant.displayName = applicantName
          await applicant.save({ session })
        }
        await authUser.save({ session })
      }
    }

    if (!applicant) {
      const [newPerson] = await Person.create([{ displayName: advice ? 'Not collected (advice request)' : applicantName, identityStatus: answers.nid ? 'PENDING_REVIEW' : 'INCOMPLETE' }], { session })
      applicant = newPerson
    }

    const [caller] = representative ? await Person.create([{ displayName: answers.callerName }], { session }) : [applicant]
    const [representation] = representative ? await Representation.create([{
      applicationId, applicantPersonId: applicant._id, representativePersonId: caller._id, relationship: answers.relationship,
      scope: 'Initial report through the 16699 voice simulation; authority not verified.', recordedByUserId,
    }], { session }) : []
    // [fact field, answer it came from, value]; an answer the live model extracted is flagged aiInferred.
    // The safe number lives only in the versioned Safe Contact Profile, so a later safer number can never be shadowed by a stale copy.
    const factValues = advice
      ? [['advice.topic', 'adviceTopic', answers.adviceTopic]]
      : [['complaint.summary', 'problem', answers.problem], ['location.district', 'district', answers.district],
        ['identity.nid_known', 'nidKnown', answers.nidKnown ? 'YES' : 'NO'], ...(answers.nid ? [['identity.nid', 'nid', answers.nid]] : []),
        ['safety.urgent', 'urgent', answers.urgent === 'UNKNOWN' ? 'UNKNOWN' : answers.urgent ? 'YES' : 'NO'],
        ['contact.preference', 'contactChannel', answers.contactChannel || 'PHONE']]
    // Representative reports are never applicant-confirmed here; only the applicant can confirm them later.
    const applicantConfirmed = !advice && !representative
    const callerFacts = factValues.map(([field, answerField, value]) => {
      const unansweredSafety = field === 'safety.urgent' && value === 'UNKNOWN'
      return {
        applicationId, field, value, sourceType: unansweredSafety ? 'UNKNOWN_OR_UNVERIFIED' : sourceType,
        sourcePersonId: advice || unansweredSafety ? undefined : caller._id,
        captureMethod: 'VOICE', aiInferred: aiFields.includes(answerField),
        callerConfirmed: !unansweredSafety, applicantConfirmed: !unansweredSafety && applicantConfirmed,
        confirmedByPersonId: !unansweredSafety && applicantConfirmed ? applicant._id : undefined,
        revision: 1, recordedByUserId,
      }
    })
    // The model's outline of the account: unverified suggestions, never confirmed by anyone.
    const outlineFacts = Object.entries(outline ? { 'incident.what': outline.what, 'incident.when': outline.when, 'incident.where': outline.where,
      'incident.who': outline.who, 'complaint.type': outline.type, 'complaint.legal_need': outline.legalNeed } : {})
      .filter(([, value]) => value)
      .map(([field, value]) => ({ applicationId, field, value, sourceType: 'AI_INFERRED', captureMethod: 'AI', aiInferred: true, revision: 1, recordedByUserId }))
    const facts = await CaseFact.create([...callerFacts, ...outlineFacts], { session, ordered: true })
    const [trustedPerson] = trusted ? await Person.create([{ displayName: answers.trustedPerson }], { session }) : []
    // A UDC route means in person at the UDC; a trusted person is reached on their own phone. Never SMS or voicemail.
    const [profile] = await SafeContactProfile.create([{
      applicationId, version: 1,
      allowedChannels: phone ? ['PHONE'] : ['IN_PERSON'],
      prohibitedChannels: phone ? ['SMS'] : ['PHONE', 'SMS'],
      contactValue: safeNumber || (phone ? (trusted ? answers.trustedPhone : answers.contactValue) : undefined),
      contactOwnerPersonId: trusted ? trustedPerson._id : phone && !advice ? caller._id : undefined,
      safeTimeWindow: answers.safeTime || 'Office hours (09:00 AM - 05:00 PM)', smsSafe: false, neutralWordingRequired: true, unknownAnswerAction: 'DISCLOSE_NOTHING', recordedByUserId,
    }], { session })
    const [task] = await Task.create([advice
      ? { applicationId, kind: 'ADVICE_CALLBACK', ownerRole: 'HELPLINE_AGENT', title: 'Call back with legal information',
        nextAction: 'Call back only on the recorded safe number at the safe time. Give legal information; if formal legal aid is needed, record the applicant details for DLAO review.' }
      : { applicationId, kind: 'INTAKE_REVIEW', ownerRole: 'DLAO_OFFICER', title: 'Review 16699 voice intake', nextAction: voiceReviewSteps({ representative, answers, aiSensitive, safetyNeedsReview }) },
    ], { session })
    const aiAssisted = aiFields.length > 0 || Boolean(transcript) || outlineFacts.length > 0
    const [storedTranscript] = transcript ? await VoiceTranscript.create([{ applicationId, turns: transcript, transcribedBy: speechModel() }], { session }) : []
    const events = [
      {
        action: 'APPLICATION_SUBMITTED',
        // Records that AI assisted and which answers it extracted; no model reasoning, and never the NID itself.
        newState: { status: 'SUBMITTED', applicantPersonId: applicant.id, mode, service: advice ? 'ADVICE' : 'COMPLAINT', callerRole: answers.callerRole ?? 'NOT_COLLECTED', nidProvided: Boolean(answers.nid), contactRoute: advice ? 'PHONE' : answers.contactChannel, correctedFields, aiAssisted, aiSensitive, safetyNeedsReview, aiModels: aiAssisted ? { speechToText: speechModel(), extraction: extractionModel() } : null, aiFields, confirmation },
        reason: 'Caller confirmed the read-back and submitted through the 16699 voice simulation.',
      },
      ...(representation ? [{ action: 'REPRESENTATION_RECORDED', newState: { representationId: representation.id, authorityStatus: 'PENDING' } }] : []),
      // Project decision 2026-09-23: every call is recorded; the greeting tells the caller, and no opt-out is offered.
      { action: 'RECORDING_NOTICE_GIVEN', newState: { notice: 'GREETING_ANNOUNCES_CALL_RECORDING', optOutOffered: false } },
      ...facts.map((fact) => ({ action: 'FACT_RECORDED', newState: { factId: fact.id, field: fact.field, sourceType: fact.sourceType, callerConfirmed: fact.callerConfirmed, applicantConfirmed: fact.applicantConfirmed } })),
      { action: 'SAFE_CONTACT_UPDATED', newState: { profileId: profile.id, version: 1 } },
      { action: 'TASK_CREATED', newState: { taskId: task.id, kind: task.kind, ownerRole: task.ownerRole } },
      ...(storedTranscript ? [{ action: 'TRANSCRIPT_STORED', newState: { transcriptId: storedTranscript.id, turns: transcript.length } }] : []),
    ]

    await Application.create([{
      applicationId, applicantPersonId: applicant._id, officeCode: VOICE_OFFICE, channel: 'VOICE_SIM', service: advice ? 'ADVICE' : 'COMPLAINT',
      submittedByUserId: channelUser._id, auditSequence: events.length, lookupCodeHash: lookupHash(lookupCode),
      citizenUserId,
    }], { session })
    for (const [index, event] of events.entries()) {
      await appendAudit({ ...event, applicationId, sequence: index + 1, actorUserId: channelUser._id, actorRole: 'SYSTEM', channel: 'VOICE_16699_SIM' }, session)
    }
    return {
      applicationId,
      mode,
      status: 'SUBMITTED',
      lookupCode,
      authenticated: Boolean(citizenUserId),
    }
  })
}

// The helpline officer's callback on a 16699 advice request: legal information given (the request closes), or formal
// legal aid needed, which turns the same record into a complaint for DLAO review. What the officer enters is staff-entered.
export async function recordAdviceOutcome(applicationId, { outcome, guidance, applicantName, district, nid }, actor) {
  return mongoose.connection.transaction(async (session) => {
    const application = await Application.findOne({ applicationId }).session(session)
    // A request that became a complaint keeps its outcome, so a second outcome is a conflict, not a missing record.
    if (!application || (application.service !== 'ADVICE' && !application.adviceOutcome)) throw new HttpError(404, 'NOT_FOUND', 'Advice request not found.')
    if (!hasOfficeRole(actor, 'HELPLINE_AGENT', application.officeCode)) throw new HttpError(403, 'FORBIDDEN', 'This office cannot handle this advice request.')
    if (application.adviceOutcome) throw new HttpError(409, 'ALREADY_RECORDED', 'This advice request already has an outcome.')
    const formal = outcome === 'FORMAL_ASSISTANCE'
    const staffFact = (field, value) => ({ applicationId, field, value, sourceType: 'STAFF_ENTERED', captureMethod: 'STAFF', revision: 1, recordedByUserId: actor.userId })
    const facts = await CaseFact.create([staffFact('advice.guidance', guidance), ...(formal ? [staffFact('location.district', district),
      staffFact('identity.nid_known', nid ? 'YES' : 'NO'), ...(nid ? [staffFact('identity.nid', nid)] : [])] : [])], { session, ordered: true })
    if (formal) await Person.updateOne({ _id: application.applicantPersonId }, { $set: { displayName: applicantName, identityStatus: nid ? 'PENDING_REVIEW' : 'INCOMPLETE' } }, { session })
    const callback = await Task.findOneAndUpdate({ applicationId, kind: 'ADVICE_CALLBACK', status: 'OPEN' },
      { $set: { status: 'DONE', completedAt: new Date(), completedByUserId: actor.userId } }, { returnDocument: 'after', session })
    const [review] = formal ? await Task.create([{ applicationId, kind: 'INTAKE_REVIEW', ownerRole: 'DLAO_OFFICER', title: 'Review new application',
      nextAction: 'Review intake, identity gaps, provenance, and safe contact before deciding.' }], { session }) : []
    const events = [
      ...facts.map((fact) => ({ action: 'FACT_RECORDED', newState: { factId: fact.id, field: fact.field, sourceType: fact.sourceType } })),
      { action: 'ADVICE_OUTCOME_RECORDED', newState: { outcome, callbackTaskId: callback?.id ?? null },
        reason: formal ? 'Helpline officer found that formal legal aid is needed; the request now waits for DLAO review.' : 'Helpline officer gave legal information on the callback; no application follows.' },
      ...(review ? [{ action: 'TASK_CREATED', newState: { taskId: review.id, kind: review.kind, ownerRole: review.ownerRole } }] : []),
    ]
    const updated = await advance(application, session, { adviceOutcome: outcome, ...(formal ? { service: 'COMPLAINT' } : {}) }, events.length)
    const first = updated.auditSequence - events.length + 1
    for (const [index, event] of events.entries()) {
      await appendAudit({ ...event, applicationId, sequence: first + index, actorUserId: actor.userId, actorRole: 'HELPLINE_AGENT', channel: 'HELPLINE_SIM' }, session)
    }
    return { applicationId, outcome, service: updated.service }
  })
}

const RECORDING_UPLOAD_WINDOW_MS = 15 * 60 * 1000

// The caller's browser uploads the full call once, right after submission, proving it with the one-time status code.
export async function storeCallRecording(applicationId, code, audio, mimeType) {
  const channelUser = await voiceChannelUser()
  return mongoose.connection.transaction(async (session) => {
    const application = await Application.findOne({ applicationId, channel: 'VOICE_SIM' }).select('+lookupCodeHash').session(session)
    const expected = Buffer.from(application?.lookupCodeHash ?? '0'.repeat(64), 'hex')
    const matches = timingSafeEqual(expected, Buffer.from(lookupHash(code), 'hex'))
    if (!application || !matches || Date.now() - application.createdAt.getTime() > RECORDING_UPLOAD_WINDOW_MS) throw new HttpError(403, 'FORBIDDEN', 'This call recording cannot be attached.')
    const sha256 = createHash('sha256').update(audio).digest('hex')
    const existing = await CallRecording.findOne({ applicationId }).session(session)
    if (existing) {
      if (existing.sha256 === sha256) return { applicationId, bytes: existing.bytes }
      throw new HttpError(409, 'ALREADY_STORED', 'This call recording is already stored.')
    }
    const updated = await advance(application, session)
    const [recording] = await CallRecording.create([{ applicationId, mimeType, bytes: audio.length, sha256, audio }], { session })
    await appendAudit({
      applicationId, sequence: updated.auditSequence, action: 'CALL_RECORDING_STORED', actorUserId: channelUser._id, actorRole: 'SYSTEM', channel: 'VOICE_16699_SIM',
      newState: { recordingId: recording.id, bytes: audio.length, mimeType, sha256 },
    }, session)
    return { applicationId, bytes: audio.length }
  })
}

export async function checkApplicationAccess(applicationId, actor) {
  const application = await Application.findOne({ applicationId }).lean()
  if (!application) throw new HttpError(404, 'NOT_FOUND', 'Application not found.')
  if (hasOfficeRole(actor, 'DLAO_OFFICER', application.officeCode)) return application
  // Call audio, transcript, safe contact, and facts open to a panel lawyer only once they have accepted the case.
  const isAssignedLawyer = actor?.assignments?.some(({ role }) => role === 'PANEL_LAWYER') &&
    await LawyerAssignment.exists({ applicationId, lawyerUserId: actor.userId, active: true, status: 'ACCEPTED' })
  if (isAssignedLawyer) return application
  throw new HttpError(403, 'FORBIDDEN', 'Access to application details is not permitted for this role.')
}

export async function getCallRecording(applicationId, actor) {
  await checkApplicationAccess(applicationId, actor)
  const recording = await CallRecording.findOne({ applicationId }).select('+audio')
  if (!recording) throw new HttpError(404, 'NOT_FOUND', 'No call recording is stored.')
  return recording
}

export async function acceptApplication(applicationId, reason, actor) {
  const caseId = await nextRecordId('CASE')
  return mongoose.connection.transaction(async (session) => {
    const application = await officeApplication(applicationId, actor, session)
    if (application.status !== 'SUBMITTED' || application.caseId) throw new HttpError(409, 'ALREADY_ACCEPTED', 'This application already has a case.')
    if (application.reviewState !== 'READY_FOR_DECISION') throw new HttpError(409, 'REVIEW_REQUIRED', 'Human review must be ready for decision before acceptance.')
    const updated = await Application.findOneAndUpdate(
      { applicationId, status: 'SUBMITTED', version: application.version },
      { $set: { status: 'ACCEPTED', caseId, acceptedByUserId: actor.userId, acceptedAt: new Date(), ...(application.assignedOfficerUserId ? {} : { assignedOfficerUserId: actor.userId }) }, $inc: { version: 1, auditSequence: 1 } },
      { returnDocument: 'after', session },
    )
    if (!updated) throw new HttpError(409, 'CONFLICT', 'The application changed. Refresh and retry.')
    await Case.create([{ caseId, applicationId, officeCode: application.officeCode, acceptedByUserId: actor.userId }], { session })
    if (!application.assignedOfficerUserId) await grantRestrictedEvidence(applicationId, actor.userId, null, session)
    await Task.updateMany({ applicationId, status: 'OPEN' }, { $set: { status: 'DONE', completedAt: new Date(), completedByUserId: actor.userId } }, { session })
    await Task.create([{
      applicationId,
      caseId,
      kind: 'FOLLOW_UP',
      title: 'Plan next service step',
      ownerRole: 'DLAO_OFFICER',
      nextAction: 'Assign the appropriate human-led service or follow-up.',
    }], { session })
    await appendAudit({
      applicationId,
      caseId,
      sequence: updated.auditSequence,
      action: 'APPLICATION_ACCEPTED',
      actorUserId: actor.userId,
      actorRole: 'DLAO_OFFICER',
      channel: 'DLAO',
      previousState: { status: 'SUBMITTED', caseId: null },
      newState: { status: 'ACCEPTED', caseId },
      reason,
    }, session)
    return { applicationId, caseId, status: updated.status }
  })
}

export async function reviewApplication(applicationId, { reviewState, reason }, actor, override = false) {
  return mongoose.connection.transaction(async (session) => {
    const application = await officeApplication(applicationId, actor, session)
    if (application.status !== 'SUBMITTED') throw new HttpError(409, 'ALREADY_ACCEPTED', 'This application is already accepted.')
    if (override && application.reviewState === 'PENDING_REVIEW') throw new HttpError(409, 'REVIEW_REQUIRED', 'There is no review decision to override.')
    if (!override && application.reviewState === 'READY_FOR_DECISION') throw new HttpError(409, 'OVERRIDE_REQUIRED', 'Changing a reviewed decision requires an override reason.')
    if (application.reviewState === reviewState) throw new HttpError(409, 'NO_CHANGE', 'Choose a different review state.')
    const updated = await advance(application, session, { reviewState })
    await Task.updateMany(
      { applicationId, status: 'OPEN', kind: { $in: ['INTAKE_REVIEW', 'DECISION', 'FOLLOW_UP'] } },
      { $set: { status: 'DONE', completedAt: new Date(), completedByUserId: actor.userId } },
      { session },
    )
    const next = reviewState === 'READY_FOR_DECISION'
      ? ['DECISION', 'Decide reviewed application', 'Authorised officer to accept or request more information.']
      : reviewState === 'NEEDS_INFORMATION'
        ? ['FOLLOW_UP', 'Request missing information', 'Collect missing information using an approved safe route.']
        : ['INTAKE_REVIEW', 'Repeat application review', 'Recheck identity gaps, provenance, and safe contact.']
    await Task.create([{ applicationId, kind: next[0], title: next[1], ownerRole: 'DLAO_OFFICER', nextAction: next[2] }], { session })
    await appendAudit({
      applicationId,
      sequence: updated.auditSequence,
      action: override ? 'HUMAN_REVIEW_OVERRIDE' : 'APPLICATION_REVIEWED',
      actorUserId: actor.userId,
      actorRole: 'DLAO_OFFICER',
      channel: 'DLAO',
      previousState: { reviewState: application.reviewState },
      newState: { reviewState },
      reason,
    }, session)
    return { applicationId, reviewState, status: updated.status }
  })
}

export async function overridePriority(applicationId, { priorityDecision, reason }, actor) {
  return mongoose.connection.transaction(async (session) => {
    const application = await officeApplication(applicationId, actor, session)
    if (application.priorityDecision === priorityDecision) throw new HttpError(409, 'NO_CHANGE', 'Choose a different priority decision.')
    const updated = await advance(application, session, { priorityDecision })
    await appendAudit({
      applicationId, caseId: application.caseId, sequence: updated.auditSequence,
      action: 'HUMAN_PRIORITY_OVERRIDE', actorUserId: actor.userId, actorRole: 'DLAO_OFFICER', channel: 'DLAO',
      previousState: { priorityDecision: application.priorityDecision ?? null }, newState: { priorityDecision }, reason,
    }, session)
    return { applicationId, priorityDecision }
  })
}

// A citizen's cancellation request against an accepted Case: approving it closes out every dependent workflow
// record (open tasks, the active lawyer assignment, any pending mandatory update) so nothing stale keeps surfacing
// in another role's queue. It is blocked while a referral or mediation is actively in motion, since those involve
// another office/role's own tracked responsibility and must be wound down through their own workflow first.
export async function reviewCaseCancellationRequest(applicationId, requestId, { decision, reason }, actor) {
  return mongoose.connection.transaction(async (session) => {
    const application = await officeApplication(applicationId, actor, session)
    await requireOpenCase(applicationId, session)
    const cancellationRequest = await CancellationRequest.findOne({ _id: requestId, applicationId, status: 'OPEN' }).session(session)
    if (!cancellationRequest) throw new HttpError(404, 'NOT_FOUND', 'An open cancellation request was not found.')

    if (decision === 'DECLINE') {
      const updated = await advance(application, session)
      cancellationRequest.status = 'DECLINED'
      cancellationRequest.reviewedByUserId = actor.userId
      cancellationRequest.reviewedAt = new Date()
      cancellationRequest.reviewReason = reason
      await cancellationRequest.save({ session })
      await Task.updateMany(
        { applicationId, kind: 'CASE_CANCELLATION_REVIEW', status: 'OPEN' },
        { $set: { status: 'DONE', completedAt: new Date(), completedByUserId: actor.userId } },
        { session },
      )
      await appendAudit({
        applicationId, caseId: updated.caseId, sequence: updated.auditSequence,
        action: 'CASE_CANCELLATION_DECLINED', actorUserId: actor.userId, actorRole: 'DLAO_OFFICER', channel: 'DLAO',
        previousState: { status: 'OPEN' }, newState: { status: 'DECLINED' }, reason,
      }, session)
      return { requestId: cancellationRequest.id, status: cancellationRequest.status, version: updated.version }
    }

    if (await Referral.exists({ applicationId, status: { $in: ['SENT', 'ACKNOWLEDGED'] } }).session(session)) {
      throw new HttpError(409, 'REFERRAL_ACTIVE', 'Resolve the pending referral before cancelling this case.')
    }
    if (await Mediation.exists({ applicationId, stage: { $ne: 'REGISTRATION' } }).session(session)) {
      throw new HttpError(409, 'MEDIATION_IN_PROGRESS', 'Wind down the active mediation before cancelling this case.')
    }

    const updated = await advance(application, session, { status: 'CANCELLED' })
    await Case.updateOne({ caseId: application.caseId }, { $set: { status: 'CANCELLED' } }, { session })
    // Closes every open task, including the CASE_CANCELLATION_REVIEW task itself.
    await Task.updateMany(
      { applicationId, status: 'OPEN' },
      { $set: { status: 'DONE', completedAt: new Date(), completedByUserId: actor.userId } },
      { session },
    )
    await LawyerAssignment.updateMany({ applicationId, active: true }, { $set: { active: false } }, { session })
    await LawyerUpdate.updateMany({ applicationId, status: 'PENDING' }, { $set: { status: 'CANCELLED' } }, { session })

    cancellationRequest.status = 'APPROVED'
    cancellationRequest.reviewedByUserId = actor.userId
    cancellationRequest.reviewedAt = new Date()
    cancellationRequest.reviewReason = reason
    await cancellationRequest.save({ session })

    await appendAudit({
      applicationId, caseId: updated.caseId, sequence: updated.auditSequence,
      action: 'CASE_CANCELLED', actorUserId: actor.userId, actorRole: 'DLAO_OFFICER', channel: 'DLAO',
      previousState: { status: 'ACCEPTED' }, newState: { status: 'CANCELLED' }, reason,
    }, session)

    return { requestId: cancellationRequest.id, status: cancellationRequest.status, version: updated.version }
  })
}

export async function addRepresentation(applicationId, input, actor) {
  return mongoose.connection.transaction(async (session) => {
    const application = await officeApplication(applicationId, actor, session)
    const [person] = await Person.create([{ displayName: input.representativeName, identityStatus: 'INCOMPLETE' }], { session })
    const [representation] = await Representation.create([{
      applicationId,
      applicantPersonId: application.applicantPersonId,
      representativePersonId: person._id,
      relationship: input.relationship,
      scope: input.scope,
      recordedByUserId: actor.userId,
    }], { session })
    const updated = await advance(application, session)
    await appendAudit({
      applicationId,
      caseId: application.caseId,
      sequence: updated.auditSequence,
      action: 'REPRESENTATION_RECORDED',
      actorUserId: actor.userId,
      actorRole: 'DLAO_OFFICER',
      newState: { representationId: representation.id, authorityStatus: 'PENDING' },
    }, session)
    return { id: representation.id, representativePersonId: person.id, authorityStatus: representation.authorityStatus }
  })
}

export async function addFact(applicationId, input, actor) {
  return mongoose.connection.transaction(async (session) => {
    const application = await officeApplication(applicationId, actor, session)
    if (input.sourceType === 'REPRESENTATIVE_REPORTED') {
      const represented = await Representation.exists({ applicationId, representativePersonId: input.sourcePersonId }).session(session)
      if (!represented) throw new HttpError(400, 'INVALID_SOURCE', 'The representative is not recorded for this application.')
    } else if (input.sourceType === 'APPLICANT_REPORTED') {
      if (application.applicantPersonId.toString() !== input.sourcePersonId) throw new HttpError(400, 'INVALID_SOURCE', 'The source is not the applicant.')
    } else if (input.sourcePersonId) {
      throw new HttpError(400, 'INVALID_SOURCE', 'This source type cannot use a person ID.')
    }
    const latest = await CaseFact.findOne({ applicationId, field: input.field }).sort({ revision: -1 }).session(session)
    const updated = await advance(application, session)
    const [fact] = await CaseFact.create([{
      applicationId,
      caseId: application.caseId,
      field: input.field,
      value: input.value,
      sourceType: input.sourceType,
      sourcePersonId: input.sourcePersonId,
      captureMethod: 'STAFF',
      applicantConfirmed: false,
      supersedesFactId: latest?._id,
      revision: (latest?.revision || 0) + 1,
      recordedByUserId: actor.userId,
    }], { session })
    await appendAudit({
      applicationId,
      caseId: application.caseId,
      sequence: updated.auditSequence,
      action: 'FACT_RECORDED',
      actorUserId: actor.userId,
      actorRole: 'DLAO_OFFICER',
      previousState: latest ? { factId: latest.id, sourceType: latest.sourceType } : null,
      newState: { factId: fact.id, sourceType: fact.sourceType, applicantConfirmed: false },
    }, session)
    return fact
  })
}

export async function correctFact(applicationId, factId, { value, attestation }, actor) {
  return mongoose.connection.transaction(async (session) => {
    const application = await officeApplication(applicationId, actor, session)
    const previous = await CaseFact.findOne({ _id: factId, applicationId }).session(session)
    if (!previous) throw new HttpError(404, 'NOT_FOUND', 'Fact not found.')
    const latest = await CaseFact.findOne({ applicationId, field: previous.field }).sort({ revision: -1 }).session(session)
    if (!latest._id.equals(previous._id)) throw new HttpError(409, 'CONFLICT', 'This fact has a newer correction.')
    const updated = await advance(application, session)
    const [fact] = await CaseFact.create([{
      applicationId,
      caseId: application.caseId,
      field: previous.field,
      value,
      sourceType: 'APPLICANT_CONFIRMED',
      sourcePersonId: application.applicantPersonId,
      captureMethod: 'STAFF',
      applicantConfirmed: true,
      confirmedByPersonId: application.applicantPersonId,
      confirmationAttestation: attestation,
      supersedesFactId: previous._id,
      revision: previous.revision + 1,
      recordedByUserId: actor.userId,
    }], { session })
    await appendAudit({
      applicationId,
      caseId: application.caseId,
      sequence: updated.auditSequence,
      action: 'APPLICANT_CORRECTION_ATTESTED',
      actorUserId: actor.userId,
      actorRole: 'DLAO_OFFICER',
      previousState: { factId: previous.id, sourceType: previous.sourceType },
      newState: { factId: fact.id, sourceType: fact.sourceType, applicantConfirmed: true },
      reason: attestation,
    }, session)
    return fact
  })
}

// The applicant herself, reached on a logged call, is the only one who can move a fact to verified; a representative's
// word never does. Each change is a new revision, so the earlier value, its source and the undo all stay on record.
async function applicantReachedAttempt(applicationId, contactAttemptId, session) {
  const attempt = await ContactAttempt.findOne({ _id: contactAttemptId, applicationId }).session(session)
  if (!attempt) throw new HttpError(404, 'NOT_FOUND', 'Contact log entry not found.')
  if (attempt.outcome !== 'APPLICANT_REACHED') throw new HttpError(409, 'APPLICANT_NOT_REACHED', 'Only a logged contact in which the applicant herself was reached can be used.')
  return attempt
}

export async function verifyFact(applicationId, factId, { verified, contactAttemptId, note }, actor) {
  return mongoose.connection.transaction(async (session) => {
    const application = await officeApplication(applicationId, actor, session)
    const previous = await CaseFact.findOne({ _id: factId, applicationId }).session(session)
    if (!previous) throw new HttpError(404, 'NOT_FOUND', 'Fact not found.')
    const latest = await CaseFact.findOne({ applicationId, field: previous.field }).sort({ revision: -1 }).session(session)
    if (!latest._id.equals(previous._id)) throw new HttpError(409, 'CONFLICT', 'This fact has a newer revision.')
    if (previous.field === 'identity.nid') throw new HttpError(409, 'DOCUMENT_CHECK_REQUIRED', 'An NID is verified against the document, not by phone.')
    if (previous.applicantConfirmed === verified) throw new HttpError(409, 'NO_CHANGE', verified ? 'This fact is already verified.' : 'This fact is not verified.')
    // Only a verification made here can be undone; a fact the applicant gave or confirmed herself stays as she gave it.
    if (!verified && !previous.confirmationContactAttemptId) throw new HttpError(409, 'NOT_UNDOABLE', 'Only a verification recorded from a contact log entry can be undone.')
    const attempt = verified ? await applicantReachedAttempt(applicationId, contactAttemptId, session) : null
    // Undoing returns the fact to the source it had before it was confirmed.
    const before = verified ? null : previous.supersedesFactId && await CaseFact.findById(previous.supersedesFactId).session(session)
    const updated = await advance(application, session)
    const [fact] = await CaseFact.create([{
      applicationId, caseId: application.caseId, field: previous.field, value: previous.value,
      sourceType: verified ? 'APPLICANT_CONFIRMED' : before?.sourceType ?? 'UNKNOWN_OR_UNVERIFIED',
      sourcePersonId: verified ? application.applicantPersonId : before?.sourcePersonId,
      captureMethod: 'STAFF', callerConfirmed: previous.callerConfirmed, aiInferred: verified ? false : previous.aiInferred || Boolean(before?.aiInferred),
      applicantConfirmed: verified, confirmedByPersonId: verified ? application.applicantPersonId : undefined,
      confirmationAttestation: note, confirmationContactAttemptId: attempt?._id,
      supersedesFactId: previous._id, revision: previous.revision + 1, recordedByUserId: actor.userId,
    }], { session })
    await appendAudit({
      applicationId, caseId: application.caseId, sequence: updated.auditSequence,
      action: verified ? 'FACT_VERIFIED_BY_APPLICANT' : 'FACT_VERIFICATION_UNDONE',
      actorUserId: actor.userId, actorRole: 'DLAO_OFFICER',
      previousState: { factId: previous.id, sourceType: previous.sourceType, applicantConfirmed: previous.applicantConfirmed },
      newState: { factId: fact.id, sourceType: fact.sourceType, applicantConfirmed: verified, contactAttemptId: attempt?.id ?? null },
      reason: note,
    }, session)
    return fact
  })
}

// A withdrawal is the applicant's own decision, confirmed with her on a logged call; the reason recorded is her
// statement, never the representative's. It closes the record the same way an approved cancellation does.
export async function recordApplicantWithdrawal(applicationId, { contactAttemptId, statement }, actor) {
  return mongoose.connection.transaction(async (session) => {
    const application = await officeApplication(applicationId, actor, session)
    if (application.status === 'CANCELLED') throw new HttpError(409, 'ALREADY_CLOSED', 'This record is already closed.')
    const attempt = await applicantReachedAttempt(applicationId, contactAttemptId, session)
    if (application.caseId) {
      await requireOpenCase(applicationId, session)
      if (await Referral.exists({ applicationId, status: { $in: ['SENT', 'ACKNOWLEDGED'] } }).session(session)) {
        throw new HttpError(409, 'REFERRAL_ACTIVE', 'Resolve the pending referral before closing this case.')
      }
      if (await Mediation.exists({ applicationId, stage: { $ne: 'REGISTRATION' } }).session(session)) {
        throw new HttpError(409, 'MEDIATION_IN_PROGRESS', 'Wind down the active mediation before closing this case.')
      }
    }
    const previousStatus = application.status
    const updated = await advance(application, session, {
      status: 'CANCELLED',
      withdrawal: { contactAttemptId: attempt._id, statement, recordedByUserId: actor.userId, recordedAt: new Date() },
    })
    if (application.caseId) {
      await Case.updateOne({ caseId: application.caseId }, { $set: { status: 'CANCELLED' } }, { session })
      await LawyerAssignment.updateMany({ applicationId, active: true }, { $set: { active: false } }, { session })
      await LawyerUpdate.updateMany({ applicationId, status: 'PENDING' }, { $set: { status: 'CANCELLED' } }, { session })
    }
    await Task.updateMany({ applicationId, status: 'OPEN' }, { $set: { status: 'DONE', completedAt: new Date(), completedByUserId: actor.userId } }, { session })
    await CancellationRequest.updateMany({ applicationId, status: 'OPEN' }, { $set: { status: 'APPROVED', reviewedByUserId: actor.userId, reviewedAt: new Date(), reviewReason: statement } }, { session })
    await appendAudit({
      applicationId, caseId: updated.caseId, sequence: updated.auditSequence,
      action: 'APPLICATION_WITHDRAWN_BY_APPLICANT', actorUserId: actor.userId, actorRole: 'DLAO_OFFICER', channel: 'DLAO',
      previousState: { status: previousStatus },
      newState: { status: 'CANCELLED', withdrawnBy: 'APPLICANT', applicantPersonId: String(application.applicantPersonId), contactAttemptId: attempt.id },
      reason: statement,
    }, session)
    return { applicationId, status: updated.status, version: updated.version }
  })
}

export async function setSafeContact(applicationId, input, actor) {
  return mongoose.connection.transaction(async (session) => {
    const application = await officeApplication(applicationId, actor, session)
    const previous = await SafeContactProfile.findOne({ applicationId }).sort({ version: -1 }).session(session)
    const updated = await advance(application, session)
    const [profile] = await SafeContactProfile.create([{
      ...input,
      applicationId,
      caseId: application.caseId,
      version: (previous?.version || 0) + 1,
      supersedesProfileId: previous?._id,
      recordedByUserId: actor.userId,
    }], { session })
    await appendAudit({
      applicationId,
      caseId: application.caseId,
      sequence: updated.auditSequence,
      action: 'SAFE_CONTACT_UPDATED',
      actorUserId: actor.userId,
      actorRole: 'DLAO_OFFICER',
      previousState: previous ? { profileId: previous.id, version: previous.version } : null,
      newState: { profileId: profile.id, version: profile.version },
    }, session)
    return { version: profile.version, id: profile.id }
  })
}

export async function recordConsent(applicationId, { scope, state, attestation }, actor) {
  return mongoose.connection.transaction(async (session) => {
    const application = await officeApplication(applicationId, actor, session)
    const previous = await ConsentRecord.findOne({ applicationId, scope }).sort({ revision: -1 }).session(session)
    const updated = await advance(application, session)
    const [consent] = await ConsentRecord.create([{
      applicationId,
      personId: application.applicantPersonId,
      scope,
      state,
      revision: (previous?.revision || 0) + 1,
      attestation,
      sourceType: 'APPLICANT_REPORTED',
      recordedByUserId: actor.userId,
    }], { session })
    await appendAudit({
      applicationId,
      caseId: application.caseId,
      sequence: updated.auditSequence,
      action: 'CONSENT_RECORDED',
      actorUserId: actor.userId,
      actorRole: 'DLAO_OFFICER',
      previousState: previous ? { consentId: previous.id, state: previous.state } : null,
      newState: { consentId: consent.id, scope, state, revision: consent.revision },
      reason: attestation,
    }, session)
    return { id: consent.id, scope, state, revision: consent.revision }
  })
}

export async function getApplication(applicationId, actor) {
  const application = await Application.findOne({ applicationId }).lean()
  if (!application) throw new HttpError(404, 'NOT_FOUND', 'Application not found.')
  const mediationAccess = (hasOfficeRole(actor, 'MEDIATOR', application.officeCode)
      && await appointedMediator(applicationId, application.officeCode, actor))
    // The CLAO sees the same office records as the DLAO, read-only; certification is the CLAO's only action.
    || hasOfficeRole(actor, 'CLAO', application.officeCode)
  if (!hasOfficeRole(actor, 'DLAO_OFFICER', application.officeCode) && !hasOfficeRole(actor, 'CASE_SUPPORT', application.officeCode) && !mediationAccess) {
    throw new HttpError(403, 'FORBIDDEN', 'This role cannot read the application.')
  }
  const [person, nextTask, representation, assistance, assistedConsent, urgentFact, submitted, restrictedEvidence, summaryFacts, complaintSummaryFact, safeContactProfile, cancellationRequest, assignedOfficer] = await Promise.all([
    Person.findById(application.applicantPersonId).select('displayName identityStatus').lean(),
    Task.findOne({ applicationId, status: 'OPEN' }).sort({ createdAt: 1 }).select('title ownerRole nextAction dueAt').lean(),
    Representation.findOne({ applicationId }).sort({ createdAt: -1 }).populate('representativePersonId', 'displayName').lean(),
    AssistanceRecord.findOne({ applicationId }).populate('helperPersonId', 'displayName').populate('translatorPersonId', 'displayName').populate('typistPersonId', 'displayName').lean(),
    ConsentRecord.findOne({ applicationId, scope: 'ASSISTED_INTAKE' }).sort({ revision: -1 }).select('state').lean(),
    CaseFact.findOne({ applicationId, field: 'safety.urgent' }).sort({ revision: -1 }).select('value revision sourceType').lean(),
    AuditEvent.findOne({ applicationId, action: 'APPLICATION_SUBMITTED' }).select('newState.aiSensitive newState.safetyNeedsReview newState.harassmentKeywords').lean(),
    Document.countDocuments({ applicationId, sensitivity: 'RESTRICTED' }),
    CaseFact.find({ applicationId, field: { $in: ['complaint.category', 'complaint.type', 'complaint.legal_need', 'identity.nid_known', 'incident.what', 'incident.when', 'incident.where', 'incident.who', 'location.district'] } }).sort({ revision: -1 }).select('field value').lean(),
    CaseFact.findOne({ applicationId, field: 'complaint.summary' }).sort({ revision: -1 }).lean(),
    SafeContactProfile.findOne({ applicationId }).sort({ version: -1 }).lean(),
    CancellationRequest.findOne({ applicationId, status: 'OPEN' }).select('reason createdAt').lean(),
    application.assignedOfficerUserId ? User.findById(application.assignedOfficerUserId).select('displayName').lean() : null,
  ])
  const summary = latestValues(summaryFacts)
  return {
    applicationId, caseId: application.caseId ?? null, status: application.status,
    reviewState: application.reviewState, priorityDecision: application.priorityDecision ?? null, version: application.version, channel: application.channel,
    officeCode: application.officeCode, applicantName: person?.displayName ?? 'Unavailable',
    identityStatus: person?.identityStatus ?? 'INCOMPLETE', nextTask,
    assignedOfficer: assignedOfficer ? { id: assignedOfficer._id, name: assignedOfficer.displayName } : null,
    urgencyReasons: urgencyReasons({ urgentFact: urgentFact?.value === 'YES' && urgentFact, aiSensitive: submitted?.newState?.aiSensitive, safetyNeedsReview: submitted?.newState?.safetyNeedsReview, restrictedEvidence, category: summary['complaint.category'], harassmentKeywords: submitted?.newState?.harassmentKeywords }),
    service: application.service ?? 'COMPLAINT',
    complaintSummary: complaintSummaryFact?.value ?? null,
    safeContactPhone: safeContactProfile?.contactValue ?? null,
    incident: {
      what: summary['incident.what'] ?? null,
      when: summary['incident.when'] ?? null,
      where: summary['incident.where'] ?? summary['location.district'] ?? null,
      who: summary['incident.who'] ?? null,
    },
    safeContact: safeContactProfile ? {
      contactValue: safeContactProfile.contactValue ?? null,
      safeTimeWindow: safeContactProfile.safeTimeWindow,
      allowedChannels: safeContactProfile.allowedChannels,
      unknownAnswerAction: safeContactProfile.unknownAnswerAction,
    } : null,
    // AI suggestions from the caller's own account; the officer confirms or ignores them.
    complaintType: summary['complaint.type'] ?? null, legalNeed: summary['complaint.legal_need'] ?? null,
    // The applicant's own choice of category on the digital form, not an officer's classification.
    category: summary['complaint.category'] ?? null,
    vulnerability: vulnerabilities({ urgent: urgentFact?.value === 'YES', representative: Boolean(representation), nidKnown: summary['identity.nid_known'], aiSensitive: submitted?.newState?.aiSensitive, safetyNeedsReview: submitted?.newState?.safetyNeedsReview, category: summary['complaint.category'], harassmentKeywords: submitted?.newState?.harassmentKeywords }),
    representation: representation ? {
      representativeName: representation.representativePersonId?.displayName ?? 'Unavailable',
      relationship: representation.relationship, authorityStatus: representation.authorityStatus,
    } : null,
    assistance: assistance ? {
      helperName: assistance.helperPersonId?.displayName ?? 'Unavailable',
      translatorName: assistance.translatorPersonId?.displayName ?? 'Unavailable',
      typistName: assistance.typistPersonId?.displayName ?? 'Unavailable',
      originalLanguage: assistance.originalLanguage, caseType: assistance.caseType,
      originalConfirmed: assistance.originalConfirmed, translationConfirmed: assistance.translationConfirmed,
      consentState: assistedConsent?.state ?? 'PENDING',
    } : null,
    cancellationRequest: cancellationRequest ? {
      id: cancellationRequest._id, reason: cancellationRequest.reason, createdAt: cancellationRequest.createdAt,
    } : null,
    petitioner: application.petitioner ?? null,
    respondent: application.respondent ?? null,
    // Until an officer records the Bibadi, the person the case file names as involved stands in, marked unverified.
    respondentFromCaseFile: application.respondent?.name ? null : summary['incident.who'] ?? null,
    withdrawal: application.withdrawal?.recordedAt ? { statement: application.withdrawal.statement, recordedAt: application.withdrawal.recordedAt } : null,
    meansTest: application.meansTest ?? null,
    preMediationVerification: application.preMediationVerification ?? null,
    notices: application.notices ?? [],
  }
}

export async function searchRecord(identifier, actor) {
  const applicationId = identifier.startsWith('APP-')
    ? identifier
    : (await Case.findOne({ caseId: identifier }).select('applicationId').lean())?.applicationId
  if (!applicationId) throw new HttpError(404, 'NOT_FOUND', 'Record not found.')
  return getApplication(applicationId, actor)
}

export async function listWorkspace(role, actor) {
  const assignment = actor.assignments.find((item) => item.role === role)
  if (!assignment) throw new HttpError(403, 'FORBIDDEN', 'This role is not assigned to this user.')
  // The CLAO gets the DLAO view read-only, plus the mediations awaiting or holding CLAO certification.
  const dlaoView = role === 'DLAO_OFFICER' || role === 'CLAO'
  if (dlaoView || role === 'CASE_SUPPORT') {
    const applications = await Application.find({ officeCode: assignment.officeCode, service: { $ne: 'ADVICE' } })
      .sort({ updatedAt: -1 }).select('applicationId caseId status reviewState priorityDecision channel applicantPersonId createdAt updatedAt').lean()
    const ids = applications.map(({ applicationId }) => applicationId)
    const summaryFields = dlaoView
      ? ['complaint.category', 'complaint.type', 'identity.nid_known', 'complaint.summary']
      : ['complaint.category', 'complaint.type', 'identity.nid_known']
    const [people, tasks, urgentFacts, aiEvents, restricted, referrals, lawyerUpdates, summaryFacts, representations, hearings] = await Promise.all([
      Person.find({ _id: { $in: applications.map(({ applicantPersonId }) => applicantPersonId) } }).select('displayName identityStatus').lean(),
      Task.find({ applicationId: { $in: ids }, status: 'OPEN' }).select('applicationId kind dueAt createdAt nextAction').lean(),
      CaseFact.find({ applicationId: { $in: ids }, field: 'safety.urgent' }).sort({ revision: -1 }).select('applicationId value revision sourceType').lean(),
      AuditEvent.find({ applicationId: { $in: ids }, action: 'APPLICATION_SUBMITTED' }).select('applicationId newState.aiSensitive newState.safetyNeedsReview newState.harassmentKeywords').lean(),
      Document.find({ applicationId: { $in: ids }, sensitivity: 'RESTRICTED' }).select('applicationId').lean(),
      Referral.find({ applicationId: { $in: ids }, status: { $in: ['SENT', 'ACKNOWLEDGED'] } }).select('applicationId status dueAt receivingOfficeCode').lean(),
      LawyerUpdate.find({ applicationId: { $in: ids }, $or: [{ status: 'MISSED' }, { status: 'PENDING', dueAt: { $lte: new Date() } }] }).select('applicationId sequence status dueAt').lean(),
      CaseFact.find({ applicationId: { $in: ids }, field: { $in: summaryFields } }).sort({ revision: -1 })
        .select('applicationId field value sourceType applicantConfirmed aiInferred').lean(),
      Representation.find({ applicationId: { $in: ids } }).select('applicationId').lean(),
      Case.find({ caseId: { $in: applications.map(({ caseId }) => caseId).filter(Boolean) } }).select('caseId nextHearingAt nextAction').lean(),
    ])
    const names = new Map(people.map((person) => [person._id.toString(), person.displayName]))
    const identities = new Map(people.map((person) => [person._id.toString(), person.identityStatus]))
    const tasksByApplication = Map.groupBy(tasks, (task) => task.applicationId)
    const urgency = new Map()
    for (const fact of urgentFacts) if (!urgency.has(fact.applicationId)) urgency.set(fact.applicationId, fact.value === 'YES' && fact)
    const aiSensitive = new Set(aiEvents.filter((event) => event.newState?.aiSensitive).map((event) => event.applicationId))
    const safetyNeedsReview = new Set(aiEvents.filter((event) => event.newState?.safetyNeedsReview).map((event) => event.applicationId))
    const harassmentKeywords = new Set(aiEvents.filter((event) => event.newState?.harassmentKeywords).map((event) => event.applicationId))
    const restrictedCounts = Map.groupBy(restricted, (item) => item.applicationId)
    const waiting = new Map(referrals.map((referral) => [referral.applicationId, referral]))
    const missedUpdates = Map.groupBy(lawyerUpdates, (item) => item.applicationId)
    const summaries = new Map([...Map.groupBy(summaryFacts, (fact) => fact.applicationId)].map(([id, facts]) => [id, latestValues(facts)]))
    const problemSummaries = new Map()
    if (dlaoView) {
      for (const fact of summaryFacts) {
        if (fact.field === 'complaint.summary' && !problemSummaries.has(fact.applicationId)) problemSummaries.set(fact.applicationId, fact)
      }
    }
    const represented = new Set(representations.map((item) => item.applicationId))
    const hearingByCase = new Map(hearings.map((item) => [item.caseId, item]))
    const now = Date.now()
    // ponytail: full-office scan suits fictional demo data; add indexed pagination when real volume warrants it.
    const records = applications.map((item) => {
      const problem = dlaoView ? problemSummaries.get(item.applicationId) : null
      const hearing = item.caseId ? hearingByCase.get(item.caseId) ?? null : null
      return {
        applicationId: item.applicationId, caseId: item.caseId ?? null, status: item.status,
        reviewState: item.reviewState, priorityDecision: item.priorityDecision ?? null, channel: item.channel,
        applicantName: names.get(item.applicantPersonId.toString()) ?? 'Unavailable',
        createdAt: item.createdAt, updatedAt: item.updatedAt,
        nextHearingAt: hearing?.nextHearingAt ?? null, nextAction: hearing?.nextAction ?? null,
        complaintType: summaries.get(item.applicationId)?.['complaint.type'] ?? null,
        category: summaries.get(item.applicationId)?.['complaint.category'] ?? null,
        ...(dlaoView ? { problemSummary: problem ? {
          value: problem.value, sourceType: problem.sourceType,
          applicantConfirmed: problem.applicantConfirmed, aiInferred: problem.aiInferred,
        } : null } : {}),
        vulnerability: vulnerabilities({ urgent: Boolean(urgency.get(item.applicationId)), representative: represented.has(item.applicationId),
          nidKnown: summaries.get(item.applicationId)?.['identity.nid_known'], aiSensitive: aiSensitive.has(item.applicationId), safetyNeedsReview: safetyNeedsReview.has(item.applicationId), category: summaries.get(item.applicationId)?.['complaint.category'], harassmentKeywords: harassmentKeywords.has(item.applicationId) }),
        flags: queueFlags(item, identities.get(item.applicantPersonId.toString()), tasksByApplication.get(item.applicationId) ?? [],
          urgencyReasons({ urgentFact: urgency.get(item.applicationId), aiSensitive: aiSensitive.has(item.applicationId), safetyNeedsReview: safetyNeedsReview.has(item.applicationId), restrictedEvidence: restrictedCounts.get(item.applicationId)?.length ?? 0, category: summaries.get(item.applicationId)?.['complaint.category'], harassmentKeywords: harassmentKeywords.has(item.applicationId) }),
          waiting.get(item.applicationId), missedUpdates.get(item.applicationId) ?? [], now, hearing?.nextHearingAt ?? null),
      }
    })
    const counts = Object.fromEntries(['NEW', 'INCOMPLETE', 'URGENT_RECOMMENDATION', 'PENDING', 'OVERDUE', 'REFERRAL_WAITING', 'LAWYER_UPDATE_OVERDUE', 'HEARING_TODAY', 'CASE_CANCELLATION_REQUESTED'].map((flag) => [flag, records.filter((record) => record.flags.some((item) => item.code === flag)).length]))
    
    let hearingList = []
    let mediationList = []
    let lawyerFeedback = []
    let calendarEvents = []
    let certifications = []

    if (dlaoView) {
      hearingList = records.filter((r) => r.nextHearingAt).sort((a, b) => new Date(a.nextHearingAt) - new Date(b.nextHearingAt))

      const mediations = await Mediation.find({ officeCode: assignment.officeCode }).sort({ updatedAt: -1 }).lean()
      const medAppIds = mediations.map((m) => m.applicationId)
      const medApps = await Application.find({ applicationId: { $in: medAppIds } }).select('applicationId petitioner respondent').lean()
      const medAppMap = new Map(medApps.map((a) => [a.applicationId, a]))

      mediationList = mediations.filter((m) => medAppMap.has(m.applicationId)).map((m) => {
        const app = medAppMap.get(m.applicationId)
        const rec = records.find((r) => r.applicationId === m.applicationId)
        return {
          id: m._id,
          applicationId: m.applicationId,
          caseId: m.caseId,
          stage: m.stage,
          mode: m.mode,
          scheduledAt: m.scheduledAt,
          venue: m.venue,
          applicantName: rec?.applicantName || app?.petitioner?.name || 'Petitioner',
          petitioner: app?.petitioner || null,
          respondent: app?.respondent || null,
          sessionsCount: m.sessions?.length || 0,
          outcome: m.outcome,
          legalApplicability: m.legalApplicability,
          legalEffectState: m.legalEffectState,
          certifiedAt: m.certifiedAt ?? null,
          updatedAt: m.updatedAt,
        }
      })
      if (role === 'CLAO') certifications = mediationList.filter(({ stage }) => stage === 'PENDING_CLAO_CERTIFICATION' || stage === 'CERTIFIED_FINAL')

      const updates = await LawyerUpdate.find({ applicationId: { $in: ids }, $or: [{ status: { $in: ['SUBMITTED_ON_TIME', 'SUBMITTED_LATE', 'MISSED'] } }, { report: { $exists: true, $ne: '' } }] })
        .sort({ updatedAt: -1 }).limit(30).populate({ path: 'assignmentId', populate: { path: 'lawyerUserId', select: 'displayName' } }).lean()

      lawyerFeedback = updates.map((u) => ({
        id: u._id,
        applicationId: u.applicationId,
        caseId: u.caseId,
        sequence: u.sequence,
        dueAt: u.dueAt,
        submittedAt: u.submittedAt,
        status: u.status,
        report: u.report,
        nextAction: u.nextAction,
        instruction: u.instruction,
        lawyerName: u.assignmentId?.lawyerUserId?.displayName || 'Panel Lawyer',
      }))

      for (const h of hearingList) {
        calendarEvents.push({
          id: `h-${h.caseId}-${h.nextHearingAt}`,
          caseId: h.caseId,
          applicationId: h.applicationId,
          title: `Court Hearing: ${h.caseId}`,
          titleBn: `আদালতের শুনানি: ${h.caseId}`,
          date: new Date(h.nextHearingAt).toISOString(),
          type: 'HEARING',
          applicantName: h.applicantName,
          nextAction: h.nextAction,
        })
      }
      for (const m of mediationList) {
        if (m.scheduledAt) {
          calendarEvents.push({
            id: `m-${m.caseId}-${m.scheduledAt}`,
            caseId: m.caseId,
            applicationId: m.applicationId,
            title: `Mediation Session: ${m.caseId}`,
            titleBn: `মধ্যস্থতা বৈঠক: ${m.caseId}`,
            date: new Date(m.scheduledAt).toISOString(),
            type: 'MEDIATION',
            applicantName: m.applicantName,
            stage: m.stage,
            mode: m.mode,
          })
        }
      }
      for (const u of lawyerFeedback) {
        if (u.dueAt) {
          calendarEvents.push({
            id: `u-${u.caseId}-${u.id}`,
            caseId: u.caseId,
            applicationId: u.applicationId,
            title: `Lawyer Report #${u.sequence}: ${u.lawyerName}`,
            titleBn: `আইনজীবীর প্রতিবেদন #${u.sequence}: ${u.lawyerName}`,
            date: new Date(u.dueAt).toISOString(),
            type: 'LAWYER_DEADLINE',
            status: u.status,
          })
        }
      }
    }

    return {
      role, officeCode: assignment.officeCode, records,
      report: { total: records.length, accepted: records.filter((item) => item.status === 'ACCEPTED').length, byChannel: Object.fromEntries([...new Set(records.map((item) => item.channel))].map((channel) => [channel, records.filter((item) => item.channel === channel).length])), counts },
      hearingList, mediationList, lawyerFeedback, calendarEvents,
      ...(role === 'CLAO' ? { certifications, readOnly: true } : {}),
      unavailableQueues: [],
    }
  }
  if (role === 'HELPLINE_AGENT') {
    // ponytail: oldest 50 open advice requests only; add paging when callback volume warrants it.
    const requests = await Application.find({ officeCode: assignment.officeCode, service: 'ADVICE', adviceOutcome: null })
      .sort({ createdAt: 1 }).limit(50).select('applicationId createdAt').lean()
    const ids = requests.map(({ applicationId }) => applicationId)
    const [topics, profiles] = await Promise.all([
      CaseFact.find({ applicationId: { $in: ids }, field: 'advice.topic' }).select('applicationId value').lean(),
      SafeContactProfile.find({ applicationId: { $in: ids } }).sort({ version: 1 }).select('applicationId contactValue safeTimeWindow').lean(),
    ])
    const topic = new Map(topics.map((fact) => [fact.applicationId, fact.value]))
    const contact = new Map(profiles.map((profile) => [profile.applicationId, profile])) // ascending, so the latest version wins
    return { role, officeCode: assignment.officeCode, records: requests.map(({ applicationId, createdAt }) => ({
      applicationId, createdAt, topic: topic.get(applicationId) ?? '', contactValue: contact.get(applicationId)?.contactValue ?? null,
      safeTime: contact.get(applicationId)?.safeTimeWindow ?? null,
    })) }
  }
  if (role === 'MEDIATOR') {
    // A mediator sees only the mediations a DLAO officer appointed them to.
    const filter = { officeCode: assignment.officeCode, stage: { $ne: 'CERTIFIED_FINAL' }, mediatorUserId: actor.userId }
    const mediations = await Mediation.find(filter).sort({ updatedAt: -1 }).limit(50).select('applicationId caseId stage legalEffectState').lean()
    const applications = await Application.find({ applicationId: { $in: mediations.map(({ applicationId }) => applicationId) } }).select('applicationId status reviewState applicantPersonId').lean()
    const people = await Person.find({ _id: { $in: applications.map(({ applicantPersonId }) => applicantPersonId) } }).select('displayName').lean()
    const names = new Map(people.map((person) => [person._id.toString(), person.displayName]))
    const records = new Map(applications.map((item) => [item.applicationId, item]))
    return { role, officeCode: assignment.officeCode, records: mediations.filter((m) => records.has(m.applicationId)).map((mediation) => {
      const item = records.get(mediation.applicationId)
      return { applicationId: mediation.applicationId, caseId: mediation.caseId, status: item?.status, reviewState: item?.reviewState, applicantName: names.get(item?.applicantPersonId?.toString()) ?? 'Unavailable', mediationStage: mediation.stage, legalEffectState: mediation.legalEffectState }
    }) }
  }
  if (role === 'RECEIVING_DLAO') {
    // ponytail: newest 50 referrals only; add paging when an office receives more.
    const referrals = await Referral.find({ receivingOfficeCode: assignment.officeCode }).sort({ createdAt: -1 }).limit(50)
      .select('applicationId caseId status dueAt sendingOfficeCode').lean()
    const now = Date.now()
    return { role, officeCode: assignment.officeCode, records: referrals.map((referral) => ({
      referralId: referral._id, applicationId: referral.applicationId, caseId: referral.caseId, status: referral.status,
      sendingOfficeCode: referral.sendingOfficeCode, dueAt: referral.dueAt, overdue: referral.status === 'SENT' && referral.dueAt.getTime() < now,
    })) }
  }
  if (role === 'PANEL_LAWYER') {
    const assignments = await LawyerAssignment.find({ lawyerUserId: actor.userId, active: true, status: { $in: ['PENDING', 'ACCEPTED'] } }).select('caseId applicationId status').limit(25).lean()
    return { role, officeCode: assignment.officeCode, records: assignments.map(({ _id, caseId, applicationId, status }) => ({ assignmentId: _id, caseId, applicationId, assignmentStatus: status })) }
  }
  if (role === 'UDC_OPERATOR') {
    const applications = await Application.find({ channel: 'UDC', officeCode: assignment.officeCode })
      .sort({ createdAt: -1 }).limit(25).select('applicationId status reviewState applicantPersonId createdAt channel assistedByUserId officeCode').lean()
    const people = await Person.find({ _id: { $in: applications.map(({ applicantPersonId }) => applicantPersonId) } }).select('displayName').lean()
    const names = new Map(people.map((person) => [person._id.toString(), person.displayName]))
    return {
      role, officeCode: assignment.officeCode,
      records: applications.map((item) => ({
        applicationId: item.applicationId,
        status: item.status,
        reviewState: item.reviewState,
        applicantName: names.get(item.applicantPersonId.toString()) ?? 'Unavailable',
        createdAt: item.createdAt,
        channel: item.channel,
        canOpen: udcCanOpen(item, actor),
      })),
    }
  }
  return { role, officeCode: assignment.officeCode, records: [] }
}

function queueFlags(application, identityStatus, tasks, urgentReasons, referral, missedUpdates, now, hearingAt = null) {
  const flags = []
  const oldestOpenDays = tasks.length ? Math.floor((now - Math.min(...tasks.map((task) => new Date(task.createdAt).getTime()))) / 86400000) : 0
  if (application.status === 'SUBMITTED' && application.reviewState === 'PENDING_REVIEW') flags.push({ code: 'NEW', reason: 'Submitted; first human review has not been recorded.' })
  if (application.reviewState === 'NEEDS_INFORMATION' || identityStatus === 'INCOMPLETE') flags.push({ code: 'INCOMPLETE', reason: application.reviewState === 'NEEDS_INFORMATION' ? 'Officer requested more information.' : 'Identity is still recorded as incomplete.' })
  if (urgentReasons.length) flags.push({ code: 'URGENT_RECOMMENDATION', reason: `${urgentReasons.join(' ')} Human decision: ${application.priorityDecision ?? 'not recorded'}.` })
  if (tasks.length) flags.push({ code: 'PENDING', reason: `${tasks.length} open task${tasks.length === 1 ? '' : 's'} need a human next action.` })
  if (tasks.some((task) => task.kind === 'CASE_CANCELLATION_REVIEW')) flags.push({ code: 'CASE_CANCELLATION_REQUESTED', reason: 'The applicant requested cancellation of this case; approve or decline.' })
  const overdue = tasks.find((task) => task.dueAt && new Date(task.dueAt).getTime() < now)
  // ponytail: demo ageing threshold only; office-approved service targets must replace it before real operations.
  const escalated = tasks.some((task) => task.kind === 'ROUTING_DECISION')
  if (escalated || referral) {
    flags.push({ code: 'REFERRAL_WAITING', reason: escalated ? 'Repeated referral returns were escalated; an authorised routing decision is required.'
      : referral.status === 'SENT' ? `Awaiting acknowledgement from ${referral.receivingOfficeCode}${new Date(referral.dueAt).getTime() < now ? '; the deadline has passed' : ''}.`
        : `Acknowledged by ${referral.receivingOfficeCode}; awaiting accept or return.` })
  }
  if (missedUpdates.length) {
    const oldest = Math.max(...missedUpdates.map(({ dueAt }) => daysOverdue(dueAt, now)))
    flags.push({ code: 'LAWYER_UPDATE_OVERDUE', reason: `${missedUpdates.length} mandatory panel-lawyer update${missedUpdates.length === 1 ? ' is' : 's are'} overdue (the oldest by ${oldest} day${oldest === 1 ? '' : 's'}); review a safe next step before asking the applicant to travel.` })
  }
  if (overdue || (tasks.length && oldestOpenDays >= (application.status === 'SUBMITTED' ? 2 : 7))) flags.push({ code: 'OVERDUE', reason: overdue ? 'An open task passed its explicit due date.' : `Oldest open task is ${oldestOpenDays} days old; demo reminder threshold reached.` })
  if (hearingAt && dhakaDay(hearingAt) === dhakaDay(now)) flags.push({ code: 'HEARING_TODAY', reason: 'A court hearing is listed for today; confirm attendance and the applicant-safe next step before travel.' })
  return flags
}

export async function listTasks(applicationId, actor) {
  const application = await Application.findOne({ applicationId }).select('officeCode').lean()
  if (!application) throw new HttpError(404, 'NOT_FOUND', 'Application not found.')
  if (!hasOfficeRole(actor, 'DLAO_OFFICER', application.officeCode) && !hasOfficeRole(actor, 'CASE_SUPPORT', application.officeCode)) throw new HttpError(403, 'FORBIDDEN', 'This office cannot read tasks.')
  return Task.find({ applicationId }).sort({ createdAt: 1 }).lean()
}

export async function createTask(applicationId, { title, ownerRole, ownerUserId, nextAction, dueAt }, actor) {
  return mongoose.connection.transaction(async (session) => {
    const application = await Application.findOne({ applicationId }).session(session)
    if (!application) throw new HttpError(404, 'NOT_FOUND', 'Application not found.')
    if (!hasOfficeRole(actor, 'DLAO_OFFICER', application.officeCode) && !hasOfficeRole(actor, 'CASE_SUPPORT', application.officeCode)) throw new HttpError(403, 'FORBIDDEN', 'This office cannot manage tasks.')
    if (ownerUserId && !await RoleAssignment.exists({ userId: ownerUserId, role: ownerRole, officeCode: application.officeCode, active: true }).session(session)) throw new HttpError(400, 'INVALID_OWNER', 'The owner is not active in this office and role.')
    const updated = await advance(application, session)
    const [task] = await Task.create([{
      applicationId, caseId: application.caseId, kind: 'MANUAL', title, ownerRole,
      ownerUserId, nextAction, dueAt,
    }], { session })
    await appendAudit({
      applicationId, caseId: application.caseId, sequence: updated.auditSequence,
      action: 'TASK_CREATED', actorUserId: actor.userId,
      actorRole: hasOfficeRole(actor, 'DLAO_OFFICER', application.officeCode) ? 'DLAO_OFFICER' : 'CASE_SUPPORT',
      newState: { taskId: task.id, ownerRole, ownerUserId: ownerUserId ?? null, nextAction, dueAt: dueAt ?? null },
    }, session)
    return task
  })
}

export async function completeTask(applicationId, taskId, actor) {
  return mongoose.connection.transaction(async (session) => {
    const application = await Application.findOne({ applicationId }).session(session)
    if (!application) throw new HttpError(404, 'NOT_FOUND', 'Application not found.')
    if (!hasOfficeRole(actor, 'DLAO_OFFICER', application.officeCode) && !hasOfficeRole(actor, 'CASE_SUPPORT', application.officeCode)) throw new HttpError(403, 'FORBIDDEN', 'This office cannot manage tasks.')
    const task = await Task.findOne({ _id: taskId, applicationId }).session(session)
    if (!task) throw new HttpError(404, 'NOT_FOUND', 'Task not found.')
    if (task.kind !== 'MANUAL' || task.status !== 'OPEN') throw new HttpError(409, 'INVALID_TRANSITION', 'Only an open manual task can be completed here.')
    const updated = await advance(application, session)
    task.status = 'DONE'
    task.completedAt = new Date()
    task.completedByUserId = actor.userId
    await task.save({ session })
    await appendAudit({
      applicationId, caseId: application.caseId, sequence: updated.auditSequence,
      action: 'TASK_COMPLETED', actorUserId: actor.userId,
      actorRole: hasOfficeRole(actor, 'DLAO_OFFICER', application.officeCode) ? 'DLAO_OFFICER' : 'CASE_SUPPORT',
      previousState: { taskId: task.id, status: 'OPEN' }, newState: { taskId: task.id, status: 'DONE' },
    }, session)
    return { id: task.id, status: task.status }
  })
}

export async function listContactAttempts(applicationId, actor) {
  const application = await Application.findOne({ applicationId }).select('officeCode').lean()
  if (!application) throw new HttpError(404, 'NOT_FOUND', 'Application not found.')
  if (!hasOfficeRole(actor, 'DLAO_OFFICER', application.officeCode) && !hasOfficeRole(actor, 'CASE_SUPPORT', application.officeCode)) throw new HttpError(403, 'FORBIDDEN', 'This office cannot read contact history.')
  return ContactAttempt.find({ applicationId }).sort({ createdAt: -1 }).lean()
}

// A contact attempt as it happened, so an officer can later see how often the office tried and what came of it: who
// answered, whether anything about the case reached someone else (the officer's statement, never assumed), whether
// the status was explained, and when to try again. An unsuccessful attempt always leaves a follow-up, dated when the
// officer planned the next attempt; a disclosure leaves its own review task.
const ANSWERED_BY = { APPLICANT_REACHED: 'APPLICANT', UNKNOWN_PERSON: 'SOMEONE_ELSE', NO_ANSWER: 'NOBODY' }
function contactFollowUp(outcome, disclosedSensitive) {
  if (outcome === 'NO_ANSWER') return { title: 'Try the applicant again', nextAction: 'Nobody answered. Try again at the planned time, within the safe-contact window.' }
  if (outcome !== 'UNKNOWN_PERSON') return null
  return { title: 'Plan safer follow-up', nextAction: disclosedSensitive
    ? 'An unknown person answered and case details were disclosed. Choose a safer route or time before trying again.'
    : 'An unknown person answered and nothing was disclosed. Choose a safer route or time before trying again.' }
}

export async function recordContactAttempt(applicationId, { channel, outcome, reason, answeredByNote, disclosedSensitive = false, statusExplained, nextAttemptAt }, actor) {
  return mongoose.connection.transaction(async (session) => {
    const application = await officeApplication(applicationId, actor, session)
    const profile = await SafeContactProfile.findOne({ applicationId }).sort({ version: -1 }).session(session)
    if (!['BLOCKED_UNSAFE', 'UNKNOWN_PERSON'].includes(outcome) && (!profile?.allowedChannels.includes(channel) || profile.prohibitedChannels.includes(channel))) {
      throw new HttpError(409, 'UNSAFE_CONTACT', 'This channel is not permitted by the active safe-contact profile.')
    }
    const updated = await advance(application, session)
    const nextAttempt = nextAttemptAt ? new Date(nextAttemptAt) : null
    const [attempt] = await ContactAttempt.create([{
      applicationId, caseId: application.caseId, channel, outcome, reason, answeredBy: ANSWERED_BY[outcome], answeredByNote,
      disclosedSensitive, statusExplained, nextAttemptAt: nextAttempt ?? undefined, safeContactVersion: profile?.version,
      recordedByUserId: actor.userId,
    }], { session })
    // An unknown person answering fails safe: neutral wording only, then a safer follow-up for a human to plan.
    const failedSafe = outcome === 'UNKNOWN_PERSON'
    const followUp = contactFollowUp(outcome, disclosedSensitive)
    const tasks = [
      ...(followUp ? [{ ...followUp, dueAt: nextAttempt ?? undefined }] : []),
      ...(disclosedSensitive ? [{
        title: 'Review a disclosure', dueAt: new Date(),
        nextAction: 'Case details reached someone other than the applicant. Assess the risk to the applicant and update the safe-contact plan before any further contact.',
      }] : []),
    ]
    const created = tasks.length ? await Task.create(tasks.map((task) => ({ applicationId, caseId: application.caseId, kind: 'FOLLOW_UP', ownerRole: 'DLAO_OFFICER', ...task })), { session, ordered: true }) : []
    const followUpTaskId = followUp ? created[0].id : null
    const disclosureTaskId = disclosedSensitive ? created.at(-1).id : null
    await appendAudit({
      applicationId, caseId: application.caseId, sequence: updated.auditSequence,
      action: 'CONTACT_ATTEMPT_LOGGED', actorUserId: actor.userId, actorRole: 'DLAO_OFFICER',
      newState: {
        contactAttemptId: attempt.id, channel, outcome, answeredBy: ANSWERED_BY[outcome] ?? null, disclosedSensitive, statusExplained: statusExplained ?? null,
        nextAttemptAt: nextAttempt, failedSafe, followUpTaskId, disclosureTaskId, safeContactVersion: profile?.version ?? null,
      },
      reason,
    }, session)
    return {
      id: attempt.id, channel, outcome, answeredBy: ANSWERED_BY[outcome] ?? null, disclosedSensitive, statusExplained: statusExplained ?? null,
      nextAttemptAt: nextAttempt, safeContactVersion: profile?.version ?? null, followUpTaskId, disclosureTaskId,
      ...(failedSafe ? { neutralScript: NEUTRAL_UNKNOWN_ANSWER } : {}),
    }
  })
}

export async function getFacts(applicationId, actor) {
  await officeApplication(applicationId, actor)
  return CaseFact.find({ applicationId }).sort({ field: 1, revision: 1 }).lean()
}

export async function getSafeContact(applicationId, actor) {
  await checkApplicationAccess(applicationId, actor)
  const profile = await SafeContactProfile.findOne({ applicationId }).sort({ version: -1 })
    .select('version allowedChannels prohibitedChannels contactValue safeTimeWindow smsSafe neutralWordingRequired unknownAnswerAction').lean()
  // The officer needs the neutral words during the call, before the attempt is logged.
  return profile && { ...profile, neutralScript: NEUTRAL_UNKNOWN_ANSWER }
}

export async function getTranscript(applicationId, actor) {
  await checkApplicationAccess(applicationId, actor)
  return VoiceTranscript.findOne({ applicationId }).select('turns transcribedBy createdAt').lean()
}

export async function getApplicationAudit(applicationId, actor) {
  await officeApplication(applicationId, actor)
  return getAuditTrail(applicationId)
}

export async function getCaseHistory(applicationId, actor) {
  const application = await Application.findOne({ applicationId }).select('officeCode').lean()
  if (!application) throw new HttpError(404, 'NOT_FOUND', 'Application not found.')
  if (!hasOfficeRole(actor, 'DLAO_OFFICER', application.officeCode) && !hasOfficeRole(actor, 'CASE_SUPPORT', application.officeCode)) throw new HttpError(403, 'FORBIDDEN', 'This office cannot reconstruct this record.')
  const trail = await getAuditTrail(applicationId)
  return { valid: trail.valid, events: trail.events.map(({ action, actorRole, createdAt }) => ({ action, actorRole, createdAt })) }
}

export async function verifyHelplineLookup(identifier, code, actor, contactChannel = 'PHONE', session) {
  const applicationId = identifier.startsWith('APP-') ? identifier : (await Case.findOne({ caseId: identifier }).select('applicationId').lean())?.applicationId
  const query = applicationId && Application.findOne({ applicationId }).select('+lookupCodeHash')
  if (query && session) query.session(session)
  const application = query && await query.lean()
  const permitted = application && hasOfficeRole(actor, 'HELPLINE_AGENT', application.officeCode)
  const expected = Buffer.from(application?.lookupCodeHash ?? '0'.repeat(64), 'hex')
  const supplied = Buffer.from(lookupHash(code), 'hex')
  if (!permitted || !timingSafeEqual(expected, supplied)) throw new HttpError(404, 'NOT_FOUND', 'No permitted status lookup matched.')
  const profileQuery = SafeContactProfile.findOne({ applicationId }).sort({ version: -1 }).select('version allowedChannels prohibitedChannels')
  if (session) profileQuery.session(session)
  const profile = await profileQuery.lean()
  if (!['PHONE', 'IN_PERSON'].includes(contactChannel) || !profile?.allowedChannels.includes(contactChannel) || profile.prohibitedChannels.includes(contactChannel)) throw new HttpError(403, 'UNSAFE_CONTACT', 'This status route is not permitted by the active safe-contact profile.')
  return { applicationId, application, profile }
}

export async function lookupHelplineStatus(identifier, code, actor, contactChannel = 'PHONE') {
  return mongoose.connection.transaction(async (session) => {
    const { applicationId, profile } = await verifyHelplineLookup(identifier, code, actor, contactChannel, session)
    const current = await Application.findOne({ applicationId }).session(session)
    const casePlan = current.caseId ? await Case.findOne({ caseId: current.caseId }).select('nextHearingAt nextAction').session(session).lean() : null
    const updated = await advance(current, session)
    const [attempt] = await ContactAttempt.create([{
      applicationId, caseId: current.caseId, channel: contactChannel, outcome: 'STATUS_LOOKUP',
      reason: 'Helpline agent attested caller verification and used the caller-provided lookup code on an allowed safe channel; generic status only.',
      disclosedSensitive: false, safeContactVersion: profile.version, recordedByUserId: actor.userId,
    }], { session })
    await appendAudit({
      applicationId, caseId: current.caseId, sequence: updated.auditSequence,
      action: 'HELPLINE_STATUS_LOOKUP', actorUserId: actor.userId, actorRole: 'HELPLINE_AGENT', channel: 'HELPLINE_SIM',
      newState: { contactAttemptId: attempt.id, disclosedSensitive: false, safeContactVersion: profile.version, contactChannel, callerVerification: 'HUMAN_ATTESTED' },
    }, session)
    const nextStep = current.status === 'ACCEPTED' ? (casePlan?.nextAction || 'An officer is handling the case. Use the agreed safe channel for further details.')
      : current.reviewState === 'NEEDS_INFORMATION' ? 'More information is needed. Arrange a safe follow-up with the office.'
        : 'The application is awaiting an officer decision. No decision has been made here.'
    return { applicationId, caseId: current.caseId ?? null, status: current.status, nextHearingAt: casePlan?.nextHearingAt ?? null, nextAction: casePlan?.nextAction ?? null, nextStep }
  })
}

// What an assigned panel lawyer sees about each applicant; a human priority decision outranks an urgent safety fact.
export async function lawyerCaseSummaries(applicationIds) {
  const [applications, facts] = await Promise.all([
    Application.find({ applicationId: { $in: applicationIds } }).select('applicationId priorityDecision applicantPersonId').populate('applicantPersonId', 'displayName').lean(),
    CaseFact.find({ applicationId: { $in: applicationIds }, field: { $in: ['safety.urgent', 'complaint.type', 'complaint.legal_need'] } })
      .sort({ revision: -1 }).select('applicationId field value').lean(),
  ])
  const factsByApplication = Map.groupBy(facts, ({ applicationId }) => applicationId)
  return new Map(applications.map(({ applicationId, priorityDecision, applicantPersonId }) => {
    const values = latestValues(factsByApplication.get(applicationId) ?? [])
    return [applicationId, {
      applicantName: applicantPersonId?.displayName ?? null, priorityDecision: priorityDecision ?? null,
      urgent: priorityDecision === 'URGENT' || (priorityDecision !== 'ROUTINE' && values['safety.urgent'] === 'YES'),
      legalNeed: values['complaint.legal_need'] ?? null, complaintType: values['complaint.type'] ?? null,
    }]
  }))
}

export async function getCase(caseId, actor) {
  const record = await Case.findOne({ caseId }).lean()
  if (!record) throw new HttpError(404, 'NOT_FOUND', 'Case not found.')
  const officeAccess = hasOfficeRole(actor, 'DLAO_OFFICER', record.officeCode) || hasOfficeRole(actor, 'CASE_SUPPORT', record.officeCode) || hasOfficeRole(actor, 'CLAO', record.officeCode) || hasOfficeRole(actor, 'MEDIATOR', record.officeCode)
  if (officeAccess) return { caseId, applicationId: record.applicationId, status: record.status, nextHearingAt: record.nextHearingAt ?? null, nextAction: record.nextAction ?? null }
  const assignment = actor.assignments.some(({ role, officeCode }) => role === 'PANEL_LAWYER' && officeCode === record.officeCode)
    && await LawyerAssignment.findOne({ caseId, lawyerUserId: actor.userId, active: true, status: { $in: ['PENDING', 'ACCEPTED'] } }).lean()
  if (!assignment) throw new HttpError(403, 'FORBIDDEN', 'This case is not assigned to this user.')
  const summary = (await lawyerCaseSummaries([record.applicationId])).get(record.applicationId)

  const [complaintFact, facts, safeContactProfile, transcriptDoc, hasRecording] = await Promise.all([
    CaseFact.findOne({ applicationId: record.applicationId, field: 'complaint.summary' }).sort({ revision: -1 }).lean(),
    CaseFact.find({ applicationId: record.applicationId, field: { $in: ['incident.what', 'incident.when', 'incident.where', 'incident.who', 'location.district'] } }).sort({ revision: -1 }).lean(),
    SafeContactProfile.findOne({ applicationId: record.applicationId }).sort({ version: -1 }).lean(),
    VoiceTranscript.findOne({ applicationId: record.applicationId }).lean(),
    CallRecording.exists({ applicationId: record.applicationId }),
  ])
  const incidentMap = latestValues(facts)
  const hasIncidentInfo = Boolean(incidentMap['incident.what'] || incidentMap['incident.when'] || incidentMap['incident.where'] || incidentMap['incident.who'])
  const incident = hasIncidentInfo ? {
    what: incidentMap['incident.what'] ?? null,
    when: incidentMap['incident.when'] ?? null,
    where: incidentMap['incident.where'] ?? null,
    who: incidentMap['incident.who'] ?? null,
    phone: safeContactProfile?.contactValue ?? null,
  } : null
  const complaintSummary = complaintFact?.value ?? null

  const caseDetails = {
    complaintSummary,
    incident,
    safeContact: safeContactProfile ? {
      contactValue: safeContactProfile.contactValue || null,
      safeTimeWindow: safeContactProfile.safeTimeWindow ?? null,
      allowedChannels: safeContactProfile.allowedChannels ?? ['PHONE'],
      unknownAnswerAction: safeContactProfile.unknownAnswerAction ?? 'DISCLOSE_NOTHING',
    } : null,
    transcript: transcriptDoc ? { turns: transcriptDoc.turns, transcribedBy: transcriptDoc.transcribedBy } : null,
    hasRecording: Boolean(hasRecording),
  }

  // An offer shows what the case is about, enough to accept or decline; the safe number, transcript,
  // and recording open only after acceptance, so a lawyer who declines never holds them.
  if (assignment.status === 'PENDING') {
    return {
      caseId, applicationId: record.applicationId, status: record.status, assignmentId: assignment._id, assignmentStatus: 'PENDING',
      ...summary,
      complaintSummary: caseDetails.complaintSummary,
      incident: caseDetails.incident && { ...caseDetails.incident, phone: null },
    }
  }
  const documents = await Document.find({ applicationId: record.applicationId, sensitivity: 'STANDARD' }).sort({ createdAt: 1 }).limit(20).select('label currentVersion').lean()
  // ponytail: first 20 standard documents for the demo; add paging when case files grow beyond the prototype.
  const versions = await DocumentVersion.find({ applicationId: record.applicationId, documentId: { $in: documents.map(({ _id }) => _id) } })
    .sort({ version: -1 }).select('+textContent version label qualityState contentHash documentId').lean()
  const latest = new Map()
  for (const version of versions) if (!latest.has(version.documentId.toString())) latest.set(version.documentId.toString(), version)
  const [updates, payment] = await Promise.all([
    LawyerUpdate.find({ assignmentId: assignment._id }).sort({ sequence: 1 }).select('sequence dueAt instruction status missedAt submittedAt report nextAction reminders').lean(),
    LawyerPaymentEvent.findOne({ assignmentId: assignment._id }).sort({ createdAt: -1 }).select('stage status reason createdAt').lean(),
  ])
  return {
    caseId, applicationId: record.applicationId, status: record.status, assignmentId: assignment._id, assignmentStatus: assignment.status,
    ...summary,
    ...caseDetails,
    nextHearingAt: record.nextHearingAt ?? null, nextAction: record.nextAction ?? null,
    // The lawyer sees how often the office reminded them and when, not which officer did.
    updates: updates.map(({ reminders = [], ...update }) => ({ ...update, reminderCount: reminders.length, lastRemindedAt: reminders.at(-1)?.at ?? null })),
    payment: payment ?? null,
    documents: documents.map((document) => ({ id: document._id, label: document.label, currentVersion: document.currentVersion, version: latest.get(document._id.toString()) ?? null })),
  }
}

// Restricted evidence opens to the assigned officer only: the previous assignee's grant goes, the uploader's stays.
async function grantRestrictedEvidence(applicationId, officerUserId, previousUserId, session) {
  if (previousUserId && !previousUserId.equals(officerUserId)) {
    const uploads = await DocumentVersion.find({ applicationId, version: 1, recordedByUserId: previousUserId }).select('documentId').session(session).lean()
    await Document.updateMany({ applicationId, sensitivity: 'RESTRICTED', _id: { $nin: uploads.map(({ documentId }) => documentId) } }, { $pull: { allowedUserIds: previousUserId } }, { session })
  }
  await Document.updateMany({ applicationId, sensitivity: 'RESTRICTED' }, { $set: { accessState: 'EXPLICIT_GRANT' }, $addToSet: { allowedUserIds: officerUserId } }, { session })
}

// A DLAO officer takes responsibility for the record; taking it over from a colleague needs a recorded reason.
export async function assignOfficer(applicationId, { reason }, actor) {
  return mongoose.connection.transaction(async (session) => {
    const application = await officeApplication(applicationId, actor, session)
    const previous = application.assignedOfficerUserId ?? null
    if (previous?.equals(actor.userId)) throw new HttpError(409, 'ALREADY_ASSIGNED', 'You are already the assigned officer.')
    if (previous && !reason) throw new HttpError(400, 'VALIDATION_ERROR', 'Give a reason for taking over from the assigned officer.')
    const updated = await advance(application, session, { assignedOfficerUserId: actor.userId })
    await grantRestrictedEvidence(applicationId, actor.userId, previous, session)
    await appendAudit({
      applicationId, caseId: application.caseId, sequence: updated.auditSequence, action: 'OFFICER_ASSIGNED',
      actorUserId: actor.userId, actorRole: 'DLAO_OFFICER', channel: 'DLAO',
      previousState: { assignedOfficerUserId: previous ? String(previous) : null }, newState: { assignedOfficerUserId: String(actor.userId) },
      reason: reason || 'Officer took responsibility for the record.',
    }, session)
    return { applicationId, version: updated.version, assignedOfficer: { id: actor.userId, name: actor.displayName } }
  })
}

const explicitlyGranted = (document, actor) => document.accessState === 'EXPLICIT_GRANT' && document.allowedUserIds.some((id) => id.equals(actor.userId))

// Office roles read standard documents; restricted evidence needs a per-user grant or an active referral naming this user.
// The mediator a DLAO officer appointed reads the case like the officer, except restricted evidence.
const appointedMediator = (applicationId, officeCode, actor) => hasOfficeRole(actor, 'MEDIATOR', officeCode)
  && Mediation.exists({ applicationId, officeCode, mediatorUserId: actor.userId })

async function documentAccess(document, application, actor) {
  const restricted = document.sensitivity === 'RESTRICTED'
  if (!restricted && await appointedMediator(application.applicationId, application.officeCode, actor)) return { basis: 'MEDIATOR' }
  const staff = hasOfficeRole(actor, 'DLAO_OFFICER', application.officeCode) || hasOfficeRole(actor, 'CASE_SUPPORT', application.officeCode)
  if (staff && (!restricted || explicitlyGranted(document, actor))) return { basis: restricted ? 'EXPLICIT_GRANT' : 'OFFICE' }
  if (!actor.assignments.some(({ role }) => role === 'RECEIVING_DLAO')) return null
  const referral = await Referral.findOne({
    responsibleUserId: actor.userId, status: { $in: ['SENT', 'ACKNOWLEDGED', 'ACCEPTED'] },
    [restricted ? 'sensitiveDocumentIds' : 'documentIds']: document._id,
  }).select('receivingOfficeCode').lean()
  return referral && hasOfficeRole(actor, 'RECEIVING_DLAO', referral.receivingOfficeCode) ? { basis: 'REFERRAL', referralId: referral._id } : null
}

export async function getDocument(documentId, actor) {
  const document = await Document.findById(documentId).lean()
  if (!document) throw new HttpError(404, 'NOT_FOUND', 'Document not found.')
  const application = await Application.findOne({ applicationId: document.applicationId }).lean()
  if (!application) throw new HttpError(404, 'NOT_FOUND', 'Application not found.')
  const access = await documentAccess(document, application, actor)
  if (document.sensitivity === 'RESTRICTED') {
    await EvidenceAccessLog.create({
      applicationId: document.applicationId, documentId: document._id, userId: actor.userId, roles: actor.assignments.map(({ role }) => role),
      outcome: access ? 'GRANTED' : 'DENIED', basis: access?.basis ?? 'NONE', referralId: access?.referralId,
    })
  }
  if (!access) throw new HttpError(403, 'FORBIDDEN', 'This evidence is restricted.')
  const version = await DocumentVersion.findOne({ documentId: document._id }).sort({ version: -1 }).select('version label qualityState note createdAt').lean()
  return { id: document._id, applicationId: document.applicationId, label: document.label, sensitivity: document.sensitivity, accessState: document.accessState, currentVersion: document.currentVersion, version }
}

export async function listDocuments(applicationId, actor) {
  const application = await Application.findOne({ applicationId }).select('officeCode').lean()
  if (!application) throw new HttpError(404, 'NOT_FOUND', 'Application not found.')
  const office = hasOfficeRole(actor, 'DLAO_OFFICER', application.officeCode) || hasOfficeRole(actor, 'CASE_SUPPORT', application.officeCode)
  if (!office && !await appointedMediator(applicationId, application.officeCode, actor)) throw new HttpError(403, 'FORBIDDEN', 'This office cannot read documents.')
  const documents = await Document.find({ applicationId, ...(office ? {} : { sensitivity: 'STANDARD' }) }).sort({ createdAt: -1 }).lean()
  // Ungranted staff learn only that restricted evidence exists, never its label.
  return documents.map((item) => item.sensitivity !== 'RESTRICTED' || explicitlyGranted(item, actor)
    ? { id: item._id, label: item.label, sensitivity: item.sensitivity, currentVersion: item.currentVersion }
    : { id: item._id, label: 'Restricted evidence (no access grant)', sensitivity: item.sensitivity, redacted: true })
}

export async function listEvidenceAccess(applicationId, actor) {
  await officeApplication(applicationId, actor)
  const [entries, documents] = await Promise.all([
    EvidenceAccessLog.find({ applicationId }).sort({ createdAt: -1 }).limit(100).populate('userId', 'displayName').lean(),
    Document.find({ applicationId, sensitivity: 'RESTRICTED' }).select('label accessState allowedUserIds').lean(),
  ])
  const labels = new Map(documents.map((item) => [item._id.toString(), explicitlyGranted(item, actor) ? item.label : 'Restricted evidence']))
  return entries.map((entry) => ({
    id: entry._id, document: labels.get(entry.documentId.toString()) ?? 'Restricted evidence', user: entry.userId?.displayName ?? 'Unavailable',
    roles: entry.roles, outcome: entry.outcome, basis: entry.basis, createdAt: entry.createdAt,
  }))
}

export async function createDocumentMetadata(applicationId, { label, qualityState, note, filename, textContent, checklistItem, sensitivity = 'STANDARD' }, actor) {
  return mongoose.connection.transaction(async (session) => {
    const application = await officeApplication(applicationId, actor, session)
    const updated = await advance(application, session)
    // Restricting at first upload leaves no window where every office role could read it; only the classifying officer is granted.
    const [document] = await Document.create([{
      applicationId, caseId: application.caseId, label, checklistItem, sensitivity,
      ...(sensitivity === 'RESTRICTED' ? { accessState: 'EXPLICIT_GRANT', allowedUserIds: [...new Set([actor.userId, application.assignedOfficerUserId].filter(Boolean).map(String))] } : {}),
    }], { session })
    await DocumentVersion.create([{
      applicationId, caseId: application.caseId, documentId: document._id,
      version: 1, label, qualityState, note, filename, textContent,
      contentHash: textContent ? createHash('sha256').update(textContent).digest('hex') : undefined,
      recordedByUserId: actor.userId,
    }], { session })
    await appendAudit({
      applicationId, caseId: application.caseId, sequence: updated.auditSequence,
      action: textContent ? 'DOCUMENT_TEXT_UPLOADED' : 'DOCUMENT_METADATA_CREATED', actorUserId: actor.userId, actorRole: 'DLAO_OFFICER',
      newState: { documentId: document.id, version: 1, qualityState, sensitivity, contentHash: textContent ? createHash('sha256').update(textContent).digest('hex') : null, checklistItem: checklistItem ?? null },
    }, session)
    return { id: document.id, applicationId, label, currentVersion: 1, qualityState, sensitivity }
  })
}

export async function addDocumentVersion(documentId, { label, qualityState, note, filename, textContent, checklistItem }, actor) {
  return mongoose.connection.transaction(async (session) => {
    const document = await Document.findById(documentId).session(session)
    if (!document) throw new HttpError(404, 'NOT_FOUND', 'Document not found.')
    const application = await officeApplication(document.applicationId, actor, session)
    if (document.sensitivity === 'RESTRICTED' && (document.accessState !== 'EXPLICIT_GRANT' || !document.allowedUserIds.some((id) => id.equals(actor.userId)))) throw new HttpError(403, 'FORBIDDEN', 'This evidence is restricted.')
    const changed = await Document.findOneAndUpdate(
      { _id: document._id, currentVersion: document.currentVersion },
      { $inc: { currentVersion: 1 }, $set: { label, ...(checklistItem ? { checklistItem } : {}), ...(document.reviewState ? { reviewState: 'PENDING', reviewReason: null, reviewedAt: null, reviewedByUserId: null } : {}) } },
      { returnDocument: 'after', session },
    )
    if (!changed) throw new HttpError(409, 'CONFLICT', 'The document changed. Refresh and retry.')
    const updated = await advance(application, session)
    const [version] = await DocumentVersion.create([{
      applicationId: application.applicationId, caseId: application.caseId,
      documentId: document._id, version: changed.currentVersion, label, qualityState, note, filename, textContent,
      contentHash: textContent ? createHash('sha256').update(textContent).digest('hex') : undefined,
      recordedByUserId: actor.userId,
    }], { session })
    await appendAudit({
      applicationId: application.applicationId, caseId: application.caseId, sequence: updated.auditSequence,
      action: 'DOCUMENT_VERSION_ADDED', actorUserId: actor.userId, actorRole: 'DLAO_OFFICER',
      previousState: { documentId: document.id, version: document.currentVersion },
      newState: { documentId: document.id, version: version.version, qualityState, contentHash: version.contentHash ?? null },
    }, session)
    return { documentId: document.id, version: version.version, qualityState }
  })
}

export async function listDocumentVersions(documentId, actor) {
  await getDocument(documentId, actor)
  return DocumentVersion.find({ documentId }).sort({ version: 1 }).select('version label qualityState note createdAt').lean()
}

// Wrong codes per Application/Case ID from any address, so a 6-digit PIN cannot be guessed by spreading attempts across
// many IP addresses. Counted per ID string, whether or not it exists, so a lockout does not reveal which IDs are real.
// ponytail: per-process like the rate limiter; use shared storage before running more than one API instance.
const LOOKUP_FAILURES_MAX = 10
const LOOKUP_WINDOW_MS = 60 * 60 * 1000
const lookupFailures = new Map()
function recentLookupFailures(id, now) {
  const recent = (lookupFailures.get(id) ?? []).filter((time) => now - time < LOOKUP_WINDOW_MS)
  if (recent.length) lookupFailures.set(id, recent)
  else lookupFailures.delete(id)
  return recent
}
function recordLookupFailure(ids, now) {
  if (lookupFailures.size >= 10000) {
    for (const [id, times] of lookupFailures) if (now - times.at(-1) >= LOOKUP_WINDOW_MS) lookupFailures.delete(id)
    if (lookupFailures.size >= 10000) lookupFailures.delete(lookupFailures.keys().next().value)
  }
  for (const id of ids) lookupFailures.set(id, [...recentLookupFailures(id, now), now])
}

// Public tracking: only the holder of the record's own lookup code sees its progress, and a wrong ID or code look the same.
export async function trackApplicationStatus(identifier, lookupCode) {
  const year = new Date().getUTCFullYear()
  const ids = /^\d+$/.test(identifier)
    ? [`APP-${year}-${identifier.padStart(6, '0')}`, `CASE-${year}-${identifier.padStart(6, '0')}`]
    : [identifier]
  const now = Date.now()
  if (ids.some((id) => recentLookupFailures(id, now).length >= LOOKUP_FAILURES_MAX)) {
    throw new HttpError(429, 'TOO_MANY_ATTEMPTS', 'Too many wrong codes for this ID. Try again in an hour, or call 16699.')
  }
  const candidates = await Application.find({ $or: [{ applicationId: { $in: ids } }, { caseId: { $in: ids } }] })
    .select('+lookupCodeHash').limit(2).lean()
  const supplied = Buffer.from(lookupHash(lookupCode), 'hex')
  const application = candidates.find(({ lookupCodeHash }) => lookupCodeHash && timingSafeEqual(Buffer.from(lookupCodeHash, 'hex'), supplied))
  if (!application) {
    recordLookupFailure(ids, now)
    throw new HttpError(404, 'NOT_FOUND', 'No application matched this ID and tracking code.')
  }
  for (const id of ids) lookupFailures.delete(id)

  // The code holder may be reading on a shared screen or listening on a shared phone (Malek's number is a shop's), so
  // the public result carries progress only: never the applicant's name, the legal matter, or the lawyer's name.
  // Signed-in staff see those on the record itself.
  const [caseRecord, facts, rawAssignment, mediation] = await Promise.all([
    application.caseId
      ? Case.findOne({ caseId: application.caseId }).lean()
      : null,
    CaseFact.find({ applicationId: application.applicationId, field: 'safety.urgent' }).sort({ revision: -1 }).lean(),
    application.caseId
      ? LawyerAssignment.findOne({ caseId: application.caseId, active: true }).select('status createdAt acceptedAt').lean()
      : null,
    Mediation.findOne({ applicationId: application.applicationId }).select('status').lean(),
  ])

  const factMap = latestValues(facts)
  const isUrgent = application.priorityDecision === 'URGENT' || factMap['safety.urgent'] === 'YES'

  let lawyer = null
  if (rawAssignment) {
    lawyer = {
      status: rawAssignment.status,
      assignedAt: rawAssignment.createdAt,
      acceptedAt: rawAssignment.acceptedAt || null,
    }
  }

  // Determine current phase (1 to 6)
  let currentPhase = 1
  if (application.status === 'SUBMITTED') {
    currentPhase = 2
  } else if (application.status === 'ACCEPTED') {
    if (caseRecord?.nextHearingAt) {
      currentPhase = 5
    } else if (lawyer?.status === 'ACCEPTED' || mediation?.status === 'AGREED' || mediation?.status === 'IN_PROGRESS') {
      currentPhase = 4
    } else if (lawyer || mediation) {
      currentPhase = 4
    } else {
      currentPhase = 3
    }
  }

  const stages = [
    {
      phase: 1,
      title: 'Intake Registered',
      titleBn: 'আবেদন গ্রহণ',
      description: `Intake registered via ${application.channel || 'Voice Hotline 16699'}.`,
      descriptionBn: `${application.channel || 'ভয়েস হেল্পলাইন ১৬৬৯৯'} এর মাধ্যমে আবেদন নিবন্ধিত হয়েছে।`,
      status: currentPhase >= 1 ? (currentPhase === 1 ? 'CURRENT' : 'COMPLETED') : 'UPCOMING',
      date: application.createdAt,
    },
    {
      phase: 2,
      title: 'DLAO Assessment',
      titleBn: 'প্রাথমিক মূল্যায়ন',
      description: application.reviewState === 'READY_FOR_DECISION' || currentPhase > 2
        ? 'DLAO officer verified eligibility, facts, and safe contact.'
        : 'DLAO officer screening eligibility and case background.',
      descriptionBn: application.reviewState === 'READY_FOR_DECISION' || currentPhase > 2
        ? 'কর্মকর্তা কর্তৃক প্রাথমিক যাচাই ও মূল্যায়ন সম্পন্ন হয়েছে।'
        : 'কর্মকর্তা আবেদন ও তথ্যাদি যাচাই করছেন।',
      status: currentPhase > 2 ? 'COMPLETED' : (currentPhase === 2 ? 'CURRENT' : 'UPCOMING'),
      date: application.reviewState === 'READY_FOR_DECISION' ? application.updatedAt : null,
    },
    {
      phase: 3,
      title: 'Decision & Legal Aid Approval',
      titleBn: 'সহায়তা অনুমোদন ও সিদ্ধান্ত',
      description: application.status === 'ACCEPTED'
        ? `Legal aid granted. Formal Case ID ${application.caseId || 'assigned'} opened.`
        : 'Awaiting formal legal aid acceptance and case opening.',
      descriptionBn: application.status === 'ACCEPTED'
        ? `আইনি সহায়তা মঞ্জুর করা হয়েছে। মামলা নম্বর: ${application.caseId || 'বরাদ্দকৃত'}।`
        : 'আইনি সহায়তা অনুমোদনের সিদ্ধান্ত প্রক্রিয়াধীন।',
      status: currentPhase > 3 ? 'COMPLETED' : (currentPhase === 3 ? 'CURRENT' : 'UPCOMING'),
      date: application.acceptedAt || (application.status === 'ACCEPTED' ? application.updatedAt : null),
    },
    {
      phase: 4,
      title: 'Service & Lawyer Assignment',
      titleBn: 'আইনজীবী নিয়োগ / মধ্যস্থতা',
      description: lawyer
        ? (lawyer.status === 'ACCEPTED'
            ? 'A panel lawyer accepted representation.'
            : 'A panel lawyer was nominated; acceptance is pending.')
        : (mediation ? 'Assigned to Alternative Dispute Resolution (Mediation).' : 'Appointing panel advocate or mediation officer.'),
      descriptionBn: lawyer
        ? (lawyer.status === 'ACCEPTED'
            ? 'একজন প্যানেল আইনজীবী দায়িত্ব গ্রহণ করেছেন।'
            : 'একজন প্যানেল আইনজীবী মনোনীত হয়েছেন; সম্মতি প্রক্রিয়াধীন।')
        : (mediation ? 'আপস-মীমাংসা ও মধ্যস্থতায় পাঠানো হয়েছে।' : 'প্যানেল আইনজীবী নিয়োগ প্রক্রিয়াধীন।'),
      status: currentPhase > 4 ? 'COMPLETED' : (currentPhase === 4 ? 'CURRENT' : 'UPCOMING'),
      date: lawyer?.acceptedAt || lawyer?.assignedAt || null,
    },
    {
      phase: 5,
      title: 'Court Proceedings & Hearings',
      titleBn: 'আদালত কার্যক্রম ও শুনানি',
      description: caseRecord?.nextHearingAt
        ? `Next court appearance scheduled on ${new Date(caseRecord.nextHearingAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}.`
        : 'Legal briefs, court petitions, and appearance scheduling.',
      descriptionBn: caseRecord?.nextHearingAt
        ? `আদালতে শুনানির পরবর্তী তারিখ: ${new Date(caseRecord.nextHearingAt).toLocaleDateString('bn-BD', { day: 'numeric', month: 'short', year: 'numeric' })}।`
        : 'মামলার নথিপত্র প্রস্তুতকরণ ও শুনানির তারিখ নির্ধারণ।',
      status: currentPhase > 5 ? 'COMPLETED' : (currentPhase === 5 ? 'CURRENT' : 'UPCOMING'),
      date: caseRecord?.nextHearingAt || null,
    },
    {
      phase: 6,
      title: 'Resolution & Case Closed',
      titleBn: 'নিষ্পত্তি ও সমাপ্তি',
      description: currentPhase === 6
        ? 'Case concluded through legal judgment, settlement, or decree.'
        : 'Final decree, settlement compliance, or formal case closure.',
      descriptionBn: currentPhase === 6
        ? 'আইনি সহায়তা প্রক্রিয়া সমাপ্ত হয়েছে।'
        : 'চূড়ান্ত রায়, মীমাংসা বাস্তবায়ন ও নথি সমাপ্তি।',
      status: currentPhase === 6 ? 'COMPLETED' : 'UPCOMING',
      date: null,
    },
  ]

  const updates = []
  if (caseRecord?.nextHearingAt) {
    updates.push({
      id: 'hearing',
      date: caseRecord.nextHearingAt,
      type: 'HEARING',
      title: 'Court Hearing Scheduled',
      titleBn: 'আদালতে শুনানির তারিখ নির্ধারিত',
      description: `Next court hearing set for ${new Date(caseRecord.nextHearingAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}. Required Action: ${caseRecord.nextAction || 'Court attendance & petition filing'}.`,
      descriptionBn: `শুনানির তারিখ: ${new Date(caseRecord.nextHearingAt).toLocaleDateString('bn-BD', { day: 'numeric', month: 'short', year: 'numeric' })}। করণীয়: ${caseRecord.nextAction || 'আদালতে উপস্থিতি ও আবেদন দাখিল'}।`,
    })
  }

  if (lawyer) {
    updates.push({
      id: 'lawyer',
      date: lawyer.acceptedAt || lawyer.assignedAt || application.updatedAt,
      type: 'LAWYER',
      title: lawyer.status === 'ACCEPTED' ? 'Panel Lawyer Accepted Representation' : 'Panel Lawyer Nominated',
      titleBn: lawyer.status === 'ACCEPTED' ? 'প্যানেল আইনজীবী দায়িত্ব গ্রহণ করেছেন' : 'প্যানেল আইনজীবী মনোনীত হয়েছেন',
      description: 'A panel lawyer was assigned to provide legal aid representation.',
      descriptionBn: 'আইনি সহায়তার জন্য একজন প্যানেল আইনজীবীকে দায়িত্ব দেওয়া হয়েছে।',
    })
  }

  if (application.status === 'ACCEPTED') {
    updates.push({
      id: 'accepted',
      date: application.acceptedAt || application.updatedAt,
      type: 'DECISION',
      title: 'Application Accepted for Legal Aid',
      titleBn: 'আইনি সহায়তা আবেদন মঞ্জুর হয়েছে',
      description: `Case ID ${application.caseId || 'assigned'} officially registered at ${application.officeCode} DLAO office.`,
      descriptionBn: `মামলা নম্বর ${application.caseId || 'বরাদ্দকৃত'} (${application.officeCode} জেলা লিগ্যাল এইড অফিস) আনুষ্ঠানিকভাবে খোলা হয়েছে।`,
    })
  }

  if (application.reviewState === 'READY_FOR_DECISION') {
    updates.push({
      id: 'review',
      date: application.updatedAt,
      type: 'REVIEW',
      title: 'Assessment & Eligibility Review Complete',
      titleBn: 'প্রাথমিক যাচাই ও যোগ্যতা নিশ্চিত',
      description: 'DLAO officer completed initial review and confirmed applicant eligibility.',
      descriptionBn: 'কর্মকর্তা কর্তৃক তথ্যাদি যাচাই এবং আবেদনকারীর যোগ্যতা অনুমোদন নিশ্চিত করা হয়েছে।',
    })
  }

  updates.push({
    id: 'intake',
    date: application.createdAt,
    type: 'INTAKE',
    title: 'Application Registered in DLAS',
    titleBn: 'আবেদন নিবন্ধন সম্পন্ন',
    description: `Intake recorded via ${application.channel || 'Voice Hotline 16699'}. Assigned ID ${application.applicationId}.`,
    descriptionBn: `${application.channel || 'ভয়েস হেল্পলাইন ১৬৬৯৯'} এর মাধ্যমে আবেদন লিপিবদ্ধ হয়েছে। ট্র্যাকিং আইডি: ${application.applicationId}।`,
  })

  return {
    applicationId: application.applicationId,
    caseId: application.caseId || null,
    status: application.status,
    reviewState: application.reviewState,
    currentPhase,
    isUrgent,
    priorityDecision: application.priorityDecision || 'ROUTINE',
    officeCode: application.officeCode,
    channel: application.channel,
    submittedAt: application.createdAt,
    acceptedAt: application.acceptedAt || null,
    nextHearingAt: caseRecord?.nextHearingAt || null,
    // Only the applicant-facing case plan; staff task instructions stay internal.
    nextAction: caseRecord?.nextAction || null,
    lawyer,
    stages,
    updates,
  }
}

export async function editCaseInformation(applicationId, input, actor) {
  await mongoose.connection.transaction(async (session) => {
    const application = await Application.findOne({ applicationId }).session(session)
    if (!application) throw new HttpError(404, 'NOT_FOUND', 'Application not found.')
    if (!hasOfficeRole(actor, 'DLAO_OFFICER', application.officeCode)) {
      throw new HttpError(403, 'FORBIDDEN', 'Only a DLAO officer in this office can edit case information.')
    }
    if (!input.reason || input.reason.trim().length < 5) {
      throw new HttpError(400, 'REASON_REQUIRED', 'An officer reason of at least 5 characters is required to edit case information.')
    }

    const person = await Person.findById(application.applicantPersonId).session(session)
    const previousState = {
      applicantName: person?.displayName,
      petitioner: application.petitioner ? { ...application.petitioner } : null,
      respondent: application.respondent ? { ...application.respondent } : null,
    }

    if (input.applicantName?.trim() && person) {
      person.displayName = input.applicantName.trim()
      await person.save({ session })
    }

    if (input.petitioner) {
      application.petitioner = {
        name: input.petitioner.name?.trim() || application.petitioner?.name || input.applicantName?.trim() || person?.displayName || '',
        phone: input.petitioner.phone?.trim() || application.petitioner?.phone || '',
        address: input.petitioner.address?.trim() || application.petitioner?.address || '',
      }
    } else if (input.applicantName?.trim()) {
      application.petitioner = {
        name: input.applicantName.trim(),
        phone: application.petitioner?.phone || '',
        address: application.petitioner?.address || '',
      }
    }

    if (input.respondent) {
      application.respondent = {
        name: input.respondent.name?.trim() || application.respondent?.name || '',
        phone: input.respondent.phone?.trim() || application.respondent?.phone || '',
        address: input.respondent.address?.trim() || application.respondent?.address || '',
        relationship: input.respondent.relationship?.trim() || application.respondent?.relationship || '',
      }
    }

    const incidentFields = [
      ['incident.what', input.incident?.what],
      ['incident.when', input.incident?.when],
      ['incident.where', input.incident?.where],
      ['incident.who', input.incident?.who],
      ['complaint.summary', input.complaintSummary],
      ['complaint.type', input.complaintType],
    ]
    for (const [field, val] of incidentFields) {
      if (typeof val === 'string' && val.trim()) {
        const lastFact = await CaseFact.findOne({ applicationId, field }).sort({ revision: -1 }).session(session)
        const revision = (lastFact?.revision ?? 0) + 1
        await CaseFact.create([{
          applicationId,
          caseId: application.caseId ?? undefined,
          field,
          value: val.trim(),
          sourceType: 'STAFF_ENTERED',
          captureMethod: 'STAFF',
          revision,
          recordedByUserId: actor.userId,
        }], { session })
      }
    }

    if (input.safeContactPhone?.trim()) {
      const lastSafe = await SafeContactProfile.findOne({ applicationId }).sort({ version: -1 }).session(session)
      const newVersion = (lastSafe?.version ?? 0) + 1
      await SafeContactProfile.create([{
        applicationId,
        caseId: application.caseId ?? undefined,
        version: newVersion,
        contactValue: input.safeContactPhone.trim(),
        allowedChannels: lastSafe?.allowedChannels || ['PHONE'],
        prohibitedChannels: lastSafe?.prohibitedChannels || [],
        safeTimeWindow: lastSafe?.safeTimeWindow || 'Anytime with caller discretion',
        unknownAnswerAction: lastSafe?.unknownAnswerAction || 'DISCLOSE_NOTHING',
        recordedByUserId: actor.userId,
      }], { session })
    }

    const changes = {
      ...(application.petitioner ? { petitioner: application.petitioner } : {}),
      ...(application.respondent ? { respondent: application.respondent } : {}),
    }
    const updated = await advance(application, session, changes)
    await appendAudit({
      applicationId: application.applicationId,
      caseId: application.caseId,
      sequence: updated.auditSequence,
      action: 'CASE_INFORMATION_EDITED',
      actorUserId: actor.userId,
      actorRole: 'DLAO_OFFICER',
      channel: 'DLAO',
      previousState,
      newState: {
        applicantName: input.applicantName?.trim() || person?.displayName,
        petitioner: application.petitioner,
        respondent: application.respondent,
      },
      reason: input.reason.trim(),
    }, session)
  })
  return getApplication(applicationId, actor)
}

export async function preMediationVerify(applicationId, input, actor) {
  return mongoose.connection.transaction(async (session) => {
    const application = await Application.findOne({ applicationId }).session(session)
    if (!application) throw new HttpError(404, 'NOT_FOUND', 'Application not found.')
    if (!hasOfficeRole(actor, 'DLAO_OFFICER', application.officeCode) && !hasOfficeRole(actor, 'MEDIATOR', application.officeCode)) {
      throw new HttpError(403, 'FORBIDDEN', 'Only a DLAO officer or mediator can record verification.')
    }
    const previous = application.preMediationVerification ? { ...application.preMediationVerification } : null
    const verification = {
      petitionerVerified: input.petitionerVerified ?? application.preMediationVerification?.petitionerVerified ?? false,
      petitionerCallDate: input.petitionerCallDate ? new Date(input.petitionerCallDate) : (input.petitionerVerified ? new Date() : application.preMediationVerification?.petitionerCallDate),
      petitionerNotes: input.petitionerNotes ?? application.preMediationVerification?.petitionerNotes ?? '',
      respondentVerified: input.respondentVerified ?? application.preMediationVerification?.respondentVerified ?? false,
      respondentCallDate: input.respondentCallDate ? new Date(input.respondentCallDate) : (input.respondentVerified ? new Date() : application.preMediationVerification?.respondentCallDate),
      respondentNotes: input.respondentNotes ?? application.preMediationVerification?.respondentNotes ?? '',
      status: input.status || (input.petitionerVerified && input.respondentVerified ? 'VERIFIED' : 'IN_PROGRESS'),
      verifiedAt: new Date(),
    }
    application.preMediationVerification = verification
    await application.save({ session })
    const updated = await advance(application, session)
    await appendAudit({
      applicationId: application.applicationId,
      caseId: application.caseId,
      sequence: updated.auditSequence,
      action: 'PRE_MEDIATION_VERIFIED',
      actorUserId: actor.userId,
      actorRole: hasOfficeRole(actor, 'DLAO_OFFICER', application.officeCode) ? 'DLAO_OFFICER' : 'MEDIATOR',
      channel: 'DLAO',
      previousState: previous,
      newState: verification,
      reason: input.reason || 'Pre-mediation call verification completed for parties.',
    }, session)
    return { applicationId, preMediationVerification: application.preMediationVerification }
  })
}

export async function recordNoticeSent(applicationId, input, actor) {
  return mongoose.connection.transaction(async (session) => {
    const application = await Application.findOne({ applicationId }).session(session)
    if (!application) throw new HttpError(404, 'NOT_FOUND', 'Application not found.')
    if (!hasOfficeRole(actor, 'DLAO_OFFICER', application.officeCode) && !hasOfficeRole(actor, 'MEDIATOR', application.officeCode)) {
      throw new HttpError(403, 'FORBIDDEN', 'Only a DLAO officer or mediator can record notices.')
    }
    const notice = {
      recipient: input.recipient || 'RESPONDENT',
      memoNo: input.memoNo?.trim() || `NOT-${Date.now().toString().slice(-6)}`,
      dispatchDate: input.dispatchDate ? new Date(input.dispatchDate) : new Date(),
      deliveryMethod: input.deliveryMethod || 'PROCESS_SERVER',
      status: input.status || 'SENT',
      notes: input.notes?.trim() || '',
      createdAt: new Date(),
    }
    if (!application.notices) application.notices = []
    application.notices.push(notice)
    await application.save({ session })
    const updated = await advance(application, session)
    await appendAudit({
      applicationId: application.applicationId,
      caseId: application.caseId,
      sequence: updated.auditSequence,
      action: 'NOTICE_DISPATCHED',
      actorUserId: actor.userId,
      actorRole: hasOfficeRole(actor, 'DLAO_OFFICER', application.officeCode) ? 'DLAO_OFFICER' : 'MEDIATOR',
      channel: 'DLAO',
      previousState: null,
      newState: notice,
      reason: input.reason || `Notice dispatched to ${notice.recipient} via ${notice.deliveryMethod}.`,
    }, session)
    return { applicationId, notices: application.notices }
  })
}
