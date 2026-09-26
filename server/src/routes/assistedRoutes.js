import express, { Router } from 'express'
import { create, read, resolve, revise, transcribeOriginal } from '../controllers/assistedController.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { limitPublic } from '../middleware/rateLimit.js'
import { assistedParam, validateAssistedAudio, validateAssistedCreate, validateAssistedRevision, validateConflictResolution } from '../validators/assisted.js'

const router = Router()
router.use(requireAuth, requireRole('UDC_OPERATOR'))
// Audio is transcribed and discarded; the draft fill stays editable and translator-verified.
router.post('/transcribe', limitPublic(60), express.raw({ type: ['audio/*', 'video/webm'], limit: '2mb' }), validateAssistedAudio, transcribeOriginal)
router.post('/', validateAssistedCreate, create)
router.get('/:applicationId', assistedParam, read)
router.post('/:applicationId/revisions', assistedParam, validateAssistedRevision, revise)
router.post('/:applicationId/conflicts/resolve', assistedParam, validateConflictResolution, resolve)
export default router
