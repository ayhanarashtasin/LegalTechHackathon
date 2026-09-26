import mongoose from 'mongoose'

const { Schema, model } = mongoose
const ref = (name, required = true) => ({ type: Schema.Types.ObjectId, ref: name, required })
const recordId = { type: String, required: true, index: true }
const roles = ['DLAO_OFFICER', 'MEDIATOR', 'HELPLINE_AGENT', 'UDC_OPERATOR', 'PANEL_LAWYER', 'RECEIVING_DLAO', 'CASE_SUPPORT', 'CLAO', 'ADMIN', 'CITIZEN', 'SYSTEM']
const sources = ['APPLICANT_REPORTED', 'APPLICANT_CONFIRMED', 'REPRESENTATIVE_REPORTED', 'INTERMEDIARY_TRANSLATED', 'INTERMEDIARY_TYPED', 'STAFF_ENTERED', 'DOCUMENT_EXTRACTED', 'AI_INFERRED', 'UNKNOWN_OR_UNVERIFIED']

const userSchema = new Schema({
  username: { type: String, required: true, unique: true, lowercase: true, trim: true },
  displayName: { type: String, required: true },
  passwordHash: { type: String, required: true, select: false },
  userType: { type: String, trim: true, lowercase: true, index: true },
  nid: { type: String, trim: true },
  phone: { type: String, trim: true },
  district: { type: String, trim: true },
  safeTimeWindow: { type: String, trim: true },
  personId: ref('Person', false),
  active: { type: Boolean, default: true },
  acceptingCases: { type: Boolean, default: true },
  fictional: { type: Boolean, default: true },
}, { timestamps: true })
export const User = model('User', userSchema)

const roleAssignmentSchema = new Schema({
  userId: ref('User'),
  role: { type: String, required: true, enum: roles },
  officeCode: { type: String, required: true },
  active: { type: Boolean, default: true },
}, { timestamps: true })
roleAssignmentSchema.index({ userId: 1, role: 1, officeCode: 1 }, { unique: true })
export const RoleAssignment = model('RoleAssignment', roleAssignmentSchema)

export const Person = model('Person', new Schema({
  displayName: { type: String, required: true },
  identityStatus: { type: String, enum: ['INCOMPLETE', 'PENDING_REVIEW', 'VERIFIED'], default: 'INCOMPLETE' },
  fictional: { type: Boolean, default: true },
}, { timestamps: true }))

const applicationSchema = new Schema({
  applicationId: { type: String, required: true, unique: true },
  demoSeedKey: { type: String },
  applicantPersonId: ref('Person'),
  citizenUserId: ref('User', false),
  officeCode: { type: String, required: true },
  channel: { type: String, required: true, enum: ['WEB', 'HELPLINE_SIM', 'VOICE_SIM', 'UDC', 'DLAO'] },
  // A 16699 advice request waits for a helpline callback, outside the DLAO queue, until it becomes a complaint.
  service: { type: String, enum: ['COMPLAINT', 'ADVICE'], default: 'COMPLAINT' },
  adviceOutcome: { type: String, enum: ['INFORMATION_PROVIDED', 'FORMAL_ASSISTANCE'] },
  status: { type: String, enum: ['SUBMITTED', 'ACCEPTED'], default: 'SUBMITTED' },
  reviewState: { type: String, enum: ['PENDING_REVIEW', 'NEEDS_INFORMATION', 'READY_FOR_DECISION'], default: 'PENDING_REVIEW' },
  priorityDecision: { type: String, enum: ['URGENT', 'ROUTINE'] },
  lookupCodeHash: { type: String, select: false },
  caseId: String,
  version: { type: Number, default: 1 },
  auditSequence: { type: Number, default: 1 },
  submittedByUserId: ref('User'),
  acceptedByUserId: ref('User', false),
  acceptedAt: Date,
  assistedByUserId: ref('User', false),
  // Latest authorised human routing decision; a REFER route binds the next referral to that office.
  routingDecision: {
    route: { type: String, enum: ['RETAIN', 'REFER'] },
    officeCode: String,
    reason: String,
    returnCount: Number,
    decidedByUserId: ref('User', false),
    decidedAt: Date,
  },
}, { timestamps: true })
applicationSchema.index({ caseId: 1 }, { unique: true, partialFilterExpression: { caseId: { $type: 'string' } } })
applicationSchema.index({ demoSeedKey: 1 }, { unique: true, partialFilterExpression: { demoSeedKey: { $type: 'string' } } })
export const Application = model('Application', applicationSchema)

