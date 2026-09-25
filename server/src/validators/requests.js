import mongoose from 'mongoose'
import { HttpError } from '../utils/httpError.js'
import { promptKeys, TRANSCRIPT_HINTS } from '../services/spokenStatus.js'

const fail = (message) => { throw new HttpError(400, 'VALIDATION_ERROR', message) }
// A status code: 24 hex characters for staff-made records, or the 6-digit PIN a 16699 caller hears and can say back.
export const LOOKUP_CODE = /^(?:[a-f0-9]{24}|[0-9]{6})$/

function body(request, allowed, required = allowed) {
  const value = request.body
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('A JSON object is required.')
  if (Object.keys(value).some((key) => !allowed.includes(key)) || required.some((key) => !(key in value))) fail('Unexpected or missing fields.')
  return value
}

function text(value, label, min = 1, max = 4000) {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) fail(`${label} must be ${min}-${max} characters.`)
  return value.trim()
}

function objectId(value, label) {
  if (typeof value !== 'string' || !mongoose.isValidObjectId(value)) fail(`${label} is invalid.`)
  return value
}

export function validateLogin(request, _response, next) {
  const value = body(request, ['username', 'password'])
  value.username = text(value.username, 'Username', 3, 50).toLowerCase()
  if (!/^[a-z0-9._@+-]+$/.test(value.username)) fail('Username is invalid.')
  value.password = text(value.password, 'Password', 1, 256)
  next()
}

export function validateSubmission(request, _response, next) {
  const value = body(request, ['applicantName'])
  value.applicantName = text(value.applicantName, 'Applicant name', 2, 120)
  next()
}

export function validateAcceptance(request, _response, next) {
  const value = body(request, ['reason'])
  value.reason = text(value.reason, 'Human decision reason', 10, 1000)
  next()
}

export function validateReview(request, _response, next) {
  const value = body(request, ['reviewState', 'reason'])
  if (!['NEEDS_INFORMATION', 'READY_FOR_DECISION'].includes(value.reviewState)) fail('Review state is invalid.')
  value.reason = text(value.reason, 'Review reason', 10, 1000)
  next()
}

export function validateReviewOverride(request, _response, next) {
  const value = body(request, ['reviewState', 'reason'])
  if (!['PENDING_REVIEW', 'NEEDS_INFORMATION', 'READY_FOR_DECISION'].includes(value.reviewState)) fail('Review state is invalid.')
  value.reason = text(value.reason, 'Override reason', 10, 1000)
  next()
}

export function validatePriorityOverride(request, _response, next) {
  const value = body(request, ['priorityDecision', 'reason'])
  if (!['URGENT', 'ROUTINE'].includes(value.priorityDecision)) fail('Priority decision is invalid.')
  value.reason = text(value.reason, 'Human override reason', 10, 1000)
  next()
}

export function validateStatusLookup(request, _response, next) {
  const value = body(request, ['identifier', 'lookupCode', 'callerVerified', 'contactChannel'], ['identifier', 'lookupCode', 'callerVerified'])
  if (!/^((APP|CASE)-\d{4}-\d{6})$/.test(value.identifier)) fail('A valid Application or Case ID is required.')
  if (typeof value.lookupCode !== 'string' || !LOOKUP_CODE.test(value.lookupCode)) fail('A valid lookup code is required.')
  if (value.callerVerified !== true) fail('Human caller-verification attestation is required.')
  value.contactChannel ??= 'PHONE'
  if (!['PHONE', 'IN_PERSON'].includes(value.contactChannel)) fail('Status channel is invalid.')
  next()
}

// Public tracking needs the caller's own lookup code; a bare number is padded into an Application or Case ID.
export function validateTrackLookup(request, _response, next) {
  const value = body(request, ['identifier', 'lookupCode'])
  value.identifier = typeof value.identifier === 'string' ? value.identifier.trim().toUpperCase() : ''
  if (!/^(?:(?:APP|CASE)-\d{4}-\d{6}|\d{1,6})$/.test(value.identifier)) fail('Enter an Application ID or Case ID.')
  value.lookupCode = typeof value.lookupCode === 'string' ? value.lookupCode.trim().toLowerCase() : ''
  if (!LOOKUP_CODE.test(value.lookupCode)) fail('Enter the tracking code you received when you applied.')
  next()
}

