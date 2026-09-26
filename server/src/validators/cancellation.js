import mongoose from 'mongoose'
import { HttpError } from '../utils/httpError.js'

const fail = (message) => { throw new HttpError(400, 'VALIDATION_ERROR', message) }
const text = (value, label, min = 1, max = 1000) => {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) fail(`${label} must be ${min}-${max} characters.`)
  return value.trim()
}
function body(request, allowed, required = allowed) {
  const value = request.body
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !allowed.includes(key)) || required.some((key) => !(key in value))) fail('Unexpected or missing fields.')
  return value
}

export function cancellationRequestParam(request, _response, next) {
  if (typeof request.params.requestId !== 'string' || !mongoose.isValidObjectId(request.params.requestId)) fail('Cancellation request ID is invalid.')
  next()
}

export function validateCitizenCancellationRequest(request, _response, next) {
  const value = body(request, ['reason'])
  value.reason = text(value.reason, 'Cancellation reason', 5, 1000)
  next()
}

export function validateCancellationReview(request, _response, next) {
  const value = body(request, ['decision', 'reason'])
  if (!['APPROVE', 'DECLINE'].includes(value.decision)) fail('Review decision is invalid.')
  value.reason = text(value.reason, 'Review reason', 10, 1000)
  next()
}
