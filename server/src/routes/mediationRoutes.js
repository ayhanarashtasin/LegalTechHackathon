import { Router, raw } from 'express'
import * as identity from '../controllers/partyVerificationController.js'
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
  inviteParty, openParty, read, reviewDocuments, reviewDraft, schedule, sign, signParty, verify, addSession,
} from '../controllers/mediationController.js'

// Party signing is public (the one-time code is the credential), so app.js mounts it at its own path,
// ahead of the '/api' routers whose requireAuth would otherwise answer first.
export const partySigningRoutes = Router()
partySigningRoutes.post('/open', limitPublic(60), validateSigningCode, openParty)
partySigningRoutes.post('/sign', limitPublic(60), validatePartySignature, signParty)
partySigningRoutes.post('/verification/state', limitPublic(60), identity.state)
partySigningRoutes.post('/verification/begin', limitPublic(12), identity.begin)
partySigningRoutes.post('/verification/submit', limitPublic(12), identity.submit)
partySigningRoutes.post('/verification/evidence/:slot', limitPublic(24), raw({ type: ['video/webm', 'video/mp4', 'image/png', 'image/jpeg', 'application/pdf'], limit: '4mb' }), identity.upload)
partySigningRoutes.get('/verification/evidence/:evidenceId', limitPublic(60), identity.evidence)

const router = Router()
router.use(requireAuth)
router.get('/applications/:applicationId/mediation/identity', applicationIdParam, requireRole('MEDIATOR'), identity.list)
router.post('/applications/:applicationId/mediation/identity/review', applicationIdParam, requireRole('MEDIATOR'), identity.review)
router.get('/applications/:applicationId/mediation/identity/evidence/:evidenceId', applicationIdParam, requireRole('MEDIATOR'), identity.evidence)
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
router.post('/applications/:applicationId/mediation/sessions', applicationIdParam, requireRole('DLAO_OFFICER', 'MEDIATOR'), addSession)
export default router