export function validateSearch(request, _response, next) {
  if (Object.keys(request.query).some((key) => key !== 'identifier')) fail('Unexpected search parameter.')
  if (!/^((APP|CASE)-\d{4}-\d{6})$/.test(request.query.identifier || '')) fail('A valid Application or Case ID is required.')
  next()
}

export function validateWorkspace(request, _response, next) {
  if (Object.keys(request.query).some((key) => key !== 'role')) fail('Unexpected workspace parameter.')
  if (!['DLAO_OFFICER', 'MEDIATOR', 'HELPLINE_AGENT', 'UDC_OPERATOR', 'PANEL_LAWYER', 'RECEIVING_DLAO', 'CASE_SUPPORT', 'CLAO'].includes(request.query.role)) fail('A valid provider role is required.')
  next()
}

export function validateTask(request, _response, next) {
  const value = body(request, ['title', 'ownerRole', 'ownerUserId', 'nextAction', 'dueAt'], ['title', 'ownerRole', 'nextAction'])
  value.title = text(value.title, 'Task title', 3, 120)
  value.nextAction = text(value.nextAction, 'Next action', 5, 300)
  if (!['DLAO_OFFICER', 'MEDIATOR', 'HELPLINE_AGENT', 'UDC_OPERATOR', 'PANEL_LAWYER', 'RECEIVING_DLAO', 'CASE_SUPPORT', 'CLAO'].includes(value.ownerRole)) fail('Owner role is invalid.')
  if (value.ownerUserId !== undefined) objectId(value.ownerUserId, 'Owner user')
  if (value.dueAt !== undefined && (typeof value.dueAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value.dueAt) || Number.isNaN(Date.parse(value.dueAt)))) fail('Due date must be an ISO date-time.')
  next()
}

export function validateContactAttempt(request, _response, next) {
  const value = body(request, ['channel', 'outcome', 'reason'])
  if (!['PHONE', 'SMS', 'WEB', 'IN_PERSON'].includes(value.channel)) fail('Contact channel is invalid.')
  if (!['NO_ANSWER', 'UNKNOWN_PERSON', 'APPLICANT_REACHED', 'BLOCKED_UNSAFE'].includes(value.outcome)) fail('Contact outcome is invalid.')
  value.reason = text(value.reason, 'Contact outcome reason', 5, 500)
  next()
}

export function validateDocument(request, _response, next) {
  const value = body(request, ['label', 'qualityState', 'note', 'filename', 'textContent', 'checklistItem', 'sensitivity'], ['label', 'qualityState'])
  value.label = text(value.label, 'Document label', 3, 160)
  if (!['PENDING_REVIEW', 'READABLE', 'UNREADABLE'].includes(value.qualityState)) fail('Document quality state is invalid.')
  if (value.note !== undefined) value.note = text(value.note, 'Document note', 3, 500)
  if ((value.filename === undefined) !== (value.textContent === undefined)) fail('Text upload needs both filename and content.')
  if (value.filename !== undefined) {
    value.filename = text(value.filename, 'Filename', 5, 160)
    if (!/^[\w .()-]+\.txt$/i.test(value.filename)) fail('Only fictional .txt uploads are supported.')
    value.textContent = text(value.textContent, 'Document text', 1, 50000)
    if (Buffer.byteLength(value.textContent, 'utf8') > 50000) fail('Document text must not exceed 50 KB.')
  }
  if (value.checklistItem !== undefined) value.checklistItem = text(value.checklistItem, 'Checklist item', 3, 120)
  if (value.sensitivity !== undefined && (request.params.documentId || !['STANDARD', 'RESTRICTED'].includes(value.sensitivity))) fail('Sensitivity is set once, when the document is first recorded.')
  next()
}

