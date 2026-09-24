import mongoose from 'mongoose'
import { Application, Case, ContactAttempt, LawyerAssignment, LawyerChangeRequest, LawyerPaymentEvent, LawyerUpdate, PanelLawyerHold, RoleAssignment, Task, User } from '../models/index.js'
import { hasOfficeRole } from '../middleware/auth.js'
import { HttpError } from '../utils/httpError.js'
import { advance, officeApplication, verifyHelplineLookup } from './applicationService.js'
import { appendAudit } from './auditService.js'

const reviewRole = 'DLAO_OFFICER'

async function acceptedCase(applicationId, actor, session) {
  const application = await officeApplication(applicationId, actor, session)
  if (application.status !== 'ACCEPTED' || !application.caseId) throw new HttpError(409, 'CASE_REQUIRED', 'Accept the application before managing panel-lawyer work.')
  const caseRecord = await Case.findOne({ applicationId }).session(session)
  if (!caseRecord) throw new HttpError(409, 'CASE_REQUIRED', 'The accepted Case record is unavailable.')
  return { application, caseRecord }
}

async function auditApplication(application, session, action, newState, reason, actorUserId, actorRole = 'DLAO_OFFICER', previousState = null) {
  const updated = await advance(application, session)
  await appendAudit({ applicationId: updated.applicationId, caseId: updated.caseId, sequence: updated.auditSequence,
    action, actorUserId, actorRole, channel: actorRole === 'SYSTEM' ? 'SYSTEM' : actorRole === 'PANEL_LAWYER' ? 'LAWYER_PORTAL' : actorRole === 'HELPLINE_AGENT' ? 'HELPLINE_SIM' : 'DLAO',
    previousState, newState, reason }, session)
  return updated
}

export async function getLawyerManagement(applicationId, actor) {
  const { caseRecord, application } = await acceptedCase(applicationId, actor)
  const [assignments, requests, updates, payments, panelRoles] = await Promise.all([
    LawyerAssignment.find({ applicationId }).sort({ createdAt: -1 }).populate('lawyerUserId', 'displayName').lean(),
    LawyerChangeRequest.find({ applicationId }).sort({ createdAt: -1 }).lean(),
    LawyerUpdate.find({ applicationId }).sort({ dueAt: 1 }).lean(),
    LawyerPaymentEvent.find({ applicationId }).sort({ createdAt: -1, _id: -1 }).select('assignmentId stage status reason createdAt').lean(),
    RoleAssignment.find({ role: 'PANEL_LAWYER', officeCode: application.officeCode, active: true }).populate('userId', 'displayName active').lean(),
  ])
  const lawyerIds = [...new Set([
    ...assignments.map(({ lawyerUserId }) => lawyerUserId?._id?.toString()),
    ...panelRoles.map(({ userId }) => userId?._id?.toString()),
  ].filter(Boolean))]
  const holds = await PanelLawyerHold.find({ lawyerUserId: { $in: lawyerIds } }).lean()
  const holdByLawyer = new Map(holds.map((hold) => [hold.lawyerUserId.toString(), hold]))
  const paymentByAssignment = new Map()
  const paymentsByAssignment = new Map()
  for (const payment of payments) {
    const assignmentId = payment.assignmentId.toString()
    if (!paymentByAssignment.has(assignmentId)) paymentByAssignment.set(assignmentId, payment)
    if (!paymentsByAssignment.has(assignmentId)) paymentsByAssignment.set(assignmentId, [])
    paymentsByAssignment.get(assignmentId).push(payment)
  }
  return {
    applicationId, caseId: caseRecord.caseId,
    casePlan: { nextHearingAt: caseRecord.nextHearingAt ?? null, nextAction: caseRecord.nextAction ?? '' },
    reviewerRole: reviewRole,
    authorityNotice: 'Demo reviewer routing only. The legally authorised body for a temporary hold is pending policy verification.',
    panelLawyers: panelRoles.filter(({ userId }) => userId?.active).map(({ userId }) => {
      const hold = holdByLawyer.get(userId._id.toString())
      return { id: userId._id, displayName: userId.displayName,
        hold: hold ? { newAssignmentHold: hold.newAssignmentHold, reviewState: hold.reviewState, reviewerRole: hold.reviewerRole, triggeredAt: hold.triggeredAt, reviewReason: hold.reviewReason ?? null } : null }
    }),
    assignments: assignments.map((assignment) => {
      const lawyerId = assignment.lawyerUserId?._id?.toString()
      const hold = holdByLawyer.get(lawyerId)
      return { id: assignment._id, lawyerUserId: assignment.lawyerUserId?._id ?? null, lawyerName: assignment.lawyerUserId?.displayName ?? 'Unavailable',
        status: assignment.status, active: assignment.active, changeRequestId: assignment.changeRequestId ?? null,
        hold: hold ? { newAssignmentHold: hold.newAssignmentHold, reviewState: hold.reviewState, reviewerRole: hold.reviewerRole, triggeredAt: hold.triggeredAt, reviewReason: hold.reviewReason ?? null } : null,
        payment: paymentByAssignment.get(assignment._id.toString()) ?? null,
        paymentHistory: paymentsByAssignment.get(assignment._id.toString()) ?? [] }
    }),
    updates: updates.map(({ _id, assignmentId, sequence, dueAt, instruction, status, missedAt, submittedAt, report, nextAction }) => ({ id: _id, assignmentId, sequence, dueAt, instruction, status, missedAt, submittedAt, report, nextAction })),
    changeRequests: requests.map(({ _id, channel, reason, status, reviewReason, reviewedAt, createdAt }) => ({ id: _id, channel, reason, status, reviewReason, reviewedAt, createdAt })),
  }
}

