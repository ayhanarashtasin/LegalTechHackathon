import { HttpError } from '../utils/httpError.js'
import { settlementTemplates } from '../services/settlementTemplates.js'

const fail = (message) => { throw new HttpError(400, 'VALIDATION_ERROR', message) }
const body = (request, allowed, required = allowed) => {
  const value = request.body
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !allowed.includes(key)) || required.some((key) => !(key in value))) fail('Request fields are invalid.')
  return value
}
const text = (value, label, min, max) => {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) fail(`${label} must be ${min}-${max} characters.`)
  return value.trim()
}
const date = (value, label) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value) || Number.isNaN(Date.parse(value))) fail(`${label} must be an ISO date-time.`)
  return value
}
export function validateEmptyMediationBody(request, _response, next) {
  body(request, [])
  next()
}

export function validateScheduling(request, _response, next) {
  const value = body(request, ['mode', 'scheduledAt', 'venue', 'inPersonFallback', 'notices', 'sessionType', 'language', 'participants'], ['mode', 'scheduledAt', 'notices'])
  if (!['IN_PERSON', 'REMOTE', 'HYBRID'].includes(value.mode)) fail('Choose in-person, remote, or hybrid mediation.')
  date(value.scheduledAt, 'Scheduled time')
  if (Date.parse(value.scheduledAt) <= Date.now()) fail('Scheduled time must be in the future.')
  if (value.mode === 'IN_PERSON') value.venue = text(value.venue, 'In-person location', 3, 200)
  else value.inPersonFallback = text(value.inPersonFallback, 'In-person fallback plan', 10, 300)
  if (value.sessionType && !['JOINT', 'SEPARATE_APPLICANT', 'SEPARATE_RESPONDENT'].includes(value.sessionType)) fail('Session type is invalid.')
  if (value.language && (typeof value.language !== 'string' || value.language.trim().length > 100)) fail('Language is invalid.')
  if (value.participants && (!Array.isArray(value.participants) || value.participants.some((p) => typeof p !== 'string' || p.length > 200))) fail('Participants must be an array of strings.')
  if (!Array.isArray(value.notices) || value.notices.length !== 2) fail('Record a delivery outcome for each party.')
  const parties = new Set()
  value.notices = value.notices.map((notice) => {
    if (!notice || !['PARTY_A', 'PARTY_B'].includes(notice.party) || !['DELIVERED', 'NOT_DELIVERED'].includes(notice.deliveryState) || Object.keys(notice).some((key) => !['party', 'deliveryState', 'reason'].includes(key))) fail('Notice records are invalid.')
    if (parties.has(notice.party)) fail('Record each party notice once.')
    parties.add(notice.party)
    return { party: notice.party, deliveryState: notice.deliveryState, reason: text(notice.reason, 'Notice record reason', 10, 300) }
  })
  if (parties.size !== 2) fail('Record both Party A and Party B.')
  next()
}

export function validateMediatorAppointment(request, _response, next) {
  const value = body(request, ['mediatorUserId', 'reason'], [])
  if (value.mediatorUserId !== undefined && value.mediatorUserId !== null && (typeof value.mediatorUserId !== 'string' || !/^[a-f0-9]{24}$/i.test(value.mediatorUserId))) fail('Choose a mediator.')
  request.body = { mediatorUserId: value.mediatorUserId || null, ...(typeof value.reason === 'string' && value.reason.trim() ? { reason: text(value.reason, 'Reason', 5, 500) } : {}) }
  next()
}

export function validateReason(request, _response, next) {
  request.body = { reason: text(body(request, ['reason']).reason, 'Reason', 10, 500) }
  next()
}

export function validateAttendance(request, _response, next) {
  const value = body(request, ['partyA', 'partyB', 'reason'])
  if (!['ATTENDED', 'REPRESENTED', 'ABSENT'].includes(value.partyA) || !['ATTENDED', 'REPRESENTED', 'ABSENT'].includes(value.partyB)) fail('Attendance status is invalid.')
  value.reason = text(value.reason, 'Attendance record reason', 10, 500)
  next()
}

export function validateOutcome(request, _response, next) {
  const value = body(request, ['outcome', 'reason'])
  if (!['AGREEMENT_REACHED', 'NO_AGREEMENT', 'CONTINUED'].includes(value.outcome)) fail('Mediation outcome is invalid.')
  value.reason = text(value.reason, 'Outcome reason', 10, 1000)
  next()
}

export function validateSettlementDraft(request, _response, next) {
  const value = body(request, ['template', 'notes', 'identifiersRemoved', 'followUpDate'], ['template', 'notes', 'identifiersRemoved'])
  if (typeof value.template !== 'string' || !Object.hasOwn(settlementTemplates, value.template)) fail('Choose a maintenance, property, or labour template.')
  value.notes = text(value.notes, 'Anonymised mediator notes', 10, 3000)
  if (value.identifiersRemoved !== true) fail('Confirm that direct identifiers have been removed before AI drafting.')
  if (value.followUpDate && Number.isNaN(Date.parse(value.followUpDate))) fail('Follow-up date is invalid.')
  next()
}