const caseSchema = new Schema({
  caseId: { type: String, required: true, unique: true },
  applicationId: { type: String, required: true, unique: true },
  officeCode: { type: String, required: true },
  status: { type: String, enum: ['OPEN'], default: 'OPEN' },
  acceptedByUserId: ref('User'),
  nextHearingAt: Date,
  nextAction: String,
}, { timestamps: true })
export const Case = model('Case', caseSchema)

const duplicateReviewSchema = new Schema({
  applicationAId: recordId,
  applicationBId: recordId,
  score: { type: Number, required: true, min: 0, max: 100 },
  matchingAttributes: [String],
  differingAttributes: [String],
  status: { type: String, enum: ['CONFIRMED_DUPLICATE', 'NOT_DUPLICATE'], required: true },
  reviewedByUserId: ref('User'),
  reviewedAt: { type: Date, required: true },
  reviewReason: { type: String, required: true },
}, { timestamps: true })
duplicateReviewSchema.index({ applicationAId: 1, applicationBId: 1 }, { unique: true })
duplicateReviewSchema.index({ applicationAId: 1, reviewedAt: -1 })
duplicateReviewSchema.index({ applicationBId: 1, reviewedAt: -1 })
export const DuplicateReview = model('DuplicateReview', duplicateReviewSchema)

const factSchema = new Schema({
  applicationId: recordId,
  caseId: String,
  field: { type: String, required: true },
  value: { type: String, required: true, maxlength: 4000 },
  sourceType: { type: String, required: true, enum: sources },
  sourcePersonId: ref('Person', false),
  captureMethod: { type: String, required: true, enum: ['VOICE', 'TYPED', 'TRANSLATED', 'DOCUMENT', 'STAFF', 'AI'] },
  translatedByPersonId: ref('Person', false),
  typedByPersonId: ref('Person', false),
  callerConfirmed: { type: Boolean, default: false },
  applicantConfirmed: { type: Boolean, default: false },
  confirmedByPersonId: ref('Person', false),
  confirmationAttestation: String,
  aiInferred: { type: Boolean, default: false },
  supersedesFactId: ref('CaseFact', false),
  revision: { type: Number, required: true },
  recordedByUserId: ref('User'),
}, { timestamps: { createdAt: true, updatedAt: false } })
factSchema.index({ applicationId: 1, field: 1, revision: 1 }, { unique: true })
export const CaseFact = model('CaseFact', factSchema)

export const Representation = model('Representation', new Schema({
  applicationId: recordId,
  applicantPersonId: ref('Person'),
  representativePersonId: ref('Person'),
  relationship: { type: String, required: true },
  scope: { type: String, required: true },
  authorityStatus: { type: String, enum: ['PENDING', 'VERIFIED', 'REVOKED'], default: 'PENDING' },
  recordedByUserId: ref('User'),
}, { timestamps: true }))

export const AssistanceRecord = model('AssistanceRecord', new Schema({
  applicationId: { type: String, required: true, unique: true },
  applicantPersonId: ref('Person'),
  helperPersonId: ref('Person'),
  translatorPersonId: ref('Person'),
  typistPersonId: ref('Person'),
  helperPhone: String,
  originalLanguage: { type: String, required: true },
  caseType: { type: String, required: true, enum: ['FAMILY', 'LAND', 'LABOUR', 'CRIMINAL', 'OTHER'] },
  originalConfirmed: { type: Boolean, default: false },
  translationConfirmed: { type: Boolean, default: false },
  recordedByUserId: ref('User'),
}, { timestamps: true }))

const clientMutationSchema = new Schema({
  actorUserId: ref('User'),
  clientMutationId: { type: String, required: true },
  temporaryId: { type: String, required: true },
  payloadHash: { type: String, required: true },
  applicationId: recordId,
  result: { type: Schema.Types.Mixed, required: true },
}, { timestamps: true })
clientMutationSchema.index({ actorUserId: 1, clientMutationId: 1 }, { unique: true })
export const ClientMutation = model('ClientMutation', clientMutationSchema)

