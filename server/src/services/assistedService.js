import { createHash, randomBytes } from 'node:crypto'
import mongoose from 'mongoose'
import { Application, AssistanceRecord, CaseFact, ClientMutation, ConsentRecord, Person, SafeContactProfile, Task } from '../models/index.js'
import { hasOfficeRole } from '../middleware/auth.js'
import { HttpError } from '../utils/httpError.js'
import { nextRecordId } from '../utils/recordId.js'
import { appendAudit, getAuditTrail } from './auditService.js'

const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const lookupCode = () => randomBytes(12).toString('hex')

function udcOffice(actor) {
  const assignment = actor.assignments.find(({ role }) => role === 'UDC_OPERATOR')
  if (!assignment) throw new HttpError(403, 'FORBIDDEN', 'UDC assignment is required.')
  return assignment.officeCode
}

// ponytail: 24-hour correction window is a demo ceiling; replace with an approved office policy before real use.
const withinUdcWindow = (application) => application.status === 'SUBMITTED' && application.reviewState === 'PENDING_REVIEW' && Date.now() - new Date(application.createdAt).getTime() <= 86400000
const ownSubmission = (application, actor) => hasOfficeRole(actor, 'UDC_OPERATOR', application.officeCode) && Boolean(application.assistedByUserId?.equals(actor.userId))
// Lets the workspace mark which rows this worker may still open, using the same rule as ownAssisted.
export const udcCanOpen = (application, actor) => ownSubmission(application, actor) && withinUdcWindow(application)

async function ownAssisted(applicationId, actor, session) {
  const application = await Application.findOne({ applicationId }).session(session)
  if (!application) throw new HttpError(404, 'NOT_FOUND', 'Assisted intake not found.')
  if (!ownSubmission(application, actor)) throw new HttpError(403, 'FORBIDDEN', 'Only the submitting UDC worker may access this limited intake.')
  if (!withinUdcWindow(application)) throw new HttpError(403, 'FORBIDDEN', 'UDC access ended; request a DLAO review.')
  return application
}

async function latestStatements(applicationId, session) {
  const facts = await CaseFact.find({ applicationId, field: { $in: ['complaint.original', 'complaint.translation'] } }).sort({ revision: -1 }).session(session).lean()
  const latest = new Map()
  for (const fact of facts) if (!latest.has(fact.field)) latest.set(fact.field, fact)
  return {
    originalStatement: latest.get('complaint.original')?.value ?? '',
    translatedStatement: latest.get('complaint.translation')?.value ?? '',
    originalConfirmed: latest.get('complaint.original')?.applicantConfirmed ?? false,
    translationConfirmed: latest.get('complaint.translation')?.applicantConfirmed ?? false,
    facts: latest,
  }
}

async function writeStatements(application, assistance, input, actor, session, previous) {
  const values = [
    ['complaint.original', 'originalStatement', 'originalConfirmed', 'APPLICANT_REPORTED', 'TYPED'],
    ['complaint.translation', 'translatedStatement', 'translationConfirmed', 'INTERMEDIARY_TRANSLATED', 'TRANSLATED'],
  ]
  for (const [field, valueKey, confirmationKey, sourceType, captureMethod] of values) {
    const old = previous?.facts.get(field)
    await CaseFact.create([{
      applicationId: application.applicationId, caseId: application.caseId, field, value: input[valueKey],
      sourceType, sourcePersonId: assistance.applicantPersonId, captureMethod,
      typedByPersonId: assistance.typistPersonId,
      translatedByPersonId: field === 'complaint.translation' ? assistance.translatorPersonId : undefined,
      applicantConfirmed: input[confirmationKey], confirmedByPersonId: input[confirmationKey] ? assistance.applicantPersonId : undefined,
      confirmationAttestation: input[confirmationKey] ? 'UDC worker recorded an oral read-back confirmation; legal validity pending review.' : undefined,
      supersedesFactId: old?._id, revision: (old?.revision ?? 0) + 1, recordedByUserId: actor.userId,
    }], { session })
  }
  await AssistanceRecord.updateOne({ applicationId: application.applicationId }, { $set: { originalConfirmed: input.originalConfirmed, translationConfirmed: input.translationConfirmed } }, { session })
}

