import mongoose from 'mongoose'
import {
  Application, Case, CaseFact, Document, DocumentVersion, DuplicateReview, Person, RelatedIncidentGroup,
} from '../models/index.js'
import { hasOfficeRole } from '../middleware/auth.js'
import { HttpError } from '../utils/httpError.js'
import { advance, officeApplication } from './applicationService.js'
import { appendAudit } from './auditService.js'

const factFields = ['contact.phone', 'person.date_of_birth', 'location.district']
const matchFields = [
  ['name', 'Name'], ['contact.phone', 'Contact number'], ['person.date_of_birth', 'Date of birth'], ['location.district', 'District'],
]

const canReadIncidentGroup = (actor, officeCode) => hasOfficeRole(actor, 'DLAO_OFFICER', officeCode)
  || hasOfficeRole(actor, 'CASE_SUPPORT', officeCode)

const normalized = (value) => String(value ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('en').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ')

function nameSimilarity(left, right) {
  const a = normalized(left)
  const b = normalized(right)
  if (!a || !b) return 0
  if (a === b) return 1
  const grams = (value) => {
    const compact = value.replace(/\s/g, '')
    return new Set(compact.length < 2 ? compact : Array.from({ length: compact.length - 1 }, (_, index) => compact.slice(index, index + 2)))
  }
  const leftGrams = grams(a)
  const rightGrams = grams(b)
  const shared = [...leftGrams].filter((item) => rightGrams.has(item)).length
  const dice = (2 * shared) / (leftGrams.size + rightGrams.size)
  const leftTokens = new Set(a.split(' '))
  const rightTokens = new Set(b.split(' '))
  const token = [...leftTokens].filter((item) => rightTokens.has(item)).length / new Set([...leftTokens, ...rightTokens]).size
  return Math.max(dice, token)
}

function compare(current, candidate) {
  const nameScore = nameSimilarity(current.name, candidate.name)
  const phoneA = String(current['contact.phone'] ?? '').replace(/\D/g, '')
  const phoneB = String(candidate['contact.phone'] ?? '').replace(/\D/g, '')
  const phoneMatch = phoneA.length >= 7 && phoneA === phoneB
  const dobMatch = normalized(current['person.date_of_birth']) === normalized(candidate['person.date_of_birth']) && Boolean(current['person.date_of_birth'])
  const districtMatch = normalized(current['location.district']) === normalized(candidate['location.district']) && Boolean(current['location.district'])
  const score = Math.round(nameScore * 50 + (phoneMatch ? 25 : 0) + (dobMatch ? 20 : 0) + (districtMatch ? 5 : 0))
  const matchingAttributes = []
  if (nameScore === 1) matchingAttributes.push('Name matches exactly')
  else if (nameScore >= 0.5) matchingAttributes.push(`Name is similar (${Math.round(nameScore * 100)}%)`)
  if (phoneMatch) matchingAttributes.push('Contact number matches exactly')
  if (dobMatch) matchingAttributes.push('Date of birth matches exactly')
  if (districtMatch) matchingAttributes.push('District matches')
  const differingAttributes = []
  if (current.name && candidate.name && nameScore < 1) differingAttributes.push('Name')
  for (const field of factFields) if (current[field] && candidate[field] && normalized(current[field]) !== normalized(candidate[field])) {
    differingAttributes.push(matchFields.find(([key]) => key === field)[1])
  }
  const attributes = matchFields.map(([key, label]) => {
    const currentValue = current[key] ?? null
    const candidateValue = candidate[key] ?? null
    const equal = key === 'name' ? nameScore === 1 : key === 'contact.phone' ? phoneMatch : normalized(currentValue) === normalized(candidateValue) && Boolean(currentValue)
    return { label, currentValue, candidateValue, comparison: !currentValue || !candidateValue ? 'NOT_RECORDED' : equal ? 'MATCH' : key === 'name' && nameScore >= 0.5 ? 'SIMILAR' : 'DIFFERENT' }
  })
  return { score, matchingAttributes, differingAttributes, attributes }
}

async function profilesFor(applications, session) {
  const applicationIds = applications.map(({ applicationId }) => applicationId)
  const personIds = applications.map(({ applicantPersonId }) => applicantPersonId)
  const [people, facts] = await Promise.all([
    Person.find({ _id: { $in: personIds } }).select('displayName').session(session).lean(),
    CaseFact.find({ applicationId: { $in: applicationIds }, field: { $in: factFields } }).sort({ revision: -1 }).select('applicationId field value revision').session(session).lean(),
  ])
  const names = new Map(people.map(({ _id, displayName }) => [_id.toString(), displayName]))
  const result = new Map(applications.map((application) => [application.applicationId, { name: names.get(application.applicantPersonId.toString()) ?? 'Unavailable' }]))
  const seen = new Set()
  for (const fact of facts) {
    const key = `${fact.applicationId}|${fact.field}`
    if (!seen.has(key)) {
      const profile = result.get(fact.applicationId)
      if (profile) profile[fact.field] = fact.value
      seen.add(key)
    }
  }
  return result
}

function pairIds(first, second) {
  return [first, second].sort()
}

async function auditApplication(application, session, action, newState, reason, actorUserId) {
  const updated = await advance(application, session)
  await appendAudit({
    applicationId: updated.applicationId, caseId: updated.caseId,
    sequence: updated.auditSequence, action, actorUserId, actorRole: 'DLAO_OFFICER', channel: 'DLAO',
    previousState: null, newState, reason,
  }, session)
  return updated
}

export async function getDuplicateCandidates(applicationId, actor) {
  const application = await Application.findOne({ applicationId }).lean()
  if (!application) throw new HttpError(404, 'NOT_FOUND', 'Application not found.')
  const canReview = hasOfficeRole(actor, 'DLAO_OFFICER', application.officeCode)
  const canRead = canReview || hasOfficeRole(actor, 'CASE_SUPPORT', application.officeCode)
  if (!canRead) throw new HttpError(403, 'FORBIDDEN', 'This office cannot view duplicate suggestions.')
  // ponytail: newest 100 same-office applications bound the prototype comparison; add paging for larger offices.
  const candidates = await Application.find({ officeCode: application.officeCode, applicationId: { $ne: applicationId }, service: { $ne: 'ADVICE' } })
    .sort({ createdAt: -1 }).limit(100).lean()
  const current = await Application.findOne({ applicationId }).lean()
  const all = [current, ...candidates]
  const profiles = await profilesFor(all)
  const source = profiles.get(applicationId)
  const comparisons = candidates.map((candidate) => {
    const result = compare(source, profiles.get(candidate.applicationId))
    return { applicationId: candidate.applicationId, caseId: candidate.caseId ?? null,
      applicantName: profiles.get(candidate.applicationId).name, ...result }
  }).filter(({ score }) => score >= 30).sort((a, b) => b.score - a.score || a.applicationId.localeCompare(b.applicationId))
  const reviews = await DuplicateReview.find({ $or: [{ applicationAId: applicationId }, { applicationBId: applicationId }] }).lean()
  const reviewByPair = new Map(reviews.map((review) => [`${review.applicationAId}|${review.applicationBId}`, review]))
  return comparisons.map((candidate) => {
    const [applicationAId, applicationBId] = pairIds(applicationId, candidate.applicationId)
    const review = reviewByPair.get(`${applicationAId}|${applicationBId}`)
    const summary = { ...candidate, reviewStatus: review?.status ?? 'OPEN' }
    // Case support can see the ranking to route a possible concern to an officer, but not the
    // underlying contact/date-of-birth comparison or review reason.
    return canReview
      ? { ...summary, reviewReason: review?.reviewReason ?? null }
      : { applicationId: summary.applicationId, caseId: summary.caseId, applicantName: summary.applicantName,
          score: summary.score, reviewStatus: summary.reviewStatus, requiresOfficerReview: true }
  })
}

export async function reviewDuplicateCandidate(applicationId, otherApplicationId, input, actor) {
  if (applicationId === otherApplicationId) throw new HttpError(400, 'INVALID_CANDIDATE', 'A record cannot be compared with itself.')
  return mongoose.connection.transaction(async (session) => {
    const application = await officeApplication(applicationId, actor, session)
    const other = await officeApplication(otherApplicationId, actor, session)
    if (other.officeCode !== application.officeCode) throw new HttpError(403, 'FORBIDDEN', 'Duplicate review is limited to the same office.')
    const [first, second] = pairIds(applicationId, otherApplicationId)
    const existing = await DuplicateReview.findOne({ applicationAId: first, applicationBId: second }).session(session)
    if (existing) throw new HttpError(409, 'ALREADY_REVIEWED', 'This candidate pair already has a human review decision.')
    const profiles = await profilesFor([application, other], session)
    const result = compare(profiles.get(applicationId), profiles.get(otherApplicationId))
    if (result.score < 30) throw new HttpError(409, 'NOT_A_CANDIDATE', 'This record is not in the current deterministic suggestion list.')
    const at = new Date()
    const [review] = await DuplicateReview.create([{
      applicationAId: first, applicationBId: second, score: result.score,
      matchingAttributes: result.matchingAttributes, differingAttributes: result.differingAttributes,
      status: input.decision, reviewReason: input.reason, reviewedByUserId: actor.userId, reviewedAt: at,
    }], { session })
    const summary = { reviewId: review.id, relatedApplicationId: otherApplicationId, status: review.status, score: result.score,
      matchingAttributes: result.matchingAttributes, differingAttributes: result.differingAttributes, recordsRemainSeparate: true }
    await auditApplication(application, session, 'DUPLICATE_CANDIDATE_REVIEWED', summary, input.reason, actor.userId)
    await auditApplication(other, session, 'DUPLICATE_CANDIDATE_REVIEWED', { ...summary, relatedApplicationId: applicationId }, input.reason, actor.userId)
    return summary
  })
}

export async function createRelatedIncidentGroup(input, actor) {
  const applicationIds = [...new Set(input.applicationIds)]
  if (applicationIds.length !== input.applicationIds.length || applicationIds.length < 2) throw new HttpError(400, 'INVALID_MEMBERS', 'Choose at least two different Applications.')
  return mongoose.connection.transaction(async (session) => {
    const applications = await Application.find({ applicationId: { $in: applicationIds }, status: 'ACCEPTED' }).sort({ applicationId: 1 }).session(session)
    if (applications.length !== applicationIds.length) throw new HttpError(409, 'ACCEPTED_CASES_REQUIRED', 'Every linked Application must already have an accepted Case.')
    const officeCode = applications[0].officeCode
    if (applications.some((item) => item.officeCode !== officeCode) || !hasOfficeRole(actor, 'DLAO_OFFICER', officeCode)) throw new HttpError(403, 'FORBIDDEN', 'Related incidents can only link accepted Cases in the current DLAO office.')
    const cases = await Case.find({ applicationId: { $in: applicationIds } }).select('applicationId caseId').session(session).lean()
    if (cases.length !== applicationIds.length) throw new HttpError(409, 'CASE_REQUIRED', 'An accepted Case record is unavailable.')
    const [group] = await RelatedIncidentGroup.create([{
      title: input.title, officeCode, applicationIds: applications.map(({ applicationId }) => applicationId), createdByUserId: actor.userId,
    }], { session })
    for (const application of applications) await auditApplication(application, session, 'RELATED_INCIDENT_GROUP_CREATED', {
      groupId: group.id, title: group.title, memberCount: applications.length,
    }, input.reason, actor.userId)
    return { id: group.id, title: group.title, members: cases }
  })
}

export async function getApplicationIncidentGroups(applicationId, actor) {
  const application = await Application.findOne({ applicationId }).select('officeCode').lean()
  if (!application) throw new HttpError(404, 'NOT_FOUND', 'Application not found.')
  if (!canReadIncidentGroup(actor, application.officeCode)) throw new HttpError(403, 'FORBIDDEN', 'This office cannot read related incident groups.')
  const groups = await RelatedIncidentGroup.find({ applicationIds: applicationId, officeCode: application.officeCode }).sort({ createdAt: -1 }).lean()
  return groups.map(({ _id, title, applicationIds, commonDocumentIds, createdAt }) => ({ id: _id, title, memberCount: applicationIds.length, sharedEvidenceCount: commonDocumentIds.length, createdAt }))
}

export async function getRelatedIncidentGroup(groupId, actor) {
  const group = await RelatedIncidentGroup.findById(groupId).lean()
  if (!group) throw new HttpError(404, 'NOT_FOUND', 'Related incident group not found.')
  if (!canReadIncidentGroup(actor, group.officeCode)) throw new HttpError(403, 'FORBIDDEN', 'This office cannot view the related incident group.')
  const [applications, cases, documents] = await Promise.all([
    Application.find({ applicationId: { $in: group.applicationIds }, officeCode: group.officeCode }).lean(),
    Case.find({ applicationId: { $in: group.applicationIds } }).select('applicationId caseId').lean(),
    Document.find({ applicationId: { $in: group.applicationIds }, sensitivity: 'STANDARD' }).select('applicationId label currentVersion').lean(),
  ])
  const profiles = await profilesFor(applications)
  const caseByApplication = new Map(cases.map((item) => [item.applicationId, item.caseId]))
  const memberByApplication = new Map(applications.map((item) => [item.applicationId, {
    applicationId: item.applicationId, caseId: caseByApplication.get(item.applicationId) ?? null,
    applicantName: profiles.get(item.applicationId)?.name ?? 'Unavailable',
  }]))
  const allDocumentIds = [...new Set([...group.commonDocumentIds.map(String), ...documents.map(({ _id }) => _id.toString())])]
  const versions = await DocumentVersion.find({ documentId: { $in: allDocumentIds } }).sort({ version: -1 }).select('+textContent documentId version qualityState').lean()
  const latest = new Map()
  for (const version of versions) if (!latest.has(version.documentId.toString())) latest.set(version.documentId.toString(), version)
  const sharedIds = new Set(group.commonDocumentIds.map(String))
  const availableDocuments = documents.filter(({ _id }) => {
    const version = latest.get(_id.toString())
    return !sharedIds.has(_id.toString()) && version?.qualityState === 'READABLE' && version.textContent
  }).map(({ _id, applicationId: sourceApplicationId, label, currentVersion }) => ({
    id: _id, sourceApplicationId, sourceCaseId: caseByApplication.get(sourceApplicationId) ?? null, label, currentVersion,
  }))
  const sharedEvidence = documents.filter(({ _id }) => sharedIds.has(_id.toString())).map(({ _id, applicationId: sourceApplicationId, label, currentVersion }) => {
    const version = latest.get(_id.toString())
    return { id: _id, sourceApplicationId, sourceCaseId: caseByApplication.get(sourceApplicationId) ?? null,
      label, currentVersion, qualityState: version?.qualityState ?? 'UNREADABLE', textContent: version?.textContent ?? null }
  })
  const canShareEvidence = hasOfficeRole(actor, 'DLAO_OFFICER', group.officeCode)
  return { id: group._id, title: group.title, members: group.applicationIds.map((id) => memberByApplication.get(id)).filter(Boolean),
    canShareEvidence, availableDocuments: canShareEvidence ? availableDocuments : [], sharedEvidence,
    separationNotice: 'Only explicitly linked standard evidence is shared here. Instructions, applicant facts, outcomes, and restricted evidence stay on each individual Case.' }
}

export async function linkRelatedIncidentEvidence(groupId, input, actor) {
  return mongoose.connection.transaction(async (session) => {
    const group = await RelatedIncidentGroup.findById(groupId).session(session)
    if (!group) throw new HttpError(404, 'NOT_FOUND', 'Related incident group not found.')
    if (!hasOfficeRole(actor, 'DLAO_OFFICER', group.officeCode)) throw new HttpError(403, 'FORBIDDEN', 'This DLAO office cannot share evidence with the group.')
    const document = await Document.findById(input.documentId).session(session)
    if (!document || document.sensitivity !== 'STANDARD' || !group.applicationIds.includes(document.applicationId)) throw new HttpError(403, 'EVIDENCE_NOT_SHAREABLE', 'Only standard evidence from a member Case can be reference-linked.')
    if (group.commonDocumentIds.some((id) => id.equals(document._id))) throw new HttpError(409, 'ALREADY_SHARED', 'This document is already linked to the incident group.')
    const version = await DocumentVersion.findOne({ documentId: document._id }).sort({ version: -1 }).select('+textContent qualityState').session(session).lean()
    if (version?.qualityState !== 'READABLE' || !version.textContent) throw new HttpError(409, 'READABLE_EVIDENCE_REQUIRED', 'Only readable standard evidence can be shared with the group.')
    group.commonDocumentIds.push(document._id)
    await group.save({ session })
    for (const applicationId of group.applicationIds) {
      const application = await Application.findOne({ applicationId }).session(session)
      if (application) await auditApplication(application, session, 'RELATED_INCIDENT_EVIDENCE_LINKED', {
        groupId: group.id, documentId: document.id, sourceApplicationId: document.applicationId,
      }, input.reason, actor.userId)
    }
    return { groupId: group.id, documentId: document.id, sourceApplicationId: document.applicationId, linkedOnce: true }
  })
}
