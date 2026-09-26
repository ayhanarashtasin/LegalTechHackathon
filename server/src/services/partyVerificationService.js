import { createCipheriv, createDecipheriv, createHash, randomBytes, randomInt } from 'node:crypto'
import { readFile, writeFile, mkdtemp, unlink, rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import mongoose from 'mongoose'
import { Application, Mediation, PartyEvidence, PartyVerification, SettlementDraft, SigningInvitation } from '../models/index.js'
import { context, recordMutation } from './mediationService.js'
import { HttpError } from '../utils/httpError.js'

const fail = (status, code, message) => { throw new HttpError(status, code, message) }
const hash = (value) => createHash('sha256').update(value).digest('hex')
const fields = { ID: 'idEvidenceId', VIDEO: 'videoEvidenceId', SIGNATURE: 'signatureEvidenceId' }
const run = promisify(execFile)
let keyPromise

async function encryptionKey() {
  if (process.env.IDENTITY_EVIDENCE_KEY) {
    if (!/^[a-f0-9]{64}$/i.test(process.env.IDENTITY_EVIDENCE_KEY)) fail(503, 'IDENTITY_STORAGE_UNAVAILABLE', 'Identity evidence encryption is not configured correctly.')
    return Buffer.from(process.env.IDENTITY_EVIDENCE_KEY, 'hex')
  }
  if (process.env.NODE_ENV === 'production') fail(503, 'IDENTITY_STORAGE_UNAVAILABLE', 'Configure private identity evidence storage before accepting real documents.')
  keyPromise ??= (async () => {
    const path = new URL('../../.identity-evidence-key', import.meta.url)
    try { await writeFile(path, randomBytes(32), { flag: 'wx', mode: 0o600 }) } catch (error) { if (error.code !== 'EEXIST') throw error }
    const key = await readFile(path)
    if (key.length !== 32) fail(503, 'IDENTITY_STORAGE_UNAVAILABLE', 'The local identity evidence key is invalid.')
    return key
  })()
  return keyPromise
}

function retentionDays() {
  const days = Number(process.env.IDENTITY_EVIDENCE_RETENTION_DAYS || (process.env.NODE_ENV === 'production' ? 0 : 30))
  if (!Number.isInteger(days) || days < 1 || days > 365) fail(503, 'IDENTITY_STORAGE_UNAVAILABLE', 'An authorised evidence retention period must be configured (1–365 days).')
  return days
}

export async function currentInvitation(code, session) {
  if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(code)) fail(400, 'INVALID_SIGNING_CODE', 'Enter the private 43-character signing code.')
  const invitation = await SigningInvitation.findOne({ tokenHash: hash(code) }).session(session)
  if (!invitation || invitation.usedAt || invitation.expiresAt <= new Date()) fail(404, 'SIGNING_CODE_UNAVAILABLE', 'This signing code is unavailable or has expired.')
  const [draft, mediation] = await Promise.all([SettlementDraft.findById(invitation.draftId).session(session), Mediation.findById(invitation.mediationId).session(session)])
  if (!draft || !mediation || mediation.stage !== 'SIGNATURES' || draft.status !== 'APPROVED' || String(mediation.settlementDraftId) !== String(draft._id) || draft.version !== invitation.draftVersion) fail(409, 'DOCUMENT_CHANGED', 'The approved document changed. Ask the mediator for a new invitation.')
  return invitation
}

const latest = (invitation, session) => PartyVerification.findOne({ invitationId: invitation._id, tokenHash: invitation.tokenHash }).sort({ createdAt: -1, _id: -1 }).session(session)
function summary(record) {
  if (!record) return null
  const digits = record.challenge?.match(/\d{4}/)?.[0]
  const challengeBn = digits ? `বলুন “হ্যাঁ, এটা আমি”, তারপর ${digits}, এবং মাথা ${record.challenge.includes('left') ? 'বামে' : 'ডানে'} ঘোরান।` : undefined
  return { id: String(record._id), signerRole: record.signerRole, mode: record.mode, status: record.status, challenge: record.challenge, challengeBn, challengeExpiresAt: record.challengeExpiresAt, reason: record.reason, documentType: record.documentType, reviewedAt: record.reviewedAt, expiresAt: record.expiresAt, idEvidenceId: record.idEvidenceId, videoEvidenceId: record.videoEvidenceId, signatureEvidenceId: record.signatureEvidenceId }
}

async function partyAudit(invitation, session, action, record) {
  const application = await Application.findOne({ applicationId: invitation.applicationId }).session(session)
  if (!application) fail(404, 'NOT_FOUND', 'The case is unavailable.')
  await recordMutation(application, session, { userId: null }, 'SYSTEM', action, null, { verificationId: String(record._id), signerRole: record.signerRole, mode: record.mode, status: record.status }, 'The private invitation holder submitted a consenting identity check; human approval remains required.', 'WEB')
}

