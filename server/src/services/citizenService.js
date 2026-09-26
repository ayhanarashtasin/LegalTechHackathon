import { createHash } from 'node:crypto'
import mongoose from 'mongoose'
import { Application, CancellationRequest, Case, CaseFact, Document, DocumentVersion, LawyerAssignment, LawyerChangeRequest, Mediation, Person, SafeContactProfile, Task, User } from '../models/index.js'
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
    const [applicant, caseRecord, activeAssignment, changeRequests, mediation, facts, docs, cancellationRequest] = await Promise.all([
      Person.findById(app.applicantPersonId).select('displayName').lean(),
      Case.findOne({ applicationId: app.applicationId }).lean(),
      LawyerAssignment.findOne({ applicationId: app.applicationId, active: true, status: 'ACCEPTED' }).populate('lawyerUserId', 'displayName').lean(),
      LawyerChangeRequest.find({ applicationId: app.applicationId }).sort({ createdAt: -1 }).lean(),
      Mediation.findOne({ applicationId: app.applicationId }).sort({ createdAt: -1 }).lean(),
      CaseFact.find({ applicationId: app.applicationId }).lean(),
      Document.find({ applicationId: app.applicationId }).select('label currentVersion checklistItem createdAt').lean(),
      CancellationRequest.findOne({ applicationId: app.applicationId }).sort({ createdAt: -1 }).lean(),
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
      cancellationRequest: cancellationRequest ? {
        id: cancellationRequest._id,
        reason: cancellationRequest.reason,
        status: cancellationRequest.status,
        createdAt: cancellationRequest.createdAt,
        reviewReason: cancellationRequest.reviewReason,
        reviewedAt: cancellationRequest.reviewedAt,
      } : null,
      mediation: mediation ? {
        stage: mediation.stage,
        scheduledAt: mediation.scheduledAt,
        outcome: mediation.outcome,
      } : null,
      summary: facts.find(f => f.field === 'complaint.summary')?.value || 'No summary provided',
      identityDocument: facts.find(f => f.field === 'identity.document_access')?.value || 'NONE',
      nidNumber: facts.find(f => f.field === 'identity.nid_number')?.value || null,
      birthCertificateNumber: facts.find(f => f.field === 'identity.birth_certificate_number')?.value || null,
      prottayonpotroStatus: facts.find(f => f.field === 'prottayonpotro.status')?.value || null,
      documents: docs.map(d => ({
        id: d._id,
        label: d.label,
        checklistItem: d.checklistItem,
        currentVersion: d.currentVersion,
      })),
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

// If the DLAO has not yet accepted the application, the applicant's own withdrawal takes effect immediately.
// Once a Case ID exists, cancellation can affect other people's tracked work (a lawyer, a referral, a mediation),
// so it becomes a DLAO officer decision instead, following the same request/review shape as a lawyer-change request.
export async function cancelOrRequestCancellation(applicationId, { reason }, actor) {
  return mongoose.connection.transaction(async (session) => {
    const owner = await User.findById(actor.userId).select('personId').session(session).lean()
    const ownership = owner?.personId
      ? { $or: [{ citizenUserId: actor.userId }, { applicantPersonId: owner.personId }] }
      : { citizenUserId: actor.userId }
    const application = await Application.findOne({ applicationId, ...ownership }).session(session)
    if (!application) {
      throw new HttpError(404, 'NOT_FOUND', 'Application record not found.')
    }
    if (application.status === 'CANCELLED') {
      throw new HttpError(409, 'ALREADY_CANCELLED', 'This application has already been cancelled.')
    }
    if (await CancellationRequest.exists({ applicationId, status: 'OPEN' }).session(session)) {
      throw new HttpError(409, 'REQUEST_IN_PROGRESS', 'A cancellation request is already under review.')
    }

    if (application.status === 'SUBMITTED') {
      const updated = await advance(application, session, { status: 'CANCELLED' })
      await Task.updateMany(
        { applicationId, status: 'OPEN' },
        { $set: { status: 'DONE', completedAt: new Date(), completedByUserId: actor.userId } },
        { session },
      )
      await appendAudit({
        applicationId: updated.applicationId,
        caseId: updated.caseId,
        sequence: updated.auditSequence,
        action: 'APPLICATION_CANCELLED_BY_APPLICANT',
        actorUserId: actor.userId,
        actorRole: 'CITIZEN',
        channel: 'PORTAL',
        previousState: { status: 'SUBMITTED' },
        newState: { status: 'CANCELLED' },
        reason: reason.trim(),
      }, session)
      return {
        status: 'CANCELLED',
        message: 'Your application has been cancelled.',
      }
    }

    // ACCEPTED: a Case ID exists, so cancellation needs a DLAO officer's confirmation.
    const [cancellationRequest] = await CancellationRequest.create([{
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
      kind: 'CASE_CANCELLATION_REVIEW',
      title: 'Review citizen case cancellation request',
      ownerRole: 'DLAO_OFFICER',
      nextAction: 'Approve or decline; on approval the case and all dependent workflow records are closed out.',
    }], { session })

    await auditApplication(
      application,
      session,
      'APPLICANT_CASE_CANCELLATION_REQUESTED',
      { cancellationRequestId: cancellationRequest.id, status: 'OPEN' },
      reason.trim(),
      actor.userId,
      'CITIZEN',
    )

    return {
      status: 'PENDING_REVIEW',
      requestId: cancellationRequest.id,
      message: 'Your case has already been accepted, so this cancellation request has been sent to the DLAO officer for confirmation.',
    }
  })
}

export async function submitDigitalApplication(input, actor) {
  const {
    problem,
    district,
    urgent,
    contactPhone,
    identityDocument,
    applicantName,
    nidNumber,
    nidPhoto,
    birthCertificateNumber,
    birthCertificatePhoto,
    prottayonpotro,
    extraDocuments,
  } = input || {}

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

    if (identityDocument === 'NID' && nidNumber && nidNumber.trim()) {
      factValues.push(['identity.nid_number', nidNumber.trim()])
    }

    if (identityDocument === 'BIRTH_CERTIFICATE' && birthCertificateNumber && birthCertificateNumber.trim()) {
      factValues.push(['identity.birth_certificate_number', birthCertificateNumber.trim()])
    }

    if (prottayonpotro) {
      if (prottayonpotro.status) {
        factValues.push(['prottayonpotro.status', prottayonpotro.status])
      }
      if (prottayonpotro.status === 'YES') {
        if (prottayonpotro.issuerType) {
          factValues.push(['prottayonpotro.issuer_type', prottayonpotro.issuerType])
        }
        if (prottayonpotro.issuerName && prottayonpotro.issuerName.trim()) {
          factValues.push(['prottayonpotro.issuer_name', prottayonpotro.issuerName.trim()])
        }
        if (prottayonpotro.memoNumber && prottayonpotro.memoNumber.trim()) {
          factValues.push(['prottayonpotro.memo_number', prottayonpotro.memoNumber.trim()])
        }
        if (prottayonpotro.issueDate && prottayonpotro.issueDate.trim()) {
          factValues.push(['prottayonpotro.issue_date', prottayonpotro.issueDate.trim()])
        }
      }
    }

    if (Array.isArray(extraDocuments) && extraDocuments.length > 0) {
      factValues.push(['documents.extra_count', String(extraDocuments.length)])
    }

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

    // Process attached pictures and documents
    const createdDocuments = []

    // 1. NID Card photo if provided
    if (identityDocument === 'NID' && nidPhoto?.dataUrl) {
      const [doc] = await Document.create([{
        applicationId,
        label: 'National ID (NID) Card',
        checklistItem: 'Applicant identity evidence',
        sensitivity: 'STANDARD',
        currentVersion: 1,
      }], { session })

      const hash = createHash('sha256').update(nidPhoto.dataUrl).digest('hex')
      await DocumentVersion.create([{
        applicationId,
        documentId: doc._id,
        version: 1,
        label: 'National ID (NID) Card',
        filename: nidPhoto.filename || 'nid-card.jpg',
        qualityState: 'READABLE',
        note: nidNumber ? `NID Number: ${nidNumber.trim()}` : 'Uploaded by citizen via portal',
        fileData: nidPhoto.dataUrl,
        contentHash: hash,
        recordedByUserId: actor.userId,
      }], { session })
      createdDocuments.push(doc)
    }

    // 2. Birth Certificate photo if provided
    if (identityDocument === 'BIRTH_CERTIFICATE' && birthCertificatePhoto?.dataUrl) {
      const [doc] = await Document.create([{
        applicationId,
        label: 'Birth Registration Certificate',
        checklistItem: 'Applicant identity evidence',
        sensitivity: 'STANDARD',
        currentVersion: 1,
      }], { session })

      const hash = createHash('sha256').update(birthCertificatePhoto.dataUrl).digest('hex')
      await DocumentVersion.create([{
        applicationId,
        documentId: doc._id,
        version: 1,
        label: 'Birth Registration Certificate',
        filename: birthCertificatePhoto.filename || 'birth-certificate.jpg',
        qualityState: 'READABLE',
        note: birthCertificateNumber ? `BRN: ${birthCertificateNumber.trim()}` : 'Uploaded by citizen via portal',
        fileData: birthCertificatePhoto.dataUrl,
        contentHash: hash,
        recordedByUserId: actor.userId,
      }], { session })
      createdDocuments.push(doc)
    }

    // 3. Prottayonpotro document/photo if provided
    if (prottayonpotro?.status === 'YES' && prottayonpotro.photo?.dataUrl) {
      const [doc] = await Document.create([{
        applicationId,
        label: 'Prottayonpotro (Chairman/Councilor Certificate)',
        checklistItem: 'Income/Insolvency Certificate (প্রত্যয়নপত্র)',
        sensitivity: 'STANDARD',
        currentVersion: 1,
      }], { session })

      const hash = createHash('sha256').update(prottayonpotro.photo.dataUrl).digest('hex')
      const noteParts = []
      if (prottayonpotro.issuerName?.trim()) noteParts.push(`Office: ${prottayonpotro.issuerName.trim()}`)
      if (prottayonpotro.memoNumber?.trim()) noteParts.push(`Memo: ${prottayonpotro.memoNumber.trim()}`)

      await DocumentVersion.create([{
        applicationId,
        documentId: doc._id,
        version: 1,
        label: 'Prottayonpotro (প্রত্যয়নপত্র)',
        filename: prottayonpotro.photo.filename || 'prottayonpotro.jpg',
        qualityState: 'READABLE',
        note: noteParts.length ? noteParts.join(' · ') : 'Attestation certificate uploaded by citizen',
        fileData: prottayonpotro.photo.dataUrl,
        contentHash: hash,
        recordedByUserId: actor.userId,
      }], { session })
      createdDocuments.push(doc)
    }

    // 4. Extra supporting document pictures
    if (Array.isArray(extraDocuments)) {
      for (const extra of extraDocuments) {
        if (!extra?.dataUrl) continue
        const [doc] = await Document.create([{
          applicationId,
          label: extra.label?.trim() || extra.filename || 'Extra Supporting Evidence',
          checklistItem: 'Available supporting record',
          sensitivity: 'STANDARD',
          currentVersion: 1,
        }], { session })

        const hash = createHash('sha256').update(extra.dataUrl).digest('hex')
        await DocumentVersion.create([{
          applicationId,
          documentId: doc._id,
          version: 1,
          label: extra.label?.trim() || extra.filename || 'Extra Supporting Evidence',
          filename: extra.filename || 'document.jpg',
          qualityState: 'READABLE',
          note: extra.note || 'Uploaded by citizen as supporting evidence',
          fileData: extra.dataUrl,
          contentHash: hash,
          recordedByUserId: actor.userId,
        }], { session })
        createdDocuments.push(doc)
      }
    }

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
      {
        status: 'SUBMITTED',
        mode: 'DIGITAL_PORTAL',
        applicantPersonId: person.id,
        documentsAttached: createdDocuments.length,
        identityDocument: identityDocument || 'NONE',
      },
      'Citizen submitted application digitally via citizen portal with supporting documents.',
      actor.userId,
      'CITIZEN'
    )

    // Update user profile with latest details if not already set
    if (phone && !user.phone) {
      user.phone = phone
    }
    if (nidNumber && nidNumber.trim() && !user.nid) {
      user.nid = nidNumber.trim()
    }
    if (district && district.trim() && !user.district) {
      user.district = district.trim()
    }
    await user.save({ session })

    return {
      applicationId,
      status: 'SUBMITTED',
      documentsCount: createdDocuments.length,
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


