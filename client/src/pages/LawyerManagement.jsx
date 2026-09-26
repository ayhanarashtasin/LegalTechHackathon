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
const remindedTimes = (count) => bi(`reminded ${count} time${count === 1 ? '' : 's'}`, `${num(count)} বার তাগিদ দেওয়া হয়েছে`)

// One panel lawyer's record in this office, for a human to review; not a finding about the lawyer.
function LawyerActivity({ activity }) {
  const { updates } = activity
  return <section className="lawyer-activity" aria-label={bi('Lawyer activity', 'আইনজীবীর দায়িত্ব ও অগ্রগতির বিবরণী')}>
    <h4>{activity.lawyerName}: <Bi en="activity in this office" bn="এই কার্যালয়ে আইনজীবীর কার্যক্রমের বিবরণী" /></h4>
    <dl className="details compact">
      <div><dt><Bi en="Cases" bn="মামলা" /></dt><dd>{bi(`${activity.activeCases} active · ${activity.pastCases} past`, `${num(activity.activeCases)}টি চলমান · ${num(activity.pastCases)}টি সম্পন্ন / পূর্ববর্তী`)}</dd></div>
      <div><dt><Bi en="Required updates" bn="বাধ্যতামূলক অগ্রগতি প্রতিবেদন" /></dt><dd>{bi(`${updates.onTime} on time · ${updates.late} late · ${updates.overdue} overdue now · ${updates.upcoming} upcoming`,
        `${num(updates.onTime)}টি সময়মতো দাখিল · ${num(updates.late)}টি বিলম্বে দাখিল · ${num(updates.overdue)}টি বর্তমানে বকেয়া · ${num(updates.upcoming)}টি অপেক্ষমাণ`)}</dd></div>
      <div><dt><Bi en="Reminders sent" bn="প্রেরিত তাগিদ" /></dt><dd>{num(activity.remindersSent)}</dd></div>
      <div><dt><Bi en="Last report" bn="সর্বশেষ দাখিলকৃত প্রতিবেদন" /></dt><dd>{activity.lastReportAt ? when(activity.lastReportAt) : bi('None yet', 'এখনো নেই')}</dd></div>
      <div><dt><Bi en="New assignments" bn="নতুন মামলা বরাদ্দ" /></dt><dd>{activity.hold?.newAssignmentHold ? <><Badge code="ON_HOLD" /> <Term code={activity.hold.reviewState} /></> : bi('Open', 'বরাদ্দযোগ্য')}</dd></div>
    </dl>
    {activity.cases.some(({ overdueUpdates }) => overdueUpdates) && <ul className="plain-list">{activity.cases.filter(({ overdueUpdates }) => overdueUpdates).map((item) => <li key={item.caseId}>
      <strong>{item.caseId}</strong> · {bi(`${item.overdueUpdates} overdue, the oldest ${item.oldestOverdueDays} days`, `${num(item.overdueUpdates)}টি বকেয়া, যার মধ্যে সবচেয়ে পুরোনোটি ${num(item.oldestOverdueDays)} দিন বিলম্বিত`)}
    </li>)}</ul>}
    <p className="muted"><Bi en="A pattern for a human to review. It is not a finding of misconduct." bn="এটি সংশ্লিষ্ট কর্মকর্তার পর্যালোচনার জন্য একটি অভ্যন্তরীণ তথ্যচিত্র; আইনজীবীর বিরুদ্ধে অসদাচরণের কোনো চূড়ান্ত সিদ্ধান্ত নয়।" /></p>
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
    }, bi('Hearing and next step saved.', 'পরবর্তী শুনানির তারিখ ও করণীয় পদক্ষেপ সফলভাবে সংরক্ষিত হয়েছে।'))) setPlanReason('')
  }

  async function offerAssignment(event) {
    event.preventDefault()
    if (await mutate(`/api/lawyers/applications/${applicationId}/assignments`, {
      lawyerUserId, reason: assignmentReason, ...(changeRequestId ? { changeRequestId } : {}),
    }, bi('Offer sent. It starts when the lawyer accepts.', 'মামলাটি পরিচালনার আনুষ্ঠানিক প্রস্তাব পাঠানো হয়েছে। আইনজীবী সম্মতি প্রদান করলে দায়িত্ব কার্যকর হবে।'))) setAssignmentReason('')
  }

  async function schedule(event) {
    event.preventDefault()
    const target = event.currentTarget
    const form = new FormData(event.currentTarget)
    if (await mutate(`/api/lawyers/applications/${applicationId}/update-schedules`, {
      assignmentId: form.get('assignmentId'), dueAt: new Date(form.get('dueAt')).toISOString(), instruction: form.get('instruction'),
    }, bi('Update scheduled.', 'অগ্রগতি প্রতিবেদন দাখিলের সময়সূচি নির্ধারণ করা হয়েছে।'))) target.reset()
  }

  function reviewRequest(requestId, decision) {
    mutate(`/api/lawyers/applications/${applicationId}/change-requests/${requestId}/review`, {
      decision, reason: reviewReasons[requestId] || '',
    }, decision === 'APPROVE'
      ? bi('Request approved. Offer a new lawyer separately.', 'আইনজীবী পরিবর্তনের আবেদন অনুমোদিত হয়েছে। নতুন আইনজীবীকে আলাদাভাবে মামলার প্রস্তাব প্রেরণ করুন।')
      : bi('Request declined with reason.', 'যথাযথ কারণসহ আবেদনটি নামঞ্জুর করা হয়েছে।'))
  }

  // "Request update": a reminder on the lawyer's own worklist, recorded on the case, instead of phoning them.
  async function requestUpdate(update) {
    if (await mutate(`/api/lawyers/applications/${applicationId}/updates/${update.id}/reminders`, undefined,
      bi('Reminder added to the lawyer’s worklist. No call, SMS, or email was sent.', 'আইনজীবীর কর্মতালিকায় তাগিদ বার্তা পাঠানো হয়েছে। কোনো ফোন কল, এসএমএস বা ইমেইল পাঠানো হয়নি।'))) setActivity(null)
  }

  async function toggleActivity(lawyerUserId) {
    if (activity?.lawyerUserId === String(lawyerUserId)) return setActivity(null)
    setError('')
    try { setActivity(await api(`/api/lawyers/panel-lawyers/${lawyerUserId}/activity`, { token })) } catch (failure) { setError(failure.message) }
  }

  function reviewHold(lawyerId, decision) {
    mutate(`/api/lawyers/holds/${lawyerId}/review`, { decision, reason: holdReasons[lawyerId] || '' },
      decision === 'LIFT' ? bi('Hold lifted. Current cases unchanged.', 'নতুন মামলা বরাদ্দের স্থগিতাদেশ প্রত্যাহার করা হয়েছে। চলমান মামলার দায়িত্ব বহাল থাকবে।') : bi('Hold continued. Current cases unchanged.', 'নতুন মামলা বরাদ্দের স্থগিতাদেশ বহাল রাখা হয়েছে। চলমান মামলার দায়িত্ব বহাল থাকবে।'))
  }

  async function recordPayment(event) {
    event.preventDefault()
    const assignment = data.assignments.find(({ id }) => id === (paymentAssignmentId || paymentAssignments[0]?.id))
    if (!assignment) return
    if (await mutate(`/api/lawyers/assignments/${assignment.id}/payment-status`, { stage: paymentStage, status: paymentStatus, reason: paymentReason },
      bi('Payment status saved. No money moved.', 'আইনজীবী ফি ও পেমেন্ট প্রক্রিয়ার স্থিতি সংরক্ষিত হয়েছে। কোনো আর্থিক লেনদেন সম্পন্ন হয়নি।'))) setPaymentReason('')
  }

  const activeAssignments = data?.assignments.filter(({ active, status }) => active && status === 'ACCEPTED') ?? []
  const paymentAssignments = data?.assignments.filter(({ status }) => status === 'ACCEPTED' || status === 'REASSIGNED') ?? []
  const pendingAssignments = data?.assignments.filter(({ active, status }) => active && status === 'PENDING') ?? []
  const approvedRequests = data?.changeRequests.filter(({ status }) => status === 'APPROVED') ?? []
  const holds = data?.panelLawyers.filter(({ hold }) => hold?.newAssignmentHold) ?? []
  // Overdue, unreported updates of the lawyer who holds the case now; each gets its own alert.
  const overdueUpdates = data?.updates.filter(({ status, assignmentId }) => status === 'MISSED' && activeAssignments.some(({ id }) => id === assignmentId)) ?? []
  const hint = activeAssignments[0]?.lawyerName ?? (pendingAssignments.length ? bi('Offer pending', 'আইনজীবীর সম্মতির অপেক্ষায়') : data && bi('No lawyer yet', 'এখনো কোনো আইনজীবী নিযুক্ত হননি'))

  return <Panel id="lawyer-title" en="Phase 5: Panel Lawyer Process (If Required)" bn="ধাপ ৫: প্যানেল আইনজীবী নিয়োগ ও মামলা পরিচালনা" hint={hint} open>
    {error && <p role="alert" className="error">{error}</p>}
    {notice && <p role="status" className="success">{notice}</p>}
    {!data && !error && <p role="status">{bi('Loading…', 'লোড হচ্ছে…')}</p>}
    {data && <>
      {overdueUpdates.map((update) => {
        const lawyer = activeAssignments.find(({ id }) => id === update.assignmentId)
        const remindedRecently = update.lastRemindedAt && loadedAt - new Date(update.lastRemindedAt).getTime() < REMINDER_GAP_MS
        return <section className="escalation-box" key={update.id} aria-label={bi('Lawyer update overdue', 'আইনজীবীর অগ্রগতি প্রতিবেদন দাখিলে বিলম্ব')}>
          <h3><Bi en="Lawyer update overdue" bn="আইনজীবীর অগ্রগতি প্রতিবেদন দাখিলে বিলম্ব" /></h3>
          <dl className="details compact">
            <div><dt><Bi en="Case" bn="মামলা" /></dt><dd>{data.caseId}</dd></div>
            <div><dt><Bi en="Applicant" bn="আবেদনকারী" /></dt><dd>{data.applicantName || bi('Not recorded', 'লিপিবদ্ধ নেই')}</dd></div>
            <div><dt><Bi en="Lawyer" bn="আইনজীবী" /></dt><dd>{lawyer?.lawyerName}</dd></div>
            <div><dt><Bi en="Required update" bn="বাধ্যতামূলক অগ্রগতি প্রতিবেদন" /></dt><dd>{num(update.sequence)} · <Bi en="due" bn="দাখিলের শেষ সময়" /> {when(update.dueAt)}</dd></div>
            <div><dt><Bi en="Overdue" bn="বিলম্বের সময়" /></dt><dd><strong>{overdueText(update.dueAt, loadedAt)}</strong></dd></div>
            <div><dt><Bi en="Reminders" bn="তাগিদপত্র" /></dt><dd>{update.reminderCount ? <>{remindedTimes(update.reminderCount)} · <Bi en="last" bn="সর্বশেষ" /> {when(update.lastRemindedAt)}</> : bi('None yet', 'এখনো কোনো তাগিদ দেওয়া হয়নি')}</dd></div>
          </dl>
          <div className="choice-row">
            <button type="button" disabled={busy || remindedRecently} onClick={() => requestUpdate(update)}><Bi en="Request update" bn="তাগিদ পাঠান" /></button>
            {lawyer?.lawyerUserId && <button type="button" className="secondary-button" aria-expanded={activity?.lawyerUserId === String(lawyer.lawyerUserId)} onClick={() => toggleActivity(lawyer.lawyerUserId)}><Bi en="Review lawyer activity" bn="আইনজীবীর সার্বিক কার্যক্রম দেখুন" /></button>}
          </div>
          {remindedRecently && <p className="muted"><Bi en="Reminded in the last 24 hours; another reminder is possible after that." bn="বিগত ২৪ ঘণ্টার মধ্যে তাগিদ পাঠানো হয়েছে; উক্ত সময় অতিক্রান্ত হলে পুনরায় তাগিদ দেওয়া যাবে।" /></p>}
        </section>
      })}
      {activity && <LawyerActivity activity={activity} />}
      {holds.map(({ id, displayName, hold }) => <section className="escalation-box" key={id} aria-label={bi('Lawyer assignment hold', 'আইনজীবী নিয়োগ স্থগিতাদেশ')}>
        <h3><Bi en="New assignments on hold: review needed" bn="নতুন মামলা বরাদ্দ সাময়িক স্থগিত: কর্মকর্তার পর্যালোচনা আবশ্যক" /></h3>
        <p>{displayName}: <Bi en="missed 2 updates in a row. Current cases continue. No misconduct finding." bn="ধারাবাহিকভাবে ২টি অগ্রগতি প্রতিবেদন দেননি। চলমান মামলাগুলো যথারীতি চলবে। এটি কোনো অসদাচরণের সিদ্ধান্ত নয়।" /></p>
        <p className="muted"><Term code={hold.reviewerRole} /> · <Term code={hold.reviewState} /> · <Bi en="Demo reviewer; legal authority not yet confirmed." bn="ডেমো পর্যালোচকের ভূমিকা। বিধি মোতাবেক চূড়ান্ত সিদ্ধান্তের আইনি এখতিয়ার যাচাইাধীন।" /></p>
        {hold.reviewReason && <p><Bi en="Last reason:" bn="সর্বশেষ কারণ:" /> {hold.reviewReason}</p>}
        <label htmlFor={`hold-reason-${id}`}><Bi en="Hold review reason" bn="স্থগিতাদেশ পর্যালোচনার মন্তব্য" /></label>
        <textarea id={`hold-reason-${id}`} value={holdReasons[id] || ''} onChange={(event) => setHoldReasons((current) => ({ ...current, [id]: event.target.value }))} minLength="10" maxLength="500" />
        <div className="choice-row"><button type="button" disabled={busy || (holdReasons[id] || '').trim().length < 10} onClick={() => reviewHold(id, 'LIFT')}><Bi en="Lift hold" bn="স্থগিতাদেশ প্রত্যাহার করুন" /></button><button type="button" className="secondary-button" disabled={busy || (holdReasons[id] || '').trim().length < 10} onClick={() => reviewHold(id, 'CONTINUE')}><Bi en="Continue hold" bn="স্থগিতাদেশ বহাল রাখুন" /></button></div>
      </section>)}

      <div className="block"><h3 id="assignment-title"><Bi en="Assigned lawyer" bn="নিয়োজিত প্যানেল আইনজীবী" /></h3>
        <fieldset className="means-test">
          <legend><Bi en="Beneficiary Financial Status Check (DBLA Criteria)" bn="সুবিধাভোগীর আর্থিক অবস্থা যাচাই (ডিবিএলএ নীতিমালা)" /></legend>
          <p className="muted"><Bi en="Verify if beneficiary can bear private advocate costs before government-funded panel lawyer allocation." bn="সরকারি খরচে প্যানেল আইনজীবী বরাদ্দের পূর্বে আবেদনকারীর আর্থিক অসচ্ছলতা নিশ্চিত করুন।" /></p>
          <div className="means-test-options">
            <label className={`means-test-option${!canBearCosts ? ' selected' : ''}`}>
              <input type="radio" name={`dlao-means-${applicationId}`} checked={!canBearCosts} onChange={() => setCanBearCosts(false)} />
              <span className="means-test-label">
                <strong><Bi en="No: Cannot bear cost" bn="না: খরচ বহনে অক্ষম" /></strong>
                <small><Bi en="Approve panel lawyer allocation" bn="প্যানেল আইনজীবী বরাদ্দ অনুমোদিত" /></small>
              </span>
            </label>
            <label className={`means-test-option${canBearCosts ? ' selected' : ''}`}>
              <input type="radio" name={`dlao-means-${applicationId}`} checked={canBearCosts} onChange={() => setCanBearCosts(true)} />
              <span className="means-test-label">
                <strong><Bi en="Yes: Can bear cost" bn="হ্যাঁ: খরচ বহনে সক্ষম" /></strong>
                <small><Bi en="Ineligible for State Counsel" bn="সরকারি আইনজীবী প্রযোজ্য নয়" /></small>
              </span>
            </label>
          </div>
          {canBearCosts ? (
            <div className="means-test-result means-test-ineligible">
              <strong><Bi en="No government-funded panel lawyer allocation." bn="সরকারি খরচে প্যানেল আইনজীবী বরাদ্দ হবে না।" /></strong>
              <p><Bi en="Inform applicant: explore alternative options or private counsel." bn="আবেদনকারীকে বিকল্প বা ব্যক্তিগত আইনজীবী নিয়োগের পরামর্শ প্রদান করুন।" /></p>
            </div>
          ) : (
            <div className="means-test-result means-test-eligible">
              <strong><Bi en="Approved for panel lawyer allocation" bn="প্যানেল আইনজীবী বরাদ্দ অনুমোদিত" /></strong>
              <p><Bi en="Beneficiary qualifies under DBLA criteria. Select and assign an advocate from the approved panel below." bn="সুবিধাভোগী ডিবিএলএ মানদণ্ডে যোগ্য। নিম্নের তালিকা থেকে অনুমোদিত প্যানেল আইনজীবী নির্বাচন ও নিয়োগ দিন।" /></p>
            </div>
          )}
        </fieldset>

        {data.assignments.length === 0 ? <p className="muted"><Bi en="No lawyer yet." bn="এখনো আইনজীবী নিযুক্ত হননি।" /></p> : <ul className="plain-list">{data.assignments.map((item) => <li key={item.id}><div><strong>{item.lawyerName}</strong> <Badge code={item.status} />{!item.active && <small className="muted"> · <Bi en="past" bn="পূর্ববর্তী" /></small>}{item.hold && <p><small><Bi en="Hold" bn="স্থগিতাদেশ" />: <Term code={item.hold.reviewState} /></small></p>}</div>{item.active && item.lawyerUserId && <button type="button" className="secondary-button" aria-expanded={activity?.lawyerUserId === String(item.lawyerUserId)} onClick={() => toggleActivity(item.lawyerUserId)}><Bi en="Review activity" bn="কার্যক্রম পর্যালোচনা" /></button>}</li>)}</ul>}
        {pendingAssignments.length > 0 && <p role="status"><Bi en="Waiting for the lawyer to accept or decline." bn="নিয়োগ প্রস্তাবে আইনজীবীর আনুষ্ঠানিক সম্মতির অপেক্ষায় রয়েছে।" /></p>}

        {/* Panel Lawyers Directory & Availability Roster */}
        {data.panelLawyers?.length > 0 && (
          <div style={{ margin: '1rem 0', background: '#fafaf8', border: '1px solid #eaeaea', borderRadius: '7px', padding: '0.85rem 1rem' }}>
            <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.92rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span><Bi en="Panel Lawyer Directory & Availability" bn="প্যানেল আইনজীবীদের তালিকা ও প্রাপ্যতা স্থিতি" /></span>
              <span className="muted" style={{ fontSize: '0.8rem', fontWeight: 400 }}>
                {bi(`${data.panelLawyers.length} lawyers on panel`, `প্যানেলে মোট ${num(data.panelLawyers.length)} জন আইনজীবী`)}
              </span>
            </h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.65rem' }}>
              {data.panelLawyers.map((person) => {
                const isAccepting = person.acceptingCases !== false
                const isSelected = lawyerUserId === String(person.id)
                return (
                  <div
                    key={person.id}
                    onClick={() => setLawyerUserId(String(person.id))}
                    style={{
                      padding: '0.6rem 0.75rem',
                      background: isSelected ? '#f5f8f5' : '#ffffff',
                      border: isSelected ? '1.5px solid #28562d' : '1px solid #e2e2dc',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
                      <strong style={{ fontSize: '0.88rem' }}>{person.displayName}</strong>
                      <span className={`availability-badge ${isAccepting ? 'accepting' : 'not-accepting'}`} style={{ fontSize: '0.72rem', padding: '0.15rem 0.5rem' }}>
                        <span className="availability-dot" />
                        {isAccepting ? bi('Accepting', 'প্রস্তুত') : bi('Not Accepting', 'স্থগিত')}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.8rem', color: '#666', marginTop: '0.2rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <span style={{ textTransform: 'uppercase', letterSpacing: '0.03em', fontWeight: 600, fontSize: '0.72rem', background: '#ececec', padding: '0.1rem 0.35rem', borderRadius: '3px' }}>
                        {person.userType || 'lawyer'}
                      </span>
                      <span>{person.username || person.email}</span>
                    </div>
                    {person.hold?.newAssignmentHold && (
                      <small style={{ color: '#9f2f2d', display: 'block', marginTop: '0.2rem' }}>
                        <Bi en="Assignment on hold" bn="নতুন বরাদ্দ স্থগিত" />
                      </small>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <AddForm en="Offer to a lawyer" bn="প্যানেল আইনজীবীকে নিয়োগের প্রস্তাব পাঠান">
          <form onSubmit={offerAssignment} className="form-stack inline-form">
            <label htmlFor="panel-lawyer"><Bi en="Panel lawyer" bn="প্যানেল আইনজীবী" /></label>
            <select id="panel-lawyer" value={lawyerUserId} onChange={(event) => setLawyerUserId(event.target.value)} required>
              <option value="">{bi('Choose panel lawyer…', 'প্যানেল আইনজীবী নির্বাচন করুন…')}</option>
              {data.panelLawyers.map((person) => {
                const isAccepting = person.acceptingCases !== false
                const statusTag = isAccepting ? bi('[Accepting]', '[মামলা গ্রহণে প্রস্তুত]') : bi('[Not Accepting]', '[মামলা গ্রহণ স্থগিত]')
                const holdTag = person.hold?.newAssignmentHold ? ` · ${bi('on hold', 'বরাদ্দ স্থগিত')}` : ''
                return (
                  <option key={person.id} value={person.id}>
                    {person.displayName} · {person.userType || 'lawyer'} ({person.username || person.email}) — {statusTag}{holdTag}
                  </option>
                )
              })}
            </select>
            <label htmlFor="assignment-change-request"><Bi en="Linked change request" bn="আইনজীবী পরিবর্তনের আবেদন সূত্র" /></label><select id="assignment-change-request" value={changeRequestId} onChange={(event) => setChangeRequestId(event.target.value)}><option value="">{bi('None: officer decision', 'প্রযোজ্য নয়: সরাসরি কর্মকর্তার সিদ্ধান্ত')}</option>{approvedRequests.map((item) => <option key={item.id} value={item.id}>{bi('Approved request', 'অনুমোদিত আবেদন')} · {when(item.createdAt)}</option>)}</select>
            <label htmlFor="assignment-reason"><Bi en="Reason" bn="নিয়োগের কারণ ও আইনি নির্দেশনা" /></label><textarea id="assignment-reason" value={assignmentReason} onChange={(event) => setAssignmentReason(event.target.value)} minLength="10" maxLength="500" required />
            <button type="submit" disabled={busy || !lawyerUserId || pendingAssignments.length > 0 || canBearCosts}><Bi en="Send offer" bn="নিয়োগের প্রস্তাব পাঠান" /></button>
          </form>
        </AddForm>
      </div>

      <div className="block"><h3 id="plan-title"><Bi en="Hearing and next step" bn="পরবর্তী শুনানি ও করণীয় পদক্ষেপ" /></h3>
        <dl className="details compact">
          <div><dt><Bi en="Next hearing" bn="পরবর্তী শুনানির সময়" /></dt><dd>{when(data.casePlan.nextHearingAt)}</dd></div>
          <div><dt><Bi en="Next step" bn="পরবর্তী করণীয়" /></dt><dd>{data.casePlan.nextAction || bi('Not set', 'নির্ধারিত নয়')}</dd></div>
        </dl>
        <AddForm en="Update hearing or next step" bn="শুনানি ও করণীয় হালনাগাদ করুন">
          <form onSubmit={savePlan} className="form-stack inline-form">
            <label htmlFor="lawyer-hearing"><Bi en="Next hearing" bn="পরবর্তী শুনানি" /></label><input id="lawyer-hearing" name="nextHearingAt" type="datetime-local" defaultValue={localDate(data.casePlan.nextHearingAt)} />
            <label htmlFor="lawyer-next-action"><Bi en="Next step for the applicant" bn="সুবিধাভোগী আবেদনকারীর করণীয়" /></label><textarea id="lawyer-next-action" name="nextAction" defaultValue={data.casePlan.nextAction} minLength="5" maxLength="300" required /><small><Bi en="May be read aloud. No private facts or contact details." bn="এই তথ্য আবেদনকারীকে পড়ে শোনানো হতে পারে। কোনো গোপনীয় তথ্য বা ফোন নম্বর লিখবেন না।" /></small>
            <label htmlFor="plan-reason"><Bi en="Reason" bn="হালনাগাদের কারণ ও ব্যাখ্যা" /></label><textarea id="plan-reason" name="reason" value={planReason} onChange={(event) => setPlanReason(event.target.value)} minLength="10" maxLength="500" required />
            <button type="submit" disabled={busy}><Bi en="Save" bn="সংরক্ষণ করুন" /></button>
          </form>
        </AddForm>
      </div>

      {activeAssignments.length > 0 && <div className="block"><h3 id="schedule-title"><Bi en="Progress updates" bn="অগ্রগতি প্রতিবেদন দাখিলের সময়সূচি" /></h3>
        {data.updates.length === 0 ? <p className="muted"><Bi en="None scheduled." bn="কোনো অগ্রগতি প্রতিবেদনের সময়সূচি নির্ধারিত নেই।" /></p> : <ol className="timeline compact">{data.updates.map((item) => <li key={item.id}><strong><Bi en="Update" bn="আপডেট" /> {num(item.sequence)}</strong> <Badge code={item.status} /><p>{item.instruction}</p><small><Bi en="Due" bn="দাখিলের শেষ সময়" /> {when(item.dueAt)}{item.status === 'MISSED' ? ` · ${overdueText(item.dueAt, loadedAt)}` : item.missedAt ? ` · ${bi('missed', 'ব্যর্থ')} ${when(item.missedAt)}` : ''}{item.reminderCount ? ` · ${remindedTimes(item.reminderCount)}` : ''}{item.nextAction ? ` · ${bi('next', 'পরবর্তী করণীয়')}: ${item.nextAction}` : ''}</small>{item.report && <p><Bi en="Report:" bn="প্রতিবেদন:" /> {item.report}</p>}</li>)}</ol>}
        <AddForm en="Schedule an update" bn="অগ্রগতি প্রতিবেদন দাখিলের সময় নির্ধারণ করুন">
          <form onSubmit={schedule} className="form-stack inline-form">
            <label htmlFor="update-assignment"><Bi en="Lawyer" bn="আইনজীবী" /></label><select id="update-assignment" name="assignmentId" defaultValue={activeAssignments[0]?.id}>{activeAssignments.map((item) => <option key={item.id} value={item.id}>{item.lawyerName}</option>)}</select>
            <label htmlFor="update-deadline"><Bi en="Deadline" bn="দাখিলের শেষ সময়" /></label><input id="update-deadline" name="dueAt" type="datetime-local" required />
            <label htmlFor="update-instruction"><Bi en="What to report" bn="প্রতিবেদনে যা উল্লেখ করতে হবে" /></label><textarea id="update-instruction" name="instruction" minLength="5" maxLength="300" required />
            <button type="submit" disabled={busy}><Bi en="Schedule" bn="সময়সূচি সংরক্ষণ করুন" /></button>
          </form>
        </AddForm>
      </div>}

      {paymentAssignments.length > 0 && <div className="block"><h3 id="payment-title"><Bi en="Payment status" bn="আইনজীবী ফি ও পেমেন্টের স্থিতি" /></h3>
        <p className="muted"><Bi en="Status record only. No money moves here." bn="এখানে কেবল পেমেন্ট প্রক্রিয়াকরণের অবস্থা সংরক্ষিত হয়; সরাসরি কোনো অর্থ লেনদেন হয় না।" /></p>
        <ul className="plain-list">{paymentAssignments.map((item) => <li key={item.id}>
          <strong>{item.lawyerName}</strong> <Badge code={item.status} />
          <ul className="plain-list">{paymentStages.map((stage) => {
            const latest = item.paymentHistory?.find((entry) => entry.stage === stage)
            return <li key={stage}><Term code={stage} />: {latest ? <><Badge code={latest.status} /> <small>{when(latest.createdAt)} · {latest.reason}</small></> : <span className="muted">{bi('Not recorded', 'লিপিবদ্ধ নেই')}</span>}</li>
          })}</ul>
          {item.paymentHistory?.length > 0 && <details>
            <summary>{bi('Status history', 'স্থিতির পূর্বাপর বিবরণী')} ({num(item.paymentHistory.length)})</summary>
            <ol className="timeline compact">{item.paymentHistory.map((entry) => <li key={entry._id}><Term code={entry.stage} /> · <Badge code={entry.status} /> · {when(entry.createdAt)}<p>{entry.reason}</p></li>)}</ol>
          </details>}
        </li>)}</ul>
        <AddForm en="Record payment status" bn="পেমেন্টের স্থিতি লিপিবদ্ধ করুন">
          <form onSubmit={recordPayment} className="form-stack inline-form">
            <label htmlFor="payment-assignment"><Bi en="Lawyer" bn="আইনজীবী" /></label><select id="payment-assignment" value={paymentAssignmentId || paymentAssignments[0].id} onChange={(event) => setPaymentAssignmentId(event.target.value)}>{paymentAssignments.map((item) => <option key={item.id} value={item.id}>{item.lawyerName} · {say(item.status)}</option>)}</select>
            <label htmlFor="payment-stage"><Bi en="Work stage" bn="কাজের পর্যায় / খাত" /></label><select id="payment-stage" value={paymentStage} onChange={(event) => setPaymentStage(event.target.value)}>{paymentStages.map((code) => <option key={code} value={code}>{say(code)}</option>)}</select>
            <label htmlFor="payment-status"><Bi en="Status" bn="বর্তমান স্থিতি" /></label><select id="payment-status" value={paymentStatus} onChange={(event) => setPaymentStatus(event.target.value)}>{['SUBMITTED', 'UNDER_REVIEW', 'RECONCILED', 'PAYMENT_RECORDED', 'DISPUTED', 'NOT_RECORDED'].map((code) => <option key={code} value={code}>{say(code)}</option>)}</select>
            <label htmlFor="payment-reason"><Bi en="Note" bn="মন্তব্য ও বিবরণী" /></label><textarea id="payment-reason" value={paymentReason} onChange={(event) => setPaymentReason(event.target.value)} minLength="10" maxLength="500" required />
            <button type="submit" disabled={busy}><Bi en="Save payment status" bn="পেমেন্টের স্থিতি সংরক্ষণ করুন" /></button>
          </form>
        </AddForm>
      </div>}

      <div className="block"><h3 id="change-title"><Bi en="Lawyer change requests" bn="আইনজীবী পরিবর্তনের আবেদনসমূহ" /></h3>
        {data.changeRequests.length === 0 ? <p className="muted">{bi('None', 'নেই')}</p> : <ul className="plain-list">{data.changeRequests.map((item) => <li key={item.id}><div><Badge code={item.status} /> <Term code={item.channel} /><p>{item.reason}</p><small>{when(item.createdAt)}{item.reviewReason ? ` · ${item.reviewReason}` : ''}</small>
          {item.status === 'OPEN' && <><label htmlFor={`request-reason-${item.id}`}><Bi en="Review reason" bn="পর্যালোচনার কারণ ও মন্তব্য" /></label><textarea id={`request-reason-${item.id}`} value={reviewReasons[item.id] || ''} onChange={(event) => setReviewReasons((current) => ({ ...current, [item.id]: event.target.value }))} minLength="10" maxLength="500" /><div className="choice-row"><button type="button" disabled={busy || (reviewReasons[item.id] || '').trim().length < 10} onClick={() => reviewRequest(item.id, 'APPROVE')}><Bi en="Approve" bn="অনুমোদন করুন" /></button><button type="button" className="secondary-button" disabled={busy || (reviewReasons[item.id] || '').trim().length < 10} onClick={() => reviewRequest(item.id, 'DECLINE')}><Bi en="Decline" bn="নামঞ্জুর করুন" /></button></div></>}
        </div></li>)}</ul>}
        <p className="muted"><Bi en="Approving does not change the lawyer. The current lawyer stays until a new one accepts." bn="আবেদন অনুমোদন করলেও তাৎক্ষণিকভাবে আইনজীবী পরিবর্তিত হবে না। নতুন প্যানেল আইনজীবী দায়িত্ব গ্রহণ না করা পর্যন্ত বর্তমান আইনজীবীই দায়িত্বে থাকবেন।" /></p>
      </div>
    </>}
  </Panel>
}