export function validateSettlementReview(request, _response, next) {
  const value = body(request, ['partyAUnderstands', 'partyAConsents', 'partyBUnderstands', 'partyBConsents', 'warningsReviewed', 'reason'], ['partyAUnderstands', 'partyAConsents', 'partyBUnderstands', 'partyBConsents', 'reason'])
  for (const field of ['partyAUnderstands', 'partyAConsents', 'partyBUnderstands', 'partyBConsents']) if (typeof value[field] !== 'boolean') fail('Record each party understanding and consent as yes or no.')
  if (value.warningsReviewed !== undefined && typeof value.warningsReviewed !== 'boolean') fail('Warning review must be yes or no.')
  value.reason = text(value.reason, 'Mediator review reason', 10, 1000)
  next()
}

export function validateSettlementAmendment(request, _response, next) {
  const value = body(request, ['template', 'sections', 'reason', 'followUpDate'], ['template', 'sections', 'reason'])
  const keys = typeof value.template === 'string' && Object.hasOwn(settlementTemplates, value.template)
    ? settlementTemplates[value.template].fields.map(([key]) => key) : null
  if (!keys || !Array.isArray(value.sections) || value.sections.length !== keys.length) fail('Draft sections do not match a supported template.')
  value.sections = value.sections.map((section, index) => {
    if (!section || Object.keys(section).some((key) => !['key', 'text'].includes(key)) || section.key !== keys[index]) fail('Only template-defined sections may be amended, in their original order.')
    return { key: section.key, text: text(section.text, 'Draft section', 1, 500) }
  })
  value.reason = text(value.reason, 'Amendment reason', 10, 1000)
  if (value.followUpDate && Number.isNaN(Date.parse(value.followUpDate))) fail('Follow-up date is invalid.')
  next()
}

export function validateSafetyConsent(request, _response, next) {
  const value = body(request, [
    'safeForApplicant', 'applicantAgreed', 'applicantAvailable', 'oppositePartyWilling', 'status', 'reason',
    'isSafe', 'decision', 'notes',
  ], [])
  const status = value.status || value.decision
  if (!status || !['CONSENT_CONFIRMED', 'NOT_SAFE', 'CONSENT_PENDING'].includes(status)) fail('Status must be CONSENT_CONFIRMED, NOT_SAFE, or CONSENT_PENDING.')
  // A person answers every question; nothing defaults to "safe".
  const answers = {
    safeForApplicant: value.safeForApplicant ?? value.isSafe,
    applicantAgreed: value.applicantAgreed,
    applicantAvailable: value.applicantAvailable,
    oppositePartyWilling: value.oppositePartyWilling,
  }
  if (Object.values(answers).some((answer) => typeof answer !== 'boolean')) fail('Answer each of the four safety and consent questions.')
  if (status === 'CONSENT_CONFIRMED' && Object.values(answers).some((answer) => !answer)) fail('Confirm consent only when all four safety and consent checks are true.')
  request.body = { ...answers, status, reason: text(value.reason ?? value.notes, 'Safety and consent note', 10, 500) }
  next()
}

export function validateSessionDetails(request, _response, next) {
  const value = body(request, [
    'applicantComplaint', 'applicantRequestedSolution', 'applicantStatements',
    'oppositePartyResponse', 'oppositePartyPosition', 'oppositePartyProposedSolution',
    'issuesDiscussed', 'proposedSolutions', 'mediatorNotes', 'sessionNotes',
  ], [])
  request.body = {
    ...value,
    mediatorNotes: value.mediatorNotes || value.sessionNotes || '',
    issuesDiscussed: typeof value.issuesDiscussed === 'string' ? [value.issuesDiscussed] : value.issuesDiscussed,
    proposedSolutions: typeof value.proposedSolutions === 'string' ? [value.proposedSolutions] : value.proposedSolutions,
  }
  next()
}

export function validateSettlementTerms(request, _response, next) {
  const value = body(request, ['terms'], ['terms'])
  if (!Array.isArray(value.terms)) fail('Terms must be an array.')
  request.body.terms = value.terms.map((item) => {
    if (!item.issue || typeof item.issue !== 'string') fail('Each term requires an issue.')
    if (item.status && !['AGREED', 'DISAGREED', 'UNDER_NEGOTIATION'].includes(item.status)) fail('Term status is invalid.')
    return {
      issue: item.issue,
      applicantAsks: item.applicantAsks || item.applicantDemand || '',
      oppositePartyOffers: item.oppositePartyOffers || item.oppositePartyOffer || '',
      agreedTerm: item.agreedTerm || '',
      status: item.status || 'UNDER_NEGOTIATION',
    }
  })
  next()
}

