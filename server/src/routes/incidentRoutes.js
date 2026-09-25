import { Router } from 'express'
import { applicationIdParam } from '../validators/requests.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import {
  incidentGroupIdParam, otherApplicationIdParam, validateDuplicateReview, validateIncidentEvidence, validateIncidentGroup,
} from '../validators/incident.js'
import { applicationGroups, createGroup, duplicateCandidates, linkEvidence, readGroup, reviewDuplicate } from '../controllers/incidentController.js'

const router = Router()
router.use(requireAuth)
router.get('/applications/:applicationId/incidents', applicationIdParam, requireRole('DLAO_OFFICER', 'CASE_SUPPORT'), applicationGroups)
router.post('/applications/:applicationId/incidents', applicationIdParam, requireRole('DLAO_OFFICER'), validateIncidentGroup, createGroup)
router.get('/applications/:applicationId/duplicates', applicationIdParam, requireRole('DLAO_OFFICER', 'CASE_SUPPORT'), duplicateCandidates)
router.post('/applications/:applicationId/duplicates/:otherApplicationId/review', applicationIdParam, otherApplicationIdParam, requireRole('DLAO_OFFICER'), validateDuplicateReview, reviewDuplicate)
router.get('/incidents/:groupId', incidentGroupIdParam, requireRole('DLAO_OFFICER', 'CASE_SUPPORT'), readGroup)
router.post('/incidents/:groupId/evidence', incidentGroupIdParam, requireRole('DLAO_OFFICER'), validateIncidentEvidence, linkEvidence)
export default router
