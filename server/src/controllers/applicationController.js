import { extractAnswers, transcribeAnswer } from '../services/ai/groq.js'
import { acceptApplication, addFact, assignOfficer, recordApplicantWithdrawal, verifyFact, recordAdviceOutcome, addRepresentation, completeTask, correctFact, createTask, editCaseInformation, getApplication, getApplicationAudit, getCallRecording, getCaseHistory, getFacts, getSafeContact, getTranscript, listContactAttempts, listTasks, listWorkspace, lookupHelplineStatus, overridePriority, preMediationVerify, recordConsent, recordContactAttempt, recordNoticeSent, reviewApplication, reviewCaseCancellationRequest, searchRecord, setSafeContact, storeCallRecording, submitApplication, submitVoiceIntake, trackApplicationStatus } from '../services/applicationService.js'

export async function submit(request, response) {
  response.status(201).json(await submitApplication(request.body, request.auth))
}

export async function adviceOutcome(request, response) {
  response.json(await recordAdviceOutcome(request.params.applicationId, request.body, request.auth))
}

export async function submitVoice(request, response) {
  response.status(201).json(await submitVoiceIntake(request.body, request.auth))
}

export async function storeRecording(request, response) {
  response.status(201).json(await storeCallRecording(request.params.applicationId, request.get('x-lookup-code'), request.body, request.audioType))
}

export async function readRecording(request, response) {
  const recording = await getCallRecording(request.params.applicationId, request.auth)
  response.type(recording.mimeType).send(Buffer.from(recording.audio))
}

export async function transcribeVoiceAnswer(request, response) {
  const lang = request.query.lang === 'en' ? 'en' : 'bn'
  const text = await transcribeAnswer(request.body, request.get('content-type'), undefined, lang)
  const { values, sensitive } = await extractAnswers(text, request.query.fields.split(','))
  response.json({ text, values, sensitive })
}

export async function readTranscript(request, response) {
  response.json(await getTranscript(request.params.applicationId, request.auth))
}

export async function read(request, response) {
  response.json(await getApplication(request.params.applicationId, request.auth))
}

export async function search(request, response) {
  response.json(await searchRecord(request.query.identifier, request.auth))
}

export async function workspace(request, response) {
  response.json(await listWorkspace(request.query.role, request.auth))
}

export async function review(request, response) {
  response.json(await reviewApplication(request.params.applicationId, request.body, request.auth))
}

export async function overrideReview(request, response) {
  response.json(await reviewApplication(request.params.applicationId, request.body, request.auth, true))
}

export async function priorityOverride(request, response) {
  response.json(await overridePriority(request.params.applicationId, request.body, request.auth))
}

export async function readHistory(request, response) {
  response.json(await getCaseHistory(request.params.applicationId, request.auth))
}

export async function helplineStatus(request, response) {
  response.json(await lookupHelplineStatus(request.body.identifier, request.body.lookupCode, request.auth, request.body.contactChannel))
}

export async function takeCase(request, response) {
  response.json(await assignOfficer(request.params.applicationId, request.body, request.auth))
}

export async function accept(request, response) {
  response.json(await acceptApplication(request.params.applicationId, request.body.reason, request.auth))
}

export async function reviewCancellation(request, response) {
  response.json(await reviewCaseCancellationRequest(request.params.applicationId, request.params.requestId, request.body, request.auth))
}

export async function addRepresentative(request, response) {
  response.status(201).json(await addRepresentation(request.params.applicationId, request.body, request.auth))
}

export async function recordFact(request, response) {
  const fact = await addFact(request.params.applicationId, request.body, request.auth)
  response.status(201).json(fact)
}

export async function recordCorrection(request, response) {
  const fact = await correctFact(request.params.applicationId, request.params.factId, request.body, request.auth)
  response.status(201).json(fact)
}

export async function readFacts(request, response) {
  response.json(await getFacts(request.params.applicationId, request.auth))
}

export async function recordFactVerification(request, response) {
  response.status(201).json(await verifyFact(request.params.applicationId, request.params.factId, request.body, request.auth))
}

export async function withdraw(request, response) {
  response.json(await recordApplicantWithdrawal(request.params.applicationId, request.body, request.auth))
}

export async function updateSafeContact(request, response) {
  response.status(201).json(await setSafeContact(request.params.applicationId, request.body, request.auth))
}

export async function readSafeContact(request, response) {
  response.json(await getSafeContact(request.params.applicationId, request.auth))
}

export async function addConsent(request, response) {
  response.status(201).json(await recordConsent(request.params.applicationId, request.body, request.auth))
}

export async function readTasks(request, response) {
  response.json(await listTasks(request.params.applicationId, request.auth))
}

export async function addTask(request, response) {
  response.status(201).json(await createTask(request.params.applicationId, request.body, request.auth))
}

export async function finishTask(request, response) {
  response.json(await completeTask(request.params.applicationId, request.params.taskId, request.auth))
}

export async function readContactAttempts(request, response) {
  response.json(await listContactAttempts(request.params.applicationId, request.auth))
}

export async function addContactAttempt(request, response) {
  response.status(201).json(await recordContactAttempt(request.params.applicationId, request.body, request.auth))
}

export async function readAudit(request, response) {
  response.json(await getApplicationAudit(request.params.applicationId, request.auth))
}

export async function trackStatus(request, response) {
  response.json(await trackApplicationStatus(request.body.identifier, request.body.lookupCode))
}

export async function updateCaseInfo(request, response) {
  response.json(await editCaseInformation(request.params.applicationId, request.body, request.auth))
}

export async function verifyPreMediation(request, response) {
  response.json(await preMediationVerify(request.params.applicationId, request.body, request.auth))
}

export async function sendNotice(request, response) {
  response.status(201).json(await recordNoticeSent(request.params.applicationId, request.body, request.auth))
}