const isoDate = (value, label) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && !Number.isNaN(Date.parse(value)) ? value : fail(`${label} must be an ISO date-time.`)

function idList(value, label) {
  if (!Array.isArray(value) || value.length > 20 || new Set(value).size !== value.length) fail(`${label} must be a list of up to 20 distinct IDs.`)
  for (const id of value) objectId(id, label)
}

export function validateReferral(request, _response, next) {
  const value = body(request, ['responsibleUserId', 'reason', 'history', 'expectedAction', 'dueAt', 'documentIds', 'sensitiveDocumentIds', 'sensitiveAccessReason'],
    ['responsibleUserId', 'reason', 'history', 'expectedAction', 'dueAt', 'documentIds', 'sensitiveDocumentIds'])
  objectId(value.responsibleUserId, 'Responsible receiving actor')
  value.reason = text(value.reason, 'Referral reason', 10, 1000)
  value.history = text(value.history, 'Relevant history', 10, 2000)
  value.expectedAction = text(value.expectedAction, 'Expected action', 5, 300)
  if (Date.parse(isoDate(value.dueAt, 'Acknowledgement deadline')) <= Date.now()) fail('Acknowledgement deadline must be in the future.')
  idList(value.documentIds, 'Documents')
  idList(value.sensitiveDocumentIds, 'Restricted evidence')
  if (value.sensitiveDocumentIds.length) value.sensitiveAccessReason = text(value.sensitiveAccessReason, 'Reason restricted evidence must be shared', 10, 500)
  else if (value.sensitiveAccessReason !== undefined) fail('A sharing reason applies only when restricted evidence is included.')
  next()
}

export function validateReferralResponse(request, _response, next) {
  const value = body(request, ['action', 'reason'], ['action'])
  if (!['ACKNOWLEDGE', 'ACCEPT', 'RETURN'].includes(value.action)) fail('Referral response is invalid.')
  if (value.action !== 'ACKNOWLEDGE' || value.reason !== undefined) value.reason = text(value.reason, 'Response reason', 10, 1000)
  next()
}

export function validateRoutingDecision(request, _response, next) {
  const value = body(request, ['route', 'officeCode', 'reason'], ['route', 'reason'])
  if (!['RETAIN', 'REFER'].includes(value.route)) fail('Route is invalid.')
  if (value.route === 'REFER' ? !/^[A-Z0-9-]{2,40}$/.test(value.officeCode || '') : value.officeCode !== undefined) fail('A referral route needs one office code; retaining needs none.')
  value.reason = text(value.reason, 'Routing decision reason', 10, 1000)
  next()
}

export function referralIdParam(request, _response, next) {
  objectId(request.params.referralId, 'Referral ID')
  next()
}

export function validateBriefingApproval(request, _response, next) {
  const value = body(request, ['reason'])
  value.reason = text(value.reason, 'Officer briefing verification reason', 10, 500)
  next()
}

export function taskIdParam(request, _response, next) {
  objectId(request.params.taskId, 'Task ID')
  next()
}

export function validateRepresentation(request, _response, next) {
  const value = body(request, ['representativeName', 'relationship', 'scope'])
  value.representativeName = text(value.representativeName, 'Representative name', 2, 120)
  value.relationship = text(value.relationship, 'Relationship', 2, 80)
  value.scope = text(value.scope, 'Scope', 2, 250)
  next()
}

export function validateFact(request, _response, next) {
  const value = body(request, ['field', 'value', 'sourceType', 'sourcePersonId'], ['field', 'value', 'sourceType'])
  value.field = text(value.field, 'Field', 1, 80)
  if (!/^[a-z][a-z0-9_.]*$/.test(value.field)) fail('Field is invalid.')
  value.value = text(value.value, 'Fact', 1, 4000)
  if (!['REPRESENTATIVE_REPORTED', 'APPLICANT_REPORTED', 'STAFF_ENTERED'].includes(value.sourceType)) fail('Source type is invalid.')
  if (value.sourceType !== 'STAFF_ENTERED') objectId(value.sourcePersonId, 'Source person')
  if (value.sourceType === 'STAFF_ENTERED' && value.sourcePersonId !== undefined) fail('Staff-entered facts cannot claim a citizen source.')
  next()
}

