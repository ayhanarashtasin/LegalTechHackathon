import { Router } from 'express'
import { accept, adviceOutcome, takeCase, addConsent, addContactAttempt, addRepresentative, addTask, finishTask, helplineStatus, overrideReview, priorityOverride, read, readAudit, readContactAttempts, readFacts, readHistory, readRecording, readSafeContact, readTasks, readTranscript, recordCorrection, recordFact, recordFactVerification, withdraw, review, reviewCancellation, search, sendNotice, submit, trackStatus, updateCaseInfo, updateSafeContact, verifyPreMediation } from '../controllers/applicationController.js'
import { addDocument, approveDocumentBriefing, generateBriefing, readBriefing, readDocuments, readEvidenceAccess } from '../controllers/documentController.js'
import { readForApplication, routingDecision, send } from '../controllers/referralController.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { limitStatusLookup } from '../middleware/rateLimit.js'
import { applicationIdParam, factIdParam, taskIdParam, validateAcceptance, validateAdviceOutcome, validateApplicantWithdrawal, validateFactVerification, validateBriefingApproval, validateConsent, validateContactAttempt, validateCorrection, validateDocument, validateEditCaseInfo, validateEmptyBody, validateFact, validateNoticeDispatch, validateOfficerAssignment, validatePreMediationVerify, validatePriorityOverride, validateReferral, validateRepresentation, validateReview, validateReviewOverride, validateRoutingDecision, validateSafeContact, validateSearch, validateStatusLookup, validateSubmission, validateTask, validateTrackLookup } from '../validators/requests.js'
import { cancellationRequestParam, validateCancellationReview } from '../validators/cancellation.js'