const consentSchema = new Schema({
  applicationId: recordId,
  personId: ref('Person'),
  scope: { type: String, required: true, enum: ['LIVE_VOICE', 'AUDIO_STORAGE', 'TRANSCRIPT_STORAGE', 'STRUCTURED_FACTS', 'ASSISTED_INTAKE', 'CONTACT'] },
  state: { type: String, required: true, enum: ['PENDING', 'GRANTED', 'DENIED', 'WITHDRAWN'] },
  revision: { type: Number, required: true },
  attestation: { type: String, required: true },
  sourceType: { type: String, required: true, enum: sources },
  recordedByUserId: ref('User'),
}, { timestamps: { createdAt: true, updatedAt: false } })
consentSchema.index({ applicationId: 1, scope: 1, revision: 1 }, { unique: true })
export const ConsentRecord = model('ConsentRecord', consentSchema)

const safeContactSchema = new Schema({
  applicationId: recordId,
  caseId: String,
  version: { type: Number, required: true },
  allowedChannels: [{ type: String, enum: ['PHONE', 'SMS', 'WEB', 'IN_PERSON'] }],
  prohibitedChannels: [{ type: String, enum: ['PHONE', 'SMS', 'WEB', 'IN_PERSON'] }],
  contactValue: String,
  contactOwnerPersonId: ref('Person', false),
  safeTimeWindow: String,
  smsSafe: { type: Boolean, default: false },
  neutralWordingRequired: { type: Boolean, default: true },
  unknownAnswerAction: { type: String, enum: ['DISCLOSE_NOTHING', 'APPROVED_NEUTRAL_ONLY'], default: 'DISCLOSE_NOTHING' },
  supersedesProfileId: ref('SafeContactProfile', false),
  recordedByUserId: ref('User'),
}, { timestamps: { createdAt: true, updatedAt: false } })
safeContactSchema.index({ applicationId: 1, version: 1 }, { unique: true })
export const SafeContactProfile = model('SafeContactProfile', safeContactSchema)

export const Task = model('Task', new Schema({
  applicationId: recordId,
  caseId: String,
  kind: { type: String, required: true, enum: ['INTAKE_REVIEW', 'DECISION', 'FOLLOW_UP', 'MANUAL', 'REFERRAL', 'ROUTING_DECISION', 'LAWYER_UPDATE', 'LAWYER_PATTERN_REVIEW', 'LAWYER_CHANGE_REVIEW', 'ADVICE_CALLBACK'] },
  title: { type: String, required: true },
  status: { type: String, enum: ['OPEN', 'DONE'], default: 'OPEN' },
  ownerRole: { type: String, required: true, enum: roles },
  ownerUserId: ref('User', false),
  nextAction: { type: String, required: true },
  dueAt: Date,
  completedAt: Date,
  completedByUserId: ref('User', false),
}, { timestamps: true }))

export const ContactAttempt = model('ContactAttempt', new Schema({
  applicationId: recordId,
  caseId: String,
  channel: { type: String, required: true },
  outcome: { type: String, required: true },
  reason: { type: String, required: true },
  // Who picked up follows from the outcome; the note says who someone else was ("shop owner").
  answeredBy: { type: String, enum: ['APPLICANT', 'SOMEONE_ELSE', 'NOBODY'] },
  answeredByNote: String,
  // Stated by the officer when someone else answered, never assumed.
  disclosedSensitive: { type: Boolean, default: false },
  statusExplained: Boolean,
  nextAttemptAt: Date,
  safeContactVersion: Number,
  recordedByUserId: ref('User'),
}, { timestamps: { createdAt: true, updatedAt: false } }))

const auditSchema = new Schema({
  applicationId: String,
  caseId: String,
  sequence: Number,
  action: { type: String, required: true },
  actorUserId: ref('User', false),
  actorRole: { type: String, required: true, enum: roles },
  channel: String,
  previousState: Schema.Types.Mixed,
  newState: Schema.Types.Mixed,
  reason: String,
  previousHash: String,
  hash: { type: String, required: true },
}, { timestamps: { createdAt: true, updatedAt: false } })
auditSchema.index({ applicationId: 1, sequence: 1 }, { unique: true, partialFilterExpression: { applicationId: { $type: 'string' } } })
export const AuditEvent = model('AuditEvent', auditSchema)

