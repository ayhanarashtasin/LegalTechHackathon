import { useEffect, useState } from 'react'
import { api } from '../services/api.js'
import { AddForm, Badge, Bi, Panel, Term, bi, num, overdueText, say, when } from '../components/Bi.jsx'

const localDate = (value) => {
  if (!value) return ''
  const date = new Date(value)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}
const paymentStages = ['CASE_PREPARATION', 'HEARING_ATTENDANCE', 'CLAIM_REVIEW', 'RECONCILIATION']
const REMINDER_GAP_MS = 24 * 60 * 60 * 1000 // the server allows one reminder per update per day
const remindedTimes = (count) => bi(`reminded ${count} time${count === 1 ? '' : 's'}`, `${num(count)} বার মনে করানো হয়েছে`)

// One panel lawyer's record in this office, for a human to review; not a finding about the lawyer.
function LawyerActivity({ activity }) {
  const { updates } = activity
  return <section className="lawyer-activity" aria-label={bi('Lawyer activity', 'আইনজীবীর কাজের হিসাব')}>
    <h4>{activity.lawyerName}: <Bi en="activity in this office" bn="এই অফিসে কাজের হিসাব" /></h4>
    <dl className="details compact">
      <div><dt><Bi en="Cases" bn="মামলা" /></dt><dd>{bi(`${activity.activeCases} active · ${activity.pastCases} past`, `${num(activity.activeCases)}টি চলমান · ${num(activity.pastCases)}টি আগের`)}</dd></div>
      <div><dt><Bi en="Required updates" bn="বাধ্যতামূলক আপডেট" /></dt><dd>{bi(`${updates.onTime} on time · ${updates.late} late · ${updates.overdue} overdue now · ${updates.upcoming} upcoming`,
        `${num(updates.onTime)}টি সময়মতো · ${num(updates.late)}টি দেরিতে · ${num(updates.overdue)}টি এখন বাকি · ${num(updates.upcoming)}টি সামনে`)}</dd></div>
      <div><dt><Bi en="Reminders sent" bn="মনে করানো হয়েছে" /></dt><dd>{num(activity.remindersSent)}</dd></div>
      <div><dt><Bi en="Last report" bn="শেষ প্রতিবেদন" /></dt><dd>{activity.lastReportAt ? when(activity.lastReportAt) : bi('None yet', 'এখনো নেই')}</dd></div>
      <div><dt><Bi en="New assignments" bn="নতুন মামলা" /></dt><dd>{activity.hold?.newAssignmentHold ? <><Badge code="ON_HOLD" /> <Term code={activity.hold.reviewState} /></> : bi('Open', 'দেওয়া যাবে')}</dd></div>
    </dl>
    {activity.cases.some(({ overdueUpdates }) => overdueUpdates) && <ul className="plain-list">{activity.cases.filter(({ overdueUpdates }) => overdueUpdates).map((item) => <li key={item.caseId}>
      <strong>{item.caseId}</strong> · {bi(`${item.overdueUpdates} overdue, the oldest ${item.oldestOverdueDays} days`, `${num(item.overdueUpdates)}টি বাকি, সবচেয়ে পুরোনোটি ${num(item.oldestOverdueDays)} দিন দেরিতে`)}
    </li>)}</ul>}
    <p className="muted"><Bi en="A pattern for a human to review. It is not a finding of misconduct." bn="এটি একজন মানুষের পর্যালোচনার জন্য একটি চিত্র। এটি অসদাচরণের কোনো সিদ্ধান্ত নয়।" /></p>
  </section>
}

