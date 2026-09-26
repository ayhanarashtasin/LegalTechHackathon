import { CancellationRequest, LawyerAssignment, LawyerChangeRequest, LawyerUpdate, Mediation, Referral, Task } from '../models/index.js'
import { HttpError } from '../utils/httpError.js'

// Every route that closes a Case runs the same checks, so no open request, offer, referral, or mediation is left behind.
// The panel lawyer's own final report may close a Case the lawyer is still assigned to; other routes may not.
export async function assertCaseCanClose(caseRecord, session, { closedByAssignedLawyer = false } = {}) {
  const { applicationId } = caseRecord
  if (caseRecord.status !== 'OPEN' || await LawyerAssignment.exists({ applicationId, active: true, status: 'PENDING' }).session(session)) throw new HttpError(409, 'INVALID_TRANSITION', 'Resolve the Case status and outstanding assignment offers before closure.')
  if (!closedByAssignedLawyer && await LawyerAssignment.exists({ applicationId, active: true, status: 'ACCEPTED' }).session(session)) throw new HttpError(409, 'LAWYER_STILL_ASSIGNED', 'A panel lawyer is still assigned. Close the Case through the lawyer’s final report.')
  for (const [Model, statuses] of [[CancellationRequest, ['OPEN']], [LawyerChangeRequest, ['OPEN', 'APPROVED']], [Referral, ['SENT', 'ACKNOWLEDGED']]]) {
    if (await Model.exists({ applicationId, status: { $in: statuses } }).session(session)) throw new HttpError(409, 'REQUEST_IN_PROGRESS', 'Resolve outstanding cancellation, lawyer-change or referral work before closure.')
  }
  if (await Mediation.exists({ applicationId, stage: { $ne: 'CERTIFIED_FINAL' } }).session(session)) throw new HttpError(409, 'MEDIATION_IN_PROGRESS', 'Complete the separate mediation review and certification workflow first.')
}

export async function closeCase(caseRecord, actor, session, nextAction) {
  const { applicationId } = caseRecord
  caseRecord.status = 'CLOSED'; caseRecord.nextHearingAt = null; caseRecord.nextAction = nextAction
  await caseRecord.save({ session })
  await LawyerUpdate.updateMany({ applicationId, status: { $in: ['PENDING', 'MISSED'] } }, { $set: { status: 'CANCELLED' } }, { session })
  await Task.updateMany({ applicationId, kind: 'LAWYER_UPDATE', status: 'OPEN' }, { $set: { status: 'DONE', completedAt: new Date(), completedByUserId: actor.userId } }, { session })
}
