import mongoose from 'mongoose'
import { Application, Case, CaseFact, LawyerAssignment, LawyerChangeRequest, Mediation, Person, SafeContactProfile, Task, User } from '../models/index.js'
import { advance } from './applicationService.js'
import { appendAudit } from './auditService.js'
import { HttpError } from '../utils/httpError.js'
import { nextRecordId } from '../utils/recordId.js'

async function auditApplication(application, session, action, newState, reason, actorUserId, actorRole = 'CITIZEN', previousState = null) {
  const updated = await advance(application, session)
  await appendAudit({
    applicationId: updated.applicationId,
    caseId: updated.caseId,
    sequence: updated.auditSequence,
    action,
    actorUserId,
    actorRole,
    channel: 'PORTAL',
    previousState,
    newState,
    reason,
  }, session)
  return updated
}

export async function getCitizenCases(actor) {
  const user = await User.findById(actor.userId).lean()
  const query = user?.personId
    ? { $or: [{ citizenUserId: actor.userId }, { applicantPersonId: user.personId }] }
    : { citizenUserId: actor.userId }

  const applications = await Application.find(query).sort({ createdAt: -1 }).lean()

  const enrichedCases = await Promise.all(applications.map(async (app) => {
    const [applicant, caseRecord, activeAssignment, changeRequests, mediation, facts] = await Promise.all([
      Person.findById(app.applicantPersonId).select('displayName').lean(),
      Case.findOne({ applicationId: app.applicationId }).lean(),
      LawyerAssignment.findOne({ applicationId: app.applicationId, active: true, status: 'ACCEPTED' }).populate('lawyerUserId', 'displayName').lean(),
      LawyerChangeRequest.find({ applicationId: app.applicationId }).sort({ createdAt: -1 }).lean(),
      Mediation.findOne({ applicationId: app.applicationId }).sort({ createdAt: -1 }).lean(),
      CaseFact.find({ applicationId: app.applicationId }).lean(),
    ])

    return {
      applicationId: app.applicationId,
      caseId: app.caseId,
      applicantName: applicant?.displayName || 'Applicant',
      status: app.status,
      reviewState: app.reviewState,
      intakeChannel: app.channel || 'WEBSITE',
      createdAt: app.createdAt,
      submittedAt: app.createdAt,
      priority: app.priorityDecision,
      caseRecord: caseRecord ? {
        caseNumber: caseRecord.caseId,
        status: caseRecord.status,
        nextHearingAt: caseRecord.nextHearingAt,
        nextAction: caseRecord.nextAction,
      } : null,
      lawyer: activeAssignment ? {
        assignmentId: activeAssignment._id,
        lawyerName: activeAssignment.lawyerUserId?.displayName || 'Panel Lawyer',
        status: activeAssignment.status,
        appointedAt: activeAssignment.createdAt,
      } : null,
      changeRequests: changeRequests.map(cr => ({
        id: cr._id,
        reason: cr.reason,
        status: cr.status,
        createdAt: cr.createdAt,
        reviewReason: cr.reviewReason,
        reviewedAt: cr.reviewedAt,
      })),
      mediation: mediation ? {
        stage: mediation.stage,
        scheduledAt: mediation.scheduledAt,
        outcome: mediation.outcome,
      } : null,
      summary: facts.find(f => f.field === 'complaint.summary')?.value || 'No summary provided',
    }
  }))

  return enrichedCases
}

