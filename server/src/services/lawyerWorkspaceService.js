import { createHash } from 'node:crypto'
import mongoose from 'mongoose'
import { Application, Case, Document, DocumentVersion, EvidenceAccessLog, LawyerAssignment, LawyerCaseEntry, LawyerFeeClaim, LawyerPaymentEvent, SafeContactProfile, Task, User } from '../models/index.js'
import { hasOfficeRole } from '../middleware/auth.js'
import { advance } from './applicationService.js'
import { appendAudit } from './auditService.js'
import { assertCaseCanClose, closeCase } from './caseClosureService.js'
import { HttpError } from '../utils/httpError.js'

export async function assignmentScope(assignmentId, actor, session, { write = false, officerOnly = false } = {}) {
  const assignment = await LawyerAssignment.findById(assignmentId).session(session).lean()
  if (!assignment) throw new HttpError(404, 'NOT_FOUND', 'Assignment not found.')
  const officer = hasOfficeRole(actor, 'DLAO_OFFICER', assignment.officeCode)
  const lawyer = !officerOnly && assignment.lawyerUserId.equals(actor.userId) && assignment.active && assignment.status === 'ACCEPTED' && hasOfficeRole(actor, 'PANEL_LAWYER', assignment.officeCode)
  if ((!officer && !lawyer) || (write && !officer && !lawyer)) throw new HttpError(403, 'FORBIDDEN', 'This assignment is outside your access.')
  const application = await Application.findOne({ applicationId: assignment.applicationId }).session(session)
  const caseRecord = await Case.findOne({ applicationId: assignment.applicationId }).session(session)
  if (!application || !caseRecord || application.status !== 'ACCEPTED' || !['ACCEPTED', 'REASSIGNED'].includes(assignment.status)) throw new HttpError(409, 'ASSIGNMENT_REQUIRED', 'An accepted assignment is required.')
  return { assignment, application, caseRecord, officer, actorRole: officer ? 'DLAO_OFFICER' : 'PANEL_LAWYER' }
}
const granted = (document, actor) => document.sensitivity !== 'RESTRICTED' || (document.accessState === 'EXPLICIT_GRANT' && document.allowedUserIds.some((id) => id.equals(actor.userId)))

export async function checkAttachments(applicationId, documentIds, actor, session, { approved = false } = {}) {
  const documents = await Document.find({ _id: { $in: documentIds }, applicationId }).session(session).lean()
  for (const document of documents.filter(({ sensitivity }) => sensitivity === 'RESTRICTED')) await EvidenceAccessLog.create([{ applicationId, documentId: document._id, userId: actor.userId, roles: actor.assignments.map(({ role }) => role), outcome: granted(document, actor) ? 'GRANTED' : 'DENIED', basis: granted(document, actor) ? 'EXPLICIT_GRANT' : 'NONE' }], granted(document, actor) ? { session } : {})
  if (documents.length !== documentIds.length || documents.some((document) => !granted(document, actor) || (approved && document.reviewState !== 'APPROVED'))) throw new HttpError(403, 'FORBIDDEN', 'Attachments must be permitted documents from this Case; approval requires reviewed documents.')
  return documents
}
async function audit(scope, actor, session, action, newState, reason) {
  const updated = await advance(scope.application, session)
  await appendAudit({ applicationId: scope.assignment.applicationId, caseId: scope.assignment.caseId, sequence: updated.auditSequence,
    actorUserId: actor.userId, actorRole: scope.actorRole, channel: scope.officer ? 'DLAO' : 'LAWYER_PORTAL', action, newState, reason }, session)
}
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const versionsOf = (documents) => documents.map((document) => ({ documentId: document._id, version: document.currentVersion }))
const checkVersions = (record, documents) => {
  if (record.attachmentVersions.some((snapshot) => documents.find((document) => document._id.equals(snapshot.documentId))?.currentVersion !== snapshot.version)) throw new HttpError(409, 'STALE_DOCUMENT', 'A supporting document changed. Request a fresh report or claim against the reviewed version.')
}
async function replay(Model, assignmentId, input, session) {
  const existing = await Model.findOne({ assignmentId, clientMutationId: input.clientMutationId }).session(session)
  if (existing && existing.payloadHash !== digest(input)) throw new HttpError(409, 'CONFLICT', 'This retry identifier was already used for different data.')
  return existing
}

