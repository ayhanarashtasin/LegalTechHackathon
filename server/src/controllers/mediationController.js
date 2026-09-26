import {
  advanceMediation, amendSettlementDraft, certifyMediation, createSettlementDraft, getMediation, listMediators, setMediator,
  recordAttendance, recordDocumentReview, recordLegalApplicability, recordMediationSession, recordOutcome, recordScheduling,
  issueSigningInvitation, openPartySigning, recordPartySignature, recordSignature,
  reviewSettlementDraft, startMediation, verifyMediation,
} from '../services/mediationService.js'

export async function read(request, response) { response.json(await getMediation(request.params.applicationId, request.auth)) }
export async function create(request, response) { response.status(201).json(await startMediation(request.params.applicationId, request.auth)) }
export async function mediators(request, response) { response.json(await listMediators(request.params.applicationId, request.auth)) }
export async function appoint(request, response) { response.json(await setMediator(request.params.applicationId, request.body, request.auth)) }
export async function schedule(request, response) { response.json(await recordScheduling(request.params.applicationId, request.body, request.auth)) }
export async function advance(request, response) { response.json(await advanceMediation(request.params.applicationId, request.auth)) }
export async function reviewDocuments(request, response) { response.json(await recordDocumentReview(request.params.applicationId, request.body, request.auth)) }
export async function attendance(request, response) { response.json(await recordAttendance(request.params.applicationId, request.body, request.auth)) }
export async function outcome(request, response) { response.json(await recordOutcome(request.params.applicationId, request.body, request.auth)) }
export async function draft(request, response) { response.status(201).json(await createSettlementDraft(request.params.applicationId, request.body, request.auth)) }
export async function amendDraft(request, response) { response.json(await amendSettlementDraft(request.params.applicationId, request.body, request.auth)) }
export async function reviewDraft(request, response) { response.json(await reviewSettlementDraft(request.params.applicationId, request.body, request.auth)) }
export async function sign(request, response) { response.status(201).json(await recordSignature(request.params.applicationId, request.body, request.auth)) }
export async function inviteParty(request, response) { response.status(201).json(await issueSigningInvitation(request.params.applicationId, request.body.signerRole, request.auth)) }
export async function openParty(request, response) { response.json(await openPartySigning(request.body.code)) }
export async function signParty(request, response) { response.status(201).json(await recordPartySignature(request.body.code, request.body)) }
export async function verify(request, response) { response.json(await verifyMediation(request.params.applicationId, request.auth)) }
export async function legalApplicability(request, response) { response.json(await recordLegalApplicability(request.params.applicationId, request.body, request.auth)) }
export async function certify(request, response) { response.json(await certifyMediation(request.params.applicationId, request.body, request.auth)) }
export async function addSession(request, response) { response.status(201).json(await recordMediationSession(request.params.applicationId, request.body, request.auth)) }
