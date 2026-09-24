import mongoose from 'mongoose'
import { HttpError } from '../utils/httpError.js'
import { LOOKUP_CODE } from './requests.js'

const fail = (message) => { throw new HttpError(400, 'VALIDATION_ERROR', message) }
const text = (value, label, min = 1, max = 1000) => {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) fail(`${label} must be ${min}-${max} characters.`)
  return value.trim()
}
const objectId = (value, label) => {
  if (typeof value !== 'string' || !mongoose.isValidObjectId(value)) fail(`${label} is invalid.`)
}
const isoDate = (value, label, future = false) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value) || Number.isNaN(Date.parse(value)) || (future && Date.parse(value) <= Date.now())) fail(`${label} must be a future ISO date-time.`)
  return new Date(value)
}
function body(request, allowed, required = allowed) {
  const value = request.body
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !allowed.includes(key)) || required.some((key) => !(key in value))) fail('Unexpected or missing fields.')
  return value
}

export function assignmentParam(request, _response, next) { objectId(request.params.assignmentId, 'Assignment ID'); next() }
export function updateParam(request, _response, next) { objectId(request.params.updateId, 'Update ID'); next() }
export function changeRequestParam(request, _response, next) { objectId(request.params.requestId, 'Change request ID'); next() }
export function holdUserParam(request, _response, next) { objectId(request.params.lawyerUserId, 'Lawyer ID'); next() }

export function validateCasePlan(request, _response, next) {
  const value = body(request, ['nextHearingAt', 'nextAction', 'reason'])
  if (value.nextHearingAt !== null) value.nextHearingAt = isoDate(value.nextHearingAt, 'Hearing date', true)
  value.nextAction = text(value.nextAction, 'Next action', 5, 300)
  value.reason = text(value.reason, 'Reason', 10)
  next()
}

export function validateAssignment(request, _response, next) {
  const value = body(request, ['lawyerUserId', 'changeRequestId', 'reason'], ['lawyerUserId', 'reason'])
  objectId(value.lawyerUserId, 'Panel lawyer')
  if (value.changeRequestId !== undefined) objectId(value.changeRequestId, 'Change request ID')
  value.reason = text(value.reason, 'Assignment reason', 10)
  next()
}

export function validateUpdateSchedule(request, _response, next) {
  const value = body(request, ['assignmentId', 'dueAt', 'instruction'])
  objectId(value.assignmentId, 'Assignment ID')
  value.dueAt = isoDate(value.dueAt, 'Update deadline', true)
  value.instruction = text(value.instruction, 'Update instruction', 5, 300)
  next()
}

export function validateAssignmentResponse(request, _response, next) {
  const value = body(request, ['decision', 'reason'])
  if (!['ACCEPT', 'DECLINE'].includes(value.decision)) fail('Assignment decision is invalid.')
  value.reason = text(value.reason, 'Decision reason', 10)
  next()
}

export function validateProgressReport(request, _response, next) {
  const value = body(request, ['report', 'nextAction'])
  value.report = text(value.report, 'Progress update', 5)
  value.nextAction = text(value.nextAction, 'Next action', 5, 300)
  next()
}

export function validatePaymentStatus(request, _response, next) {
  const value = body(request, ['stage', 'status', 'reason'])
  if (!['CASE_PREPARATION', 'HEARING_ATTENDANCE', 'CLAIM_REVIEW', 'RECONCILIATION'].includes(value.stage)) fail('Payment stage is invalid.')
  if (!['NOT_RECORDED', 'SUBMITTED', 'UNDER_REVIEW', 'RECONCILED', 'PAYMENT_RECORDED', 'DISPUTED'].includes(value.status)) fail('Payment status is invalid.')
  value.reason = text(value.reason, 'Reconciliation reason', 10)
  next()
}

export function validateLawyerChangeRequest(request, _response, next) {
  const value = body(request, ['lookupCode', 'callerVerified', 'contactChannel', 'reason'])
  if (typeof value.lookupCode !== 'string' || !LOOKUP_CODE.test(value.lookupCode)) fail('A valid lookup code is required.')
  if (value.callerVerified !== true) fail('Human caller-verification attestation is required.')
  if (!['PHONE', 'IN_PERSON'].includes(value.contactChannel)) fail('Safe contact channel is invalid.')
  value.reason = text(value.reason, 'Applicant request', 5, 1000)
  next()
}

export function validateCitizenLawyerChangeRequest(request, _response, next) {
  const value = body(request, ['reason'])
  value.reason = text(value.reason, 'Applicant request', 5, 1000)
  next()
}

export function validateChangeReview(request, _response, next) {
  const value = body(request, ['decision', 'reason'])
  if (!['APPROVE', 'DECLINE'].includes(value.decision)) fail('Review decision is invalid.')
  value.reason = text(value.reason, 'Review reason', 10)
  next()
}

export function validateHoldReview(request, _response, next) {
  const value = body(request, ['decision', 'reason'])
  if (!['LIFT', 'CONTINUE'].includes(value.decision)) fail('Hold review decision is invalid.')
  value.reason = text(value.reason, 'Hold review reason', 10)
  next()
}