export async function getLawyerWorklist(actor) {
  const offices = actor.assignments.filter(({ role }) => role === 'PANEL_LAWYER').map(({ officeCode }) => officeCode)
  if (!offices.length) throw new HttpError(403, 'FORBIDDEN', 'A panel-lawyer assignment is required.')
  // ponytail: newest 25 assignments for the demo; add paging when real caseloads exceed this.
  const assignments = await LawyerAssignment.find({ lawyerUserId: actor.userId, officeCode: { $in: offices }, active: true, status: { $in: ['PENDING', 'ACCEPTED'] } })
    .sort({ updatedAt: -1 }).limit(25).lean()
  const ids = assignments.map(({ _id }) => _id)
  const [cases, updates, payments] = await Promise.all([
    Case.find({ caseId: { $in: assignments.map(({ caseId }) => caseId) } }).select('caseId status nextHearingAt nextAction').lean(),
    LawyerUpdate.find({ assignmentId: { $in: ids }, status: { $ne: 'CANCELLED' } }).sort({ dueAt: 1 }).lean(),
    LawyerPaymentEvent.find({ assignmentId: { $in: ids } }).sort({ createdAt: -1 }).select('assignmentId stage status reason createdAt').lean(),
  ])
  const caseById = new Map(cases.map((record) => [record.caseId, record]))
  const updatesByAssignment = Map.groupBy(updates, (update) => update.assignmentId.toString())
  const paymentByAssignment = new Map()
  for (const payment of payments) if (!paymentByAssignment.has(payment.assignmentId.toString())) paymentByAssignment.set(payment.assignmentId.toString(), payment)
  return { records: assignments.map((assignment) => {
    const record = caseById.get(assignment.caseId)
    const accepted = assignment.status === 'ACCEPTED'
    return { assignmentId: assignment._id, applicationId: assignment.applicationId, caseId: assignment.caseId,
      assignmentStatus: assignment.status, caseStatus: accepted ? record?.status ?? 'OPEN' : null,
      nextHearingAt: accepted ? record?.nextHearingAt ?? null : null, nextAction: accepted ? record?.nextAction ?? null : null,
      updates: accepted ? (updatesByAssignment.get(assignment._id.toString()) ?? []).map(({ _id, sequence, dueAt, instruction, status, submittedAt }) => ({ id: _id, sequence, dueAt, instruction, status, submittedAt })) : [],
      payment: accepted ? paymentByAssignment.get(assignment._id.toString()) ?? null : null }
  }) }
}