export function paymentTotals(claims) {
  const cents = (field) => claims.reduce((total, item) => total + Math.round((item[field] || 0) * 100), 0)
  return { claimed: cents('amount') / 100, approved: cents('approvedAmount') / 100, paid: cents('paidAmount') / 100,
    pendingApproved: (cents('approvedAmount') - cents('paidAmount')) / 100 }
}

export async function getLawyerWorkspace(assignmentId, actor) {
  const scope = await assignmentScope(assignmentId, actor)
  const { applicationId } = scope.assignment
  const [entries, claims, paymentHistory, documents] = await Promise.all([
    LawyerCaseEntry.find({ applicationId }).sort({ createdAt: -1, _id: -1 }).lean(),
    LawyerFeeClaim.find({ assignmentId }).sort({ createdAt: -1, _id: -1 }).lean(),
    LawyerPaymentEvent.find({ assignmentId }).sort({ createdAt: -1, _id: -1 }).select('assignmentId claimId stage status amount reason paymentReference createdAt').lean(),
    Document.find({ applicationId }).sort({ createdAt: -1 }).lean(),
  ])
  const visibleDocuments = documents.filter((document) => granted(document, actor))
  const versions = await DocumentVersion.find({ documentId: { $in: visibleDocuments.map(({ _id }) => _id) } }).sort({ version: -1 }).select('documentId version label filename qualityState contentHash createdAt').lean()
  const byDocument = Map.groupBy(versions, (version) => version.documentId.toString())
  // Keep inaccessible attachment identifiers out of notes, fee claims, and report exports.
  const allowed = new Set(visibleDocuments.map(({ _id }) => _id.toString()))
  const redact = (item) => ({ ...item, attachmentIds: item.attachmentIds.filter((id) => allowed.has(id.toString())), attachmentVersions: item.attachmentVersions.filter(({ documentId }) => allowed.has(documentId.toString())) })
  return { assignmentId, applicationId, caseId: scope.caseRecord.caseId, caseStatus: scope.caseRecord.status, officer: scope.officer,
    entries: entries.map(redact), claims: claims.map(redact), totals: paymentTotals(claims), paymentHistory,
    documents: visibleDocuments.map((document) => ({ _id: document._id, label: document.label, category: document.category, sensitivity: document.sensitivity,
      currentVersion: document.currentVersion, reviewState: document.reviewState || 'PENDING', reviewReason: document.reviewReason,
      version: byDocument.get(document._id.toString())?.[0] ?? null, versions: byDocument.get(document._id.toString()) ?? [] })) }
}

export async function createLawyerEntry(assignmentId, input, actor) {
  return mongoose.connection.transaction(async (session) => {
    const scope = await assignmentScope(assignmentId, actor, session, { write: true, officerOnly: input.kind === 'DOCUMENT_REQUEST' })
    if (scope.officer && input.kind !== 'DOCUMENT_REQUEST') throw new HttpError(403, 'FORBIDDEN', 'Lawyer reports must be submitted by the assigned lawyer.')
    const existing = await replay(LawyerCaseEntry, assignmentId, input, session)
    if (existing) return existing
    if (scope.caseRecord.status !== 'OPEN') throw new HttpError(409, 'INVALID_TRANSITION', 'This Case is closed; reports cannot change it.')
    if (input.kind === 'CONSULTATION' && ['PHONE', 'PHONE_SAFE'].includes(input.data.mode)) {
      const contact = await SafeContactProfile.findOne({ applicationId: scope.assignment.applicationId }).sort({ version: -1 }).session(session).lean()
      if (!contact?.allowedChannels.includes('PHONE') || contact.prohibitedChannels.includes('PHONE')) throw new HttpError(409, 'UNSAFE_CONTACT', 'A phone consultation requires the Case’s approved safe phone route.')
    }
    if (input.kind === 'OUTCOME' && await LawyerCaseEntry.exists({ applicationId: scope.assignment.applicationId, kind: 'OUTCOME', reviewState: 'PENDING' }).session(session)) throw new HttpError(409, 'REQUEST_IN_PROGRESS', 'A final report is already awaiting review.')
    const documents = await checkAttachments(scope.assignment.applicationId, input.attachmentIds, actor, session)
    const [entry] = await LawyerCaseEntry.create([{ ...input, applicationId: scope.assignment.applicationId, caseId: scope.assignment.caseId, assignmentId,
      attachmentVersions: versionsOf(documents), payloadHash: digest(input), recordedByUserId: actor.userId, ...(input.kind === 'OUTCOME' ? { reviewState: 'PENDING' } : {}) }], { session })
    if (input.kind === 'OUTCOME') await Task.create([{ applicationId: scope.assignment.applicationId, caseId: scope.assignment.caseId, kind: 'FOLLOW_UP',
      title: 'Review lawyer final report', ownerRole: 'DLAO_OFFICER', nextAction: 'Review the final report and supporting documents; decide case closure.' }], { session })
    await audit(scope, actor, session, `LAWYER_${input.kind}_RECORDED`, { assignmentId, entryId: entry.id, kind: input.kind, attachmentIds: input.attachmentIds, source: scope.actorRole }, input.data.notes ?? input.data.report)
    return entry
  })
}