export function validateFollowUp(request, _response, next) {
  const value = body(request, [
    'dueDate', 'settlementFollowed', 'paymentStatus', 'agreementComplied', 'complianceStatus',
    'furtherAssistanceRequired', 'actionTaken', 'action', 'notes', 'reason',
  ], [])
  const actionTaken = value.actionTaken || (value.action === 'CLOSE_CASE' ? 'CLOSED' : value.action === 'REOPEN_REFERRAL' ? 'REOPENED_REFERRED' : value.action) || 'KEEP_MONITORING'
  if (!['CLOSED', 'REOPENED_REFERRED', 'KEEP_MONITORING'].includes(actionTaken)) fail('Action taken is invalid.')
  if (value.dueDate && Number.isNaN(Date.parse(value.dueDate))) fail('Due date is invalid.')
  request.body = {
    dueDate: value.dueDate,
    settlementFollowed: value.settlementFollowed,
    paymentStatus: value.paymentStatus,
    agreementComplied: value.agreementComplied ?? (value.complianceStatus === 'COMPLIED'),
    furtherAssistanceRequired: typeof value.furtherAssistanceRequired === 'boolean' ? (value.furtherAssistanceRequired ? 'Yes' : 'No') : value.furtherAssistanceRequired,
    actionTaken,
    notes: text(value.notes ?? value.reason ?? '', actionTaken === 'CLOSED' ? 'Case closure reason' : 'Follow-up note', 10, 1000),
  }
  next()
}

export function validateClaoReturn(request, _response, next) {
  const value = body(request, ['reason'], ['reason'])
  value.reason = text(value.reason, 'Correction reason', 5, 1000)
  next()
}

export function validateSignature(request, _response, next) {
  const value = body(request, ['signerRole', 'draftVersion', 'documentHash', 'publicKeyJwk', 'signature', 'clientMutationId', 'clientSignedAt'])
  checkSignature(value)
  next()
}

function checkSignature(value, roles = ['PARTY_A', 'PARTY_B', 'MEDIATOR']) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Signature is invalid.')
  if (!roles.includes(value.signerRole)) fail('Signer role is invalid.')
  if (!Number.isSafeInteger(value.draftVersion) || value.draftVersion < 1) fail('Draft version is invalid.')
  if (typeof value.documentHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.documentHash)) fail('Document digest is invalid.')
  const jwk = value.publicKeyJwk
  if (!jwk || typeof jwk !== 'object' || Array.isArray(jwk) || Object.keys(jwk).some((key) => !['kty', 'crv', 'x', 'y', 'key_ops', 'ext'].includes(key)) || jwk.kty !== 'EC' || jwk.crv !== 'P-256' || typeof jwk.x !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(jwk.x) || typeof jwk.y !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(jwk.y) || (jwk.key_ops && (!Array.isArray(jwk.key_ops) || !jwk.key_ops.includes('verify')))) fail('Only a P-256 public verification key is accepted.')
  if (typeof value.signature !== 'string' || !/^[A-Za-z0-9_-]{86}$/.test(value.signature)) fail('Signature encoding is invalid.')
  if (typeof value.clientMutationId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.clientMutationId)) fail('Offline mutation ID must be a UUID.')
  date(value.clientSignedAt, 'Device-reported signing time')
}

export function validateSigningCode(request, _response, next) {
  const value = body(request, ['code'])
  if (typeof value.code !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value.code)) fail('Signing code is invalid.')
  next()
}

export function validatePartySignature(request, _response, next) {
  const value = body(request, ['code', 'signerRole', 'draftVersion', 'documentHash', 'publicKeyJwk', 'signature', 'clientMutationId', 'clientSignedAt', 'partyConfirmed'])
  if (typeof value.code !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value.code)) fail('Signing code is invalid.')
  checkSignature(value)
  if (!['PARTY_A', 'PARTY_B'].includes(value.signerRole)) fail('A party signing code is required.')
  if (value.partyConfirmed !== true) fail('The party must confirm the exact document before signing.')
  next()
}

export function validateSigningInvitation(request, _response, next) {
  const value = body(request, ['signerRole'])
  if (!['PARTY_A', 'PARTY_B'].includes(value.signerRole)) fail('Choose Party A or Party B.')
  next()
}

export function validateVerificationBody(request, _response, next) {
  body(request, [])
  next()
}

export function validateLegalApplicability(request, _response, next) {
  const value = body(request, ['applicability', 'basis'], ['applicability'])
  if (!['UNVERIFIED', 'APPLICABLE_VERIFIED'].includes(value.applicability)) fail('Legal applicability status is invalid.')
  if (value.applicability === 'APPLICABLE_VERIFIED') value.basis = text(value.basis, 'Authorised legal basis', 10, 500)
  else if (value.basis !== undefined) fail('Do not attach a legal basis while applicability remains unverified.')
  next()
}

// The CLAO signs the same settlement document the parties and mediator signed; the reason stays in the audit history.
export function validateCertification(request, _response, next) {
  const value = body(request, ['reason', 'signature'])
  value.reason = text(value.reason, 'CLAO certification reason', 10, 500)
  checkSignature(value.signature, ['CLAO'])
  if (Object.keys(value.signature).some((key) => !['signerRole', 'draftVersion', 'documentHash', 'publicKeyJwk', 'signature', 'clientMutationId', 'clientSignedAt'].includes(key))) fail('Signature fields are invalid.')
  next()
}