export async function verificationState(code) {
  const invitation = await currentInvitation(code)
  return { signerRole: invitation.signerRole, verification: summary(await latest(invitation)), retentionDays: retentionDays() }
}

export async function beginVerification(code, input = {}) {
  if (!['REMOTE_VIDEO', 'IN_PERSON', 'ASSISTED'].includes(input.mode) || input.consent !== true) fail(400, 'VERIFICATION_CONSENT_REQUIRED', 'Choose a verification method and consent to the private identity check.')
  retentionDays()
  if (input.mode === 'REMOTE_VIDEO') await encryptionKey()
  return mongoose.connection.transaction(async (session) => {
    const invitation = await currentInvitation(code, session)
    const previous = await latest(invitation, session)
    if (previous && ['VERIFIED', 'PENDING_REVIEW', 'CAPTURING'].includes(previous.status) && (previous.status !== 'CAPTURING' || previous.mode === input.mode && previous.challengeExpiresAt > new Date())) return summary(previous)
    if (await PartyVerification.countDocuments({ invitationId: invitation._id, tokenHash: invitation.tokenHash }).session(session) >= 5) fail(429, 'VERIFICATION_ATTEMPTS_EXCEEDED', 'Ask the mediator for a replacement invitation or an in-person appointment.')
    const challenge = `Say “This is me”, then ${randomInt(1000, 10000)}, and turn your head ${randomInt(2) ? 'left' : 'right'}.`
    const [record] = await PartyVerification.create([{ applicationId: invitation.applicationId, invitationId: invitation._id, tokenHash: invitation.tokenHash, draftVersion: invitation.draftVersion, signerRole: invitation.signerRole, mode: input.mode, status: input.mode === 'REMOTE_VIDEO' ? 'CAPTURING' : 'PENDING_REVIEW', challenge: input.mode === 'REMOTE_VIDEO' ? challenge : undefined, challengeExpiresAt: new Date(Date.now() + 15 * 60 * 1000), consentAt: new Date(), expiresAt: invitation.expiresAt }], { session })
    // Updating the invitation serialises concurrent starts and review/sign operations.
    invitation.updatedAt = new Date()
    await invitation.save({ session })
    await partyAudit(invitation, session, 'MEDIATION_IDENTITY_CHECK_STARTED', record)
    return summary(record)
  })
}

async function validateMedia(slot, mime, bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 16 || bytes.length > (slot === 'VIDEO' ? 4 : 2) * 1024 * 1024) fail(400, 'INVALID_IDENTITY_MEDIA', 'Video files must be below 4 MB; ID and signature images below 2 MB.')
  const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
  const pdf = bytes.subarray(0, 5).toString() === '%PDF-'
  const webm = bytes.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163]))
  const mp4 = bytes.subarray(4, 8).toString() === 'ftyp'
  if (slot !== 'VIDEO') {
    if (!(mime === 'image/png' && png || mime === 'image/jpeg' && jpeg || slot === 'ID' && mime === 'application/pdf' && pdf)) fail(400, 'INVALID_IDENTITY_MEDIA', 'Upload a PNG/JPEG image, or a PDF for the ID document.')
    return
  }
  if (!(mime === 'video/webm' && webm || mime === 'video/mp4' && mp4)) fail(400, 'INVALID_IDENTITY_MEDIA', 'Record a WebM or MP4 video.')
  const folder = await mkdtemp(join(tmpdir(), 'dlas-identity-'))
  const path = join(folder, 'capture')
  try {
    await writeFile(path, bytes, { mode: 0o600 })
    const { stdout } = await run(process.env.FFPROBE_PATH || 'ffprobe', ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-select_streams', 'v:0', '-show_entries', 'stream=codec_type:packet=pts_time,duration_time', '-of', 'json', path], { timeout: 10000, maxBuffer: 1024 * 1024, windowsHide: true })
    const probe = JSON.parse(stdout)
    const packets = (probe.packets ?? []).filter((packet) => Number.isFinite(Number(packet.pts_time)))
    const duration = packets.length ? Math.max(...packets.map((packet) => Number(packet.pts_time) + Number(packet.duration_time || 0))) - Math.min(...packets.map((packet) => Number(packet.pts_time))) : 0
    if (!probe.streams?.some((stream) => stream.codec_type === 'video') || duration < 3 || duration > 12) fail(400, 'INVALID_IDENTITY_MEDIA', 'The video must be 3–12 seconds long. Aim for five seconds.')
  } catch (error) {
    if (error instanceof HttpError) throw error
    if (error.code === 'ENOENT') fail(503, 'IDENTITY_STORAGE_UNAVAILABLE', 'Video validation is unavailable; use an in-person identity check.')
    fail(400, 'INVALID_IDENTITY_MEDIA', 'The video could not be validated. Record it again or use an in-person check.')
  } finally { await unlink(path).catch(() => {}); await rmdir(folder).catch(() => {}) }
}

