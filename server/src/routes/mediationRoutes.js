import { Router } from 'express'
import { applicationIdParam } from '../validators/requests.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { limitPublic } from '../middleware/rateLimit.js'
import {
  validateAttendance, validateCertification, validateEmptyMediationBody, validateLegalApplicability,
  validateOutcome, validateReason, validateScheduling, validateSettlementDraft, validateSettlementReview,
  validateSettlementAmendment, validateSignature, validateSigningCode,
  validateSigningInvitation, validatePartySignature, validateVerificationBody,
} from '../validators/mediation.js'
import {
  advance, amendDraft, attendance, certify, claim, create, draft, legalApplicability, outcome,
  inviteParty, openParty, read, reviewDocuments, reviewDraft, schedule, sign, signParty, verify,
} from '../controllers/mediationController.js'

const router = Router()
router.post('/mediation-signing/open', limitPublic(60), validateSigningCode, openParty)
router.post('/mediation-signing/sign', limitPublic(60), validatePartySignature, signParty)
router.use(requireAuth)
router.get('/applications/:applicationId/mediation', applicationIdParam, requireRole('DLAO_OFFICER', 'MEDIATOR', 'CLAO'), read)
router.post('/applications/:applicationId/mediation', applicationIdParam, requireRole('DLAO_OFFICER'), validateEmptyMediationBody, create)
router.post('/applications/:applicationId/mediation/claim', applicationIdParam, requireRole('MEDIATOR'), validateEmptyMediationBody, claim)
router.post('/applications/:applicationId/mediation/schedule', applicationIdParam, requireRole('MEDIATOR'), validateScheduling, schedule)
router.post('/applications/:applicationId/mediation/advance', applicationIdParam, requireRole('MEDIATOR'), validateEmptyMediationBody, advance)
router.post('/applications/:applicationId/mediation/documents/review', applicationIdParam, requireRole('MEDIATOR'), validateReason, reviewDocuments)
router.post('/applications/:applicationId/mediation/attendance', applicationIdParam, requireRole('MEDIATOR'), validateAttendance, attendance)
router.post('/applications/:applicationId/mediation/outcome', applicationIdParam, requireRole('MEDIATOR'), validateOutcome, outcome)
router.post('/applications/:applicationId/mediation/draft', applicationIdParam, requireRole('MEDIATOR'), validateSettlementDraft, draft)
router.post('/applications/:applicationId/mediation/draft/amend', applicationIdParam, requireRole('MEDIATOR'), validateSettlementAmendment, amendDraft)
router.post('/applications/:applicationId/mediation/draft/review', applicationIdParam, requireRole('MEDIATOR'), validateSettlementReview, reviewDraft)
router.post('/applications/:applicationId/mediation/signing-invitations', applicationIdParam, requireRole('MEDIATOR'), validateSigningInvitation, inviteParty)
router.post('/applications/:applicationId/mediation/signatures', applicationIdParam, requireRole('MEDIATOR'), validateSignature, sign)
router.post('/applications/:applicationId/mediation/verify', applicationIdParam, requireRole('DLAO_OFFICER', 'MEDIATOR', 'CLAO'), validateVerificationBody, verify)
router.post('/applications/:applicationId/mediation/legal-applicability', applicationIdParam, requireRole('CLAO'), validateLegalApplicability, legalApplicability)
router.post('/applications/:applicationId/mediation/certify', applicationIdParam, requireRole('CLAO'), validateCertification, certify)
export default router
