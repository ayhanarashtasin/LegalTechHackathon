import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { api, apiUrl } from '../services/api.js'
import LawyerWorkspace, { DocumentChoices } from '../components/LawyerWorkspace.jsx'
import { AddForm, Badge, Bi, Term, bi, num, overdueText, say, when } from '../components/Bi.jsx'

function CallRecording({ applicationId, token }) {
  const [url, setUrl] = useState(null)
  const [state, setState] = useState('LOADING')
  useEffect(() => {
    const controller = new AbortController()
    let objectUrl
    fetch(apiUrl(`/api/applications/${applicationId}/recording`), { headers: { authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal })
      .then((response) => (response.ok ? response.blob() : Promise.reject(response.status)))
      .then((blob) => { objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); setState('READY') })
      .catch((failure) => { if (failure?.name !== 'AbortError') setState(failure === 404 ? 'NONE' : 'FAILED') })
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [applicationId, token])
  return state === 'READY'
    ? <audio controls preload="metadata" src={url} aria-label={bi('Full call recording', 'সম্পূর্ণ কল রেকর্ডিং')} />
    : <p className="muted">{{ LOADING: bi('Loading recording…', 'কল রেকর্ডিং লোড হচ্ছে…'), NONE: bi('No recording stored.', 'কোনো কল রেকর্ডিং সংরক্ষিত নেই।'), FAILED: bi('Recording could not load. Refresh to retry.', 'কল রেকর্ডিং লোড করা যায়নি। পৃষ্ঠাটি রিলোড করে পুনরায় চেষ্টা করুন।') }[state]}</p>
}

export default function LawyerCasePage({ session }) {
  const { caseId } = useParams()
  return <LawyerCase key={caseId} caseId={caseId} session={session} />
}

function LawyerCase({ session, caseId }) {
  const [record, setRecord] = useState(null)
  const [refresh, setRefresh] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [responseReason, setResponseReason] = useState('')
  const [drafts, setDrafts] = useState({})
  const [acceptingCases, setAcceptingCases] = useState(() => session.user.acceptingCases ?? true)
  const [togglingAvailability, setTogglingAvailability] = useState(false)

  // Step 6: Client Consultation state
  const [consultDate, setConsultDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [consultMode, setConsultMode] = useState('IN_PERSON_CHAMBER')
  const [consultNotes, setConsultNotes] = useState('')

  // Step 7: Court & Legal Representation state
  const [courtNameDraft, setCourtName] = useState(null)
  const [courtCaseNoDraft, setCourtCaseNo] = useState(null)
  const [courtStageDraft, setCourtStage] = useState(null)
  const [hearingDate, setHearingDate] = useState('')
  const [hearingBench, setHearingBench] = useState('')
  const [hearingNotes, setHearingNotes] = useState('')

  // Step 8 & Phase 6: Case Outcome & Completion Output state
  const [outcomeType, setOutcomeType] = useState('COURT_JUDGMENT_FAVOUR')
  const [outcomeDate, setOutcomeDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [outcomeRef, setOutcomeRef] = useState('')
  const [outcomeReport, setOutcomeReport] = useState('')
  const [outcomeAttachments, setOutcomeAttachments] = useState([])

  const mutations = useRef(new Map())
  const entries = record?.lawyerWorkspace?.entries || []
  const consultations = entries.filter((entry) => entry.kind === 'CONSULTATION').map((entry) => ({ ...entry.data, id: entry._id }))
  const hearings = entries.filter((entry) => entry.kind === 'HEARING').map((entry) => ({ ...entry.data, id: entry._id }))
  const court = entries.find((entry) => entry.kind === 'COURT')?.data
  const courtName = courtNameDraft ?? court?.courtName ?? ''
  const courtCaseNo = courtCaseNoDraft ?? court?.courtCaseNo ?? ''
  const courtStage = courtStageDraft ?? court?.courtStage ?? 'PLAINT_SUBMITTED'
  const outcome = entries.find((entry) => entry.kind === 'OUTCOME' && entry.reviewState !== 'CHANGES_REQUESTED')
  const outcomeRecord = outcome ? { ...outcome.data, reviewState: outcome.reviewState, submittedAt: outcome.createdAt } : null
  const feeClaims = record?.lawyerWorkspace?.claims || []

  useEffect(() => {
    const controller = new AbortController()
    api(`/api/cases/${encodeURIComponent(caseId)}`, { token: session.token, signal: controller.signal })
      .then(async (result) => {
        const lawyerWorkspace = result.assignmentStatus === 'ACCEPTED' ? await api(`/api/lawyers/assignments/${result.assignmentId}/workspace`, { token: session.token, signal: controller.signal }) : null
        setRecord({ ...result, lawyerWorkspace })
      }).catch((failure) => { if (failure.name !== 'AbortError') setError(failure.message) })
    return () => controller.abort()
  }, [caseId, refresh, session.token])

  useEffect(() => {
    api('/api/lawyers/availability', { token: session.token })
      .then((res) => { if (typeof res.acceptingCases === 'boolean') setAcceptingCases(res.acceptingCases) })
      .catch(() => {})
  }, [session.token])

  async function handleToggleAvailability() {
    setTogglingAvailability(true)
    try {
      const next = !acceptingCases
      const res = await api('/api/lawyers/availability', {
        token: session.token,
        method: 'PUT',
        body: { acceptingCases: next }
      })
      setAcceptingCases(res.acceptingCases)
      setNotice(res.acceptingCases
        ? bi('Status updated: You are now accepting cases.', 'অবস্থা হালনাগাদ: আপনি এখন নতুন মামলা গ্রহণে প্রস্তুত।')
        : bi('Status updated: Case acceptance paused.', 'অবস্থা হালনাগাদ: নতুন মামলা গ্রহণ স্থগিত করা হয়েছে।')
      )
    } catch (err) {
      setError(err.message)
    } finally {
      setTogglingAvailability(false)
    }
  }

  async function send(path, body, success) {
    setBusy(true)
    setError('')
    setNotice('')
    const retryKey = `${path}:${JSON.stringify(body)}`
    if (path.endsWith('/entries') && !mutations.current.has(retryKey)) mutations.current.set(retryKey, crypto.randomUUID())
    try {
      await api(path, { token: session.token, method: 'POST', body: { ...body, ...(path.endsWith('/entries') ? { clientMutationId: mutations.current.get(retryKey) } : {}) } })
      mutations.current.delete(retryKey)
      setNotice(success)
      setResponseReason('')
      setRefresh((value) => value + 1)
      return true
    } catch (failure) { setError(failure.message); return false } finally { setBusy(false) }
  }

  function respond(decision) {
    send(`/api/lawyers/assignments/${record.assignmentId}/respond`, { decision, reason: responseReason.trim() },
      decision === 'ACCEPT' ? bi('Assignment accepted. You are now the official legal aid counsel for this case.', 'নিয়োগ সফলভাবে গৃহীত হয়েছে। আপনি এই মামলার দায়িত্বপ্রাপ্ত প্যানেল আইনজীবী হিসেবে নিযুক্ত হলেন।') : bi('Assignment rejected. The DLAO has been notified.', 'নিয়োগ প্রত্যাখ্যান করা হয়েছে। সংশ্লিষ্ট ডিএলএও কার্যালয়কে অবহিত করা হয়েছে।'))
  }

  function submitUpdate(event, update) {
    event.preventDefault()
    const draft = drafts[update._id] || {}
    send(`/api/lawyers/assignments/${record.assignmentId}/updates/${update._id}`, draft,
      bi(`Progress update ${num(update.sequence)} recorded in official file.`, `মামলার ${num(update.sequence)} নম্বর অগ্রগতি প্রতিবেদন সরকারি নথিতে অন্তর্ভুক্ত হয়েছে।`))
  }

  async function saveConsultation(event) {
    event.preventDefault()
    if (await sendEntry('CONSULTATION', { date: consultDate, mode: consultMode, notes: consultNotes }, [])) setConsultNotes('')
  }
  function saveCourtFiling(event) {
    event.preventDefault()
    sendEntry('COURT', { courtName, courtCaseNo, courtStage }, [])
  }
  async function logHearing(event) {
    event.preventDefault()
    if (await sendEntry('HEARING', { date: hearingDate, bench: hearingBench || courtName, notes: hearingNotes }, [])) { setHearingNotes(''); setHearingBench('') }
  }
  async function submitOutcome(event) {
    event.preventDefault()
    if (await sendEntry('OUTCOME', { type: outcomeType, date: outcomeDate, referenceNo: outcomeRef, report: outcomeReport }, outcomeAttachments)) { setOutcomeReport(''); setOutcomeAttachments([]) }
  }
  function sendEntry(kind, data, attachmentIds) {
    return send(`/api/lawyers/assignments/${record.assignmentId}/entries`, { kind, data, attachmentIds }, bi('Report saved to the shared Case record.', 'প্রতিবেদন একীভূত মামলার নথিতে সংরক্ষিত হয়েছে।'))
  }
  function exportBrowserDrafts() {
    const prefixes = ['consult', 'court_name', 'court_no', 'court_stage', 'hearings', 'outcome', 'fee']
    const drafts = Object.fromEntries(prefixes.map((key) => [key, localStorage.getItem(`dlas_lawyer_${key}_${caseId}`)]).filter(([, value]) => value))
    const url = URL.createObjectURL(new Blob([JSON.stringify({ caseId, notice: 'Browser drafts only; not authoritative submissions. Review before resubmitting.', drafts }, null, 2)], { type: 'application/json' }))
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${caseId}-browser-drafts.json`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  let hasBrowserDrafts = false
  try { hasBrowserDrafts = ['consult', 'court_name', 'court_no', 'court_stage', 'hearings', 'outcome', 'fee'].some((key) => localStorage.getItem(`dlas_lawyer_${key}_${caseId}`)) } catch { /* Storage can be unavailable. */ }

  const back = <Link to="/">← <Bi en="Lawyer worklist" bn="প্যানেল আইনজীবীর কার্যতালিকা" /></Link>
  if (!record) return <section aria-labelledby="case-title">{back}<h1 id="case-title">{caseId}</h1>{error ? <p role="alert" className="error">{error}</p> : <p role="status">{bi('Loading…', 'লোড হচ্ছে…')}</p>}</section>

  const pending = record.assignmentStatus === 'PENDING'
  const accepted = record.assignmentStatus === 'ACCEPTED'
  const isUrgent = Boolean(
    record.urgent ||
    record.priorityDecision === 'URGENT' ||
    (record.priorityDecision !== 'ROUTINE' && record.flags?.some((f) => f.code === 'URGENT_RECOMMENDATION'))
  )
  const openUpdates = (record.updates || []).filter(({ status }) => status === 'PENDING' || status === 'MISSED')

  // Calculate lawyer workflow stage (1 to 5)
  let lawyerStage = 1
  if (accepted) {
    if (outcomeRecord) {
      lawyerStage = feeClaims.length > 0 ? 5 : 4
    } else if (hearings.length > 0 || courtCaseNo) {
      lawyerStage = 3
    } else {
      lawyerStage = 2
    }
  }

  const lawyerSteps = [
    { num: 1, title: '1. Appointment & Acceptance', desc: pending ? 'Offer Pending' : 'Accepted' },
    { num: 2, title: '2. Details & Client Consultation', desc: consultations.length ? `${consultations.length} Consultations` : 'Preparation' },
    { num: 3, title: '3. Court Filing & Representation', desc: courtCaseNo ? `${courtCaseNo}` : 'Hearings & Defense' },
    { num: 4, title: '4. Case Outcome & Completion', desc: outcomeRecord ? 'Disposed' : 'Disposal Report' },
    { num: 5, title: '5. Fee Claim & Payment', desc: record.payment?.status ? record.payment.status : 'DBLA Disbursement' },
  ]

  return (
    <section aria-labelledby="case-title">
      {back}

      {/* Lawyer Case Acceptance Availability Banner */}
      <div className="lawyer-availability-banner">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
          <span style={{ fontSize: '0.85rem', color: '#555', fontWeight: 500 }}>
            <Bi en="Your Panel Availability:" bn="আপনার প্যানেল প্রাপ্যতা স্থিতি:" />
          </span>
          <span className={`availability-badge ${acceptingCases ? 'accepting' : 'not-accepting'}`}>
            <span className="availability-dot" />
            {acceptingCases
              ? bi('Accepting Cases', 'মামলা গ্রহণে প্রস্তুত')
              : bi('Not Accepting Cases', 'মামলা গ্রহণ স্থগিত')}
          </span>
        </div>
        <button
          type="button"
          className="secondary-button"
          style={{ padding: '0.3rem 0.75rem', fontSize: '0.85rem' }}
          disabled={togglingAvailability}
          onClick={handleToggleAvailability}
        >
          {acceptingCases
            ? bi('Change to: Not Accepting', 'মামলা গ্রহণ স্থগিত করুন')
            : bi('Change to: Accepting', 'মামলা গ্রহণে প্রস্তুত করুন')}
        </button>
      </div>

      <div className={`record-head ${isUrgent ? 'urgent-record' : ''}`} style={isUrgent ? { padding: '1rem', borderRadius: '6px' } : {}}>
        <div>
          <p className="eyebrow"><Bi en="Panel Lawyer Case Record" bn="প্যানেল আইনজীবীর মামলা নথি" /></p>
          <h1 id="case-title">{record.caseId}</h1>
          <p className="record-sub">
            <Bi en="Application" bn="আবেদন নম্বর" /> {record.applicationId}
            {record.applicantName && <> · <strong><Bi en="Beneficiary:" bn="সুবিধাভোগী:" /> {record.applicantName}</strong></>}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {isUrgent && <span className="urgent-flag">{say('URGENT')}</span>}
          <Badge code={record.assignmentStatus} />
        </div>
      </div>

      {isUrgent && (
        <div className="urgent-record" style={{ padding: '0.75rem 1rem', borderRadius: '6px', margin: '1rem 0', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span className="urgent-flag" style={{ margin: 0 }}>{say('URGENT')}</span>
          <span><strong><Bi en="Urgent Case:" bn="জরুরি মামলা:" /></strong> <Bi en="Priority case flagged by DLAO / AI assessment. Expedited representation requested." bn="ডিএলএও কার্যালয় বা এআই মূল্যায়নে চিহ্নিত অগ্রাধিকারমূলক মামলা। দ্রুত কার্যকর আইনি পদক্ষেপ গ্রহণের অনুরোধ করা যাচ্ছে।" /></span>
        </div>
      )}

      {hasBrowserDrafts && <div className="safety-note"><p><Bi en="Previous browser drafts were not sent to DLAO. Export them, review, and resubmit through these forms." bn="পূর্বের ব্রাউজারের খসড়া ডিএলএওতে জমা হয়নি। রপ্তানি করে পর্যালোচনা শেষে এই ফর্মে পুনরায় জমা দিন।" /></p><button type="button" className="secondary-button" onClick={exportBrowserDrafts}><Bi en="Download previous browser drafts" bn="পূর্বের ব্রাউজারের খসড়া ডাউনলোড" /></button></div>}
      {record.status === 'CLOSED' && <p role="status" className="success"><Bi en="Case completed following DLAO review." bn="ডিএলএও পর্যালোচনার পর মামলা সমাপ্ত।" /></p>}
      {error && <p role="alert" className="error">{error}</p>}
      {notice && <p role="status" className="success">{notice}</p>}

      {/* Panel Lawyer Lifecycle Tracker */}
      <div className="phase-tracker-card" style={{ margin: '1rem 0 1.5rem 0' }} aria-label="Panel Lawyer Workflow">
        <div className="phase-tracker-header">
          <div>
            <span className="phase-tracker-badge">Panel Lawyer Assignment Workflow</span>
            <h3 className="phase-tracker-title"><Bi en="Legal Aid Representation & Case Management" bn="আইনি সহায়তা প্রদান ও মামলা পরিচালনা" /></h3>
          </div>
          <div className="phase-tracker-summary">
            {pending ? bi('Step 1 of 5 • Awaiting Acceptance', 'ধাপ ১/৫ • নিয়োগ গ্রহণের অপেক্ষায়') : `Step ${lawyerStage} of 5 • ${lawyerSteps[lawyerStage - 1].title}`}
          </div>
        </div>

        <ol className="phase-steps-grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
          {lawyerSteps.map((step) => {
            const isCompleted = accepted && (step.num < lawyerStage || (step.num === 5 && outcomeRecord))
            const isCurrent = (pending && step.num === 1) || (accepted && step.num === lawyerStage)
            const isUpcoming = !pending && step.num > lawyerStage

            return (
              <li
                key={step.num}
                className={`phase-step-item ${isCompleted ? 'step-completed' : ''} ${isCurrent ? 'step-active' : ''} ${isUpcoming ? 'step-upcoming' : ''}`}
              >
                <div className="phase-step-indicator">
                  <span className="phase-step-circle">
                    {isCompleted ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    ) : (
                      step.num
                    )}
                  </span>
                  {step.num < 5 && <span className="phase-step-line" aria-hidden="true" />}
                </div>
                <div className="phase-step-content">
                  <div className="phase-step-title">{step.title}</div>
                  <div className="phase-step-sub">{step.desc}</div>
                </div>
              </li>
            )
          })}
        </ol>
      </div>

      {/* Summary Card */}
      <section className={`card ${isUrgent ? 'urgent-record' : ''}`} aria-labelledby="summary-title" style={{ marginBottom: '1.25rem' }}>
        <h2 id="summary-title"><Bi en="At a glance" bn="এক নজরে মামলার তথ্য" /></h2>
        <dl className="facts">
          <div><dt><Bi en="Case status" bn="মামলার বর্তমান অবস্থা" /></dt><dd><Term code={record.status} /></dd></div>
          <div><dt><Bi en="Your assignment" bn="আপনার নিয়োগের অবস্থা" /></dt><dd><Term code={record.assignmentStatus} /></dd></div>
          {record.applicantName && <div><dt><Bi en="Client / Beneficiary" bn="মক্কেল / সুবিধাভোগী" /></dt><dd><strong>{record.applicantName}</strong></dd></div>}
          <div>
            <dt><Bi en="Safe Contact Phone" bn="নিরাপদ ফোন নম্বর" /></dt>
            <dd>
              {(record.safeContact?.contactValue || record.safeContactPhone) ? (
                <span className="safe-phone-highlight">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                  </svg>
                  {record.safeContact?.contactValue || record.safeContactPhone}
                </span>
              ) : (
                <span className="muted" style={{ fontStyle: 'italic', fontSize: '0.88rem' }}>
                  <Bi en="Not provided on call / Not recorded" bn="কলে নম্বর দেওয়া হয়নি / নথিতে নেই" />
                </span>
              )}
              {(record.safeContact?.callingWindow || record.safeContact?.safeTimeWindow) && (
                <small style={{ display: 'block', marginTop: '0.25rem', color: '#555' }}>
                  <Bi en="Safe time window:" bn="যোগাযোগের নিরাপদ সময়:" /> {record.safeContact.callingWindow || record.safeContact.safeTimeWindow}
                </small>
              )}
            </dd>
          </div>
          {record.legalNeed && <div className="wide"><dt><Bi en="Legal Need & Guidance" bn="আইনি সহায়তা ও পরামর্শের ক্ষেত্র" /></dt><dd>{record.legalNeed}</dd></div>}
          {record.complaintType && <div><dt><Bi en="Complaint Category" bn="অভিযোগের ধরন" /></dt><dd><Term code={record.complaintType} /></dd></div>}
          {record.vulnerability?.length > 0 && <div className="wide"><dt><Bi en="Special Vulnerability" bn="বিশেষ সুরক্ষা বা ঝুঁকির কারণ" /></dt><dd>{record.vulnerability.map(say).join(' · ')}</dd></div>}
          {!pending && <>
            <div><dt><Bi en="Next hearing" bn="পরবর্তী শুনানির তারিখ" /></dt><dd>{record.nextHearingAt ? <time dateTime={record.nextHearingAt}>{when(record.nextHearingAt)}</time> : bi('Not set', 'নির্ধারিত নয়')}</dd></div>
            <div className="wide"><dt><Bi en="Next step" bn="পরবর্তী করণীয় পদক্ষেপ" /></dt><dd>{record.nextAction || bi('Not set', 'নির্ধারিত নয়')}</dd></div>
          </>}
        </dl>
      </section>

      {/* Case Intake, Background & Call Recording Details */}
      <section className="card" aria-labelledby="intake-title" style={{ marginBottom: '1.25rem' }}>
        <h2 id="intake-title"><Bi en="Case Background & Intake Information" bn="মামলার বিবরণ ও ভয়েস ইনটেক তথ্য" /></h2>
        
        {record.complaintSummary ? (
          <div style={{ marginBottom: '1rem' }}>
            <h3 style={{ fontSize: '0.95rem', margin: '0 0 0.35rem 0', color: '#444' }}>
              <Bi en="Problem / Application Description" bn="সমস্যা বা অভিযোগের বিবরণ" />
            </h3>
            <p style={{ background: '#fcfbf9', border: '1px solid #eaeaea', borderRadius: '6px', padding: '0.75rem 1rem', lineHeight: '1.6', margin: 0 }}>
              {record.complaintSummary}
            </p>
          </div>
        ) : (
          <p className="muted" style={{ fontStyle: 'italic', marginBottom: '1rem' }}>
            <Bi en="No specific description recorded during initial intake." bn="প্রাথমিক ইনটেকে কোনো অতিরিক্ত বিবরণ লিপিবদ্ধ নেই।" />
          </p>
        )}

        {record.incident && (record.incident.what || record.incident.when || record.incident.where || record.incident.who) && (
          <div style={{ marginBottom: '1rem' }}>
            <h3 style={{ fontSize: '0.95rem', margin: '0 0 0.35rem 0', color: '#444' }}>
              <Bi en="Incident Specifics" bn="ঘটনার সুনির্দিষ্ট তথ্য" />
            </h3>
            <dl className="details compact" style={{ background: '#faf9f6', padding: '0.65rem 0.85rem', borderRadius: '6px' }}>
              {record.incident.what && <div><dt><Bi en="What Happened" bn="ঘটনা" /></dt><dd>{record.incident.what}</dd></div>}
              {record.incident.when && <div><dt><Bi en="When" bn="তারিখ / সময়" /></dt><dd>{record.incident.when}</dd></div>}
              {record.incident.where && <div><dt><Bi en="Where" bn="স্থান" /></dt><dd>{record.incident.where}</dd></div>}
              {record.incident.who && <div><dt><Bi en="Persons Involved" bn="জড়িত ব্যক্তি" /></dt><dd>{record.incident.who}</dd></div>}
            </dl>
          </div>
        )}

        {record.safeContact?.safeCallReason && (
          <div style={{ background: '#fff9e6', border: '1px solid #e0c878', borderRadius: '6px', padding: '0.65rem 0.85rem', marginBottom: '1rem' }}>
            <strong style={{ color: '#7a5a00' }}><Bi en="Safety & Confidentiality Notice:" bn="নিরাপত্তা ও গোপনীয়তা সতর্কতা:" /></strong>
            <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.9rem', color: '#553e00' }}>
              {record.safeContact.safeCallReason}
            </p>
          </div>
        )}

        {(record.hasRecording || record.channel === 'VOICE_SIM') && (
          <div style={{ marginTop: '1rem', padding: '0.85rem 1rem', background: '#f8faf8', border: '1px solid #d5e5d5', borderRadius: '6px' }}>
            <h3 style={{ margin: '0 0 0.4rem 0', fontSize: '0.95rem' }}><Bi en="Helpline / 16699 Voice Call Recording" bn="১৬৬৯৯ কল রেকর্ডিং অডিও" /></h3>
            <CallRecording applicationId={record.applicationId} token={session.token} />
            <p className="muted" style={{ margin: '0.35rem 0 0 0', fontSize: '0.82rem' }}>
              <Bi en="Full audio recorded during citizen voice intake. For advocate legal preparation." bn="নাগরিকের ভয়েস ইনটেকের সম্পূর্ণ অডিও রেকর্ডিং। আইনজীবী কর্তৃক মামলা প্রস্তুতির সুবিধার্থে সংরক্ষিত।" />
            </p>
          </div>
        )}

        {record.transcript?.turns?.length > 0 && (
          <div style={{ marginTop: '1rem' }}>
            <h3 style={{ fontSize: '0.95rem', margin: '0 0 0.4rem 0' }}><Bi en="Intake Call Transcript" bn="কলের লিখিত প্রতিলিপি (ট্রান্সক্রিপ্ট)" /></h3>
            {record.transcript.summary && (
              <p style={{ fontStyle: 'italic', color: '#555', margin: '0 0 0.5rem 0' }}>
                {record.transcript.summary}
              </p>
            )}
            <ol className="timeline compact" style={{ maxHeight: '350px', overflowY: 'auto', background: '#faf9f6', padding: '0.75rem', borderRadius: '6px' }}>
              {record.transcript.turns.map((turn, idx) => (
                <li key={idx} style={{ padding: '0.35rem 0' }}>
                  <strong>{turn.speaker === 'CALLER' ? <Bi en="Caller" bn="কলার" /> : <Bi en="Assistant" bn="সহকারী কর্মকর্তা" />}</strong>:
                  <span style={{ marginLeft: '0.5rem' }}>{turn.text}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </section>

      {/* Respond to assignment offer */}
      {pending && (
        <section className={`card ${isUrgent ? 'urgent-record' : ''}`} aria-labelledby="decision-title">
          <h2 id="decision-title"><Bi en="Step 1: Respond to Assignment Offer (DBLA Appointment)" bn="ধাপ ১: নিয়োগের প্রস্তাবে সম্মতি প্রদান (ডিবিএলএ নিয়োগ)" /></h2>
          <p className="muted"><Bi en="As per DBLA procedure, the case remains under DLAO jurisdiction until you formally accept assignment." bn="ডিবিএলএ বিধিমালা অনুযায়ী আপনি আনুষ্ঠানিকভাবে নিয়োগ গ্রহণ না করা পর্যন্ত মামলাটির কার্যক্রম পরিচালনার দায়িত্ব সংশ্লিষ্ট ডিএলএও কর্মকর্তার অধীনে থাকবে।" /></p>
          <label htmlFor="assignment-response-reason"><Bi en="Reason for accepting or declining" bn="নিয়োগ গ্রহণ বা প্রত্যাখ্যানের কারণ" /></label>
          <textarea id="assignment-response-reason" value={responseReason} onChange={(event) => setResponseReason(event.target.value)} minLength="10" maxLength="500" required />
          <div className="choice-row" style={{ marginTop: '0.75rem', display: 'flex', gap: '0.75rem' }}>
            <button type="button" disabled={busy || responseReason.trim().length < 10} onClick={() => respond('ACCEPT')}>
              <Bi en="Accept" bn="গ্রহণ করুন" />
            </button>
            <button type="button" className="secondary-button" style={{ borderColor: 'var(--color-danger, #b3261e)', color: 'var(--color-danger, #b3261e)' }} disabled={busy || responseReason.trim().length < 10} onClick={() => respond('DECLINE')}>
              <Bi en="Reject" bn="প্রত্যাখ্যান করুন" />
            </button>
          </div>
        </section>
      )}

      {/* Accepted Workflows (Steps 2 to 5) */}
      {!pending && (
        <div className="card panels">
          {/* Step 2: Case Information & Client Consultation */}
          <section className="panel" aria-labelledby="consult-title">
            <div className="panel-body">
              <h2 id="consult-title" className="panel-heading"><Bi en="Step 2: Case Information & Client Consultation" bn="ধাপ ২: মামলা পর্যালোচনা ও মক্কেলের আইনি পরামর্শ" /></h2>
              <p className="muted"><Bi en="Review case details, conduct initial client interview/consultation, formulate legal strategy, and record consultation notes." bn="মামলার নথিপত্র পর্যালোচনা করুন, সুবিধাভোগীর সাথে সাক্ষাৎ বা পরামর্শ সম্পন্ন করে আইনি কৌশল ও করণীয় লিপিবদ্ধ করুন।" /></p>

              <AddForm en="Record Client Consultation" bn="মক্কেলের আইনি পরামর্শ লিপিবদ্ধ করুন">
                <form onSubmit={saveConsultation} className="form-stack inline-form">
                  <label htmlFor="consult-date"><Bi en="Consultation Date" bn="সাক্ষাৎ / পরামর্শের তারিখ" /></label>
                  <input id="consult-date" type="date" value={consultDate} onChange={(e) => setConsultDate(e.target.value)} required />

                  <label htmlFor="consult-mode"><Bi en="Meeting Mode" bn="পরামর্শের মাধ্যম" /></label>
                  <select id="consult-mode" value={consultMode} onChange={(e) => setConsultMode(e.target.value)}>
                    <option value="IN_PERSON_CHAMBER">{bi('In-Person (Lawyer Chamber / DLAO Office)', 'সরাসরি সাক্ষাৎ (আইনজীবীর চেম্বার / ডিএলএও অফিস)')}</option>
                    <option value="PHONE_SAFE">{bi('Safe Phone Call (Approved Route)', 'অনুমোদিত নিরাপদ টেলিফোন সংযোগ')}</option>
                    <option value="COURT_PREMISES">{bi('Court Premises Consultation', 'আদালত প্রাঙ্গণে তাৎক্ষণিক পরামর্শ')}</option>
                  </select>

                  <label htmlFor="consult-notes"><Bi en="Consultation & Strategy Notes" bn="পরামর্শ ও আইনি কৌশলের বিবরণী" /></label>
                  <textarea id="consult-notes" value={consultNotes} onChange={(e) => setConsultNotes(e.target.value)} minLength="10" maxLength="1000" placeholder="Record key facts confirmed by client, list of witnesses, relief sought, and litigation plan..." required />

                  <button type="submit" disabled={busy || record.status !== 'OPEN'}><Bi en="Save Consultation Record" bn="পরামর্শের বিবরণী সংরক্ষণ করুন" /></button>
                </form>
              </AddForm>

              {consultations.length > 0 ? (
                <div className="version-history" style={{ marginTop: '0.75rem' }}>
                  <h4><Bi en="Consultation History" bn="পরামর্শের বিবরণীর ইতিহাস" /></h4>
                  <ol className="timeline compact">
                    {consultations.map((c) => (
                      <li key={c.id}>
                        <strong><Term code={c.mode} /></strong> <small>· {c.date}</small>
                        <p>{c.notes}</p>
                      </li>
                    ))}
                  </ol>
                </div>
              ) : (
                <p className="muted" style={{ fontSize: '0.85rem' }}><Bi en="No consultation logged yet. Record your initial meeting with the beneficiary." bn="এখনো কোনো পরামর্শ লিপিবদ্ধ করা হয়নি। সুবিধাভোগী মক্কেলের সাথে প্রথম বৈঠকের তথ্য অন্তর্ভুক্ত করুন।" /></p>
              )}
            </div>
          </section>

          {/* Step 3: Court / Legal Representation & Hearing Tracking */}
          <section className="panel" aria-labelledby="court-rep-title">
            <div className="panel-body">
              <h2 id="court-rep-title" className="panel-heading"><Bi en="Step 3: Court / Legal Representation & Hearings" bn="ধাপ ৩: আদালতে আইনি প্রতিনিধিত্ব ও শুনানির ট্র্যাকিং" /></h2>
              <p className="muted"><Bi en="File case documents in court, represent applicant in hearings, update hearing dates, and record hearing outcomes." bn="সংশ্লিষ্ট আদালতে মামলা বা আরজি দাখিল করুন, শুনানিতে নিয়মিত হাজিরা প্রদান করুন এবং আদেশের বিবরণ হালনাগাদ রাখুন।" /></p>

              {/* Court filing details */}
              <div style={{ background: '#fdfbf7', border: '1px solid #e8e2d2', borderRadius: '6px', padding: '1rem', margin: '0.75rem 0' }}>
                <h3 style={{ margin: '0 0 0.5rem 0' }}><Bi en="Court & Filing Reference" bn="আদালত ও মামলার বিবরণী" /></h3>
                <form onSubmit={saveCourtFiling} className="form-stack inline-form">
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem' }}>
                    <div>
                      <label htmlFor="court-name"><Bi en="Court / Tribunal Name" bn="আদালত / ট্রাইব্যুনালের নাম" /></label>
                      <input id="court-name" value={courtName} onChange={(e) => setCourtName(e.target.value)} required />
                    </div>
                    <div>
                      <label htmlFor="court-case-no"><Bi en="Court Case / Filing No." bn="আদালতের মামলা / মোকাদ্দমা নম্বর" /></label>
                      <input id="court-case-no" value={courtCaseNo} onChange={(e) => setCourtCaseNo(e.target.value)} placeholder="e.g. Family Suit No. 12/2026" />
                    </div>
                    <div>
                      <label htmlFor="court-stage"><Bi en="Case Stage in Court" bn="আদালতে মামলার বর্তমান পর্যায়" /></label>
                      <select id="court-stage" value={courtStage} onChange={(e) => setCourtStage(e.target.value)}>
                        <option value="PLAINT_SUBMITTED">{bi('Plaint Filed / Cognizance', 'আরজি দাখিল / আমলে গ্রহণ')}</option>
                        <option value="SUMMONS_SERVED">{bi('Summons / Notice Served', 'সমন বা নোটিশ জারি')}</option>
                        <option value="WRITTEN_STATEMENT">{bi('Written Statement Filed', 'লিখিত জবাব দাখিল')}</option>
                        <option value="FRAMING_ISSUES">{bi('Framing of Issues / Charge', 'বিচার্য বিষয় বা চার্জ গঠন')}</option>
                        <option value="WITNESS_EVIDENCE">{bi('Evidence / Witness Hearing', 'সাক্ষ্য গ্রহণ পর্যায়')}</option>
                        <option value="FINAL_ARGUMENTS">{bi('Final Arguments', 'চূড়ান্ত যুক্তিতর্ক')}</option>
                        <option value="FIXED_FOR_JUDGMENT">{bi('Fixed for Judgment', 'রায়ের জন্য দিন ধার্য')}</option>
                      </select>
                    </div>
                  </div>
                  <button type="submit" disabled={busy || record.status !== 'OPEN'} className="secondary-button" style={{ marginTop: '0.5rem' }}><Bi en="Save Court Information" bn="আদালতের তথ্য সংরক্ষণ করুন" /></button>
                </form>
              </div>

              {/* Hearing appearances log */}
              <AddForm en="Record Hearing Appearance" bn="শুনানির হাজিরা ও কার্যবিবরণী লিপিবদ্ধ করুন">
                <form onSubmit={logHearing} className="form-stack inline-form">
                  <label htmlFor="hearing-date"><Bi en="Hearing Date" bn="শুনানির তারিখ" /></label>
                  <input id="hearing-date" type="date" value={hearingDate} onChange={(e) => setHearingDate(e.target.value)} required />

                  <label htmlFor="hearing-bench"><Bi en="Presiding Judge / Bench" bn="বিচারক / এজলাসের বিবরণ" /></label>
                  <input id="hearing-bench" value={hearingBench} onChange={(e) => setHearingBench(e.target.value)} placeholder="e.g. Joint District Judge Court 1" />

                  <label htmlFor="hearing-notes"><Bi en="Hearing Proceedings & Court Order" bn="শুনানির কার্যক্রম ও আদালতের আদেশ" /></label>
                  <textarea id="hearing-notes" value={hearingNotes} onChange={(e) => setHearingNotes(e.target.value)} minLength="10" maxLength="1000" placeholder="Detail witness examination, argument points, and court's order today..." required />

                  <button type="submit" disabled={busy || record.status !== 'OPEN'}><Bi en="Log Hearing Appearance" bn="শুনানির হাজিরা সংরক্ষণ করুন" /></button>
                </form>
              </AddForm>

              {hearings.length > 0 && (
                <div className="version-history" style={{ marginTop: '0.75rem' }}>
                  <h4><Bi en="Hearing Log & Appearances" bn="শুনানি ও হাজিরার বিবরণী" /></h4>
                  <ol className="timeline compact">
                    {hearings.map((h) => (
                      <li key={h.id}>
                        <strong>{h.bench}</strong> <small>· {h.date}</small>
                        <p>{h.notes}</p>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          </section>

          {/* Required Progress Updates (Preserved) */}
          <section className="panel" aria-labelledby="updates-title"><div className="panel-body"><h2 id="updates-title" className="panel-heading"><Bi en="Required Progress Updates (DLAO Schedules)" bn="প্রয়োজনীয় অগ্রগতির বিবরণী (ডিএলএও নির্ধারিত সময়সূচি)" /></h2>
            {openUpdates.length === 0 ? <p className="muted"><Bi en="Nothing due." bn="আপাতত কোনো অগ্রগতি প্রতিবেদন বাকি নেই।" /></p> : <ul className="plain-list">{openUpdates.map((update) => {
              const draft = drafts[update._id] || {}
              return <li key={update._id}><div><strong><Bi en="Update" bn="আপডেট" /> {num(update.sequence)}</strong> <Badge code={update.status} /><p>{update.instruction}</p><small><Bi en="Due" bn="দাখিলের শেষ সময়" /> {when(update.dueAt)}{update.status === 'MISSED' && <> · <strong>{overdueText(update.dueAt)}</strong></>}</small>
                {update.reminderCount > 0 && <p role="note" className="reminder-note"><Bi en="The DLAO office has asked for this update" bn="ডিএলএও কার্যালয় থেকে এই অগ্রগতি প্রতিবেদনের তাগিদ দেওয়া হয়েছে" /> ({bi(`${update.reminderCount} time${update.reminderCount === 1 ? '' : 's'}`, `${num(update.reminderCount)} বার`)}, <Bi en="last" bn="সর্বশেষ" /> {when(update.lastRemindedAt)})</p>}
                <form onSubmit={(event) => submitUpdate(event, update)} className="form-stack inline-form">
                  <label htmlFor={`lawyer-report-${update._id}`}><Bi en="Progress report" bn="অগ্রগতির প্রতিবেদন" /></label><textarea id={`lawyer-report-${update._id}`} value={draft.report || ''} onChange={(event) => setDrafts((current) => ({ ...current, [update._id]: { ...current[update._id], report: event.target.value } }))} minLength="5" maxLength="2000" required />
                  <label htmlFor={`lawyer-next-${update._id}`}><Bi en="Next step" bn="পরবর্তী করণীয় পদক্ষেপ" /></label><input id={`lawyer-next-${update._id}`} value={draft.nextAction || ''} onChange={(event) => setDrafts((current) => ({ ...current, [update._id]: { ...current[update._id], nextAction: event.target.value } }))} minLength="5" maxLength="300" required />
                  <button type="submit" disabled={busy}><Bi en="Submit progress update" bn="অগ্রগতি প্রতিবেদন জমা দিন" /></button>
                </form>
              </div></li>
            })}</ul>}
            {(record.updates || []).filter(({ report }) => report).map((update) => <div className="version-history" key={update._id}><h3><Bi en="Update" bn="আপডেট" /> {num(update.sequence)} <Badge code={update.status} /></h3><p>{update.report}</p><p><Bi en="Next step:" bn="পরবর্তী করণীয়:" /> {update.nextAction}</p><small>{when(update.submittedAt)}</small></div>)}
          </div></section>

          {/* Step 4: Case Outcome & Completion Output */}
          <section className="panel" aria-labelledby="outcome-title">
            <div className="panel-body">
              <h2 id="outcome-title" className="panel-heading"><Bi en="Step 4: Case Outcome & Completion Output" bn="ধাপ ৪: মামলার চূড়ান্ত নিষ্পত্তি ও সমাপ্তি প্রতিবেদন দাখিল" /></h2>
              <p className="muted"><Bi en="When case is disposed or resolved, record the legal outcome (Judgment/Settlement) and submit your formal completion output." bn="মামলা নিষ্পত্তি বা সমাধান হলে আদালতের আদেশের বিবরণ এবং দায়িত্ব সমাপ্তির আনুষ্ঠানিক প্রতিবেদন দাখিল করুন।" /></p>

              {outcomeRecord ? (
                <div className="success" style={{ margin: '0.75rem 0' }}>
                  <h3><Bi en="Final Report Review" bn="চূড়ান্ত প্রতিবেদনের পর্যালোচনা" /></h3>
                  <Badge code={outcomeRecord.reviewState} />
                  <dl className="details compact" style={{ marginTop: '0.5rem' }}>
                    <div><dt><Bi en="Legal Outcome" bn="আইনি নিষ্পত্তির ফলাফল" /></dt><dd><Term code={outcomeRecord.type} /></dd></div>
                    <div><dt><Bi en="Disposal Date" bn="নিষ্পত্তির তারিখ" /></dt><dd>{outcomeRecord.date}</dd></div>
                    <div><dt><Bi en="Decree / Judgment Ref" bn="ডিক্রি / আদেশ / রেফারেন্স নম্বর" /></dt><dd>{outcomeRecord.referenceNo || bi('Not recorded', 'লিপিবদ্ধ নেই')}</dd></div>
                    <div><dt><Bi en="Completion Summary" bn="সমাপ্তি প্রতিবেদনের বিবরণ" /></dt><dd>{outcomeRecord.report}</dd></div>
                    <div><dt><Bi en="Submitted at" bn="দাখিলের সময়" /></dt><dd>{when(outcomeRecord.submittedAt)}</dd></div>
                  </dl>
                  <p style={{ marginTop: '0.5rem', fontSize: '0.85rem' }}>
                    <Bi en="Final report saved; DLAO reviews closure and payment separately." bn="চূড়ান্ত প্রতিবেদন সংরক্ষিত হয়েছে; ডিএলএও সমাপ্তি ও পরিশোধ পৃথকভাবে পর্যালোচনা করবেন।" />
                  </p>
                </div>
              ) : (
                <form onSubmit={submitOutcome} className="form-stack inline-form">
                  <label htmlFor="lawyer-outcome-type"><Bi en="Disposal Outcome Type" bn="মামলা নিষ্পত্তির ধরন" /></label>
                  <select id="lawyer-outcome-type" value={outcomeType} onChange={(e) => setOutcomeType(e.target.value)}>
                    <option value="COURT_JUDGMENT_FAVOUR">{bi('Judgment in Favour of Beneficiary (পক্ষে রায়)', 'সুবিধাভোগীর পক্ষে রায়')}</option>
                    <option value="COURT_JUDGMENT_DISMISSED">{bi('Case Dismissed / Decreed (খারিজ / ডিক্রি)', 'মামলা খারিজ / ডিক্রি')}</option>
                    <option value="COMPROMISE_DECREE">{bi('Compromise / Settlement Decree (আপস নিষ্পত্তি ডিক্রি)', 'আপস নিষ্পত্তি ডিক্রি')}</option>
                    <option value="OTHER">{bi('Other outcome', 'অন্যান্য ফলাফল')}</option>
                    <option value="WITHDRAWN">{bi('Withdrawn on Satisfaction (প্রত্যাহার)', 'সন্তুষ্টি সাপেক্ষে প্রত্যাহার')}</option>
                  </select>

                  <label htmlFor="lawyer-outcome-date"><Bi en="Disposal Date" bn="নিষ্পত্তির তারিখ" /></label>
                  <input id="lawyer-outcome-date" type="date" value={outcomeDate} onChange={(e) => setOutcomeDate(e.target.value)} required />

                  <label htmlFor="lawyer-outcome-ref"><Bi en="Judgment / Order / Decree Number" bn="রায় / আদেশ / ডিক্রি নম্বর" /></label>
                  <input id="lawyer-outcome-ref" value={outcomeRef} onChange={(e) => setOutcomeRef(e.target.value)} placeholder="e.g. Decree dated 24/09/2026 in Suit No. 12" />

                  <label htmlFor="lawyer-completion-report"><Bi en="Completion Output Report (Summary for DLAO)" bn="দায়িত্ব সমাপ্তি প্রতিবেদন (ডিএলএও কার্যালয়ের অবগতির জন্য)" /></label>
                  <textarea id="lawyer-completion-report" value={outcomeReport} onChange={(e) => setOutcomeReport(e.target.value)} minLength="10" maxLength="1500" placeholder="Summarize final hearing, terms of decree/judgment, reliefs obtained for client, and formal conclusion of advocacy..." required />

                  <DocumentChoices documents={record.lawyerWorkspace?.documents || []} id="outcome-attachments" value={outcomeAttachments} onChange={setOutcomeAttachments} />
                  <button type="submit" disabled={busy || record.status !== 'OPEN'} style={{ background: '#28562d', borderColor: '#1f4523' }}>
                    <Bi en="Submit Completion Output" bn="সমাপ্তি প্রতিবেদন দাখিল করুন" />
                  </button>
                </form>
              )}
            </div>
          </section>

          <LawyerWorkspace key={record.assignmentId} data={record.lawyerWorkspace} token={session.token} onChanged={() => setRefresh((value) => value + 1)} />
        </div>
      )}
    </section>
  )
}

