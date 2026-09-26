import mongoose from 'mongoose'
import { HttpError } from '../utils/httpError.js'

export function notFound(_request, _response, next) {
  next(new HttpError(404, 'NOT_FOUND', 'Endpoint not found.'))
}

export function errorHandler(error, _request, response, next) {
  if (response.headersSent) return next(error)
  if (error instanceof HttpError) return response.status(error.status).json({ error: { code: error.code, message: error.message } })
  if (error.expose && error.status >= 400 && error.status < 500) return response.status(error.status).json({ error: { code: 'BAD_REQUEST', message: 'The request body is invalid or too large.' } })
  if (error instanceof mongoose.Error.ValidationError || error instanceof mongoose.Error.CastError) {
    return response.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request data.' } })
  }
  if (error.code === 11000 || error.hasErrorLabel?.('TransientTransactionError')) {
    return response.status(409).json({ error: { code: 'CONFLICT', message: 'The record changed. Refresh and retry.' } })
  }
  console.error('Request failed:', error.name, error.message)
  return response.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'The request could not be completed.' } })
}
