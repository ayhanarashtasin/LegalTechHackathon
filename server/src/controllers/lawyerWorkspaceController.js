import * as workspace from '../services/lawyerWorkspaceService.js'

export async function read(request, response) { response.json(await workspace.getLawyerWorkspace(request.params.assignmentId, request.auth)) }
export async function entry(request, response) { response.status(201).json(await workspace.createLawyerEntry(request.params.assignmentId, request.body, request.auth)) }
export async function claim(request, response) { response.status(201).json(await workspace.createFeeClaim(request.params.assignmentId, request.body, request.auth)) }
export async function claimReview(request, response) { response.json(await workspace.reviewFeeClaim(request.params.assignmentId, request.params.claimId, request.body, request.auth)) }
export async function outcomeReview(request, response) { response.json(await workspace.reviewLawyerOutcome(request.params.assignmentId, request.params.entryId, request.body, request.auth)) }
export async function upload(request, response) { response.status(201).json(await workspace.uploadLawyerPdf(request.params.assignmentId, request.upload, request.body, request.auth)) }
export async function documentReview(request, response) { response.json(await workspace.reviewLawyerDocument(request.params.assignmentId, request.params.documentId, request.body, request.auth)) }
export async function download(request, response) {
  const file = await workspace.downloadLawyerPdf(request.params.assignmentId, request.params.documentId, request.auth, request.query.version ? Number(request.query.version) : undefined)
  response.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="case-document.pdf"; filename*=UTF-8''${encodeURIComponent(file.filename)}` }).send(file.bytes)
}
export async function feedback(request, response) { response.status(201).json(await workspace.submitClientFeedback(request.params.assignmentId, request.body, request.auth)) }