export async function createFeeClaim(assignmentId, input, actor) {
  return mongoose.connection.transaction(async (session) => {
    const scope = await assignmentScope(assignmentId, actor, session, { write: true })
    if (scope.officer) throw new HttpError(403, 'FORBIDDEN', 'Only the assigned lawyer may submit a fee claim.')
    const existing = await replay(LawyerFeeClaim, assignmentId, input, session)
    if (existing) return existing
    if (scope.caseRecord.status === 'CANCELLED') throw new HttpError(409, 'INVALID_TRANSITION', 'Reconcile cancelled work through the officer.')
    const documents = await checkAttachments(scope.assignment.applicationId, input.attachmentIds, actor, session)
    const pdf = await DocumentVersion.exists({ $or: documents.map((document) => ({ documentId: document._id, version: document.currentVersion })), fileData: /^data:application\/pdf;base64,/ }).session(session)
    if (!pdf) throw new HttpError(400, 'VALIDATION_ERROR', 'The claim needs at least one supporting PDF.')
    if (input.stage === 'FINAL_DISPOSAL' && !await LawyerCaseEntry.exists({ applicationId: scope.assignment.applicationId, kind: 'OUTCOME', reviewState: { $in: ['PENDING', 'APPROVED'] } }).session(session)) throw new HttpError(409, 'REVIEW_REQUIRED', 'Submit a final report before a final-disposal claim.')
    const [claim] = await LawyerFeeClaim.create([{ ...input, applicationId: scope.assignment.applicationId, caseId: scope.assignment.caseId, assignmentId, attachmentVersions: versionsOf(documents), recordedByUserId: actor.userId, payloadHash: digest(input) }], { session })
    await LawyerPaymentEvent.create([{ applicationId: claim.applicationId, caseId: claim.caseId, assignmentId, claimId: claim.id, stage: claim.stage, status: 'SUBMITTED', amount: claim.amount, reason: claim.notes, recordedByUserId: actor.userId }], { session })
    await audit(scope, actor, session, 'LAWYER_FEE_CLAIM_SUBMITTED', { assignmentId, claimId: claim.id, stage: claim.stage, amount: claim.amount, moneyMoved: false }, input.notes)
    return claim
  })
}

