import { addDocumentVersion, createDocumentMetadata, getDocument, listDocuments, listDocumentVersions, listEvidenceAccess } from '../services/applicationService.js'
import { approveBriefing, getBriefing, getDocumentSource, proposeBriefing } from '../services/documentAgentService.js'

export async function readDocument(request, response) {
  response.json(await getDocument(request.params.documentId, request.auth))
}

export async function readDocuments(request, response) {
  response.json(await listDocuments(request.params.applicationId, request.auth))
}

export async function readEvidenceAccess(request, response) {
  response.json(await listEvidenceAccess(request.params.applicationId, request.auth))
}

export async function addDocument(request, response) {
  response.status(201).json(await createDocumentMetadata(request.params.applicationId, request.body, request.auth))
}

export async function readVersions(request, response) {
  response.json(await listDocumentVersions(request.params.documentId, request.auth))
}

export async function readDocumentSource(request, response) {
  response.json(await getDocumentSource(request.params.documentId, Number(request.params.version), request.auth))
}

export async function addVersion(request, response) {
  response.status(201).json(await addDocumentVersion(request.params.documentId, request.body, request.auth))
}

export async function readBriefing(request, response) {
  response.json(await getBriefing(request.params.applicationId, request.auth))
}

export async function generateBriefing(request, response) {
  response.status(201).json(await proposeBriefing(request.params.applicationId, request.auth))
}

export async function approveDocumentBriefing(request, response) {
  response.json(await approveBriefing(request.params.applicationId, request.body.reason, request.auth))
}
