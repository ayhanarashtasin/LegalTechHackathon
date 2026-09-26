import mongoose from 'mongoose'
import { HttpError } from '../utils/httpError.js'

const fail = (message) => { throw new HttpError(400, 'VALIDATION_ERROR', message) }
const text = (value, label, min = 1, max = 1500) => {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) fail(`${label} must be ${min}-${max} characters.`)
  return value.trim()
}
const choice = (value, values, label) => { if (!values.includes(value)) fail(`${label} is invalid.`); return value }
const shape = (value, fields, required = fields) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !fields.includes(key)) || required.some((key) => !(key in value))) fail('Unexpected or missing fields.')
  return value
}
const date = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) fail('Enter a valid date.')
  return value
}
export const money = (value) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 10000000 || Math.abs(value * 100 - Math.round(value * 100)) > 0.000001) fail('Amount must be positive BDT with at most two decimal places (maximum 10,000,000).')
  return value
}
export const attachments = (value = []) => {
  if (!Array.isArray(value) || value.length > 10 || value.some((id) => typeof id !== 'string' || !mongoose.isValidObjectId(id)) || new Set(value).size !== value.length) fail('Choose up to ten distinct case documents.')
  return value
}
const mutation = (value) => { if (typeof value !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)) fail('A client mutation UUID is required.'); return value }
export function resourceParam(request, _response, next) {
  for (const key of ['entryId', 'claimId', 'documentId']) if (request.params[key] && !mongoose.isValidObjectId(request.params[key])) fail(`${key} is invalid.`)
  next()
}