export async function reviewFeeClaim(assignmentId, claimId, input, actor) {
  return mongoose.connection.transaction(async (session) => {
    const scope = await assignmentScope(assignmentId, actor, session, { officerOnly: true })
    const claim = await LawyerFeeClaim.findOne({ _id: claimId, assignmentId }).session(session)
    if (!claim) throw new HttpError(404, 'NOT_FOUND', 'Claim not found.')
    const previous = await replay(LawyerPaymentEvent, assignmentId, { ...input, claimId }, session)
    if (previous) return claim
    let status
    if (input.decision === 'RECORD_PAYMENT') {
      if (claim.status !== 'APPROVED' || Math.round(input.amount * 100) > Math.round((claim.approvedAmount - claim.paidAmount) * 100)) throw new HttpError(409, 'INVALID_TRANSITION', 'Payment must be within the approved unpaid balance.')
      claim.paidAmount = (Math.round(claim.paidAmount * 100) + Math.round(input.amount * 100)) / 100
      if (claim.paidAmount === claim.approvedAmount) claim.status = 'PAID'
      status = 'PAYMENT_RECORDED'
    } else {
      if (claim.status !== 'SUBMITTED') throw new HttpError(409, 'ALREADY_REVIEWED', 'This claim has already been reviewed.')
      if (input.decision === 'APPROVE') {
        const documents = await checkAttachments(claim.applicationId, claim.attachmentIds.map(String), actor, session, { approved: true })
        checkVersions(claim, documents)
        if (input.amount > claim.amount) throw new HttpError(400, 'VALIDATION_ERROR', 'Approval cannot exceed the claim amount.')
        if (claim.stage === 'FINAL_DISPOSAL' && scope.caseRecord.status !== 'CLOSED') throw new HttpError(409, 'REVIEW_REQUIRED', 'Review and approve the final report before approving the final-disposal claim.')
        claim.approvedAmount = input.amount; claim.status = 'APPROVED'; status = 'RECONCILED'
      } else { claim.status = 'CHANGES_REQUESTED'; status = 'DISPUTED' }
    }
    claim.reviewReason = input.reason; claim.reviewedAt = new Date()
    await claim.save({ session })
    await LawyerPaymentEvent.create([{ applicationId: claim.applicationId, caseId: claim.caseId, assignmentId, claimId, stage: claim.stage, status,
      amount: input.amount, paymentReference: input.paymentReference, reason: input.reason, recordedByUserId: actor.userId,
      clientMutationId: input.clientMutationId, payloadHash: digest({ ...input, claimId }) }], { session })
    await audit(scope, actor, session, 'LAWYER_FEE_CLAIM_REVIEWED', { claimId, decision: input.decision, approvedAmount: claim.approvedAmount, paidAmount: claim.paidAmount, paymentReference: input.paymentReference, moneyMoved: false }, input.reason)
    return claim
  })
}

export async function reviewLawyerOutcome(assignmentId, entryId, input, actor) {
  return mongoose.connection.transaction(async (session) => {
    const scope = await assignmentScope(assignmentId, actor, session, { officerOnly: true })
    const entry = await LawyerCaseEntry.findOne({ _id: entryId, assignmentId, kind: 'OUTCOME', reviewState: 'PENDING' }).session(session)
    if (!entry) throw new HttpError(409, 'ALREADY_REVIEWED', 'No pending final report exists.')
    if (input.decision === 'APPROVE') {
      await assertCaseCanClose(scope.caseRecord, session, { closedByAssignedLawyer: true })
      const documents = await checkAttachments(entry.applicationId, entry.attachmentIds.map(String), actor, session, { approved: true })
      checkVersions(entry, documents)
      await closeCase(scope.caseRecord, actor, session, 'Case completed following officer review.')
    }
    entry.reviewState = input.decision === 'APPROVE' ? 'APPROVED' : 'CHANGES_REQUESTED'; entry.reviewReason = input.reason; entry.reviewedAt = new Date()
    await entry.save({ session })
    await Task.updateMany({ applicationId: entry.applicationId, title: 'Review lawyer final report', status: 'OPEN' }, { $set: { status: 'DONE', completedAt: new Date(), completedByUserId: actor.userId } }, { session })
    await audit(scope, actor, session, 'LAWYER_FINAL_REPORT_REVIEWED', { entryId, reviewState: entry.reviewState, caseStatus: scope.caseRecord.status }, input.reason)
    return entry
  })
}

export async function uploadLawyerPdf(assignmentId, metadata, bytes, actor) {
  return mongoose.connection.transaction(async (session) => {
    const scope = await assignmentScope(assignmentId, actor, session, { write: true })
    if (scope.officer) throw new HttpError(403, 'FORBIDDEN', 'This upload is for the assigned lawyer.')
    // ponytail: 4 MB PDFs stored using existing inline fileData; use GridFS/object storage for larger court bundles.
    const [document] = await Document.create([{ applicationId: scope.assignment.applicationId, caseId: scope.assignment.caseId, assignmentId,
      ...metadata, reviewState: 'PENDING', ...(metadata.sensitivity === 'RESTRICTED' ? { accessState: 'EXPLICIT_GRANT', allowedUserIds: [actor.userId, ...(scope.assignment.assignedByUserId ? [scope.assignment.assignedByUserId] : [])] } : {}) }], { session })
    const contentHash = createHash('sha256').update(bytes).digest('hex')
    await DocumentVersion.create([{ applicationId: document.applicationId, caseId: document.caseId, documentId: document.id, version: 1, label: metadata.label,
      filename: metadata.filename, qualityState: 'PENDING_REVIEW', fileData: `data:application/pdf;base64,${bytes.toString('base64')}`, contentHash, recordedByUserId: actor.userId }], { session })
    await audit(scope, actor, session, 'LAWYER_DOCUMENT_UPLOADED', { documentId: document.id, category: metadata.category, sensitivity: metadata.sensitivity, bytes: bytes.length, contentHash }, 'PDF uploaded for human document review.')
    return { id: document.id, reviewState: document.reviewState }
  })
}