export function validateCorrection(request, _response, next) {
  const value = body(request, ['value', 'attestation'])
  value.value = text(value.value, 'Correction', 1, 4000)
  value.attestation = text(value.attestation, 'Applicant confirmation attestation', 10, 500)
  next()
}

export function validateSafeContact(request, _response, next) {
  const value = body(request,
    ['allowedChannels', 'prohibitedChannels', 'contactValue', 'safeTimeWindow', 'smsSafe', 'neutralWordingRequired'],
    ['allowedChannels', 'prohibitedChannels', 'smsSafe', 'neutralWordingRequired'])
  const allowed = ['PHONE', 'SMS', 'WEB', 'IN_PERSON']
  for (const field of ['allowedChannels', 'prohibitedChannels']) {
    if (!Array.isArray(value[field]) || value[field].some((item) => !allowed.includes(item)) || new Set(value[field]).size !== value[field].length) fail(`${field} is invalid.`)
  }
  if (!value.allowedChannels.length || value.allowedChannels.some((item) => value.prohibitedChannels.includes(item))) fail('Safe and prohibited channels conflict.')
  if (typeof value.smsSafe !== 'boolean' || typeof value.neutralWordingRequired !== 'boolean') fail('Contact safety choices must be explicit.')
  if (value.smsSafe && !value.allowedChannels.includes('SMS')) fail('SMS must be an allowed channel.')
  if (value.contactValue !== undefined) value.contactValue = text(value.contactValue, 'Safe contact', 3, 100)
  if (value.safeTimeWindow !== undefined) value.safeTimeWindow = text(value.safeTimeWindow, 'Safe time window', 2, 100)
  next()
}

export function validateConsent(request, _response, next) {
  const value = body(request, ['scope', 'state', 'attestation'])
  if (!['LIVE_VOICE', 'AUDIO_STORAGE', 'TRANSCRIPT_STORAGE', 'STRUCTURED_FACTS', 'ASSISTED_INTAKE', 'CONTACT'].includes(value.scope)) fail('Consent scope is invalid.')
  if (!['GRANTED', 'DENIED', 'WITHDRAWN'].includes(value.state)) fail('Consent state is invalid.')
  value.attestation = text(value.attestation, 'Consent attestation', 10, 500)
  next()
}

const oneOf = (options, label) => (value) => options.includes(value) ? value : fail(`${label} is invalid.`)
const explicit = (label) => (value) => typeof value === 'boolean' ? value : fail(`${label} must be explicit.`)
const phoneNumber = (label) => (value) => typeof value === 'string' && /^\+?[0-9][0-9 -]{5,19}$/.test(value.trim()) ? value.trim() : fail(`${label} is invalid.`)
const voiceAnswers = {
  service: oneOf(['COMPLAINT', 'ADVICE'], 'Service'), // asked on the call; the intake carries it as `mode`
  adviceTopic: (value) => text(value, 'Advice question', 5, 2000),
  callerRole: oneOf(['SELF', 'REPRESENTATIVE'], 'Caller role'),
  callerName: (value) => text(value, 'Caller name', 2, 120),
  relationship: (value) => text(value, 'Relationship', 2, 80),
  applicantName: (value) => text(value, 'Applicant name', 2, 120),
  district: (value) => text(value, 'District', 2, 60),
  nidKnown: explicit('NID known'),
  // Format only: a 10, 13, or 17 digit NID. Nothing here checks it against any identity register.
  nid: (value) => typeof value === 'string' && /^(?:[0-9]{10}|[0-9]{13}|[0-9]{17})$/.test(value) ? value : fail('NID number must be 10, 13, or 17 digits.'),
  problem: (value) => text(value, 'Problem', 5, 2000),
  urgent: (value) => value === 'UNKNOWN' ? value : explicit('Safety risk')(value),
  contactChannel: oneOf(['PHONE', 'UDC', 'TRUSTED_PERSON'], 'Safe contact route'),
  contactValue: phoneNumber('Safe phone number'),
  trustedPerson: (value) => text(value, 'Trusted person', 2, 160),
  trustedPhone: phoneNumber('Trusted person’s number'),
  safeTime: (value) => text(value, 'Safe time', 2, 100),
}