export default function LawyerManagement({ applicationId, token, onChanged }) {
  const [data, setData] = useState(null)
  const [loadedAt, setLoadedAt] = useState(0) // when data arrived: the "now" for days overdue and reminder spacing
  const [refresh, setRefresh] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [planReason, setPlanReason] = useState('')
  const [lawyerUserId, setLawyerUserId] = useState('')
  const [assignmentReason, setAssignmentReason] = useState('')
  const [changeRequestId, setChangeRequestId] = useState('')
  const [reviewReasons, setReviewReasons] = useState({})
  const [holdReasons, setHoldReasons] = useState({})
  const [paymentStage, setPaymentStage] = useState('CASE_PREPARATION')
  const [paymentStatus, setPaymentStatus] = useState('SUBMITTED')
  const [paymentReason, setPaymentReason] = useState('')
  const [paymentAssignmentId, setPaymentAssignmentId] = useState('')
  const [canBearCosts, setCanBearCosts] = useState(false)
  const [activity, setActivity] = useState(null) // the lawyer activity summary being reviewed, if any

  useEffect(() => {
    const controller = new AbortController()
    api(`/api/lawyers/applications/${applicationId}`, { token, signal: controller.signal })
      .then((result) => { setData(result); setLoadedAt(Date.now()) }).catch((failure) => { if (failure.name !== 'AbortError') setError(failure.message) })
    return () => controller.abort()
  }, [applicationId, token, refresh])

  async function mutate(path, body, success) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await api(path, { token, method: 'POST', body })
      setNotice(success)
      setRefresh((value) => value + 1)
      onChanged()
      return true
    } catch (failure) { setError(failure.message); return false } finally { setBusy(false) }
  }

  async function savePlan(event) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const hearingAt = form.get('nextHearingAt')
    if (await mutate(`/api/lawyers/applications/${applicationId}/case-plan`, {
      nextHearingAt: hearingAt ? new Date(hearingAt).toISOString() : null, nextAction: form.get('nextAction'), reason: form.get('reason'),
    }, bi('Hearing and next step saved.', 'শুনানির তারিখ ও পরবর্তী করণীয় সংরক্ষিত হয়েছে।'))) setPlanReason('')
  }

  async function offerAssignment(event) {
    event.preventDefault()
    if (await mutate(`/api/lawyers/applications/${applicationId}/assignments`, {
      lawyerUserId, reason: assignmentReason, ...(changeRequestId ? { changeRequestId } : {}),
    }, bi('Offer sent. It starts when the lawyer accepts.', 'আইনজীবীকে মামলাটি নেওয়ার প্রস্তাব পাঠানো হয়েছে। তিনি গ্রহণ করলে দায়িত্ব শুরু হবে।'))) setAssignmentReason('')
  }

  async function schedule(event) {
    event.preventDefault()
    const target = event.currentTarget
    const form = new FormData(event.currentTarget)
    if (await mutate(`/api/lawyers/applications/${applicationId}/update-schedules`, {
      assignmentId: form.get('assignmentId'), dueAt: new Date(form.get('dueAt')).toISOString(), instruction: form.get('instruction'),
    }, bi('Update scheduled.', 'অগ্রগতি জানানোর সময় নির্ধারণ করা হয়েছে।'))) target.reset()
  }

  function reviewRequest(requestId, decision) {
    mutate(`/api/lawyers/applications/${applicationId}/change-requests/${requestId}/review`, {
      decision, reason: reviewReasons[requestId] || '',
    }, decision === 'APPROVE'
      ? bi('Request approved. Offer a new lawyer separately.', 'অনুরোধটি অনুমোদিত হয়েছে। নতুন আইনজীবীকে মামলাটি নেওয়ার প্রস্তাব আলাদাভাবে পাঠান।')
      : bi('Request declined with reason.', 'কারণসহ অনুরোধ প্রত্যাখ্যাত।'))
  }

  // "Request update": a reminder on the lawyer's own worklist, recorded on the case, instead of phoning them.
  async function requestUpdate(update) {
    if (await mutate(`/api/lawyers/applications/${applicationId}/updates/${update.id}/reminders`, undefined,
      bi('Reminder added to the lawyer’s worklist. No call, SMS, or email was sent.', 'আইনজীবীর কাজের তালিকায় মনে করিয়ে দেওয়া হয়েছে। কোনো ফোন, এসএমএস বা ইমেইল পাঠানো হয়নি।'))) setActivity(null)
  }

  async function toggleActivity(lawyerUserId) {
    if (activity?.lawyerUserId === String(lawyerUserId)) return setActivity(null)
    setError('')
    try { setActivity(await api(`/api/lawyers/panel-lawyers/${lawyerUserId}/activity`, { token })) } catch (failure) { setError(failure.message) }
  }

  function reviewHold(lawyerId, decision) {
    mutate(`/api/lawyers/holds/${lawyerId}/review`, { decision, reason: holdReasons[lawyerId] || '' },
      decision === 'LIFT' ? bi('Hold lifted. Current cases unchanged.', 'নতুন মামলা দেওয়ার স্থগিতাদেশ তুলে নেওয়া হয়েছে। চলমান মামলাগুলো আগের মতোই থাকবে।') : bi('Hold continued. Current cases unchanged.', 'নতুন মামলা দেওয়ার স্থগিতাদেশ বহাল আছে। চলমান মামলাগুলো আগের মতোই থাকবে।'))
  }

  async function recordPayment(event) {
    event.preventDefault()
    const assignment = data.assignments.find(({ id }) => id === (paymentAssignmentId || paymentAssignments[0]?.id))
    if (!assignment) return
    if (await mutate(`/api/lawyers/assignments/${assignment.id}/payment-status`, { stage: paymentStage, status: paymentStatus, reason: paymentReason },
      bi('Payment status saved. No money moved.', 'পেমেন্টের তথ্য নথিভুক্ত হয়েছে। এখানে কোনো টাকা লেনদেন হয়নি।'))) setPaymentReason('')
  }

  const activeAssignments = data?.assignments.filter(({ active, status }) => active && status === 'ACCEPTED') ?? []
  const paymentAssignments = data?.assignments.filter(({ status }) => status === 'ACCEPTED' || status === 'REASSIGNED') ?? []
  const pendingAssignments = data?.assignments.filter(({ active, status }) => active && status === 'PENDING') ?? []
  const approvedRequests = data?.changeRequests.filter(({ status }) => status === 'APPROVED') ?? []
  const holds = data?.panelLawyers.filter(({ hold }) => hold?.newAssignmentHold) ?? []
  // Overdue, unreported updates of the lawyer who holds the case now; each gets its own alert.
  const overdueUpdates = data?.updates.filter(({ status, assignmentId }) => status === 'MISSED' && activeAssignments.some(({ id }) => id === assignmentId)) ?? []
  const hint = activeAssignments[0]?.lawyerName ?? (pendingAssignments.length ? bi('Offer pending', 'আইনজীবীর উত্তরের অপেক্ষায়') : data && bi('No lawyer yet', 'এখনো আইনজীবী নেই'))

  return <Panel id="lawyer-title" en="Phase 5: Panel Lawyer Process (If Required)" bn="ধাপ ৫: প্যানেল আইনজীবী নিয়োগ ও মামলা পরিচালনা" hint={hint} open>
    {error && <p role="alert" className="error">{error}</p>}
    {notice && <p role="status" className="success">{notice}</p>}
    {!data && !error && <p role="status">{bi('Loading…', 'লোড হচ্ছে…')}</p>}
    {data && <>
      {overdueUpdates.map((update) => {
        const lawyer = activeAssignments.find(({ id }) => id === update.assignmentId)
        const remindedRecently = update.lastRemindedAt && loadedAt - new Date(update.lastRemindedAt).getTime() < REMINDER_GAP_MS
        return <section className="escalation-box" key={update.id} aria-label={bi('Lawyer update overdue', 'আইনজীবীর আপডেট বাকি')}>
          <h3><Bi en="Lawyer update overdue" bn="আইনজীবীর আপডেট বাকি" /></h3>
          <dl className="details compact">
            <div><dt><Bi en="Case" bn="মামলা" /></dt><dd>{data.caseId}</dd></div>
            <div><dt><Bi en="Applicant" bn="আবেদনকারী" /></dt><dd>{data.applicantName || bi('Not recorded', 'লেখা নেই')}</dd></div>
            <div><dt><Bi en="Lawyer" bn="আইনজীবী" /></dt><dd>{lawyer?.lawyerName}</dd></div>
            <div><dt><Bi en="Required update" bn="বাধ্যতামূলক আপডেট" /></dt><dd>{num(update.sequence)} · <Bi en="due" bn="শেষ সময়" /> {when(update.dueAt)}</dd></div>
            <div><dt><Bi en="Overdue" bn="দেরি" /></dt><dd><strong>{overdueText(update.dueAt, loadedAt)}</strong></dd></div>
            <div><dt><Bi en="Reminders" bn="মনে করানো" /></dt><dd>{update.reminderCount ? <>{remindedTimes(update.reminderCount)} · <Bi en="last" bn="শেষবার" /> {when(update.lastRemindedAt)}</> : bi('None yet', 'এখনো নয়')}</dd></div>
          </dl>
          <div className="choice-row">
            <button type="button" disabled={busy || remindedRecently} onClick={() => requestUpdate(update)}><Bi en="Request update" bn="আপডেট চান" /></button>
            {lawyer?.lawyerUserId && <button type="button" className="secondary-button" aria-expanded={activity?.lawyerUserId === String(lawyer.lawyerUserId)} onClick={() => toggleActivity(lawyer.lawyerUserId)}><Bi en="Review lawyer activity" bn="আইনজীবীর কাজের হিসাব দেখুন" /></button>}
          </div>
          {remindedRecently && <p className="muted"><Bi en="Reminded in the last 24 hours; another reminder is possible after that." bn="গত ২৪ ঘণ্টার মধ্যে মনে করানো হয়েছে; এরপর আবার মনে করানো যাবে।" /></p>}
        </section>
      })}
      {activity && <LawyerActivity activity={activity} />}
      {holds.map(({ id, displayName, hold }) => <section className="escalation-box" key={id} aria-label={bi('Lawyer assignment hold', 'আইনজীবী নিয়োগ স্থগিত')}>
        <h3><Bi en="New assignments on hold: review needed" bn="নতুন মামলা দেওয়া সাময়িক বন্ধ; পর্যালোচনা দরকার" /></h3>
        <p>{displayName}: <Bi en="missed 2 updates in a row. Current cases continue. No misconduct finding." bn="পরপর ২টি আপডেট দেননি। চলমান মামলা চলবে। এটি অসদাচরণের সিদ্ধান্ত নয়।" /></p>
        <p className="muted"><Term code={hold.reviewerRole} /> · <Term code={hold.reviewState} /> · <Bi en="Demo reviewer; legal authority not yet confirmed." bn="এটি নমুনা পর্যালোচকের ভূমিকা। এই সিদ্ধান্ত নেওয়ার আইনি ক্ষমতা কার, তা এখনো নিশ্চিত নয়।" /></p>
        {hold.reviewReason && <p><Bi en="Last reason:" bn="শেষ কারণ:" /> {hold.reviewReason}</p>}
        <label htmlFor={`hold-reason-${id}`}><Bi en="Hold review reason" bn="পর্যালোচনার কারণ" /></label>
        <textarea id={`hold-reason-${id}`} value={holdReasons[id] || ''} onChange={(event) => setHoldReasons((current) => ({ ...current, [id]: event.target.value }))} minLength="10" maxLength="500" />
        <div className="choice-row"><button type="button" disabled={busy || (holdReasons[id] || '').trim().length < 10} onClick={() => reviewHold(id, 'LIFT')}><Bi en="Lift hold" bn="স্থগিতাদেশ তুলুন" /></button><button type="button" className="secondary-button" disabled={busy || (holdReasons[id] || '').trim().length < 10} onClick={() => reviewHold(id, 'CONTINUE')}><Bi en="Continue hold" bn="বহাল রাখুন" /></button></div>
      </section>)}

      <div className="block"><h3 id="assignment-title"><Bi en="Assigned lawyer" bn="নিযুক্ত আইনজীবী" /></h3>
        <div className="means-test-box" style={{ background: '#fcfbf7', border: '1px solid #e8e2d2', borderLeft: '4px solid #b8860b', borderRadius: '6px', padding: '0.9rem 1.1rem', margin: '0.75rem 0 1rem 0' }}>
          <h4 style={{ margin: '0 0 0.4rem 0' }}><Bi en="Beneficiary Financial Status Check (DBLA Criteria)" bn="সুবিধাভোগীর আর্থিক অবস্থা যাচাই (ডিবিএলএ নীতিমালা)" /></h4>
          <p style={{ margin: 0, fontSize: '0.85rem', color: '#555' }}>
            <Bi en="Verify if beneficiary can bear private advocate costs before government-funded panel lawyer allocation." bn="সরকারি খরচে প্যানেল আইনজীবী বরাদ্দের পূর্বে আবেদনকারীর আর্থিক অসচ্ছলতা নিশ্চিত করুন।" />
          </p>
          <div style={{ margin: '0.6rem 0 0.3rem 0', fontWeight: 600, fontSize: '0.88rem' }}>
            <Bi en="Can beneficiary bear the legal cost?" bn="আবেদনকারী কি মামলার খরচ বহনে সক্ষম?" />
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.25rem', marginTop: '0.4rem', fontSize: '0.88rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
              <input type="radio" name={`dlao-means-${applicationId}`} checked={!canBearCosts} onChange={() => setCanBearCosts(false)} />
              <span><Bi en="No: Cannot bear cost (Approve panel lawyer allocation)" bn="না: খরচ বহনে অক্ষম (প্যানেল আইনজীবী বরাদ্দ অনুমোদিত)" /></span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
              <input type="radio" name={`dlao-means-${applicationId}`} checked={canBearCosts} onChange={() => setCanBearCosts(true)} />
              <span><Bi en="Yes: Can bear cost (Ineligible for State Counsel)" bn="হ্যাঁ: খরচ বহনে সক্ষম (সরকারি আইনজীবী প্রযোজ্য নয়)" /></span>
            </label>
          </div>
          {canBearCosts ? (
            <div style={{ marginTop: '0.6rem', padding: '0.6rem 0.8rem', background: '#fdf6f6', border: '1px solid #d9a3a1', borderRadius: '4px', fontSize: '0.85rem', color: '#9f2f2d' }}>
              <strong><Bi en="No government-funded panel lawyer allocation." bn="সরকারি খরচে প্যানেল আইনজীবী বরাদ্দ হবে না।" /></strong>
              <p style={{ margin: '0.2rem 0 0 0' }}><Bi en="Inform applicant (Explore alternative options / private counsel)." bn="আবেদনকারীকে বিকল্প বা ব্যক্তিগত আইনজীবী নিয়োগের পরামর্শ প্রদান করুন।" /></p>
            </div>
          ) : (
            <div style={{ marginTop: '0.6rem', padding: '0.6rem 0.8rem', background: '#edf5ee', border: '1px solid #b7dab9', borderRadius: '4px', fontSize: '0.85rem', color: '#28562d' }}>
              <strong>✓ <Bi en="Approve panel lawyer allocation" bn="প্যানেল আইনজীবী বরাদ্দ অনুমোদিত" /></strong>
              <p style={{ margin: '0.2rem 0 0 0' }}><Bi en="Beneficiary qualifies under DBLA criteria. Select and assign an advocate from the approved panel below." bn="সুবিধাভোগী ডিবিএলএ মানদণ্ডে যোগ্য। নিম্নের তালিকা থেকে অনুমোদিত প্যানেল আইনজীবী নির্বাচন ও নিয়োগ দিন।" /></p>
            </div>
          )}
        </div>

        {data.assignments.length === 0 ? <p className="muted"><Bi en="No lawyer yet." bn="এখনো আইনজীবী নেই।" /></p> : <ul className="plain-list">{data.assignments.map((item) => <li key={item.id}><div><strong>{item.lawyerName}</strong> <Badge code={item.status} />{!item.active && <small className="muted"> · <Bi en="past" bn="আগের" /></small>}{item.hold && <p><small><Bi en="Hold" bn="স্থগিত" />: <Term code={item.hold.reviewState} /></small></p>}</div>{item.active && item.lawyerUserId && <button type="button" className="secondary-button" aria-expanded={activity?.lawyerUserId === String(item.lawyerUserId)} onClick={() => toggleActivity(item.lawyerUserId)}><Bi en="Review activity" bn="কাজের হিসাব" /></button>}</li>)}</ul>}
        {pendingAssignments.length > 0 && <p role="status"><Bi en="Waiting for the lawyer to accept or decline." bn="আইনজীবীর উত্তরের অপেক্ষা।" /></p>}
        <AddForm en="Offer to a lawyer" bn="আইনজীবীকে প্রস্তাব দিন">
          <form onSubmit={offerAssignment} className="form-stack inline-form">
            <label htmlFor="panel-lawyer"><Bi en="Panel lawyer" bn="প্যানেল আইনজীবী" /></label><select id="panel-lawyer" value={lawyerUserId} onChange={(event) => setLawyerUserId(event.target.value)} required><option value="">{bi('Choose', 'বাছাই করুন')}</option>{data.panelLawyers.map((person) => <option key={person.id} value={person.id} disabled={person.hold?.newAssignmentHold}>{person.displayName}{person.hold?.newAssignmentHold ? ` · ${bi('on hold', 'স্থগিত')}` : ''}</option>)}</select>
            <label htmlFor="assignment-change-request"><Bi en="Linked change request" bn="সংশ্লিষ্ট বদলের অনুরোধ" /></label><select id="assignment-change-request" value={changeRequestId} onChange={(event) => setChangeRequestId(event.target.value)}><option value="">{bi('None: officer decision', 'নেই: কর্মকর্তার সিদ্ধান্ত')}</option>{approvedRequests.map((item) => <option key={item.id} value={item.id}>{bi('Approved request', 'অনুমোদিত অনুরোধ')} · {when(item.createdAt)}</option>)}</select>
            <label htmlFor="assignment-reason"><Bi en="Reason" bn="কারণ" /></label><textarea id="assignment-reason" value={assignmentReason} onChange={(event) => setAssignmentReason(event.target.value)} minLength="10" maxLength="500" required />
            <button type="submit" disabled={busy || !lawyerUserId || pendingAssignments.length > 0 || canBearCosts}><Bi en="Send offer" bn="প্রস্তাব পাঠান" /></button>
          </form>
        </AddForm>
      </div>

      <div className="block"><h3 id="plan-title"><Bi en="Hearing and next step" bn="শুনানি ও পরবর্তী ধাপ" /></h3>
        <dl className="details compact">
          <div><dt><Bi en="Next hearing" bn="পরবর্তী শুনানি" /></dt><dd>{when(data.casePlan.nextHearingAt)}</dd></div>
          <div><dt><Bi en="Next step" bn="পরবর্তী ধাপ" /></dt><dd>{data.casePlan.nextAction || bi('Not set', 'নির্ধারিত নয়')}</dd></div>
        </dl>
        <AddForm en="Update hearing or next step" bn="শুনানি বা ধাপ হালনাগাদ">
          <form onSubmit={savePlan} className="form-stack inline-form">
            <label htmlFor="lawyer-hearing"><Bi en="Next hearing" bn="পরবর্তী শুনানি" /></label><input id="lawyer-hearing" name="nextHearingAt" type="datetime-local" defaultValue={localDate(data.casePlan.nextHearingAt)} />
            <label htmlFor="lawyer-next-action"><Bi en="Next step for the applicant" bn="আবেদনকারীর পরবর্তী ধাপ" /></label><textarea id="lawyer-next-action" name="nextAction" defaultValue={data.casePlan.nextAction} minLength="5" maxLength="300" required /><small><Bi en="May be read aloud. No private facts or contact details." bn="এই তথ্য আবেদনকারীকে পড়ে শোনানো হতে পারে। ব্যক্তিগত তথ্য বা ফোন নম্বর লিখবেন না।" /></small>
            <label htmlFor="plan-reason"><Bi en="Reason" bn="কারণ" /></label><textarea id="plan-reason" name="reason" value={planReason} onChange={(event) => setPlanReason(event.target.value)} minLength="10" maxLength="500" required />
            <button type="submit" disabled={busy}><Bi en="Save" bn="সংরক্ষণ" /></button>
          </form>
        </AddForm>
      </div>

      {activeAssignments.length > 0 && <div className="block"><h3 id="schedule-title"><Bi en="Progress updates" bn="অগ্রগতির আপডেট" /></h3>
        {data.updates.length === 0 ? <p className="muted"><Bi en="None scheduled." bn="কোনো আপডেট নির্ধারিত নেই।" /></p> : <ol className="timeline compact">{data.updates.map((item) => <li key={item.id}><strong><Bi en="Update" bn="আপডেট" /> {num(item.sequence)}</strong> <Badge code={item.status} /><p>{item.instruction}</p><small><Bi en="Due" bn="শেষ সময়" /> {when(item.dueAt)}{item.status === 'MISSED' ? ` · ${overdueText(item.dueAt, loadedAt)}` : item.missedAt ? ` · ${bi('missed', 'বাদ')} ${when(item.missedAt)}` : ''}{item.reminderCount ? ` · ${remindedTimes(item.reminderCount)}` : ''}{item.nextAction ? ` · ${bi('next', 'পরবর্তী')}: ${item.nextAction}` : ''}</small>{item.report && <p><Bi en="Report:" bn="প্রতিবেদন:" /> {item.report}</p>}</li>)}</ol>}
        <AddForm en="Schedule an update" bn="আপডেট নির্ধারণ">
          <form onSubmit={schedule} className="form-stack inline-form">
            <label htmlFor="update-assignment"><Bi en="Lawyer" bn="আইনজীবী" /></label><select id="update-assignment" name="assignmentId" defaultValue={activeAssignments[0]?.id}>{activeAssignments.map((item) => <option key={item.id} value={item.id}>{item.lawyerName}</option>)}</select>
            <label htmlFor="update-deadline"><Bi en="Deadline" bn="শেষ সময়" /></label><input id="update-deadline" name="dueAt" type="datetime-local" required />
            <label htmlFor="update-instruction"><Bi en="What to report" bn="কী জানাতে হবে" /></label><textarea id="update-instruction" name="instruction" minLength="5" maxLength="300" required />
            <button type="submit" disabled={busy}><Bi en="Schedule" bn="নির্ধারণ করুন" /></button>
          </form>
        </AddForm>
      </div>}

      {paymentAssignments.length > 0 && <div className="block"><h3 id="payment-title"><Bi en="Payment status" bn="পেমেন্টের অবস্থা" /></h3>
        <p className="muted"><Bi en="Status record only. No money moves here." bn="এখানে শুধু পেমেন্টের অবস্থা নথিভুক্ত হয়; টাকা লেনদেন হয় না।" /></p>
        <ul className="plain-list">{paymentAssignments.map((item) => <li key={item.id}>
          <strong>{item.lawyerName}</strong> <Badge code={item.status} />
          <ul className="plain-list">{paymentStages.map((stage) => {
            const latest = item.paymentHistory?.find((entry) => entry.stage === stage)
            return <li key={stage}><Term code={stage} />: {latest ? <><Badge code={latest.status} /> <small>{when(latest.createdAt)} · {latest.reason}</small></> : <span className="muted">{bi('Not recorded', 'নথিভুক্ত নয়')}</span>}</li>
          })}</ul>
          {item.paymentHistory?.length > 0 && <details>
            <summary>{bi('Status history', 'অবস্থার ইতিহাস')} ({num(item.paymentHistory.length)})</summary>
            <ol className="timeline compact">{item.paymentHistory.map((entry) => <li key={entry._id}><Term code={entry.stage} /> · <Badge code={entry.status} /> · {when(entry.createdAt)}<p>{entry.reason}</p></li>)}</ol>
          </details>}
        </li>)}</ul>
        <AddForm en="Record payment status" bn="পেমেন্টের অবস্থা লিখুন">
          <form onSubmit={recordPayment} className="form-stack inline-form">
            <label htmlFor="payment-assignment"><Bi en="Lawyer" bn="আইনজীবী" /></label><select id="payment-assignment" value={paymentAssignmentId || paymentAssignments[0].id} onChange={(event) => setPaymentAssignmentId(event.target.value)}>{paymentAssignments.map((item) => <option key={item.id} value={item.id}>{item.lawyerName} · {say(item.status)}</option>)}</select>
            <label htmlFor="payment-stage"><Bi en="Work stage" bn="কাজের ধাপ" /></label><select id="payment-stage" value={paymentStage} onChange={(event) => setPaymentStage(event.target.value)}>{paymentStages.map((code) => <option key={code} value={code}>{say(code)}</option>)}</select>
            <label htmlFor="payment-status"><Bi en="Status" bn="অবস্থা" /></label><select id="payment-status" value={paymentStatus} onChange={(event) => setPaymentStatus(event.target.value)}>{['SUBMITTED', 'UNDER_REVIEW', 'RECONCILED', 'PAYMENT_RECORDED', 'DISPUTED', 'NOT_RECORDED'].map((code) => <option key={code} value={code}>{say(code)}</option>)}</select>
            <label htmlFor="payment-reason"><Bi en="Note" bn="নোট" /></label><textarea id="payment-reason" value={paymentReason} onChange={(event) => setPaymentReason(event.target.value)} minLength="10" maxLength="500" required />
            <button type="submit" disabled={busy}><Bi en="Save payment status" bn="অবস্থা সংরক্ষণ" /></button>
          </form>
        </AddForm>
      </div>}

      <div className="block"><h3 id="change-title"><Bi en="Lawyer change requests" bn="আইনজীবী বদলের অনুরোধ" /></h3>
        {data.changeRequests.length === 0 ? <p className="muted">{bi('None', 'নেই')}</p> : <ul className="plain-list">{data.changeRequests.map((item) => <li key={item.id}><div><Badge code={item.status} /> <Term code={item.channel} /><p>{item.reason}</p><small>{when(item.createdAt)}{item.reviewReason ? ` · ${item.reviewReason}` : ''}</small>
          {item.status === 'OPEN' && <><label htmlFor={`request-reason-${item.id}`}><Bi en="Review reason" bn="পর্যালোচনার কারণ" /></label><textarea id={`request-reason-${item.id}`} value={reviewReasons[item.id] || ''} onChange={(event) => setReviewReasons((current) => ({ ...current, [item.id]: event.target.value }))} minLength="10" maxLength="500" /><div className="choice-row"><button type="button" disabled={busy || (reviewReasons[item.id] || '').trim().length < 10} onClick={() => reviewRequest(item.id, 'APPROVE')}><Bi en="Approve" bn="অনুমোদন" /></button><button type="button" className="secondary-button" disabled={busy || (reviewReasons[item.id] || '').trim().length < 10} onClick={() => reviewRequest(item.id, 'DECLINE')}><Bi en="Decline" bn="প্রত্যাখ্যান" /></button></div></>}
        </div></li>)}</ul>}
        <p className="muted"><Bi en="Approving does not change the lawyer. The current lawyer stays until a new one accepts." bn="অনুরোধ অনুমোদন করলেই আইনজীবী বদলাবে না। নতুন আইনজীবী দায়িত্ব না নেওয়া পর্যন্ত বর্তমান আইনজীবীই থাকবেন।" /></p>
      </div>
    </>}
  </Panel>
}
