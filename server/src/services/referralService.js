import mongoose from 'mongoose'
import { Application, Document, Person, Referral, RoleAssignment, SafeContactProfile, Task, User } from '../models/index.js'
import { hasOfficeRole } from '../middleware/auth.js'
import { HttpError } from '../utils/httpError.js'
import { appendAudit } from './auditService.js'
import { advance, officeApplication, requireOpenCase } from './applicationService.js'

const WAITING = ['SENT', 'ACKNOWLEDGED']
// ponytail: Goal.md T2 demo threshold; replace with the approved routing policy once the law team confirms who decides.
export const RETURN_ESCALATION_THRESHOLD = 2

async function routingReviewRequired(application, session) {
  const returns = await Referral.countDocuments({ applicationId: application.applicationId, status: 'RETURNED' }).session(session)
  if (returns < RETURN_ESCALATION_THRESHOLD) return { required: false, returns }
  const decided = application.routingDecision
  if (!decided?.route) return { required: true, returns }
  if (Number.isInteger(decided.returnCount)) return { required: decided.returnCount < returns, returns }
  // Older decisions have no returnCount; compare their timestamp with the latest return.
  const latest = await Referral.findOne({ applicationId: application.applicationId, status: 'RETURNED' })
    .sort({ respondedAt: -1, _id: -1 }).select('respondedAt').session(session).lean()
  return { required: !decided.decidedAt || decided.decidedAt <= latest.respondedAt, returns }
}

async function hasActiveReceiver(officeCode, session) {
  const assignments = await RoleAssignment.find({ role: 'RECEIVING_DLAO', officeCode, active: true }).select('userId').session(session).lean()
  if (!assignments.length) return false
  return Boolean(await User.exists({ _id: { $in: assignments.map(({ userId }) => userId) }, active: true }).session(session))
}

const view = (referral, now = Date.now()) => ({
  id: referral._id, applicationId: referral.applicationId, caseId: referral.caseId, status: referral.status,
  sendingOfficeCode: referral.sendingOfficeCode, receivingOfficeCode: referral.receivingOfficeCode,
  responsibleName: referral.responsibleUserId?.displayName ?? 'Unavailable',
  reason: referral.reason, history: referral.history, expectedAction: referral.expectedAction, dueAt: referral.dueAt,
  overdue: referral.status === 'SENT' && referral.dueAt.getTime() < now, overdueAt: referral.overdueAt ?? null,
  acknowledgedAt: referral.acknowledgedAt ?? null, respondedAt: referral.respondedAt ?? null, responseReason: referral.responseReason ?? null,
  documentCount: referral.documentIds.length, restrictedEvidenceCount: referral.sensitiveDocumentIds.length, createdAt: referral.createdAt,
})

export async function listReceivers() {
  const assignments = await RoleAssignment.find({ role: 'RECEIVING_DLAO', active: true }).populate('userId', 'displayName active').lean()
  return assignments.filter(({ userId }) => userId?.active).map(({ userId, officeCode }) => ({ userId: userId._id, displayName: userId.displayName, officeCode }))
}