// Stored only when the caller granted transcript consent; text is machine transcription, not verbatim proof.
export const VoiceTranscript = model('VoiceTranscript', new Schema({
  applicationId: { type: String, required: true, unique: true },
  turns: [{ _id: false, speaker: { type: String, enum: ['CALLER', 'ASSISTANT'], required: true }, text: { type: String, required: true, maxlength: 2000 } }],
  transcribedBy: { type: String, required: true },
}, { timestamps: { createdAt: true, updatedAt: false } }))

// The full 16699 call audio, kept under the greeting's recording notice; officer-only (see getCallRecording).
// ponytail: stored inline (8 MB upload cap, under MongoDB's 16 MB document limit); move to GridFS or object storage for longer calls.
export const CallRecording = model('CallRecording', new Schema({
  applicationId: { type: String, required: true, unique: true },
  mimeType: { type: String, required: true },
  bytes: { type: Number, required: true },
  sha256: { type: String, required: true },
  audio: { type: Buffer, required: true, select: false },
}, { timestamps: { createdAt: true, updatedAt: false } }))

export const Document = model('Document', new Schema({
  applicationId: recordId,
  caseId: String,
  label: { type: String, required: true },
  checklistItem: String,
  sensitivity: { type: String, enum: ['STANDARD', 'RESTRICTED'], default: 'STANDARD' },
  accessState: { type: String, enum: ['PENDING_POLICY', 'EXPLICIT_GRANT'], default: 'PENDING_POLICY' },
  allowedUserIds: [ref('User', false)],
  currentVersion: { type: Number, default: 1 },
}, { timestamps: true }))

const documentVersionSchema = new Schema({
  applicationId: recordId,
  caseId: String,
  documentId: ref('Document'),
  version: { type: Number, required: true },
  label: { type: String, required: true },
  filename: String,
  qualityState: { type: String, enum: ['PENDING_REVIEW', 'READABLE', 'UNREADABLE'], default: 'PENDING_REVIEW' },
  note: String,
  textContent: { type: String, maxlength: 50000, select: false },
  contentHash: String,
  recordedByUserId: ref('User'),
}, { timestamps: { createdAt: true, updatedAt: false } })
documentVersionSchema.index({ documentId: 1, version: 1 }, { unique: true })
export const DocumentVersion = model('DocumentVersion', documentVersionSchema)

export const DocumentBriefing = model('DocumentBriefing', new Schema({
  applicationId: { type: String, required: true, unique: true },
  sourceVersion: { type: Number, required: true },
  caseType: { type: String, required: true },
  status: { type: String, enum: ['PROPOSED', 'APPROVED'], default: 'PROPOSED' },
  model: { type: String, required: true },
  summary: { type: String, required: true },
  points: [{ _id: false, text: { type: String, required: true, maxlength: 180 }, sourceId: { type: String, required: true } }],
  citations: [{ _id: false, sourceId: String, documentId: ref('Document'), documentVersionId: ref('DocumentVersion'), label: String, version: Number, line: Number, excerpt: String }],
  checklist: [{ _id: false, item: String, status: { type: String, enum: ['MISSING', 'PRESENT_FOR_REVIEW', 'UNCERTAIN'] }, documentLabels: [String] }],
  missing: [String],
  uncertain: [String],
  unreadable: [String],
  limitedSources: [String],
  approvedByUserId: ref('User', false),
  approvedAt: Date,
}, { timestamps: true }))