export async function uploadIdentityEvidence(code, slot, mime, bytes) {
  if (!fields[slot]) fail(400, 'INVALID_IDENTITY_MEDIA', 'Unknown evidence type.')
  const invitation = await currentInvitation(code)
  const verification = await latest(invitation)
  if (!verification || (slot === 'SIGNATURE' ? verification.status !== 'VERIFIED' : verification.status !== 'CAPTURING' || verification.challengeExpiresAt <= new Date())) fail(409, 'VERIFICATION_NOT_OPEN', 'This verification is not accepting that evidence. Refresh its status.')
  mime = mime.split(';')[0].trim().toLowerCase()
  await validateMedia(slot, mime, bytes)
  const key = await encryptionKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(`${verification._id}:${slot}`))
  const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()])
  return mongoose.connection.transaction(async (session) => {
    const activeInvitation = await currentInvitation(code, session)
    const current = await latest(activeInvitation, session)
    if (!current || String(current._id) !== String(verification._id) || (slot === 'SIGNATURE' ? current.status !== 'VERIFIED' : current.status !== 'CAPTURING' || current.challengeExpiresAt <= new Date())) fail(409, 'VERIFICATION_NOT_OPEN', 'The verification changed during upload. Refresh its status.')
    const oldId = current[fields[slot]]
    const [evidence] = await PartyEvidence.create([{ verificationId: current._id, slot, mime, digest: hash(bytes), ciphertext, iv, tag: cipher.getAuthTag(), expiresAt: new Date(Date.now() + retentionDays() * 86400000) }], { session })
    current[fields[slot]] = evidence._id
    await current.save({ session })
    activeInvitation.updatedAt = new Date()
    await activeInvitation.save({ session })
    if (oldId) await PartyEvidence.deleteOne({ _id: oldId }).session(session)
    return { id: String(evidence._id), digest: evidence.digest }
  })
}

export async function submitVerification(code, input = {}) {
  if (!['PASSPORT', 'NATIONAL_ID', 'OTHER'].includes(input.documentType)) fail(400, 'INVALID_IDENTITY_DOCUMENT', 'Choose the type of identity document.')
  return mongoose.connection.transaction(async (session) => {
    const invitation = await currentInvitation(code, session)
    const record = await latest(invitation, session)
    if (record?.status === 'PENDING_REVIEW') return summary(record)
    if (!record || record.status !== 'CAPTURING' || record.challengeExpiresAt <= new Date() || !record.idEvidenceId || !record.videoEvidenceId) fail(409, 'VERIFICATION_NOT_OPEN', 'Upload your ID and fresh challenge video before submitting.')
    record.status = 'PENDING_REVIEW'
    record.documentType = input.documentType
    await record.save({ session })
    await partyAudit(invitation, session, 'MEDIATION_IDENTITY_CHECK_SUBMITTED', record)
    return summary(record)
  })
}

export async function reviewerState(applicationId, actor) {
  const { mediation } = await context(applicationId, actor, undefined, { requireClaim: true })
  const invitations = await SigningInvitation.find({ mediationId: mediation._id, draftId: mediation.settlementDraftId }).lean()
  return Promise.all(invitations.map(async (invitation) => ({ signerRole: invitation.signerRole, usedAt: invitation.usedAt, verification: summary(await latest(invitation)) })))
}