export async function requestCitizenLawyerChange(applicationId, { reason }, actor) {
  if (!reason || !reason.trim()) {
    throw new HttpError(400, 'INVALID_REASON', 'Please provide a reason for the lawyer change request.')
  }

  return mongoose.connection.transaction(async (session) => {
    const owner = await User.findById(actor.userId).select('personId').session(session).lean()
    const ownership = owner?.personId
      ? { $or: [{ citizenUserId: actor.userId }, { applicantPersonId: owner.personId }] }
      : { citizenUserId: actor.userId }
    const application = await Application.findOne({ applicationId, ...ownership }).session(session)
    if (!application) {
      throw new HttpError(404, 'NOT_FOUND', 'Application record not found.')
    }

    if (!application.caseId || application.status !== 'ACCEPTED') {
      throw new HttpError(409, 'CASE_NOT_ACCEPTED', 'A lawyer change request can only be submitted for an accepted Case.')
    }

    const activeAssignment = await LawyerAssignment.findOne({
      applicationId,
      active: true,
      status: 'ACCEPTED'
    }).session(session)

    if (!activeAssignment) {
      throw new HttpError(409, 'NO_ACTIVE_LAWYER', 'There is no active lawyer assigned to this case.')
    }

    const existingRequest = await LawyerChangeRequest.findOne({ applicationId, status: { $in: ['OPEN', 'APPROVED'] } }).session(session)
    if (existingRequest) {
      throw new HttpError(409, 'REQUEST_IN_PROGRESS', 'A lawyer change request is already under review or awaiting replacement.')
    }

    const [changeRequest] = await LawyerChangeRequest.create([{
      applicationId,
      caseId: application.caseId,
      channel: 'PORTAL',
      reason: reason.trim(),
      status: 'OPEN',
      recordedByUserId: actor.userId,
    }], { session })

    await Task.create([{
      applicationId,
      caseId: application.caseId,
      kind: 'LAWYER_CHANGE_REVIEW',
      title: 'Review citizen lawyer-change request (Portal)',
      ownerRole: 'DLAO_OFFICER',
      nextAction: 'Review the recorded citizen request and safe-contact profile; approve or decline separately from any replacement offer.',
    }], { session })

    await auditApplication(
      application,
      session,
      'APPLICANT_LAWYER_CHANGE_REQUESTED',
      { changeRequestId: changeRequest.id, channel: 'PORTAL', status: 'OPEN' },
      reason.trim(),
      actor.userId,
      'CITIZEN'
    )

    return {
      requestId: changeRequest.id,
      status: changeRequest.status,
      message: 'Your lawyer change request has been submitted to the DLAO officer for review.',
    }
  })
}

export async function submitDigitalApplication(input, actor) {
  const { problem, district, urgent, contactPhone, identityDocument, applicantName } = input || {}
  if (!problem || !problem.trim()) {
    throw new HttpError(400, 'PROBLEM_REQUIRED', 'Please describe your legal issue / problem.')
  }
  if (!district || !district.trim()) {
    throw new HttpError(400, 'DISTRICT_REQUIRED', 'Please select or enter your district.')
  }

  const user = await User.findById(actor.userId)
  const effectiveApplicantName = (applicantName || user?.displayName || user?.username || 'Citizen Applicant').trim()
  const phone = (contactPhone || user?.phone || user?.username || '').trim()

  const applicationId = await nextRecordId('APP')

  return mongoose.connection.transaction(async (session) => {
    const [person] = await Person.create([{
      displayName: effectiveApplicantName,
      identityStatus: identityDocument && identityDocument !== 'NONE' ? 'PENDING_REVIEW' : 'INCOMPLETE',
      fictional: false,
    }], { session })

    const factValues = [
      ['complaint.summary', problem.trim()],
      ['location.district', district.trim()],
      ['safety.urgent', urgent ? 'YES' : 'NO'],
      ['identity.document_access', identityDocument || 'NOT_COLLECTED'],
    ]

    await CaseFact.create(factValues.map(([field, value]) => ({
      applicationId,
      field,
      value,
      sourceType: 'APPLICANT_REPORTED',
      sourcePersonId: person._id,
      captureMethod: 'TYPED',
      aiInferred: false,
      callerConfirmed: true,
      applicantConfirmed: true,
      confirmedByPersonId: person._id,
      revision: 1,
      recordedByUserId: actor.userId,
    })), { session, ordered: true })

    await SafeContactProfile.create([{
      applicationId,
      version: 1,
      allowedChannels: phone ? ['PHONE'] : ['IN_PERSON'],
      prohibitedChannels: phone ? ['SMS'] : ['PHONE', 'SMS'],
      contactValue: phone || undefined,
      contactOwnerPersonId: person._id,
      safeTimeWindow: 'Business hours (9 AM - 5 PM)',
      smsSafe: false,
      neutralWordingRequired: true,
      unknownAnswerAction: 'DISCLOSE_NOTHING',
      recordedByUserId: actor.userId,
    }], { session })

    await Task.create([{
      applicationId,
      kind: 'INTAKE_REVIEW',
      ownerRole: 'DLAO_OFFICER',
      title: urgent ? 'Urgent citizen digital application' : 'Review citizen digital application',
      nextAction: 'Review submitted complaint facts, district jurisdiction, and safe contact profile; determine legal aid eligibility.',
    }], { session })

    const [createdApp] = await Application.create([{
      applicationId,
      applicantPersonId: person._id,
      officeCode: 'DEMO',
      channel: 'WEB',
      submittedByUserId: actor.userId,
      citizenUserId: actor.userId.toString(),
      auditSequence: 0,
    }], { session })

    await auditApplication(
      createdApp,
      session,
      'APPLICATION_SUBMITTED',
      { status: 'SUBMITTED', mode: 'DIGITAL_PORTAL', applicantPersonId: person.id },
      'Citizen submitted application digitally via citizen portal.',
      actor.userId,
      'CITIZEN'
    )

    // Update user profile with latest details
    if (phone && !user.phone) {
      user.phone = phone
      await user.save({ session })
    }

    return {
      applicationId,
      status: 'SUBMITTED',
      message: 'Your application has been successfully submitted and forwarded to the DLAO officer for review.',
    }
  })
}