export async function createReferral(applicationId, input, actor) {
  return mongoose.connection.transaction(async (session) => {
    const application = await officeApplication(applicationId, actor, session)
    if (application.status !== 'ACCEPTED') throw new HttpError(409, 'CASE_REQUIRED', 'Only an accepted case with a Case ID can be referred.')
    await requireOpenCase(applicationId, session)
    if (await Referral.exists({ applicationId, status: { $in: WAITING } }).session(session)) throw new HttpError(409, 'REFERRAL_ACTIVE', 'A referral is still waiting for the receiving office.')
    if ((await routingReviewRequired(application, session)).required || await Task.exists({ applicationId, kind: 'ROUTING_DECISION', status: 'OPEN' }).session(session)) {
      throw new HttpError(409, 'ROUTING_DECISION_REQUIRED', 'Repeated returns were escalated. Record an authorised routing decision first.')
    }
    const receiver = await RoleAssignment.findOne({ userId: input.responsibleUserId, role: 'RECEIVING_DLAO', active: true }).session(session)
    if (!receiver || receiver.officeCode === application.officeCode || !await User.exists({ _id: receiver.userId, active: true }).session(session)) {
      throw new HttpError(400, 'INVALID_RECEIVER', 'Choose an active receiving DLAO in another office.')
    }
    const decided = application.routingDecision
    if (decided?.route === 'RETAIN') throw new HttpError(409, 'ROUTE_RETAINED', 'The authorised routing decision keeps this matter in this office.')
    if (decided?.route === 'REFER' && decided.officeCode !== receiver.officeCode) throw new HttpError(409, 'ROUTE_MISMATCH', `The authorised routing decision directs this matter to ${decided.officeCode}.`)
    const documents = await Document.find({ applicationId, _id: { $in: [...input.documentIds, ...input.sensitiveDocumentIds] } }).session(session).lean()
    const byId = new Map(documents.map((item) => [item._id.toString(), item]))
    if (input.documentIds.some((id) => byId.get(id)?.sensitivity !== 'STANDARD')) throw new HttpError(400, 'INVALID_DOCUMENT', 'Attach only standard documents from this record.')
    if (input.sensitiveDocumentIds.some((id) => byId.get(id)?.sensitivity !== 'RESTRICTED' || !byId.get(id).allowedUserIds.some((userId) => userId.equals(actor.userId)))) {
      throw new HttpError(403, 'FORBIDDEN', 'You can share only restricted evidence you are explicitly granted.')
    }
    const updated = await advance(application, session)
    const [task] = await Task.create([{
      applicationId, caseId: application.caseId, kind: 'REFERRAL', title: `${receiver.officeCode} to acknowledge referral`,
      ownerRole: 'RECEIVING_DLAO', ownerUserId: receiver.userId, nextAction: input.expectedAction, dueAt: input.dueAt,
    }], { session })
    const [referral] = await Referral.create([{
      applicationId, caseId: application.caseId, sendingOfficeCode: application.officeCode, receivingOfficeCode: receiver.officeCode,
      sentByUserId: actor.userId, responsibleUserId: receiver.userId, reason: input.reason, history: input.history,
      expectedAction: input.expectedAction, dueAt: input.dueAt, documentIds: input.documentIds,
      sensitiveDocumentIds: input.sensitiveDocumentIds, sensitiveAccessReason: input.sensitiveAccessReason, taskId: task._id,
    }], { session })
    await appendAudit({
      applicationId, caseId: application.caseId, sequence: updated.auditSequence, action: 'REFERRAL_SENT',
      actorUserId: actor.userId, actorRole: 'DLAO_OFFICER', channel: 'DLAO',
      newState: {
        referralId: referral.id, receivingOfficeCode: receiver.officeCode, responsibleUserId: receiver.userId.toString(), dueAt: input.dueAt,
        documents: input.documentIds.length, restrictedEvidence: input.sensitiveDocumentIds.length, sensitiveAccessReason: input.sensitiveAccessReason ?? null,
      },
      reason: input.reason,
    }, session)
    return { id: referral.id, status: referral.status, receivingOfficeCode: receiver.officeCode, dueAt: referral.dueAt }
  })
}

export async function listReferrals(applicationId, actor) {
  const application = await officeApplication(applicationId, actor)
  const [referrals, escalation] = await Promise.all([
    Referral.find({ applicationId }).sort({ createdAt: 1 }).populate('responsibleUserId', 'displayName').lean(),
    Task.findOne({ applicationId, kind: 'ROUTING_DECISION', status: 'OPEN' }).select('title nextAction createdAt').lean(),
  ])
  const now = Date.now()
  const decided = application.routingDecision
  return {
    returns: referrals.filter(({ status }) => status === 'RETURNED').length, threshold: RETURN_ESCALATION_THRESHOLD,
    escalation, routingDecision: decided?.route ? { route: decided.route, officeCode: decided.officeCode, reason: decided.reason, decidedAt: decided.decidedAt } : null,
    referrals: referrals.map((referral) => view(referral, now)),
  }
}