// Mirrors the client script's active questions; the server still decides provenance itself.
function voiceFields({ mode, answers }) {
  if (mode === 'ADVICE') return ['adviceTopic', 'contactValue', 'safeTime']
  const representative = answers.callerRole === 'REPRESENTATIVE'
  return ['callerRole', 'callerName', ...(representative ? ['relationship', 'applicantName'] : []), 'district', 'nidKnown',
    ...(answers.nidKnown === true ? ['nid'] : []), 'problem', 'urgent', 'contactChannel',
    ...(answers.contactChannel === 'PHONE' ? ['contactValue'] : []),
    ...(answers.contactChannel === 'TRUSTED_PERSON' ? ['trustedPerson', 'trustedPhone'] : []), 'safeTime']
}

// A helpline callback outcome. Formal legal aid needs the applicant's name and district; the NID is optional.
export function validateAdviceOutcome(request, _response, next) {
  const value = body(request, ['outcome', 'guidance', 'applicantName', 'district', 'nid'], ['outcome', 'guidance'])
  oneOf(['INFORMATION_PROVIDED', 'FORMAL_ASSISTANCE'], 'Outcome')(value.outcome)
  value.guidance = text(value.guidance, 'Guidance given', 10, 2000)
  if (value.outcome === 'FORMAL_ASSISTANCE') {
    value.applicantName = voiceAnswers.applicantName(value.applicantName)
    value.district = voiceAnswers.district(value.district)
    if (value.nid !== undefined) value.nid = voiceAnswers.nid(value.nid)
  } else if (['applicantName', 'district', 'nid'].some((key) => value[key] !== undefined)) fail('Applicant details are recorded only for formal legal aid.')
  next()
}

export function validateEmptyBody(request, _response, next) {
  if (request.body !== undefined && (typeof request.body !== 'object' || Object.keys(request.body).length)) fail('This request takes no body.')
  next()
}

const audioTypes = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/x-wav', 'video/webm']

export function validateAnswerAudio(request, _response, next) {
  if (Object.keys(request.query).some((key) => key !== 'fields')) fail('Unexpected parameter.')
  const fields = String(request.query.fields || '').split(',')
  // `confirm` is the caller's yes/no to a read-back: their spoken number, or the whole application before submitting.
  if (!fields.length || fields.some((field) => !voiceAnswers[field] && field !== 'confirm') || new Set(fields).size !== fields.length) fail('Unknown question.')
  if (!audioTypes.includes((request.get('content-type') || '').split(';')[0].trim())) fail('Unsupported audio type.')
  if (!Buffer.isBuffer(request.body) || request.body.length < 500) fail('No audio was received.')
  next()
}

// One turn of the spoken status call: audio only, transcribed and discarded, optionally primed with a named hint.
export function validateSpeechAudio(request, _response, next) {
  const keys = Object.keys(request.query)
  if (keys.some((key) => key !== 'hint') || (keys.length && !Object.hasOwn(TRANSCRIPT_HINTS, request.query.hint))) fail('Unexpected parameter.')
  if (!audioTypes.includes((request.get('content-type') || '').split(';')[0].trim())) fail('Unsupported audio type.')
  if (!Buffer.isBuffer(request.body) || request.body.length < 500) fail('No audio was received.')
  next()
}