const triageComponentSchema = new Schema({
  name: { type: String, enum: ['CASE_CATEGORIZER', 'PROCESS_SAFETY', 'URGENCY_ROUTING'], required: true },
  recommendation: { type: String, required: true, maxlength: 80 },
  urgencySignal: { type: String, enum: ['HIGH', 'LOW', 'UNKNOWN'], required: true },
  reasons: [{ type: String, maxlength: 240 }],
  evidenceRefs: [{ type: String, maxlength: 80 }],
  uncertainty: { type: String, required: true, maxlength: 240 },
  requiresHumanReview: { type: Boolean, enum: [true], required: true },
}, { _id: false })
const triageDisagreementSchema = new Schema({
  dimension: { type: String, enum: ['URGENCY'], required: true },
  components: [{ type: String, enum: ['PROCESS_SAFETY', 'URGENCY_ROUTING'] }],
  signals: [{ type: String, enum: ['HIGH', 'LOW'] }],
  summary: { type: String, required: true, maxlength: 300 },
}, { _id: false })
const triageRoutingReviewSchema = new Schema({
  status: { type: String, enum: ['ESCALATION_OPEN', 'RETURNED_REFERRAL_REVIEW', 'HUMAN_ROUTE_RECORDED', 'ROUTE_NOT_RECORDED'], required: true },
  reason: { type: String, required: true, maxlength: 300 },
  evidenceRefs: [{ type: String, maxlength: 80 }],
  requiresHumanReview: { type: Boolean, enum: [true], required: true },
}, { _id: false })
const humanTriageDecisionSchema = new Schema({
  category: { type: String, enum: ['LABOUR', 'FAMILY', 'LAND', 'CRIMINAL', 'OTHER', 'UNCERTAIN'], required: true },
  disposition: { type: String, enum: ['PRIORITIZE_FOR_HUMAN_REVIEW', 'CONTINUE_ROUTINE_REVIEW', 'SEEK_MORE_INFORMATION', 'REQUEST_JURISDICTION_REVIEW', 'NO_CHANGE'], required: true },
  reason: { type: String, required: true, maxlength: 1000 },
  decidedByUserId: ref('User'),
  decidedAt: { type: Date, required: true },
}, { _id: false })
const triageAssessmentSchema = new Schema({
  applicationId: recordId,
  sourceVersion: { type: Number, required: true },
  model: { type: String, required: true },
  aiAssisted: { type: Boolean, required: true },
  components: { type: [triageComponentSchema], required: true },
  disagreements: [triageDisagreementSchema],
  routingReview: triageRoutingReviewSchema,
  status: { type: String, enum: ['PENDING_HUMAN_REVIEW', 'REVIEWED'], default: 'PENDING_HUMAN_REVIEW' },
  humanDecision: humanTriageDecisionSchema,
  createdByUserId: ref('User'),
}, { timestamps: true })
triageAssessmentSchema.index({ applicationId: 1, createdAt: -1 })
export const TriageAssessment = model('TriageAssessment', triageAssessmentSchema)

const settlementSectionSchema = new Schema({
  key: { type: String, required: true, maxlength: 60 },
  label: { type: String, required: true, maxlength: 80 },
  text: { type: String, required: true, maxlength: 500 },
  aiFilled: { type: Boolean, required: true },
}, { _id: false })
const settlementDraftSchema = new Schema({
  applicationId: recordId,
  caseId: { type: String, required: true },
  mediationId: ref('Mediation'),
  template: { type: String, required: true, enum: ['MAINTENANCE', 'PROPERTY', 'LABOUR'] },
  templateRevision: { type: String, maxlength: 30 },
  templateExample: { type: String, maxlength: 600 },
  templateExampleBn: { type: String, maxlength: 600 },
  version: { type: Number, required: true, default: 1 },
  model: { type: String, required: true },
  aiAssisted: { type: Boolean, required: true },
  sourceNotesDigest: { type: String, required: true },
  sections: { type: [settlementSectionSchema], required: true },
  aiInconsistencies: [{ type: String, maxlength: 300 }],
  inconsistencies: [{ type: String, maxlength: 300 }],
  warningsReviewed: { type: Boolean, default: false },
  status: { type: String, enum: ['HUMAN_REVIEW', 'APPROVED'], default: 'HUMAN_REVIEW' },
  reviewReason: { type: String, maxlength: 1000 },
  reviewedByUserId: ref('User', false),
  reviewedAt: Date,
  partyAcknowledgements: {
    partyAUnderstands: Boolean,
    partyAConsents: Boolean,
    partyBUnderstands: Boolean,
    partyBConsents: Boolean,
  },
}, { timestamps: true })
settlementDraftSchema.index({ mediationId: 1 }, { unique: true })
export const SettlementDraft = model('SettlementDraft', settlementDraftSchema)

