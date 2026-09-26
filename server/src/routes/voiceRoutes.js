import express, { Router } from 'express'
import { storeRecording, submitVoice, transcribeVoiceAnswer } from '../controllers/applicationController.js'
import { speakPrompt, speakStatus, transcribeSpeech, understandRequest } from '../controllers/voiceStatusController.js'
import { limitPublic, limitStatusLookup } from '../middleware/rateLimit.js'
import { optionalAuth } from '../middleware/auth.js'
import { applicationIdParam, validateAnswerAudio, validateCallRecording, validateSpeechAudio, validateSpokenRequest, validateTrackLookup, validateVoiceIntake, validateVoiceLanguage, validateVoicePrompt } from '../validators/requests.js'

const router = Router()
// One spoken answer at a time: the clip is transcribed, understood, and discarded.
router.post('/answers', limitPublic(120), express.raw({ type: ['audio/*', 'video/webm'], limit: '2mb' }), validateAnswerAudio, transcribeVoiceAnswer)
router.post('/intakes', limitPublic(20), optionalAuth, validateVoiceIntake, submitVoice)
// The full call recording, uploaded once after submission and proven with that submission's one-time status code.
router.post('/intakes/:applicationId/recording', limitPublic(20), applicationIdParam, express.raw({ type: ['audio/*', 'video/webm'], limit: '8mb' }), validateCallRecording, storeRecording)
// Spoken status (A5): transcribe a turn, speak a fixed prompt, and speak the status for an ID and its code, in Bangla
// or English (`?lang=`).
router.post('/transcripts', limitPublic(120), express.raw({ type: ['audio/*', 'video/webm'], limit: '2mb' }), validateSpeechAudio, transcribeSpeech)
router.post('/requests', limitPublic(60), validateSpokenRequest, understandRequest)
router.post('/prompts', limitPublic(120), validateVoiceLanguage, validateVoicePrompt, speakPrompt)
router.post('/status', limitStatusLookup, validateVoiceLanguage, validateTrackLookup, speakStatus)
export default router