// The transcript of one opening turn, to be read for a status request; a transcript is short, so a long body is refused.
export function validateSpokenRequest(request, _response, next) {
  const value = body(request, ['text'])
  value.text = text(value.text, 'Text', 1, 500)
  next()
}

// Only a fixed prompt can be spoken; the one variable is a read-back number, and it must be digits only.
export function validateVoicePrompt(request, _response, next) {
  const value = body(request, ['key', 'digits'], ['key'])
  if (!promptKeys.includes(value.key)) fail('Unknown prompt.')
  if ((value.key === 'confirmNumber') !== ('digits' in value)) fail('Unexpected or missing fields.')
  if ('digits' in value && !/^[0-9]{1,10}$/.test(value.digits)) fail('Digits are invalid.')
  next()
}

export function validateCallRecording(request, _response, next) {
  if (Object.keys(request.query).length) fail('Unexpected parameter.')
  if (!LOOKUP_CODE.test(request.get('x-lookup-code') || '')) fail('Status code is invalid.')
  const type = (request.get('content-type') || '').split(';')[0].trim()
  if (!audioTypes.includes(type)) fail('Unsupported audio type.')
  if (!Buffer.isBuffer(request.body) || request.body.length < 500) fail('No audio was received.')
  request.audioType = type
  next()
}

export function validateVoiceIntake(request, _response, next) {
  const value = body(request, ['mode', 'answers', 'correctedFields', 'aiFields', 'confirmation', 'transcript', 'aiSensitive'], ['mode', 'answers'])
  // A complaint (INTAKE) or an information/advice request (ADVICE); a reported danger no longer cuts the intake short.
  oneOf(['INTAKE', 'ADVICE'], 'Mode')(value.mode)
  if (!value.answers || typeof value.answers !== 'object' || Array.isArray(value.answers)) fail('answers must be an object.')
  const fields = voiceFields(value)
  const keys = Object.keys(value.answers)
  if (keys.length !== fields.length || keys.some((key) => !fields.includes(key))) fail('Unexpected or missing answers.')
  for (const field of fields) value.answers[field] = voiceAnswers[field](value.answers[field])
  for (const list of ['correctedFields', 'aiFields']) {
    if (value[list] !== undefined && (!Array.isArray(value[list]) || value[list].some((field) => !fields.includes(field)) || new Set(value[list]).size !== value[list].length)) fail(`${list} is invalid.`)
  }
  if (value.confirmation !== undefined) oneOf(['BUTTON', 'VOICE'], 'Confirmation')(value.confirmation)
  if (value.aiSensitive !== undefined) explicit('Sensitivity flag')(value.aiSensitive)
  if (value.transcript !== undefined) {
    // Kept with the call recording under the greeting's notice. Audio never travels inside this JSON body.
    if (!Array.isArray(value.transcript) || !value.transcript.length || value.transcript.length > 300) fail('Transcript is invalid.')
    value.transcript = value.transcript.map((turn) => {
      if (!turn || typeof turn !== 'object' || Object.keys(turn).some((key) => !['speaker', 'text'].includes(key))) fail('Transcript is invalid.')
      return { speaker: oneOf(['CALLER', 'ASSISTANT'], 'Transcript speaker')(turn.speaker), text: text(turn.text, 'Transcript text', 1, 2000) }
    })
  }
  next()
}

export function applicationIdParam(request, _response, next) {
  if (!/^APP-\d{4}-\d{6}$/.test(request.params.applicationId)) fail('Application ID is invalid.')
  next()
}

export function caseIdParam(request, _response, next) {
  if (!/^CASE-\d{4}-\d{6}$/.test(request.params.caseId)) fail('Case ID is invalid.')
  next()
}

export function factIdParam(request, _response, next) {
  objectId(request.params.factId, 'Fact ID')
  next()
}

export function documentIdParam(request, _response, next) {
  objectId(request.params.documentId, 'Document ID')
  next()
}

export function documentVersionParam(request, _response, next) {
  if (!/^[1-9][0-9]{0,5}$/.test(request.params.version)) fail('Document version is invalid.')
  next()
}
