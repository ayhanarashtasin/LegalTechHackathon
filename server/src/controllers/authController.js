import { changePassword, getDemoCredentials, login, logout, registerCitizen } from '../services/authService.js'

export async function demoAccount(request, response) {
  response.json(await getDemoCredentials(request.params.role))
}

export async function signIn(request, response) {
  response.json(await login(request.body.username, request.body.password, request.ip))
}

export async function signUp(request, response) {
  const { username, password, nid, name, displayName, phone } = request.body || {}
  response.status(201).json(await registerCitizen(username, password, nid, name || displayName, phone))
}

export function currentUser(request, response) {
  response.json({
    user: {
      id: request.auth.userId,
      username: request.auth.username,
      displayName: request.auth.displayName,
      acceptingCases: request.auth.acceptingCases ?? true,
      assignments: request.auth.assignments.map(({ role, officeCode }) => ({ role, officeCode })),
    },
  })
}

export async function signOut(request, response) {
  await logout(request.token)
  response.status(204).end()
}

export async function changeUserPassword(request, response) {
  const { currentPassword, newPassword } = request.body || {}
  const result = await changePassword(request.auth.userId, currentPassword, newPassword)
  response.json(result)
}

