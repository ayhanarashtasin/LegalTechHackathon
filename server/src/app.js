import express from 'express'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import healthRoutes from './routes/healthRoutes.js'
import authRoutes from './routes/authRoutes.js'
import applicationRoutes from './routes/applicationRoutes.js'
import caseRoutes from './routes/caseRoutes.js'
import documentRoutes from './routes/documentRoutes.js'
import workspaceRoutes from './routes/workspaceRoutes.js'
import voiceRoutes from './routes/voiceRoutes.js'
import assistedRoutes from './routes/assistedRoutes.js'
import referralRoutes from './routes/referralRoutes.js'
import lawyerRoutes from './routes/lawyerRoutes.js'
import incidentRoutes from './routes/incidentRoutes.js'
import triageRoutes from './routes/triageRoutes.js'
import mediationRoutes, { partySigningRoutes } from './routes/mediationRoutes.js'
import citizenRoutes from './routes/citizenRoutes.js'
import { errorHandler, notFound } from './middleware/errors.js'

const app = express()
app.disable('x-powered-by')
const clientContentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "media-src 'self' blob:",
  "worker-src 'self'",
  "manifest-src 'self'",
].join('; ')

app.use((_request, response, next) => {
  response.set({
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    'Permissions-Policy': 'camera=(self), microphone=(self), geolocation=()',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  })
  next()
})
app.use((request, response, next) => {
  const origin = request.get('Origin')
  if (origin && origin === process.env.CLIENT_ORIGIN) {
    response.vary('Origin')
    response.set({
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Lookup-Code, X-Signing-Code',
    })
    if (request.method === 'OPTIONS') return response.status(204).end()
  }
  next()
})
app.use('/api', (_request, response, next) => { response.set('Cache-Control', 'no-store'); next() })
app.use('/api/citizen/applications', express.json({ limit: '10mb' }))
app.use('/api/lawyers/assignments/:assignmentId/documents', express.raw({ type: 'application/pdf', limit: '4mb' }))
app.use(express.json({ limit: '128kb' }))
app.use('/health', healthRoutes)
app.use('/api/auth', authRoutes)
app.use('/api/applications', applicationRoutes)
app.use('/api/cases', caseRoutes)
app.use('/api/documents', documentRoutes)
app.use('/api/workspace', workspaceRoutes)
app.use('/api/voice', voiceRoutes)
app.use('/api/assisted', assistedRoutes)
app.use('/api/referrals', referralRoutes)
app.use('/api/lawyers', lawyerRoutes)
app.use('/api/mediation-signing', partySigningRoutes)
app.use('/api', triageRoutes)
app.use('/api', mediationRoutes)
app.use('/api', incidentRoutes)
app.use('/api/citizen', citizenRoutes)

if (process.env.NODE_ENV === 'production') {
  const clientBuild = fileURLToPath(new URL('../../client/dist/', import.meta.url))
  const clientFiles = express.static(clientBuild, {
    index: false,
    setHeaders: (response) => response.set('Content-Security-Policy', clientContentSecurityPolicy),
  })
  const isApiOrHealth = (path) => /^\/(?:api|health)(?:\/|$)/i.test(path)

  app.use((request, response, next) => isApiOrHealth(request.path) ? next() : clientFiles(request, response, next))
  app.get(/.*/, (request, response, next) => {
    if (isApiOrHealth(request.path) || extname(request.path) || !request.accepts('html')) return next()
    response.vary('Accept')
    response.set('Content-Security-Policy', clientContentSecurityPolicy)
    response.sendFile(join(clientBuild, 'index.html'))
  })
}

app.use(notFound)
app.use(errorHandler)

export default app