export async function updateCasePlan(applicationId, input, actor) {
  return mongoose.connection.transaction(async (session) => {
    const { application, caseRecord } = await acceptedCase(applicationId, actor, session)
    const previousState = { nextHearingAt: caseRecord.nextHearingAt ?? null, nextAction: caseRecord.nextAction ?? null }
    const nextHearingAt = input.nextHearingAt ? new Date(input.nextHearingAt) : null
    const updated = await Case.findOneAndUpdate({ applicationId, caseId: application.caseId }, { $set: { nextHearingAt, nextAction: input.nextAction } }, { returnDocument: 'after', session })
    if (!updated) throw new HttpError(409, 'CONFLICT', 'The Case record changed. Refresh and retry.')
    const saved = await auditApplication(application, session, 'CASE_PLAN_UPDATED', { nextHearingAt, nextAction: input.nextAction }, input.reason, actor.userId, 'DLAO_OFFICER', previousState)
    return { caseId: updated.caseId, nextHearingAt: updated.nextHearingAt ?? null, nextAction: updated.nextAction, version: saved.version }
  })
}

export async function assignLawyer(applicationId, input, actor) {
  return mongoose.connection.transaction(async (session) => {
    const { application, caseRecord } = await acceptedCase(applicationId, actor, session)
    const lawyerRole = await RoleAssignment.findOne({ userId: input.lawyerUserId, role: 'PANEL_LAWYER', officeCode: application.officeCode, active: true }).session(session)
    const lawyer = lawyerRole && await User.findOne({ _id: input.lawyerUserId, active: true }).select('displayName').session(session).lean()
    if (!lawyer) throw new HttpError(400, 'INVALID_LAWYER', 'Choose an active panel lawyer in this office.')
    if (await PanelLawyerHold.exists({ lawyerUserId: input.lawyerUserId, newAssignmentHold: true }).session(session)) throw new HttpError(409, 'LAWYER_ON_HOLD', 'This lawyer has a temporary new-assignment hold pending human review.')
    const active = await LawyerAssignment.find({ applicationId, active: true, status: { $in: ['PENDING', 'ACCEPTED'] } }).session(session).lean()
    if (active.some(({ status }) => status === 'PENDING')) throw new HttpError(409, 'ASSIGNMENT_PENDING', 'A panel lawyer has not accepted or declined this assignment offer yet.')
    const current = active.find(({ status }) => status === 'ACCEPTED')
    let changeRequest
    if (current && input.changeRequestId) {
      changeRequest = await LawyerChangeRequest.findOne({ _id: input.changeRequestId, applicationId, status: 'APPROVED' }).session(session)
      if (!changeRequest) throw new HttpError(409, 'CHANGE_REVIEW_REQUIRED', 'The selected lawyer-change request is not approved.')
    } else if (!current && input.changeRequestId) throw new HttpError(409, 'CHANGE_REQUEST_STALE', 'There is no current lawyer assignment for this approved change request.')
    const updated = await auditApplication(application, session, 'PANEL_LAWYER_ASSIGNMENT_OFFERED', {
      assignmentFor: lawyer.displayName, status: 'PENDING', previousAssignmentId: current?._id ?? null, changeRequestId: changeRequest?._id ?? null,
    }, input.reason, actor.userId, 'DLAO_OFFICER', current ? { assignmentId: current._id, status: current.status } : null)
    const [assignment] = await LawyerAssignment.create([{
      applicationId, caseId: caseRecord.caseId, officeCode: application.officeCode, lawyerUserId: input.lawyerUserId,
      active: true, status: 'PENDING', assignedByUserId: actor.userId, changeRequestId: changeRequest?._id,
    }], { session })
    return { assignmentId: assignment.id, caseId: caseRecord.caseId, lawyerName: lawyer.displayName, status: assignment.status, version: updated.version }
  })
}

