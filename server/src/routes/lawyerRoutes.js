import { Router } from 'express'
import {
  assignment, assignmentResponse, casePlan, changeRequest, changeReview, holdReview, lawyerActivity,
  management, paymentStatus, progressUpdate, scheduleUpdate, updateReminder, worklist,
} from '../controllers/lawyerController.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { applicationIdParam, validateEmptyBody } from '../validators/requests.js'
import {
  assignmentParam, changeRequestParam, holdUserParam, updateParam, validateAssignment,
  validateAssignmentResponse, validateCasePlan, validateChangeReview, validateHoldReview,
  validateLawyerChangeRequest, validatePaymentStatus, validateProgressReport, validateUpdateSchedule,
} from '../validators/lawyer.js'

const router = Router()
router.use(requireAuth)
router.get('/worklist', requireRole('PANEL_LAWYER'), worklist)
router.get('/applications/:applicationId', applicationIdParam, requireRole('DLAO_OFFICER'), management)
router.post('/applications/:applicationId/case-plan', applicationIdParam, requireRole('DLAO_OFFICER'), validateCasePlan, casePlan)
router.post('/applications/:applicationId/assignments', applicationIdParam, requireRole('DLAO_OFFICER'), validateAssignment, assignment)
router.post('/applications/:applicationId/update-schedules', applicationIdParam, requireRole('DLAO_OFFICER'), validateUpdateSchedule, scheduleUpdate)
router.post('/applications/:applicationId/updates/:updateId/reminders', applicationIdParam, updateParam, requireRole('DLAO_OFFICER'), validateEmptyBody, updateReminder)
router.get('/panel-lawyers/:lawyerUserId/activity', holdUserParam, requireRole('DLAO_OFFICER'), lawyerActivity)
router.post('/applications/:applicationId/change-requests', applicationIdParam, requireRole('HELPLINE_AGENT'), validateLawyerChangeRequest, changeRequest)
router.post('/applications/:applicationId/change-requests/:requestId/review', applicationIdParam, changeRequestParam, requireRole('DLAO_OFFICER'), validateChangeReview, changeReview)
router.post('/assignments/:assignmentId/respond', assignmentParam, requireRole('PANEL_LAWYER'), validateAssignmentResponse, assignmentResponse)
router.post('/assignments/:assignmentId/updates/:updateId', assignmentParam, updateParam, requireRole('PANEL_LAWYER'), validateProgressReport, progressUpdate)
router.post('/assignments/:assignmentId/payment-status', assignmentParam, requireRole('DLAO_OFFICER'), validatePaymentStatus, paymentStatus)
router.post('/holds/:lawyerUserId/review', holdUserParam, requireRole('DLAO_OFFICER'), validateHoldReview, holdReview)
export default router
