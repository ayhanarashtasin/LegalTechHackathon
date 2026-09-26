import { cancelOrRequestCancellation, getCitizenCases, getCitizenProfile, requestCitizenLawyerChange, submitDigitalApplication, updateCitizenProfile } from '../services/citizenService.js'

export async function listCases(request, response) {
  const cases = await getCitizenCases(request.auth)
  response.json({ cases })
}

export async function createApplication(request, response) {
  const result = await submitDigitalApplication(request.body, request.auth)
  response.status(201).json(result)
}

export async function submitLawyerChange(request, response) {
  const result = await requestCitizenLawyerChange(
    request.params.applicationId,
    request.body,
    request.auth
  )
  response.status(201).json(result)
}

export async function cancelCase(request, response) {
  const result = await cancelOrRequestCancellation(
    request.params.applicationId,
    request.body,
    request.auth
  )
  response.status(201).json(result)
}

export async function getProfile(request, response) {
  const profile = await getCitizenProfile(request.auth)
  response.json({ profile })
}

export async function updateProfile(request, response) {
  const profile = await updateCitizenProfile(request.body, request.auth)
  response.json({ profile })
}