export async function respondToAssignment(assignmentId, input, actor) {
  return mongoose.connection.transaction(async (session) => {
    const assignment = await LawyerAssignment.findOne({ _id: assignmentId, lawyerUserId: actor.userId, active: true, status: 'PENDING' }).session(session)
    if (!assignment) throw new HttpError(404, 'NOT_FOUND', 'A pending assignment for this lawyer was not found.')
    const application = await Application.findOne({ applicationId: assignment.applicationId }).session(session)
    if (!application || !hasOfficeRole(actor, 'PANEL_LAWYER', assignment.officeCode || application.officeCode)) throw new HttpError(403, 'FORBIDDEN', 'This assignment is outside the lawyer’s office.')
    const at = new Date()
    let replacedAssignment = null
    if (input.decision === 'ACCEPT') {
      replacedAssignment = await LawyerAssignment.findOne({ applicationId: assignment.applicationId, active: true, status: 'ACCEPTED', _id: { $ne: assignment._id } }).session(session)
      if (assignment.changeRequestId) {
        const changeRequest = await LawyerChangeRequest.findOne({ _id: assignment.changeRequestId, applicationId: assignment.applicationId, status: 'APPROVED' }).session(session)
        if (!changeRequest) throw new HttpError(409, 'CHANGE_REVIEW_REQUIRED', 'The approved lawyer-change request is no longer available.')
        changeRequest.status = 'COMPLETED'
        await changeRequest.save({ session })
      }
      if (replacedAssignment) {
        replacedAssignment.active = false
        replacedAssignment.status = 'REASSIGNED'
        await replacedAssignment.save({ session })
        await LawyerUpdate.updateMany({ assignmentId: replacedAssignment._id, status: 'PENDING' }, { $set: { status: 'CANCELLED' } }, { session })
      }
      assignment.status = 'ACCEPTED'
      assignment.acceptedAt = at
    } else {
      assignment.status = 'DECLINED'
      assignment.active = false
      assignment.declinedAt = at
      assignment.declineReason = input.reason
    }
    await assignment.save({ session })
    const updated = await auditApplication(application, session, input.decision === 'ACCEPT' ? 'PANEL_LAWYER_ACCEPTED' : 'PANEL_LAWYER_DECLINED', {
      assignmentId: assignment.id, status: assignment.status, replacedAssignmentId: replacedAssignment?._id ?? null,
    }, input.reason, actor.userId, 'PANEL_LAWYER', { assignmentId: assignment.id, status: 'PENDING' })
    return { assignmentId: assignment.id, status: assignment.status, existingCaseRemainsActive: true, version: updated.version }
  })
}

export async function scheduleLawyerUpdate(applicationId, input, actor) {
  return mongoose.connection.transaction(async (session) => {
    const { application, caseRecord } = await acceptedCase(applicationId, actor, session)
    const assignment = await LawyerAssignment.findOne({ _id: input.assignmentId, applicationId, active: true, status: 'ACCEPTED' }).session(session)
    if (!assignment) throw new HttpError(409, 'ASSIGNMENT_REQUIRED', 'Schedule updates only for the current accepted panel lawyer.')
    if (Date.parse(input.dueAt) <= Date.now()) throw new HttpError(400, 'VALIDATION_ERROR', 'Update deadline must be in the future.')
    const sequence = await LawyerUpdate.countDocuments({ assignmentId: assignment._id }).session(session) + 1
    const [update] = await LawyerUpdate.create([{
      applicationId, caseId: caseRecord.caseId, assignmentId: assignment._id, sequence,
      dueAt: input.dueAt, instruction: input.instruction,
    }], { session })
    const saved = await auditApplication(application, session, 'LAWYER_UPDATE_SCHEDULED', { assignmentId: assignment.id, updateId: update.id, sequence, dueAt: update.dueAt }, input.instruction, actor.userId)
    return { id: update.id, assignmentId: assignment.id, sequence, dueAt: update.dueAt, status: update.status, version: saved.version }
  })
}