async function mutation(input, actor, applicationId, work) {
  const payloadHash = digest(input)
  const match = { actorUserId: actor.userId, clientMutationId: input.clientMutationId }
  const prior = await ClientMutation.findOne(match).lean()
  if (prior) {
    if (prior.payloadHash !== payloadHash) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', 'This mutation ID was already used for different content.')
    return prior.result
  }
  try {
    return await mongoose.connection.transaction(async (session) => {
      const result = await work(session, payloadHash)
      const replayResult = { ...result }
      delete replayResult.lookupCode
      await ClientMutation.create([{ ...match, temporaryId: input.temporaryId, payloadHash, applicationId, result: replayResult }], { session })
      return result
    })
  } catch (error) {
    if (error.code !== 11000) throw error
    const saved = await ClientMutation.findOne(match).lean()
    if (!saved || saved.payloadHash !== payloadHash) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', 'This mutation ID was already used for different content.')
    return saved.result
  }
}

export async function createAssisted(input, actor) {
  const officeCode = udcOffice(actor)
  const applicationId = await nextRecordId('APP')
  const code = lookupCode()
  return mutation(input, actor, applicationId, async (session, payloadHash) => {
    const [applicant] = await Person.create([{ displayName: input.applicantName, identityStatus: 'INCOMPLETE' }], { session })
    const [helper] = await Person.create([{ displayName: actor.displayName, identityStatus: 'INCOMPLETE' }], { session })
    const namedPerson = async (name) => name.trim().toLowerCase() === actor.displayName.trim().toLowerCase()
      ? helper : (await Person.create([{ displayName: name, identityStatus: 'INCOMPLETE' }], { session }))[0]
    const translator = await namedPerson(input.translatorName)
    const typist = input.typistName.trim().toLowerCase() === input.translatorName.trim().toLowerCase() ? translator : await namedPerson(input.typistName)
    const events = [
      { action: 'APPLICATION_SUBMITTED', newState: { status: 'SUBMITTED', channel: 'UDC', applicantPersonId: applicant.id, plaintiffRecorded: true, defendantRecorded: true } },
      { action: 'OFFLINE_DRAFT_CREATED', newState: { temporaryId: input.temporaryId, offlineCreatedAt: input.offlineCreatedAt ?? null } },
      { action: 'ASSISTANCE_RECORDED', newState: { helperPersonId: helper.id, translatorPersonId: translator.id, typistPersonId: typist.id, originalLanguage: input.originalLanguage, caseType: input.caseType, originalConfirmed: input.originalConfirmed, translationConfirmed: input.translationConfirmed } },
      { action: 'CONSENT_RECORDED', newState: { scope: 'ASSISTED_INTAKE', state: 'GRANTED' }, reason: input.consentAttestation },
      { action: 'FACT_RECORDED', newState: { field: 'complaint.original', sourceType: 'APPLICANT_REPORTED', applicantConfirmed: input.originalConfirmed } },
      { action: 'FACT_RECORDED', newState: { field: 'complaint.translation', sourceType: 'INTERMEDIARY_TRANSLATED', applicantConfirmed: input.translationConfirmed } },
      { action: 'SAFE_CONTACT_UPDATED', newState: { version: 1, allowedChannels: [input.contactChannel], helperPhoneIsApplicantContact: false } },
      { action: 'TASK_CREATED', newState: { kind: 'INTAKE_REVIEW', ownerRole: 'DLAO_OFFICER' } },
      { action: 'OFFLINE_MUTATION_SYNCED', newState: { clientMutationId: input.clientMutationId, temporaryId: input.temporaryId, payloadHash, version: 1 } },
    ]
    const [application] = await Application.create([{
      applicationId, applicantPersonId: applicant._id, officeCode, channel: 'UDC', submittedByUserId: actor.userId,
      assistedByUserId: actor.userId,
      petitioner: { name: input.plaintiffName },
      respondent: { name: input.defendantName, ...(input.defendantRelationship ? { relationship: input.defendantRelationship } : {}) },
      lookupCodeHash: createHash('sha256').update(code).digest('hex'), auditSequence: events.length,
    }], { session })
    const [assistance] = await AssistanceRecord.create([{
      applicationId, applicantPersonId: applicant._id, helperPersonId: helper._id, translatorPersonId: translator._id,
      typistPersonId: typist._id, helperPhone: input.helperPhone, originalLanguage: input.originalLanguage,
      caseType: input.caseType, originalConfirmed: input.originalConfirmed, translationConfirmed: input.translationConfirmed, recordedByUserId: actor.userId,
    }], { session })
    await writeStatements(application, assistance, input, actor, session)
    await ConsentRecord.create([{
      applicationId, personId: applicant._id, scope: 'ASSISTED_INTAKE', state: 'GRANTED', revision: 1,
      attestation: input.consentAttestation, sourceType: 'INTERMEDIARY_TRANSLATED', recordedByUserId: actor.userId,
    }], { session })
    await SafeContactProfile.create([{
      applicationId, version: 1, allowedChannels: [input.contactChannel],
      prohibitedChannels: input.contactChannel === 'PHONE' ? ['SMS'] : ['PHONE', 'SMS'],
      contactValue: input.contactChannel === 'PHONE' ? input.contactValue : undefined,
      contactOwnerPersonId: input.contactChannel === 'PHONE' ? applicant._id : undefined,
      safeTimeWindow: input.safeTime, smsSafe: false, neutralWordingRequired: true,
      recordedByUserId: actor.userId,
    }], { session })
    await Task.create([{
      applicationId, kind: 'INTAKE_REVIEW', title: 'Review translated assisted intake', ownerRole: 'DLAO_OFFICER',
      nextAction: 'Check oral consent, original versus translated account, confirmation, identity, safe contact, and document checklist.',
    }], { session })
    for (const [index, event] of events.entries()) await appendAudit({ ...event, applicationId, sequence: index + 1, actorUserId: actor.userId, actorRole: 'UDC_OPERATOR', channel: 'UDC' }, session)
    return { kind: 'CREATED', applicationId, temporaryId: input.temporaryId, version: application.version, lookupCode: code }
  })
}