const router = Router()
router.post('/track', limitStatusLookup, validateTrackLookup, trackStatus)
router.use(requireAuth)
router.post('/', requireRole('DLAO_OFFICER', 'CASE_SUPPORT', 'HELPLINE_AGENT'), validateSubmission, submit)
router.post('/status-lookup', requireRole('HELPLINE_AGENT'), validateStatusLookup, helplineStatus)
router.get('/search', requireRole('DLAO_OFFICER', 'CASE_SUPPORT'), validateSearch, search)
router.post('/:applicationId/advice-outcome', applicationIdParam, requireRole('HELPLINE_AGENT'), validateAdviceOutcome, adviceOutcome)
router.get('/:applicationId', applicationIdParam, read)
router.post('/:applicationId/review', applicationIdParam, requireRole('DLAO_OFFICER'), validateReview, review)
router.post('/:applicationId/review-override', applicationIdParam, requireRole('DLAO_OFFICER'), validateReviewOverride, overrideReview)
router.post('/:applicationId/priority-override', applicationIdParam, requireRole('DLAO_OFFICER'), validatePriorityOverride, priorityOverride)
router.post('/:applicationId/assigned-officer', applicationIdParam, requireRole('DLAO_OFFICER'), validateOfficerAssignment, takeCase)
router.post('/:applicationId/accept', applicationIdParam, requireRole('DLAO_OFFICER'), validateAcceptance, accept)
router.post('/:applicationId/cancellation-requests/:requestId/review', applicationIdParam, cancellationRequestParam, requireRole('DLAO_OFFICER'), validateCancellationReview, reviewCancellation)
router.get('/:applicationId/tasks', applicationIdParam, requireRole('DLAO_OFFICER', 'CASE_SUPPORT'), readTasks)
router.post('/:applicationId/tasks', applicationIdParam, requireRole('DLAO_OFFICER', 'CASE_SUPPORT'), validateTask, addTask)
router.post('/:applicationId/tasks/:taskId/complete', applicationIdParam, taskIdParam, requireRole('DLAO_OFFICER', 'CASE_SUPPORT'), finishTask)
router.get('/:applicationId/contact-attempts', applicationIdParam, requireRole('DLAO_OFFICER', 'CASE_SUPPORT'), readContactAttempts)
router.post('/:applicationId/contact-attempts', applicationIdParam, requireRole('DLAO_OFFICER'), validateContactAttempt, addContactAttempt)
router.get('/:applicationId/documents', applicationIdParam, requireRole('DLAO_OFFICER', 'CASE_SUPPORT', 'MEDIATOR'), readDocuments)
router.post('/:applicationId/documents', applicationIdParam, requireRole('DLAO_OFFICER'), validateDocument, addDocument)
router.get('/:applicationId/evidence-access', applicationIdParam, requireRole('DLAO_OFFICER'), readEvidenceAccess)
router.get('/:applicationId/referrals', applicationIdParam, requireRole('DLAO_OFFICER'), readForApplication)
router.post('/:applicationId/referrals', applicationIdParam, requireRole('DLAO_OFFICER'), validateReferral, send)
router.post('/:applicationId/routing-decision', applicationIdParam, requireRole('DLAO_OFFICER'), validateRoutingDecision, routingDecision)
router.get('/:applicationId/briefing', applicationIdParam, requireRole('DLAO_OFFICER', 'CASE_SUPPORT'), readBriefing)
router.post('/:applicationId/briefing', applicationIdParam, requireRole('DLAO_OFFICER'), validateEmptyBody, generateBriefing)
router.post('/:applicationId/briefing/approve', applicationIdParam, requireRole('DLAO_OFFICER'), validateBriefingApproval, approveDocumentBriefing)
router.post('/:applicationId/representations', applicationIdParam, requireRole('DLAO_OFFICER'), validateRepresentation, addRepresentative)
router.get('/:applicationId/facts', applicationIdParam, requireRole('DLAO_OFFICER'), readFacts)
router.post('/:applicationId/facts', applicationIdParam, requireRole('DLAO_OFFICER'), validateFact, recordFact)
router.post('/:applicationId/facts/:factId/corrections', applicationIdParam, factIdParam, requireRole('DLAO_OFFICER'), validateCorrection, recordCorrection)
router.post('/:applicationId/facts/:factId/verification', applicationIdParam, factIdParam, requireRole('DLAO_OFFICER'), validateFactVerification, recordFactVerification)
router.post('/:applicationId/withdrawal', applicationIdParam, requireRole('DLAO_OFFICER'), validateApplicantWithdrawal, withdraw)
router.post('/:applicationId/safe-contact', applicationIdParam, requireRole('DLAO_OFFICER'), validateSafeContact, updateSafeContact)
router.get('/:applicationId/safe-contact', applicationIdParam, requireRole('DLAO_OFFICER', 'PANEL_LAWYER'), readSafeContact)
router.post('/:applicationId/consents', applicationIdParam, requireRole('DLAO_OFFICER'), validateConsent, addConsent)
router.get('/:applicationId/audit', applicationIdParam, requireRole('DLAO_OFFICER'), readAudit)
router.get('/:applicationId/history', applicationIdParam, requireRole('DLAO_OFFICER', 'CASE_SUPPORT'), readHistory)
router.put('/:applicationId/case-info', applicationIdParam, requireRole('DLAO_OFFICER'), validateEditCaseInfo, updateCaseInfo)
router.post('/:applicationId/pre-mediation-verify', applicationIdParam, requireRole('DLAO_OFFICER', 'MEDIATOR'), validatePreMediationVerify, verifyPreMediation)
router.post('/:applicationId/notices', applicationIdParam, requireRole('DLAO_OFFICER', 'MEDIATOR'), validateNoticeDispatch, sendNotice)
router.get('/:applicationId/transcript', applicationIdParam, requireRole('DLAO_OFFICER', 'PANEL_LAWYER'), readTranscript)
router.get('/:applicationId/recording', applicationIdParam, requireRole('DLAO_OFFICER', 'PANEL_LAWYER'), readRecording)
export default router