async function placeHoldIfThresholdMet(assignment, update, now, session) {
  const assignments = await LawyerAssignment.find({ lawyerUserId: assignment.lawyerUserId, status: { $in: ['ACCEPTED', 'REASSIGNED'] } }).select('_id').session(session).lean()
  const lastTwo = await LawyerUpdate.find({ assignmentId: { $in: assignments.map(({ _id }) => _id) }, status: { $ne: 'CANCELLED' }, dueAt: { $lte: now } })
    .sort({ dueAt: -1, createdAt: -1 }).limit(2).session(session).lean()
  if (lastTwo.length < 2 || !lastTwo.every(({ missedAt }) => missedAt)) return
  const existing = await PanelLawyerHold.findOne({ lawyerUserId: assignment.lawyerUserId }).session(session)
  if (existing?.newAssignmentHold) return
  const fields = {
    officeCode: assignment.officeCode, newAssignmentHold: true, reviewState: 'PENDING_REVIEW', reviewerRole: reviewRole,
    triggerApplicationId: assignment.applicationId, triggerAssignmentId: assignment._id,
    missedUpdateIds: lastTwo.map(({ _id }) => _id), triggeredAt: now,
    reviewedByUserId: undefined, reviewedAt: undefined, reviewReason: undefined,
  }
  if (existing) Object.assign(existing, fields)
  const hold = existing ?? (await PanelLawyerHold.create([{ lawyerUserId: assignment.lawyerUserId, ...fields }], { session }))[0]
  if (existing) await existing.save({ session })
  const activeAssignments = await LawyerAssignment.find({ lawyerUserId: assignment.lawyerUserId, active: true, status: 'ACCEPTED' }).session(session).lean()
  for (const active of activeAssignments) {
    const application = await Application.findOne({ applicationId: active.applicationId }).session(session)
    if (!application) continue
    const title = 'Temporary new-assignment hold needs human review'
    const task = await Task.findOne({ applicationId: active.applicationId, kind: 'LAWYER_PATTERN_REVIEW', status: 'OPEN' }).session(session)
    if (!task) {
      const [created] = await Task.create([{
        applicationId: active.applicationId, caseId: active.caseId, kind: 'LAWYER_PATTERN_REVIEW', title,
        ownerRole: reviewRole, nextAction: 'Review the missed mandatory updates and decide whether to continue or lift the temporary hold. This is not a misconduct finding; reviewer authority is pending policy verification.', dueAt: now,
      }], { session })
      await auditApplication(application, session, 'LAWYER_HOLD_REVIEW_TASK_CREATED', { holdId: hold.id, taskId: created.id, reviewerRole: reviewRole }, undefined, undefined, 'SYSTEM')
    }
    const fresh = await Application.findOne({ applicationId: active.applicationId }).session(session)
    await auditApplication(fresh, session, 'LAWYER_NEW_ASSIGNMENT_HOLD_TRIGGERED', {
      lawyerUserId: assignment.lawyerUserId, assignmentId: assignment._id, missedUpdateIds: lastTwo.map(({ _id }) => _id),
      newAssignmentHold: true, existingCaseRemainsActive: true, reviewerRole: reviewRole,
    }, 'Two consecutive mandatory panel-lawyer updates were missed. Human review is required; no misconduct or payment decision is made.', undefined, 'SYSTEM')
  }
}

