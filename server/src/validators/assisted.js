import { HttpError } from '../utils/httpError.js'

const fail = (message) => { throw new HttpError(400, 'VALIDATION_ERROR', message) }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const applicationId = /^APP-\d{4}-\d{6}$/

function body(request, fields) {
  const value = request.body
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !fields.includes(key))) fail('Unexpected assisted-intake fields.')
  return value
}

function words(value, label, min, max) {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) fail(`${label} must be ${min}-${max} characters.`)
  return value.trim()
}

function id(value, label) { if (typeof value !== 'string' || !uuid.test(value)) fail(`${label} must be a UUID.`) }
function choice(value, options, label) { if (!options.includes(value)) fail(`${label} is invalid.`) }
function boolean(value, label) { if (typeof value !== 'boolean') fail(`${label} must be explicit.`) }

export function assistedParam(request, _response, next) {
  if (!applicationId.test(request.params.applicationId)) fail('Application ID is invalid.')
  next()
}

export function validateAssistedCreate(request, _response, next) {
  const value = body(request, ['temporaryId', 'clientMutationId', 'offlineCreatedAt', 'applicantName', 'translatorName', 'typistName', 'helperPhone', 'originalLanguage', 'originalStatement', 'translatedStatement', 'caseType', 'consentAttestation', 'originalConfirmed', 'translationConfirmed', 'contactChannel', 'contactValue', 'safeTime', 'plaintiffName', 'defendantName', 'defendantRelationship'])
  id(value.temporaryId, 'Temporary ID')
  id(value.clientMutationId, 'Mutation ID')
  value.applicantName = words(value.applicantName, 'Applicant name', 2, 120)
  value.translatorName = words(value.translatorName, 'Translator name', 2, 120)
  value.typistName = words(value.typistName, 'Typist name', 2, 120)
  // Every complaint names the plaintiff (বাদী) and the defendant (বিবাদী).
  value.plaintiffName = words(value.plaintiffName, 'Plaintiff (Badi) name', 2, 120)
  value.defendantName = words(value.defendantName, 'Defendant (Bibadi) name', 2, 120)
  if (value.defendantRelationship !== undefined) value.defendantRelationship = words(value.defendantRelationship, 'Relationship to the defendant', 2, 80)
  value.originalLanguage = words(value.originalLanguage, 'Original language', 2, 60)
  value.originalStatement = words(value.originalStatement, 'Original statement', 5, 4000)
  value.translatedStatement = words(value.translatedStatement, 'Translated statement', 5, 4000)
  value.consentAttestation = words(value.consentAttestation, 'Oral consent attestation', 10, 500)
  choice(value.caseType, ['FAMILY', 'LAND', 'LABOUR', 'CRIMINAL', 'OTHER'], 'Case type')
  choice(value.contactChannel, ['IN_PERSON', 'PHONE'], 'Safe contact channel')
  boolean(value.originalConfirmed, 'Original confirmation')
  boolean(value.translationConfirmed, 'Translation confirmation')
  if (value.contactChannel === 'PHONE') {
    if (typeof value.contactValue !== 'string' || !/^\+?[0-9][0-9 -]{5,19}$/.test(value.contactValue.trim())) fail('Applicant phone is invalid.')
    value.contactValue = value.contactValue.trim()
  } else if (value.contactValue !== undefined) fail('A helper phone cannot become applicant contact.')
  if (value.helperPhone !== undefined) {
    if (typeof value.helperPhone !== 'string' || !/^\+?[0-9][0-9 -]{5,19}$/.test(value.helperPhone.trim())) fail('Helper phone is invalid.')
    value.helperPhone = value.helperPhone.trim()
  }
  if (value.safeTime !== undefined) value.safeTime = words(value.safeTime, 'Safe time', 2, 100)
  if (value.offlineCreatedAt !== undefined && (typeof value.offlineCreatedAt !== 'string' || Number.isNaN(Date.parse(value.offlineCreatedAt)))) fail('Offline creation time is invalid.')
  next()
}

export function validateAssistedRevision(request, _response, next) {
  const value = body(request, ['temporaryId', 'clientMutationId', 'baseVersion', 'originalStatement', 'translatedStatement', 'originalConfirmed', 'translationConfirmed'])
  id(value.temporaryId, 'Temporary ID')
  id(value.clientMutationId, 'Mutation ID')
  if (!Number.isSafeInteger(value.baseVersion) || value.baseVersion < 1) fail('Base version is invalid.')
  value.originalStatement = words(value.originalStatement, 'Original statement', 5, 4000)
  value.translatedStatement = words(value.translatedStatement, 'Translated statement', 5, 4000)
  boolean(value.originalConfirmed, 'Original confirmation')
  boolean(value.translationConfirmed, 'Translation confirmation')
  next()
}

export function validateConflictResolution(request, _response, next) {
  const value = body(request, ['temporaryId', 'clientMutationId', 'conflictMutationId', 'expectedVersion', 'choice', 'reason'])
  for (const key of ['temporaryId', 'clientMutationId', 'conflictMutationId']) id(value[key], key)
  if (!Number.isSafeInteger(value.expectedVersion) || value.expectedVersion < 1) fail('Expected version is invalid.')
  choice(value.choice, ['SERVER', 'LOCAL'], 'Resolution choice')
  value.reason = words(value.reason, 'Resolution reason', 10, 500)
  next()
}

// One Marma/original-language turn for the assisted intake: audio only, transcribed and discarded.
// No DB write happens here; the browser fills the Original-words draft and the translator must verify it.
const assistedAudioTypes = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/x-wav', 'video/webm']

export function validateAssistedAudio(request, _response, next) {
  if (Object.keys(request.query).length) fail('Unexpected parameter.')
  if (!assistedAudioTypes.includes((request.get('content-type') || '').split(';')[0].trim())) fail('Unsupported audio type.')
  if (!Buffer.isBuffer(request.body) || request.body.length < 500) fail('No audio was received.')
  next()
}
