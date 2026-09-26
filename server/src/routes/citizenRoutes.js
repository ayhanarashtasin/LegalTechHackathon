import { Router } from 'express'
import { cancelCase, createApplication, getProfile, listCases, submitLawyerChange, updateProfile } from '../controllers/citizenController.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { applicationIdParam } from '../validators/requests.js'
import { validateCitizenLawyerChangeRequest } from '../validators/lawyer.js'
import { validateCitizenCancellationRequest } from '../validators/cancellation.js'

const router = Router()

router.use(requireAuth)
router.use(requireRole('CITIZEN'))

router.get('/profile', getProfile)
router.put('/profile', updateProfile)
router.get('/cases', listCases)
router.post('/applications', createApplication)
router.post('/cases/:applicationId/lawyer-change', applicationIdParam, validateCitizenLawyerChangeRequest, submitLawyerChange)
router.post('/cases/:applicationId/cancel', applicationIdParam, validateCitizenCancellationRequest, cancelCase)

export default router

