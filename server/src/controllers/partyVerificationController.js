import { beginVerification, readIdentityEvidence, reviewerState, reviewVerification, submitVerification, uploadIdentityEvidence, verificationState } from '../services/partyVerificationService.js'

export async function state(request, response) { response.json(await verificationState(request.body?.code)) }
export async function begin(request, response) { response.json(await beginVerification(request.body?.code, request.body)) }
export async function submit(request, response) { response.json(await submitVerification(request.body?.code, request.body)) }
export async function upload(request, response) { response.status(201).json(await uploadIdentityEvidence(request.get('X-Signing-Code'), request.params.slot, request.get('Content-Type') || '', request.body)) }
export async function list(request, response) { response.json(await reviewerState(request.params.applicationId, request.auth)) }
export async function review(request, response) { response.json(await reviewVerification(request.params.applicationId, request.body, request.auth)) }
export async function evidence(request, response) {
  const file = await readIdentityEvidence(request.params.evidenceId, { code: request.auth ? undefined : request.get('X-Signing-Code'), applicationId: request.params.applicationId, actor: request.auth })
  response.set({ 'Content-Type': file.mime, 'Cache-Control': 'no-store', 'Content-Disposition': `${file.mime === 'application/pdf' ? 'attachment' : 'inline'}; filename="private-evidence.${file.mime === 'application/pdf' ? 'pdf' : file.mime.split('/')[1]}"` }).send(file.bytes)
}