export async function getAssisted(applicationId, actor) {
  const application = await ownAssisted(applicationId, actor)
  const [assistance, statements, trail, consent, contact] = await Promise.all([
    AssistanceRecord.findOne({ applicationId }).select('caseType originalLanguage originalConfirmed translationConfirmed helperPhone applicantPersonId translatorPersonId typistPersonId')
      .populate('applicantPersonId', 'displayName').populate('translatorPersonId', 'displayName').populate('typistPersonId', 'displayName').lean(),
    latestStatements(applicationId), getAuditTrail(applicationId),
    ConsentRecord.findOne({ applicationId, scope: 'ASSISTED_INTAKE' }).sort({ revision: -1 }).select('attestation').lean(),
    SafeContactProfile.findOne({ applicationId }).sort({ version: -1 }).select('allowedChannels safeTimeWindow').lean(),
  ])
  // Everything the submitting worker typed, read back for them; the applicant's phone number is not repeated.
  return { applicationId, version: application.version, status: application.status, reviewState: application.reviewState, submittedAt: application.createdAt,
    applicantName: assistance.applicantPersonId?.displayName ?? '', translatorName: assistance.translatorPersonId?.displayName ?? '', typistName: assistance.typistPersonId?.displayName ?? '',
    helperPhone: assistance.helperPhone ?? '', plaintiffName: application.petitioner?.name ?? '', defendantName: application.respondent?.name ?? '',
    defendantRelationship: application.respondent?.relationship ?? '', consentAttestation: consent?.attestation ?? '',
    contactChannel: contact?.allowedChannels?.[0] ?? 'IN_PERSON', safeTime: contact?.safeTimeWindow ?? '',
    caseType: assistance.caseType, originalLanguage: assistance.originalLanguage,
    originalStatement: statements.originalStatement, translatedStatement: statements.translatedStatement,
    originalConfirmed: assistance.originalConfirmed, translationConfirmed: assistance.translationConfirmed, integrityValid: trail.valid }
}