export async function reviewVerification(applicationId, input = {}, actor) {
  if (!mongoose.isValidObjectId(input.verificationId) || !['VERIFIED', 'RETAKE_REQUIRED', 'MANUAL_REVIEW_REQUIRED'].includes(input.status) || typeof input.reason !== 'string' || input.reason.trim().length < 10 || input.reason.length > 1000) fail(400, 'INVALID_IDENTITY_REVIEW', 'Choose a decision and provide a review reason (10–1000 characters).')
  return mongoose.connection.transaction(async (session) => {
    const { application, role } = await context(applicationId, actor, session, { requireClaim: true })
    const record = await PartyVerification.findOne({ _id: input.verificationId, applicationId }).session(session)
    if (!record) fail(404, 'NOT_FOUND', 'Verification not found.')
    const invitation = await SigningInvitation.findById(record.invitationId).session(session)
    if (!invitation || invitation.usedAt || invitation.tokenHash !== record.tokenHash || invitation.expiresAt <= new Date() || String((await latest(invitation, session))?._id) !== String(record._id)) fail(409, 'VERIFICATION_NOT_OPEN', 'This invitation was replaced, used or expired.')
    const draft = await SettlementDraft.findById(invitation.draftId).session(session)
    const mediation = await Mediation.findById(invitation.mediationId).session(session)
    if (!draft || draft.status !== 'APPROVED' || draft.version !== record.draftVersion || mediation?.stage !== 'SIGNATURES' || String(mediation.settlementDraftId) !== String(draft._id)) fail(409, 'DOCUMENT_CHANGED', 'This draft is no longer current.')
    if (record.status !== 'PENDING_REVIEW' && !(record.status === 'VERIFIED' && input.status !== 'VERIFIED')) fail(409, 'VERIFICATION_NOT_OPEN', 'Submit an identity check before reviewing it.')
    if (input.status === 'VERIFIED') {
      if (input.idReviewed !== true || input.personMatched !== true || input.challengeChecked !== true) fail(400, 'INVALID_IDENTITY_REVIEW', 'Confirm the identity document, the person match and the challenge or witnessed consent.')
      if (record.mode === 'REMOTE_VIDEO') {
        const count = await PartyEvidence.countDocuments({ _id: { $in: [record.idEvidenceId, record.videoEvidenceId] }, verificationId: record._id, expiresAt: { $gt: new Date() } }).session(session)
        if (count !== 2) fail(409, 'IDENTITY_EVIDENCE_EXPIRED', 'The evidence expired. Request a new verification.')
      }
    }
    const previousState = { status: record.status }
    record.status = input.status
    record.reason = input.reason.trim()
    record.reviewerUserId = actor.userId
    record.reviewedAt = new Date()
    await record.save({ session })
    invitation.updatedAt = new Date()
    await invitation.save({ session })
    await recordMutation(application, session, actor, role, 'MEDIATION_IDENTITY_REVIEWED', previousState, { verificationId: String(record._id), signerRole: record.signerRole, status: record.status, mode: record.mode, draftVersion: record.draftVersion }, 'The appointed mediator (or the DLAO officer, with none appointed) recorded an identity review. Private evidence and review notes are held separately.')
    return summary(record)
  })
}

export async function readIdentityEvidence(evidenceId, { code, applicationId, actor }) {
  const invitation = code ? await currentInvitation(code) : null
  let reviewerRole = 'SYSTEM'
  if (!invitation) {
    if (!actor || !applicationId) fail(403, 'FORBIDDEN', 'A private signing code or assigned mediator session is required.')
    reviewerRole = (await context(applicationId, actor, undefined, { requireClaim: true })).role
  }
  if (!mongoose.isValidObjectId(evidenceId)) fail(404, 'NOT_FOUND', 'Evidence not found.')
  const evidence = await PartyEvidence.findOne({ _id: evidenceId, expiresAt: { $gt: new Date() } }).select('+ciphertext +iv +tag')
  if (!evidence) fail(404, 'NOT_FOUND', 'Evidence is unavailable or has expired.')
  const record = await PartyVerification.findById(evidence.verificationId)
  if (code) {
    if (!record || String(record.invitationId) !== String(invitation._id) || record.tokenHash !== invitation.tokenHash) fail(403, 'FORBIDDEN', 'This evidence belongs to another party.')
  } else {
    if (!record || record.applicationId !== applicationId) fail(403, 'FORBIDDEN', 'This evidence belongs to another case.')
  }
  const decipher = createDecipheriv('aes-256-gcm', await encryptionKey(), evidence.iv)
  decipher.setAAD(Buffer.from(`${record._id}:${evidence.slot}`))
  decipher.setAuthTag(evidence.tag)
  const bytes = Buffer.concat([decipher.update(evidence.ciphertext), decipher.final()])
  if (hash(bytes) !== evidence.digest) fail(409, 'IDENTITY_EVIDENCE_CHANGED', 'Evidence integrity verification failed.')
  await mongoose.connection.transaction(async (session) => {
    const application = await Application.findOne({ applicationId: record.applicationId }).session(session)
    if (!application) fail(404, 'NOT_FOUND', 'The case is unavailable.')
    await recordMutation(application, session, actor ?? { userId: null }, actor ? reviewerRole : 'SYSTEM', 'MEDIATION_IDENTITY_EVIDENCE_ACCESSED', null, { verificationId: String(record._id), evidenceId: String(evidence._id), slot: evidence.slot }, 'An authorised reviewer or the private invitation holder accessed identity evidence.', actor ? 'DLAO' : 'WEB')
  })
  return { bytes, mime: evidence.mime }
}