const mediationNoticeSchema = new Schema({
  party: { type: String, required: true, enum: ['PARTY_A', 'PARTY_B'] },
  deliveryState: { type: String, required: true, enum: ['DELIVERED', 'NOT_DELIVERED'] },
  reason: { type: String, required: true, maxlength: 300 },
  recordedByUserId: ref('User'),
  recordedAt: { type: Date, required: true },
}, { _id: false })
const mediationSchema = new Schema({
  applicationId: { type: String, required: true },
  caseId: { type: String, required: true },
  officeCode: { type: String, required: true },
  mediatorUserId: ref('User', false),
  stage: { type: String, required: true, enum: ['REGISTRATION', 'SCHEDULING_NOTICES', 'DOCUMENT_REVIEW', 'ATTENDANCE', 'MEDIATION', 'DRAFT_OUTCOME', 'SIGNATURES', 'PENDING_CLAO_CERTIFICATION', 'CERTIFIED_FINAL'], default: 'REGISTRATION' },
  mode: { type: String, enum: ['IN_PERSON', 'REMOTE', 'HYBRID'] },
  scheduledAt: Date,
  venue: { type: String, maxlength: 200 },
  inPersonFallback: { type: String, maxlength: 300 },
  notices: [mediationNoticeSchema],
  documentsReviewedAt: Date,
  documentReviewReason: { type: String, maxlength: 500 },
  attendance: {
    partyA: { type: String, enum: ['ATTENDED', 'REPRESENTED', 'ABSENT'] },
    partyB: { type: String, enum: ['ATTENDED', 'REPRESENTED', 'ABSENT'] },
    reason: { type: String, maxlength: 500 },
    recordedByUserId: ref('User', false),
    recordedAt: Date,
  },
  outcome: { type: String, enum: ['AGREEMENT_REACHED', 'NO_AGREEMENT', 'CONTINUED'] },
  outcomeReason: { type: String, maxlength: 1000 },
  settlementDraftId: ref('SettlementDraft', false),
  legalApplicability: { type: String, enum: ['UNVERIFIED', 'APPLICABLE_VERIFIED'], default: 'UNVERIFIED' },
  legalReviewBasis: { type: String, maxlength: 500 },
  legalReviewedByUserId: ref('User', false),
  legalReviewedAt: Date,
  legalEffectState: { type: String, required: true, enum: ['LEGAL_EFFECT_REQUIRES_AUTHORISED_REVIEW', 'PENDING_CLAO_CERTIFICATION', 'CERTIFIED_FINAL'], default: 'LEGAL_EFFECT_REQUIRES_AUTHORISED_REVIEW' },
  certificateReason: { type: String, maxlength: 500 },
  certifiedByUserId: ref('User', false),
  certifiedAt: Date,
  createdByUserId: ref('User'),
}, { timestamps: true })
mediationSchema.index({ officeCode: 1, mediatorUserId: 1, stage: 1, updatedAt: -1 })
mediationSchema.index({ caseId: 1 }, { unique: true })
mediationSchema.index({ applicationId: 1 }, { unique: true })
export const Mediation = model('Mediation', mediationSchema)

const signatureRecordSchema = new Schema({
  applicationId: recordId,
  caseId: { type: String, required: true },
  mediationId: ref('Mediation'),
  draftId: ref('SettlementDraft'),
  draftVersion: { type: Number, required: true },
  signerRole: { type: String, required: true, enum: ['PARTY_A', 'PARTY_B', 'MEDIATOR'] },
  documentHash: { type: String, required: true, match: /^[a-f0-9]{64}$/ },
  publicKeyJwk: { type: Schema.Types.Mixed, required: true },
  signature: { type: String, required: true },
  signingInvitationId: ref('SigningInvitation', false),
  authorizationMethod: { type: String, enum: ['PARTY_CODE', 'MEDIATOR_SESSION'] },
  partyConfirmed: Boolean,
  clientMutationId: { type: String, required: true, unique: true },
  clientSignedAt: { type: Date, required: true },
  recordedByUserId: ref('User', false),
  receivedAt: { type: Date, required: true },
}, { timestamps: { createdAt: true, updatedAt: false } })
signatureRecordSchema.index({ draftId: 1, draftVersion: 1, signerRole: 1 }, { unique: true })
signatureRecordSchema.index({ applicationId: 1, receivedAt: 1 })
export const SignatureRecord = model('SignatureRecord', signatureRecordSchema)