async function recordMissedUpdate(update, assignment, application, now, session) {
  const title = `Mandatory lawyer update ${update.sequence} is overdue`
  const existing = await Task.findOne({ applicationId: update.applicationId, kind: 'LAWYER_UPDATE', title, status: 'OPEN' }).session(session)
  if (!existing) {
    const [task] = await Task.create([{
      applicationId: update.applicationId, caseId: update.caseId, kind: 'LAWYER_UPDATE', title,
      ownerRole: 'DLAO_OFFICER', nextAction: 'Review the overdue update and the safe-contact profile before any follow-up or travel. Do not use an unsafe number.', dueAt: update.dueAt,
    }], { session })
    await auditApplication(application, session, 'LAWYER_UPDATE_MISSED', { assignmentId: assignment._id, updateId: update._id, sequence: update.sequence, taskId: task.id, missedAt: now }, undefined, undefined, 'SYSTEM')
  }
  await placeHoldIfThresholdMet(assignment, update, now, session)
}

export async function sweepOverdueLawyerUpdates(now = new Date()) {
  // ponytail: process 100 deadlines per tick; the next tick catches up without loading an unbounded backlog.
  const due = await LawyerUpdate.find({ status: 'PENDING', dueAt: { $lte: now } }).sort({ assignmentId: 1, sequence: 1 }).limit(100).select('_id').lean()
  let swept = 0
  for (const { _id } of due) {
    const changed = await mongoose.connection.transaction(async (session) => {
      const update = await LawyerUpdate.findOneAndUpdate({ _id, status: 'PENDING', dueAt: { $lte: now } }, { $set: { status: 'MISSED', missedAt: now } }, { returnDocument: 'after', session })
      if (!update) return false
      const assignment = await LawyerAssignment.findOne({ _id: update.assignmentId, active: true, status: 'ACCEPTED' }).session(session)
      const application = await Application.findOne({ applicationId: update.applicationId }).session(session)
      if (!assignment || !application) return true
      await recordMissedUpdate(update, assignment, application, now, session)
      return true
    })
    if (changed) swept += 1
  }
  return swept
}

export async function submitLawyerUpdate(assignmentId, updateId, input, actor) {
  const now = new Date()
  await sweepOverdueLawyerUpdates(now)
  return mongoose.connection.transaction(async (session) => {
    const assignment = await LawyerAssignment.findOne({ _id: assignmentId, lawyerUserId: actor.userId, active: true, status: 'ACCEPTED' }).session(session)
    if (!assignment) throw new HttpError(404, 'NOT_FOUND', 'An active accepted assignment for this lawyer was not found.')
    const application = await Application.findOne({ applicationId: assignment.applicationId }).session(session)
    if (!application || !hasOfficeRole(actor, 'PANEL_LAWYER', assignment.officeCode || application.officeCode)) throw new HttpError(403, 'FORBIDDEN', 'This assignment is outside the lawyer’s office.')
    const update = await LawyerUpdate.findOne({ _id: updateId, assignmentId, status: { $in: ['PENDING', 'MISSED'] } }).session(session)
    if (!update) throw new HttpError(409, 'UPDATE_CLOSED', 'This mandatory update is no longer open for a report.')
    if (update.status === 'PENDING' && update.dueAt <= now) {
      const claimed = await LawyerUpdate.findOneAndUpdate({ _id: update._id, status: 'PENDING' }, { $set: { status: 'MISSED', missedAt: now } }, { returnDocument: 'after', session })
      if (claimed) {
        update.missedAt = claimed.missedAt
        await recordMissedUpdate(claimed, assignment, application, now, session)
      }
    }
    const latestApplication = await Application.findOne({ applicationId: assignment.applicationId }).session(session)
    update.status = update.missedAt ? 'SUBMITTED_LATE' : 'SUBMITTED_ON_TIME'
    update.submittedAt = now
    update.report = input.report
    update.nextAction = input.nextAction
    update.recordedByUserId = actor.userId
    await update.save({ session })
    const saved = await auditApplication(latestApplication, session, 'LAWYER_PROGRESS_UPDATE_SUBMITTED', {
      assignmentId: assignment._id, updateId: update._id, sequence: update.sequence, status: update.status, nextAction: update.nextAction,
    }, input.report, actor.userId, 'PANEL_LAWYER')
    return { updateId: update.id, status: update.status, submittedAt: update.submittedAt, version: saved.version }
  })
}