export async function getReferral(referralId, actor) {
  const referral = await Referral.findById(referralId).populate('responsibleUserId', 'displayName').populate('sentByUserId', 'displayName').lean()
  if (!referral) throw new HttpError(404, 'NOT_FOUND', 'Referral not found.')
  if (!hasOfficeRole(actor, 'RECEIVING_DLAO', referral.receivingOfficeCode)) throw new HttpError(403, 'FORBIDDEN', 'Only the receiving office can read this referral package.')
  // Restricted labels are listed only for the named responsible actor while the referral is live; opening them is logged separately.
  const restrictedVisible = referral.responsibleUserId._id.equals(actor.userId) && referral.status !== 'RETURNED'
  const application = await Application.findOne({ applicationId: referral.applicationId }).select('applicantPersonId').lean()
  const [applicant, documents, previousReturns, safeContact] = await Promise.all([
    Person.findById(application.applicantPersonId).select('displayName').lean(),
    Document.find({ _id: { $in: [...referral.documentIds, ...(restrictedVisible ? referral.sensitiveDocumentIds : [])] } }).select('label sensitivity currentVersion').lean(),
    Referral.find({ applicationId: referral.applicationId, status: 'RETURNED', _id: { $ne: referral._id } }).sort({ respondedAt: 1 }).select('receivingOfficeCode responseReason respondedAt').lean(),
    SafeContactProfile.findOne({ applicationId: referral.applicationId }).sort({ version: -1 })
      .select('version allowedChannels prohibitedChannels safeTimeWindow smsSafe neutralWordingRequired unknownAnswerAction').lean(),
  ])
  return {
    ...view(referral), sentByName: referral.sentByUserId?.displayName ?? 'Unavailable', applicantName: applicant?.displayName ?? 'Unavailable',
    responsible: referral.responsibleUserId._id.equals(actor.userId),
    documents: documents.map(({ _id, label, sensitivity, currentVersion }) => ({ id: _id, label, sensitivity, currentVersion })),
    previousReturns: previousReturns.map(({ receivingOfficeCode, responseReason, respondedAt }) => ({ receivingOfficeCode, reason: responseReason, respondedAt })),
    safeContact,
  }
}

export async function respondReferral(referralId, { action, reason }, actor) {
  return mongoose.connection.transaction(async (session) => {
    const referral = await Referral.findById(referralId).session(session)
    if (!referral) throw new HttpError(404, 'NOT_FOUND', 'Referral not found.')
    if (!hasOfficeRole(actor, 'RECEIVING_DLAO', referral.receivingOfficeCode)) throw new HttpError(403, 'FORBIDDEN', 'Only the receiving office can respond to this referral.')
    if (!(action === 'ACKNOWLEDGE' ? ['SENT'] : WAITING).includes(referral.status)) throw new HttpError(409, 'INVALID_TRANSITION', `This referral is already ${referral.status.toLowerCase()}.`)
    const application = await Application.findOne({ applicationId: referral.applicationId }).session(session)
    let updated = await advance(application, session)
    const now = new Date()
    const previous = referral.status
    referral.status = { ACKNOWLEDGE: 'ACKNOWLEDGED', ACCEPT: 'ACCEPTED', RETURN: 'RETURNED' }[action]
    referral.acknowledgedAt ??= now
    if (action !== 'ACKNOWLEDGE') Object.assign(referral, { respondedAt: now, responseReason: reason, respondedByUserId: actor.userId })
    await referral.save({ session })
    await Task.updateOne({ _id: referral.taskId, status: 'OPEN' }, { $set: { status: 'DONE', completedAt: now, completedByUserId: actor.userId } }, { session })
    const base = { applicationId: referral.applicationId, caseId: referral.caseId }
    await appendAudit({
      ...base, sequence: updated.auditSequence, action: `REFERRAL_${referral.status}`, actorUserId: actor.userId, actorRole: 'RECEIVING_DLAO', channel: 'REFERRAL',
      previousState: { referralId: referral.id, status: previous }, newState: { referralId: referral.id, status: referral.status }, reason,
    }, session)
    if (action !== 'RETURN') return { id: referral.id, status: referral.status }
    const returns = await Referral.countDocuments({ applicationId: referral.applicationId, status: 'RETURNED' }).session(session)
    const escalate = returns >= RETURN_ESCALATION_THRESHOLD
    // The system escalates repeated returns; it never picks the jurisdiction itself.
    const [task] = await Task.create([escalate
      ? { ...base, kind: 'ROUTING_DECISION', title: 'Jurisdiction escalation: authorised routing decision required', ownerRole: 'DLAO_OFFICER', nextAction: `${returns} referrals were returned. An authorised human must decide the route; the system does not decide jurisdiction.` }
      : { ...base, kind: 'FOLLOW_UP', title: 'Referral returned: review the reason', ownerRole: 'DLAO_OFFICER', nextAction: 'Read the return reason and decide the next human step.' }], { session })
    if (escalate) {
      updated = await advance(updated, session)
      await appendAudit({
        ...base, sequence: updated.auditSequence, action: 'JURISDICTION_ESCALATED', actorRole: 'SYSTEM', channel: 'SYSTEM',
        newState: { returns, threshold: RETURN_ESCALATION_THRESHOLD, taskId: task.id }, reason: 'Repeated transfer/return threshold reached; a human routing decision is required.',
      }, session)
    }
    return { id: referral.id, status: referral.status, returns, escalated: escalate }
  })
}