export async function reviewLawyerDocument(assignmentId, documentId, input, actor) {
  return mongoose.connection.transaction(async (session) => {
    const scope = await assignmentScope(assignmentId, actor, session, { officerOnly: true })
    await checkAttachments(scope.assignment.applicationId, [documentId], actor, session)
    const document = await Document.findOne({ _id: documentId, applicationId: scope.assignment.applicationId }).session(session)
    if (!document || document.sensitivity === 'RESTRICTED' && !granted(document, actor)) throw new HttpError(403, 'FORBIDDEN', 'Restricted documents require an explicit access grant before review.')
    document.reviewState = input.decision === 'APPROVE' ? 'APPROVED' : 'CHANGES_REQUESTED'; document.reviewReason = input.reason; document.reviewedByUserId = actor.userId; document.reviewedAt = new Date()
    await document.save({ session })
    await audit(scope, actor, session, 'LAWYER_DOCUMENT_REVIEWED', { documentId, version: document.currentVersion, reviewState: document.reviewState }, input.reason)
    return { id: document.id, reviewState: document.reviewState }
  })
}

export async function downloadLawyerPdf(assignmentId, documentId, actor, requestedVersion) {
  const scope = await assignmentScope(assignmentId, actor)
  const documents = await checkAttachments(scope.assignment.applicationId, [documentId], actor)
  const version = await DocumentVersion.findOne({ documentId, version: requestedVersion ?? documents[0].currentVersion }).select('+fileData filename contentHash').lean()
  if (!version?.fileData?.startsWith('data:application/pdf;base64,')) throw new HttpError(404, 'NOT_FOUND', 'A PDF is not stored for this document.')
  const bytes = Buffer.from(version.fileData.slice('data:application/pdf;base64,'.length), 'base64')
  if (version.contentHash && createHash('sha256').update(bytes).digest('hex') !== version.contentHash) throw new HttpError(409, 'CONFLICT', 'Document integrity check failed.')
  return { bytes, filename: version.filename || 'case-document.pdf' }
}

export async function submitClientFeedback(assignmentId, input, actor) {
  return mongoose.connection.transaction(async (session) => {
    const assignment = await LawyerAssignment.findById(assignmentId).session(session).lean()
    const owner = await User.findById(actor.userId).select('personId').session(session).lean()
    const ownership = owner?.personId ? { $or: [{ citizenUserId: actor.userId }, { applicantPersonId: owner.personId }] } : { citizenUserId: actor.userId }
    const application = assignment && await Application.findOne({ applicationId: assignment.applicationId, ...ownership }).session(session)
    if (!application || !['ACCEPTED', 'REASSIGNED'].includes(assignment.status)) throw new HttpError(404, 'NOT_FOUND', 'Owned Case with an accepted lawyer not found.')
    if (await LawyerCaseEntry.exists({ assignmentId, kind: 'FEEDBACK', recordedByUserId: actor.userId }).session(session)) throw new HttpError(409, 'ALREADY_RECORDED', 'Feedback for this assignment has already been submitted.')
    const [entry] = await LawyerCaseEntry.create([{ applicationId: assignment.applicationId, caseId: assignment.caseId, assignmentId, kind: 'FEEDBACK', data: { rating: input.rating, notes: input.notes },
      clientMutationId: input.clientMutationId, payloadHash: digest(input), recordedByUserId: actor.userId }], { session })
    const updated = await advance(application, session)
    await appendAudit({ applicationId: application.applicationId, caseId: application.caseId, sequence: updated.auditSequence, action: 'CLIENT_LAWYER_FEEDBACK_SUBMITTED', actorUserId: actor.userId, actorRole: 'CITIZEN', channel: 'PORTAL', newState: { assignmentId, entryId: entry.id } }, session)
    return { id: entry.id }
  })
}