export async function requestLawyerChange(applicationId, input, actor) {
  return mongoose.connection.transaction(async (session) => {
    const { profile } = await verifyHelplineLookup(applicationId, input.lookupCode, actor, input.contactChannel, session)
    const application = await Application.findOne({ applicationId }).session(session)
    if (!application?.caseId || application.status !== 'ACCEPTED') throw new HttpError(409, 'CASE_REQUIRED', 'A lawyer-change request needs an accepted Case.')
    if (!await LawyerAssignment.exists({ applicationId, active: true, status: 'ACCEPTED' }).session(session)) throw new HttpError(409, 'NO_ACTIVE_LAWYER', 'No active panel-lawyer assignment is recorded for this Case.')
    if (await LawyerChangeRequest.exists({ applicationId, status: { $in: ['OPEN', 'APPROVED'] } }).session(session)) throw new HttpError(409, 'REQUEST_IN_PROGRESS', 'A lawyer-change request is already under review or awaiting replacement.')
    await auditApplication(application, session, 'APPLICANT_LAWYER_CHANGE_REQUESTED', { contactChannel: input.contactChannel, status: 'OPEN' }, input.reason, actor.userId, 'HELPLINE_AGENT')
    const [changeRequest] = await LawyerChangeRequest.create([{
      applicationId, caseId: application.caseId, channel: input.contactChannel, reason: input.reason, status: 'OPEN', recordedByUserId: actor.userId,
    }], { session })
    await ContactAttempt.create([{
      applicationId, caseId: application.caseId, channel: input.contactChannel, outcome: 'LAWYER_CHANGE_REQUEST',
      reason: 'Applicant request recorded by a helpline agent. No reassignment or outbound contact occurred.',
      disclosedSensitive: false, safeContactVersion: profile.version, recordedByUserId: actor.userId,
    }], { session })
    const [task] = await Task.create([{
      applicationId, caseId: application.caseId, kind: 'LAWYER_CHANGE_REVIEW', title: 'Review applicant lawyer-change request', ownerRole: 'DLAO_OFFICER',
      nextAction: 'Review the recorded request, case status, and safe-contact profile; decide separately whether a reassignment is appropriate.',
    }], { session })
    const fresh = await Application.findOne({ applicationId }).session(session)
    const updated = await auditApplication(fresh, session, 'LAWYER_CHANGE_REVIEW_TASK_CREATED', { changeRequestId: changeRequest.id, taskId: task.id }, undefined, undefined, 'SYSTEM')
    return { requestId: changeRequest.id, status: changeRequest.status, nextStep: 'A DLAO officer will review the request. This did not change the lawyer assignment.', version: updated.version }
  })
}

export async function reviewLawyerChange(applicationId, requestId, input, actor) {
  return mongoose.connection.transaction(async (session) => {
    const { application } = await acceptedCase(applicationId, actor, session)
    const changeRequest = await LawyerChangeRequest.findOne({ _id: requestId, applicationId, status: 'OPEN' }).session(session)
    if (!changeRequest) throw new HttpError(404, 'NOT_FOUND', 'An open lawyer-change request was not found.')
    changeRequest.status = input.decision === 'APPROVE' ? 'APPROVED' : 'DECLINED'
    changeRequest.reviewedByUserId = actor.userId
    changeRequest.reviewedAt = new Date()
    changeRequest.reviewReason = input.reason
    await changeRequest.save({ session })
    const updated = await auditApplication(application, session, 'LAWYER_CHANGE_REQUEST_REVIEWED', { requestId: changeRequest.id, status: changeRequest.status }, input.reason, actor.userId)
    await Task.updateMany({ applicationId, kind: 'LAWYER_CHANGE_REVIEW', status: 'OPEN' }, { $set: { status: 'DONE', completedAt: new Date(), completedByUserId: actor.userId } }, { session })
    return { requestId: changeRequest.id, status: changeRequest.status, version: updated.version, reassignmentRequired: changeRequest.status === 'APPROVED' }
  })
}