export function progressDetails(data) {
  shape(data, ['date', 'report', 'nextAction', 'stage', 'visitReport'])
  const checks = shape(data.visitReport, ['applicantContacted', 'documentsVerified', 'legalAdviceProvided'])
  if (Object.values(checks).some((value) => typeof value !== 'boolean')) fail('Visit checks must be explicit true/false values.')
  return { date: date(data.date), report: text(data.report, 'Progress report', 5), nextAction: text(data.nextAction, 'Next action', 5, 300),
    stage: choice(data.stage, ['INITIAL_REVIEW', 'CLIENT_MEETING', 'HEARING_ATTENDED', 'JUDGMENT_PENDING'], 'Progress stage'), visitReport: checks }
}
export function validateWorkflowEntry(request, _response, next) {
  const value = shape(request.body, ['kind', 'data', 'attachmentIds', 'clientMutationId'])
  value.clientMutationId = mutation(value.clientMutationId)
  value.attachmentIds = attachments(value.attachmentIds)
  const data = value.data
  switch (value.kind) {
    case 'CONSULTATION':
      shape(data, ['date', 'mode', 'notes'])
      value.data = { date: date(data.date), mode: choice(data.mode, ['IN_PERSON_CHAMBER', 'PHONE_SAFE', 'COURT_PREMISES', 'PHONE', 'VIDEO_CALL', 'IN_PERSON_DLAO', 'IN_PERSON', 'REMOTE'], 'Consultation mode'), notes: text(data.notes, 'Notes', 5) }; break
    case 'COURT':
      shape(data, ['courtName', 'courtCaseNo', 'courtStage'])
      value.data = { courtName: text(data.courtName, 'Court name', 2, 200), courtCaseNo: text(data.courtCaseNo, 'Court case number', 1, 100),
        courtStage: choice(data.courtStage, ['PLAINT_SUBMITTED', 'SUMMONS_SERVED', 'NOTICE_SERVED', 'WRITTEN_STATEMENT', 'FRAMING_ISSUES', 'WITNESS_EVIDENCE', 'FINAL_ARGUMENTS', 'FIXED_FOR_JUDGMENT'], 'Court stage') }; break
    case 'HEARING':
      shape(data, ['date', 'bench', 'notes'])
      value.data = { date: date(data.date), bench: text(data.bench, 'Bench', 1, 200), notes: text(data.notes, 'Hearing notes', 5) }; break
    case 'PROGRESS': value.data = progressDetails(data); break
    case 'OUTCOME':
      shape(data, ['type', 'date', 'referenceNo', 'report'])
      value.data = { type: choice(data.type, ['SETTLEMENT', 'JUDGMENT', 'DISMISSED', 'OTHER', 'COURT_JUDGMENT_FAVOUR', 'COURT_JUDGMENT_DISMISSED', 'COMPROMISE_DECREE', 'WITHDRAWN'], 'Outcome'), date: date(data.date), referenceNo: text(data.referenceNo || 'Not recorded', 'Reference', 1, 200), report: text(data.report, 'Final report', 10) }; break
    case 'DOCUMENT_REQUEST':
      shape(data, ['notes']); value.data = { notes: text(data.notes, 'Document request', 5) }; break
    default: fail('Entry kind is invalid.')
  }
  next()
}
export function validateClaim(request, _response, next) {
  const value = shape(request.body, ['stage', 'amount', 'notes', 'attachmentIds', 'clientMutationId'])
  value.stage = choice(value.stage, ['CASE_PREPARATION', 'HEARING_ATTENDANCE', 'FINAL_DISPOSAL'], 'Payment stage')
  value.amount = money(value.amount); value.notes = text(value.notes, 'Claim details', 10)
  value.attachmentIds = attachments(value.attachmentIds); value.clientMutationId = mutation(value.clientMutationId)
  if (!value.attachmentIds.length) fail('Attach a supporting PDF before submitting a fee claim.')
  next()
}
export function validateClaimReview(request, _response, next) {
  const value = shape(request.body, ['decision', 'amount', 'reason', 'paymentReference', 'clientMutationId'], ['decision', 'reason', 'clientMutationId'])
  value.clientMutationId = mutation(value.clientMutationId)
  value.decision = choice(value.decision, ['APPROVE', 'CHANGES_REQUESTED', 'RECORD_PAYMENT'], 'Decision')
  value.reason = text(value.reason, 'Review reason', 10)
  if (value.decision !== 'CHANGES_REQUESTED') value.amount = money(value.amount)
  if (value.decision === 'RECORD_PAYMENT') value.paymentReference = text(value.paymentReference, 'Payment reference', 3, 200)
  next()
}
export function validateReview(request, _response, next) {
  const value = shape(request.body, ['decision', 'reason'])
  value.decision = choice(value.decision, ['APPROVE', 'CHANGES_REQUESTED'], 'Review decision')
  value.reason = text(value.reason, 'Review reason', 10)
  next()
}
export function validatePdfUpload(request, _response, next) {
  const value = shape(request.query, ['label', 'filename', 'category', 'sensitivity'])
  request.upload = { label: text(value.label, 'Document label', 2, 120), filename: text(value.filename, 'Filename', 1, 180),
    category: choice(value.category, ['APPLICATION', 'COURT', 'ORDERS', 'EVIDENCE'], 'Document folder'),
    sensitivity: choice(value.sensitivity, ['STANDARD', 'RESTRICTED'], 'Sensitivity') }
  if (!/\.pdf$/i.test(request.upload.filename)) fail('The filename must end in .pdf.')
  if (!Buffer.isBuffer(request.body) || request.body.length < 8 || request.body.length > 4 * 1024 * 1024 || request.body.subarray(0, 5).toString() !== '%PDF-' || !request.body.subarray(-1024).includes(Buffer.from('%%EOF'))) fail('Upload a PDF file of at most 4 MB.')
  next()
}
export function validateFeedback(request, _response, next) {
  const value = shape(request.body, ['rating', 'notes', 'clientMutationId'])
  if (!Number.isInteger(value.rating) || value.rating < 1 || value.rating > 5) fail('Rating must be 1 to 5.')
  value.notes = text(value.notes, 'Feedback', 5, 1000); value.clientMutationId = mutation(value.clientMutationId)
  next()
}
export function validateFileQuery(request, _response, next) {
  shape(request.query, ['version'], [])
  if (request.query.version !== undefined && !/^[1-9]\d{0,5}$/.test(request.query.version)) fail('Document version is invalid.')
  next()
}