const signingInvitationSchema = new Schema({
  applicationId: recordId,
  mediationId: ref('Mediation'),
  draftId: ref('SettlementDraft'),
  draftVersion: { type: Number, required: true },
  signerRole: { type: String, required: true, enum: ['PARTY_A', 'PARTY_B'] },
  tokenHash: { type: String, required: true, unique: true, match: /^[a-f0-9]{64}$/ },
  issuedByUserId: ref('User'),
  expiresAt: { type: Date, required: true },
  usedAt: Date,
}, { timestamps: true })
signingInvitationSchema.index({ draftId: 1, signerRole: 1 }, { unique: true })
export const SigningInvitation = model('SigningInvitation', signingInvitationSchema)

const relatedIncidentGroupSchema = new Schema({
  title: { type: String, required: true, maxlength: 120 },
  officeCode: { type: String, required: true },
  applicationIds: [{ type: String, required: true }],
  commonDocumentIds: [ref('Document', false)],
  createdByUserId: ref('User'),
}, { timestamps: true })
relatedIncidentGroupSchema.index({ applicationIds: 1 })
export const RelatedIncidentGroup = model('RelatedIncidentGroup', relatedIncidentGroupSchema)

const referralSchema = new Schema({
  applicationId: recordId,
  caseId: { type: String, required: true },
  sendingOfficeCode: { type: String, required: true },
  receivingOfficeCode: { type: String, required: true },
  sentByUserId: ref('User'),
  responsibleUserId: ref('User'),
  reason: { type: String, required: true },
  history: { type: String, required: true },
  expectedAction: { type: String, required: true },
  dueAt: { type: Date, required: true },
  documentIds: [ref('Document', false)],
  // Restricted evidence travels only when the sender holds a grant and records why sharing is necessary.
  sensitiveDocumentIds: [ref('Document', false)],
  sensitiveAccessReason: String,
  status: { type: String, enum: ['SENT', 'ACKNOWLEDGED', 'ACCEPTED', 'RETURNED'], default: 'SENT' },
  acknowledgedAt: Date,
  respondedAt: Date,
  responseReason: String,
  respondedByUserId: ref('User', false),
  overdueAt: Date,
  taskId: ref('Task'),
}, { timestamps: true })
referralSchema.index({ receivingOfficeCode: 1, createdAt: -1 })
referralSchema.index({ status: 1, dueAt: 1 })
referralSchema.index({ applicationId: 1, status: 1, respondedAt: -1 })
export const Referral = model('Referral', referralSchema)

// Append-only read log for restricted evidence, kept apart from the audit chain so reads never bump record versions.
export const EvidenceAccessLog = model('EvidenceAccessLog', new Schema({
  applicationId: recordId,
  documentId: ref('Document'),
  userId: ref('User'),
  roles: [{ type: String, enum: roles }],
  outcome: { type: String, required: true, enum: ['GRANTED', 'DENIED'] },
  basis: { type: String, required: true, enum: ['EXPLICIT_GRANT', 'REFERRAL', 'NONE'] },
  referralId: ref('Referral', false),
}, { timestamps: { createdAt: true, updatedAt: false } }))

const lawyerAssignmentSchema = new Schema({
  applicationId: recordId,
  caseId: { type: String, required: true, index: true },
  officeCode: String,
  lawyerUserId: ref('User'),
  active: { type: Boolean, default: true },
  status: { type: String, enum: ['PENDING', 'ACCEPTED', 'DECLINED', 'REASSIGNED'], default: 'ACCEPTED' },
  assignedByUserId: ref('User', false),
  changeRequestId: ref('LawyerChangeRequest', false),
  acceptedAt: Date,
  declinedAt: Date,
  declineReason: String,
}, { timestamps: true })
lawyerAssignmentSchema.index({ lawyerUserId: 1, active: 1, status: 1 })
lawyerAssignmentSchema.index({ applicationId: 1, active: 1, status: 1 })
export const LawyerAssignment = model('LawyerAssignment', lawyerAssignmentSchema)