export async function reviewLawyerHold(lawyerUserId, input, actor) {
  return mongoose.connection.transaction(async (session) => {
    const hold = await PanelLawyerHold.findOne({ lawyerUserId }).session(session)
    if (!hold) throw new HttpError(404, 'NOT_FOUND', 'No assignment hold requires review.')
    if (hold.reviewerRole !== reviewRole || !hasOfficeRole(actor, hold.reviewerRole, hold.officeCode)) throw new HttpError(403, 'FORBIDDEN', 'This user is not the configured demo reviewer for the hold.')
    if (!hold.newAssignmentHold) throw new HttpError(409, 'HOLD_CLOSED', 'This temporary hold is already lifted.')
    hold.newAssignmentHold = input.decision === 'CONTINUE'
    hold.reviewState = input.decision === 'CONTINUE' ? 'CONTINUED' : 'LIFTED'
    hold.reviewedByUserId = actor.userId
    hold.reviewedAt = new Date()
    hold.reviewReason = input.reason
    await hold.save({ session })
    const assignments = await LawyerAssignment.find({ lawyerUserId, active: true, status: 'ACCEPTED' }).select('applicationId caseId').session(session).lean()
    const applicationIds = new Set([...assignments.map(({ applicationId }) => applicationId), hold.triggerApplicationId])
    for (const applicationId of applicationIds) {
      const application = await Application.findOne({ applicationId }).session(session)
      if (application) await auditApplication(application, session, 'LAWYER_ASSIGNMENT_HOLD_REVIEWED', {
        lawyerUserId, decision: input.decision, newAssignmentHold: hold.newAssignmentHold, reviewState: hold.reviewState,
      }, input.reason, actor.userId)
      await Task.updateMany({ applicationId, kind: 'LAWYER_PATTERN_REVIEW', status: 'OPEN' }, { $set: { status: 'DONE', completedAt: new Date(), completedByUserId: actor.userId } }, { session })
    }
    return { lawyerUserId, newAssignmentHold: hold.newAssignmentHold, reviewState: hold.reviewState, reassignmentChanged: false }
  })
}

export async function updateLawyerPaymentStatus(assignmentId, input, actor) {
  return mongoose.connection.transaction(async (session) => {
    const assignment = await LawyerAssignment.findOne({ _id: assignmentId, status: { $in: ['ACCEPTED', 'REASSIGNED'] } }).session(session)
    if (!assignment) throw new HttpError(409, 'ASSIGNMENT_REQUIRED', 'Payment status can be recorded only for accepted or completed panel work.')
    const application = await officeApplication(assignment.applicationId, actor, session)
    const [event] = await LawyerPaymentEvent.create([{
      applicationId: assignment.applicationId, caseId: assignment.caseId, assignmentId: assignment._id,
      stage: input.stage, status: input.status, reason: input.reason, recordedByUserId: actor.userId,
    }], { session })
    const updated = await auditApplication(application, session, 'LAWYER_PAYMENT_STATUS_RECORDED', { assignmentId: assignment.id, eventId: event.id, stage: event.stage, status: event.status }, input.reason, actor.userId)
    return { id: event.id, stage: event.stage, status: event.status, version: updated.version, moneyMoved: false }
  })
}
