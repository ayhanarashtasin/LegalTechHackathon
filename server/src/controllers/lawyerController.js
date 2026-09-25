import {
  assignLawyer, getLawyerActivity, getLawyerManagement, getLawyerWorklist, remindLawyerUpdate, requestLawyerChange,
  respondToAssignment, reviewLawyerChange, reviewLawyerHold, scheduleLawyerUpdate, submitLawyerUpdate, updateCasePlan,
  updateLawyerPaymentStatus,
} from '../services/lawyerService.js'

export async function worklist(request, response) {
  response.json(await getLawyerWorklist(request.auth))
}

export async function updateReminder(request, response) {
  response.status(201).json(await remindLawyerUpdate(request.params.applicationId, request.params.updateId, request.auth))
}

export async function lawyerActivity(request, response) {
  response.json(await getLawyerActivity(request.params.lawyerUserId, request.auth))
}

export async function management(request, response) {
  response.json(await getLawyerManagement(request.params.applicationId, request.auth))
}

export async function casePlan(request, response) {
  response.json(await updateCasePlan(request.params.applicationId, request.body, request.auth))
}

export async function assignment(request, response) {
  response.status(201).json(await assignLawyer(request.params.applicationId, request.body, request.auth))
}

export async function assignmentResponse(request, response) {
  response.json(await respondToAssignment(request.params.assignmentId, request.body, request.auth))
}

export async function scheduleUpdate(request, response) {
  response.status(201).json(await scheduleLawyerUpdate(request.params.applicationId, request.body, request.auth))
}

export async function progressUpdate(request, response) {
  response.json(await submitLawyerUpdate(request.params.assignmentId, request.params.updateId, request.body, request.auth))
}

export async function changeRequest(request, response) {
  response.status(201).json(await requestLawyerChange(request.params.applicationId, request.body, request.auth))
}

export async function changeReview(request, response) {
  response.json(await reviewLawyerChange(request.params.applicationId, request.params.requestId, request.body, request.auth))
}

export async function holdReview(request, response) {
  response.json(await reviewLawyerHold(request.params.lawyerUserId, request.body, request.auth))
}

export async function paymentStatus(request, response) {
  response.status(201).json(await updateLawyerPaymentStatus(request.params.assignmentId, request.body, request.auth))
}