export async function reviseAssisted(applicationId, input, actor) {
  return mutation(input, actor, applicationId, async (session, payloadHash) => {
    const application = await ownAssisted(applicationId, actor, session)
    const previous = await latestStatements(applicationId, session)
    const updated = await Application.findOneAndUpdate({ applicationId, version: application.version }, { $inc: { version: 1, auditSequence: 1 } }, { returnDocument: 'after', session })
    if (!updated) throw new HttpError(409, 'CONFLICT', 'The application changed. Retry after review.')
    if (input.baseVersion !== application.version) {
      await appendAudit({ applicationId, sequence: updated.auditSequence, action: 'OFFLINE_CONFLICT_DETECTED', actorUserId: actor.userId, actorRole: 'UDC_OPERATOR', channel: 'UDC',
        newState: { clientMutationId: input.clientMutationId, baseVersion: input.baseVersion, serverVersion: updated.version, payloadHash } }, session)
      return { kind: 'CONFLICT', applicationId, temporaryId: input.temporaryId, conflictMutationId: input.clientMutationId, serverVersion: updated.version,
        server: { originalStatement: previous.originalStatement, translatedStatement: previous.translatedStatement, originalConfirmed: previous.originalConfirmed, translationConfirmed: previous.translationConfirmed },
        local: { originalStatement: input.originalStatement, translatedStatement: input.translatedStatement, originalConfirmed: input.originalConfirmed, translationConfirmed: input.translationConfirmed } }
    }
    const assistance = await AssistanceRecord.findOne({ applicationId }).session(session)
    await writeStatements(application, assistance, input, actor, session, previous)
    await appendAudit({ applicationId, sequence: updated.auditSequence, action: 'OFFLINE_MUTATION_SYNCED', actorUserId: actor.userId, actorRole: 'UDC_OPERATOR', channel: 'UDC',
      newState: { clientMutationId: input.clientMutationId, temporaryId: input.temporaryId, payloadHash, version: updated.version, correctedStatement: true } }, session)
    return { kind: 'UPDATED', applicationId, temporaryId: input.temporaryId, version: updated.version }
  })
}

export async function resolveAssisted(applicationId, input, actor) {
  return mutation(input, actor, applicationId, async (session, payloadHash) => {
    const application = await ownAssisted(applicationId, actor, session)
    const conflict = await ClientMutation.findOne({ actorUserId: actor.userId, clientMutationId: input.conflictMutationId, applicationId }).session(session)
    if (!conflict || conflict.result.kind !== 'CONFLICT' || conflict.result.resolved) throw new HttpError(409, 'CONFLICT_NOT_OPEN', 'This conflict is not open.')
    if (application.version !== input.expectedVersion) throw new HttpError(409, 'CONFLICT', 'The server changed again. Review the latest version.')
    const updated = await Application.findOneAndUpdate({ applicationId, version: application.version }, { $inc: { version: 1, auditSequence: 1 } }, { returnDocument: 'after', session })
    if (!updated) throw new HttpError(409, 'CONFLICT', 'The application changed. Review the latest version.')
    if (input.choice === 'LOCAL') {
      const assistance = await AssistanceRecord.findOne({ applicationId }).session(session)
      await writeStatements(application, assistance, conflict.result.local, actor, session, await latestStatements(applicationId, session))
    }
    await ClientMutation.updateOne({ _id: conflict._id, 'result.resolved': { $ne: true } }, { $set: { 'result.resolved': true } }, { session })
    await appendAudit({ applicationId, sequence: updated.auditSequence, action: 'OFFLINE_CONFLICT_RESOLVED', actorUserId: actor.userId, actorRole: 'UDC_OPERATOR', channel: 'UDC',
      newState: { conflictMutationId: input.conflictMutationId, choice: input.choice, version: updated.version, payloadHash }, reason: input.reason }, session)
    return { kind: 'RESOLVED', applicationId, version: updated.version, choice: input.choice }
  })
}