const lawyerUpdateSchema = new Schema({
  applicationId: recordId,
  caseId: { type: String, required: true },
  assignmentId: ref('LawyerAssignment'),
  sequence: { type: Number, required: true },
  dueAt: { type: Date, required: true },
  instruction: { type: String, required: true },
  status: { type: String, enum: ['PENDING', 'MISSED', 'SUBMITTED_ON_TIME', 'SUBMITTED_LATE', 'CANCELLED'], default: 'PENDING' },
  missedAt: Date,
  submittedAt: Date,
  report: String,
  nextAction: String,
  recordedByUserId: ref('User', false),
  // DLAO reminders for an overdue update, shown on the lawyer's own worklist instead of a phone call.
  reminders: [{ _id: false, at: { type: Date, required: true }, byUserId: ref('User') }],
}, { timestamps: true })
lawyerUpdateSchema.index({ assignmentId:  1, sequence: 1 }, { unique: true })
lawyerUpdateSchema.index({ applicationId: 1, status: 1, dueAt: 1 })
export const LawyerUpdate = model('LawyerUpdate', lawyerUpdateSchema)

const lawyerChangeRequestSchema = new Schema({
  applicationId: recordId,
  caseId: { type: String, required: true },
  channel: { type: String, required: true, enum: ['PHONE', 'IN_PERSON', 'ONLINE', 'PORTAL'] },
  reason: { type: String, required: true },
  status: { type: String, enum: ['OPEN', 'APPROVED', 'DECLINED', 'COMPLETED'], default: 'OPEN' },
  recordedByUserId: ref('User'),
  reviewedByUserId: ref('User', false),
  reviewedAt: Date,
  reviewReason: String,
}, { timestamps: true })
lawyerChangeRequestSchema.index({ applicationId: 1, status: 1 })
export const LawyerChangeRequest = model('LawyerChangeRequest', lawyerChangeRequestSchema)

const panelLawyerHoldSchema = new Schema({
  lawyerUserId: { ...ref('User'), unique: true },
  officeCode: { type: String, required: true },
  newAssignmentHold: { type: Boolean, default: true },
  reviewState: { type: String, enum: ['PENDING_REVIEW', 'CONTINUED', 'LIFTED'], default: 'PENDING_REVIEW' },
  reviewerRole: { type: String, enum: ['DLAO_OFFICER'], default: 'DLAO_OFFICER' },
  triggerApplicationId: recordId,
  triggerAssignmentId: ref('LawyerAssignment'),
  missedUpdateIds: [ref('LawyerUpdate', false)],
  triggeredAt: { type: Date, required: true },
  reviewedByUserId: ref('User', false),
  reviewedAt: Date,
  reviewReason: String,
}, { timestamps: true })
export const PanelLawyerHold = model('PanelLawyerHold', panelLawyerHoldSchema)

const lawyerPaymentEventSchema = new Schema({
  applicationId: recordId,
  caseId: { type: String, required: true },
  assignmentId: ref('LawyerAssignment'),
  stage: { type: String, required: true, enum: ['CASE_PREPARATION', 'HEARING_ATTENDANCE', 'CLAIM_REVIEW', 'RECONCILIATION'] },
  status: { type: String, required: true, enum: ['NOT_RECORDED', 'SUBMITTED', 'UNDER_REVIEW', 'RECONCILED', 'PAYMENT_RECORDED', 'DISPUTED'] },
  reason: { type: String, required: true },
  recordedByUserId: ref('User'),
}, { timestamps: { createdAt: true, updatedAt: false } })
lawyerPaymentEventSchema.index({ assignmentId: 1, createdAt: -1 })
export const LawyerPaymentEvent = model('LawyerPaymentEvent', lawyerPaymentEventSchema)

export const DemoSession = model('DemoSession', new Schema({
  tokenHash: { type: String, required: true, unique: true },
  userId: ref('User'),
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
}, { timestamps: { createdAt: true, updatedAt: false } }))

export const Counter = model('Counter', new Schema({
  key: { type: String, required: true, unique: true },
  value: { type: Number, required: true, default: 0 },
}))