export async function getCitizenProfile(actor) {
  const user = await User.findById(actor.userId).lean()
  if (!user) throw new HttpError(404, 'USER_NOT_FOUND', 'Citizen user not found.')

  let person = null
  if (user.personId) {
    person = await Person.findById(user.personId).lean()
  }

  // Find their latest application to extract preferred safe contact and district
  const latestQuery = user.personId
    ? { $or: [{ citizenUserId: actor.userId }, { applicantPersonId: user.personId }] }
    : { citizenUserId: actor.userId }
  const latestApp = await Application.findOne(latestQuery).sort({ createdAt: -1 }).lean()

  let safeProfile = null
  let districtFact = null
  if (latestApp) {
    [safeProfile, districtFact] = await Promise.all([
      SafeContactProfile.findOne({ applicationId: latestApp.applicationId }).sort({ version: -1 }).lean(),
      CaseFact.findOne({ applicationId: latestApp.applicationId, field: 'location.district' }).lean(),
    ])
  }

  const cases = await getCitizenCases(actor)

  return {
    displayName: person?.displayName || user.displayName || '',
    username: user.username,
    phone: user.phone || safeProfile?.contactValue || '',
    nid: user.nid || '',
    district: user.district || districtFact?.value || '',
    safeTimeWindow: user.safeTimeWindow || safeProfile?.safeTimeWindow || '',
    identityStatus: person?.identityStatus || 'INCOMPLETE',
    cases,
  }
}

export async function updateCitizenProfile(input, actor) {
  const { displayName, phone, nid, district, safeTimeWindow, email, username } = input || {}

  const user = await User.findById(actor.userId)
  if (!user) throw new HttpError(404, 'USER_NOT_FOUND', 'Citizen user not found.')

  const targetEmail = (email || username)?.trim().toLowerCase()
  if (targetEmail && targetEmail !== user.username) {
    if (targetEmail.length < 3 || targetEmail.length > 50) {
      throw new HttpError(400, 'INVALID_EMAIL', 'Email ID / Phone must be between 3 and 50 characters.')
    }
    const existing = await User.findOne({ username: targetEmail, _id: { $ne: user._id } })
    if (existing) {
      throw new HttpError(409, 'USERNAME_TAKEN', 'That Email ID / Phone is already in use.')
    }
    user.username = targetEmail
  }

  let person = null
  if (user.personId) {
    person = await Person.findById(user.personId)
  }

  const isVerified = person?.identityStatus === 'VERIFIED'

  // Once verified by DLAO officer, citizen user cannot edit Name or NID
  if (!isVerified) {
    if (displayName && displayName.trim()) {
      user.displayName = displayName.trim()
      if (person) {
        person.displayName = displayName.trim()
      }
    }
    if (nid !== undefined) {
      user.nid = nid.trim()
      if (person && nid.trim() && person.identityStatus === 'INCOMPLETE') {
        person.identityStatus = 'PENDING_REVIEW'
      }
    }
  }

  // Other information can be updated by user
  if (phone !== undefined) {
    user.phone = phone.trim()
  }
  if (district !== undefined) {
    user.district = district.trim()
  }
  if (safeTimeWindow !== undefined) {
    user.safeTimeWindow = safeTimeWindow.trim()
  }
  await user.save()
  if (person) {
    await person.save()
  }

  return getCitizenProfile(actor)
}