export async function decideRouting(applicationId, { route, officeCode, reason }, actor) {
  return mongoose.connection.transaction(async (session) => {
    const application = await officeApplication(applicationId, actor, session)
    const review = await routingReviewRequired(application, session)
    const escalation = await Task.exists({ applicationId, kind: 'ROUTING_DECISION', status: 'OPEN' }).session(session)
    if (!review.required || !escalation) throw new HttpError(409, 'ROUTING_DECISION_NOT_DUE', 'A new routing decision requires an open repeated-return escalation.')
    if (route === 'REFER' && (officeCode === application.officeCode || !await hasActiveReceiver(officeCode, session))) {
      throw new HttpError(400, 'INVALID_OFFICE', 'Choose another office with an active receiving DLAO.')
    }
    const previous = application.routingDecision?.route ? { route: application.routingDecision.route, officeCode: application.routingDecision.officeCode } : null
    const routingDecision = { route, officeCode: route === 'REFER' ? officeCode : application.officeCode, reason, returnCount: review.returns, decidedByUserId: actor.userId, decidedAt: new Date() }
    const updated = await advance(application, session, { routingDecision })
    const closed = await Task.updateMany({ applicationId, kind: 'ROUTING_DECISION', status: 'OPEN' }, { $set: { status: 'DONE', completedAt: new Date(), completedByUserId: actor.userId } }, { session })
    const [task] = await Task.create([{
      applicationId, caseId: application.caseId, kind: 'FOLLOW_UP', ownerRole: 'DLAO_OFFICER',
      title: route === 'REFER' ? `Send the referral to ${officeCode} as decided` : 'Continue handling in this office as decided',
      nextAction: route === 'REFER' ? `Prepare a referral package for ${officeCode}; the routing decision binds the receiving office.` : 'Plan the next service step in this office.',
    }], { session })
    await appendAudit({
      applicationId, caseId: application.caseId, sequence: updated.auditSequence, action: 'HUMAN_ROUTING_DECISION',
      actorUserId: actor.userId, actorRole: 'DLAO_OFFICER', channel: 'DLAO',
      previousState: { routingDecision: previous, openEscalations: closed.modifiedCount }, newState: { route, officeCode: routingDecision.officeCode, returnCount: review.returns, taskId: task.id }, reason,
    }, session)
    return { route, officeCode: routingDecision.officeCode }
  })
}

// Idempotent: each overdue referral is claimed once, so repeated or concurrent sweeps add one follow-up only.
export async function sweepOverdueReferrals(now = new Date()) {
  const due = await Referral.find({ status: 'SENT', overdueAt: null, dueAt: { $lt: now } }).select('_id').lean()
  let escalated = 0
  for (const { _id } of due) {
    try {
      escalated += await mongoose.connection.transaction(async (session) => {
        const referral = await Referral.findOneAndUpdate({ _id, status: 'SENT', overdueAt: null }, { $set: { overdueAt: now } }, { returnDocument: 'after', session })
        if (!referral) return 0
        const application = await Application.findOne({ applicationId: referral.applicationId }).session(session)
        const updated = await advance(application, session)
        const [task] = await Task.create([{
          applicationId: referral.applicationId, caseId: referral.caseId, kind: 'FOLLOW_UP', ownerRole: 'DLAO_OFFICER',
          title: 'Referral not acknowledged: follow up',
          nextAction: `${referral.receivingOfficeCode} did not acknowledge by the deadline. Contact that office, or escalate for an authorised routing decision.`,
        }], { session })
        await appendAudit({
          applicationId: referral.applicationId, caseId: referral.caseId, sequence: updated.auditSequence, action: 'REFERRAL_ACK_OVERDUE',
          actorRole: 'SYSTEM', channel: 'SYSTEM', previousState: { referralId: referral.id, status: 'SENT' },
          newState: { referralId: referral.id, receivingOfficeCode: referral.receivingOfficeCode, followUpTaskId: task.id },
          reason: 'The acknowledgement deadline passed without acknowledgement.',
        }, session)
        return 1
      })
    } catch (error) {
      // A concurrent record change defers this referral to the next sweep; nothing is silently marked done.
      console.error('Referral overdue sweep deferred:', error.code || error.name)
    }
  }
  return escalated
}
