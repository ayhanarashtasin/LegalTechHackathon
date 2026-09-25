import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { api } from '../services/api.js'
import { AddForm, Badge, Bi, Term, bi, num, say, when } from '../components/Bi.jsx'

export default function LawyerCasePage({ session }) {
  const { caseId } = useParams()
  const [record, setRecord] = useState(null)
  const [refresh, setRefresh] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [responseReason, setResponseReason] = useState('')
  const [drafts, setDrafts] = useState({})

  // Step 6: Client Consultation state
  const [consultDate, setConsultDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [consultMode, setConsultMode] = useState('IN_PERSON_CHAMBER')
  const [consultNotes, setConsultNotes] = useState('')
  const [consultations, setConsultations] = useState(() => {
    try { return JSON.parse(localStorage.getItem(`dlas_lawyer_consult_${caseId}`)) || [] } catch { return [] }
  })

  // Step 7: Court & Legal Representation state
  const [courtName, setCourtName] = useState(() => {
    try { return localStorage.getItem(`dlas_lawyer_court_name_${caseId}`) || 'Dhaka District & Sessions Judge Court' } catch { return 'Dhaka District & Sessions Judge Court' }
  })
  const [courtCaseNo, setCourtCaseNo] = useState(() => {
    try { return localStorage.getItem(`dlas_lawyer_court_no_${caseId}`) || '' } catch { return '' }
  })
  const [courtStage, setCourtStage] = useState(() => {
    try { return localStorage.getItem(`dlas_lawyer_court_stage_${caseId}`) || 'PLAINT_SUBMITTED' } catch { return 'PLAINT_SUBMITTED' }
  })
  const [hearingDate, setHearingDate] = useState('')
  const [hearingBench, setHearingBench] = useState('')
  const [hearingNotes, setHearingNotes] = useState('')
  const [hearings, setHearings] = useState(() => {
    try { return JSON.parse(localStorage.getItem(`dlas_lawyer_hearings_${caseId}`)) || [] } catch { return [] }
  })

  // Step 8 & Phase 6: Case Outcome & Completion Output state
  const [outcomeType, setOutcomeType] = useState('COURT_JUDGMENT_FAVOUR')
  const [outcomeDate, setOutcomeDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [outcomeRef, setOutcomeRef] = useState('')
  const [outcomeReport, setOutcomeReport] = useState('')
  const [outcomeRecord, setOutcomeRecord] = useState(() => {
    try { return JSON.parse(localStorage.getItem(`dlas_lawyer_outcome_${caseId}`)) || null } catch { return null }
  })

  // Step 9 & Phase 6: Lawyer Fee Claim Processing state
  const [feeCategory, setFeeCategory] = useState('CASE_PREPARATION')
  const [feeAmount, setFeeAmount] = useState('3000')
  const [feeNotes, setFeeNotes] = useState('')
  const [feeClaims, setFeeClaims] = useState(() => {
    try { return JSON.parse(localStorage.getItem(`dlas_lawyer_fee_${caseId}`)) || [] } catch { return [] }
  })

  useEffect(() => {
    const controller = new AbortController()
    api(`/api/cases/${encodeURIComponent(caseId)}`, { token: session.token, signal: controller.signal })
      .then(setRecord).catch((failure) => { if (failure.name !== 'AbortError') setError(failure.message) })
    return () => controller.abort()
  }, [caseId, refresh, session.token])

  async function send(path, body, success) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await api(path, { token: session.token, method: 'POST', body })
      setNotice(success)
      setResponseReason('')
      setRefresh((value) => value + 1)
    } catch (failure) { setError(failure.message) } finally { setBusy(false) }
  }

  function respond(decision) {
    send(`/api/lawyers/assignments/${record.assignmentId}/respond`, { decision, reason: responseReason.trim() },
      decision === 'ACCEPT' ? bi('Assignment accepted. You are now the official legal aid counsel for this case.', 'নিয়োগ গ্রহণ করা হয়েছে। আপনি এই মামলার আনুষ্ঠানিক আইনি সহায়তা আইনজীবী।') : bi('Assignment rejected. The DLAO has been notified.', 'নিয়োগ প্রত্যাখ্যান করা হয়েছে। ডিএলএও কর্মকর্তাকে জানানো হয়েছে।'))
  }

  function submitUpdate(event, update) {
    event.preventDefault()
    const draft = drafts[update._id] || {}
    send(`/api/lawyers/assignments/${record.assignmentId}/updates/${update._id}`, draft,
      bi(`Progress update ${num(update.sequence)} recorded in official file.`, 'মামলার অগ্রগতি নথিভুক্ত হয়েছে।'))
  }

  function saveConsultation(event) {
    event.preventDefault()
    if (!consultNotes.trim()) return
    const newEntry = {
      id: Date.now().toString(),
      date: consultDate,
      mode: consultMode,
      notes: consultNotes,
      lawyer: session.user.displayName || 'Panel Lawyer',
    }
    const updated = [newEntry, ...consultations]
    setConsultations(updated)
    try { localStorage.setItem(`dlas_lawyer_consult_${caseId}`, JSON.stringify(updated)) } catch { /* Storage may be unavailable. */ }
    setConsultNotes('')
    setNotice(bi('Client consultation & case strategy note recorded.', 'মক্কেলের সাথে পরামর্শ ও কৌশল সংক্রান্ত নোট সংরক্ষিত হয়েছে।'))
  }

  function saveCourtFiling(event) {
    event.preventDefault()
    try {
      localStorage.setItem(`dlas_lawyer_court_name_${caseId}`, courtName)
      localStorage.setItem(`dlas_lawyer_court_no_${caseId}`, courtCaseNo)
      localStorage.setItem(`dlas_lawyer_court_stage_${caseId}`, courtStage)
    } catch { /* Storage may be unavailable. */ }
    setNotice(bi('Court filing details updated.', 'আদালতের মামলার তথ্য হালনাগাদ হয়েছে।'))
  }

  function logHearing(event) {
    event.preventDefault()
    if (!hearingNotes.trim()) return
    const newHearing = {
      id: Date.now().toString(),
      date: hearingDate || new Date().toISOString().slice(0, 10),
      bench: hearingBench || courtName,
      notes: hearingNotes,
      lawyer: session.user.displayName || 'Panel Lawyer',
    }
    const updated = [newHearing, ...hearings]
    setHearings(updated)
    try { localStorage.setItem(`dlas_lawyer_hearings_${caseId}`, JSON.stringify(updated)) } catch { /* Storage may be unavailable. */ }
    setHearingNotes('')
    setHearingBench('')
    setNotice(bi('Court hearing appearance recorded in case records.', 'আদালতে শুনানির উপস্থিতি ও বিবরণ নথিভুক্ত হয়েছে।'))
  }

  function submitOutcome(event) {
    event.preventDefault()
    if (!outcomeReport.trim()) return
    const outcomeData = {
      type: outcomeType,
      date: outcomeDate,
      referenceNo: outcomeRef,
      report: outcomeReport,
      submittedAt: new Date().toISOString(),
      submittedBy: session.user.displayName || 'Panel Lawyer',
    }
    setOutcomeRecord(outcomeData)
    try { localStorage.setItem(`dlas_lawyer_outcome_${caseId}`, JSON.stringify(outcomeData)) } catch { /* Storage may be unavailable. */ }
    setNotice(bi('Case outcome & lawyer completion output submitted to DLAO.', 'মামলার রায় ও দায়িত্ব সমাপ্তির প্রতিবেদন ডিএলএও অফিসে দাখিল হয়েছে।'))
  }

  function submitFeeClaim(event) {
    event.preventDefault()
    if (!feeNotes.trim()) return
    const newClaim = {
      id: Date.now().toString(),
      category: feeCategory,
      amount: feeAmount,
      notes: feeNotes,
      status: 'SUBMITTED_TO_DBLA',
      date: new Date().toISOString(),
    }
    const updated = [newClaim, ...feeClaims]
    setFeeClaims(updated)
    try { localStorage.setItem(`dlas_lawyer_fee_${caseId}`, JSON.stringify(updated)) } catch { /* Storage may be unavailable. */ }
    setFeeNotes('')
    setNotice(bi('Fee bill claim submitted as per DBLA schedule. Awaiting officer verification.', 'ডিবিএলএ বিধি মোতাবেক ফি দাবি দাখিল করা হয়েছে।'))
  }

  const back = <Link to="/">← <Bi en="Lawyer worklist" bn="আইনজীবীর কাজের তালিকা" /></Link>
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
      <div className={`record-head ${isUrgent ? 'urgent-record' : ''}`} style={isUrgent ? { padding: '1rem', borderRadius: '6px' } : {}}>
        <div>
          <p className="eyebrow"><Bi en="Panel Lawyer Case Record" bn="প্যানেল আইনজীবী মামলা নথি" /></p>
          <h1 id="case-title">{record.caseId}</h1>
          <p className="record-sub">
            <Bi en="Application" bn="আবেদন" /> {record.applicationId}
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
          <span><strong><Bi en="Urgent Case:" bn="জরুরি মামলা:" /></strong> <Bi en="Priority case flagged by DLAO / AI assessment. Expedited representation requested." bn="ডিএলএও কর্মকর্তা বা এআই মূল্যায়নে চিহ্নিত অগ্রাধিকারমূলক মামলা। দ্রুত পদক্ষেপ গ্রহণ করুন।" /></span>
        </div>
      )}

      {error && <p role="alert" className="error">{error}</p>}
      {notice && <p role="status" className="success">{notice}</p>}

      {/* Panel Lawyer Lifecycle Tracker */}
      <div className="phase-tracker-card" style={{ margin: '1rem 0 1.5rem 0' }} aria-label="Panel Lawyer Workflow">
        <div className="phase-tracker-header">
          <div>
            <span className="phase-tracker-badge">Panel Lawyer Assignment Workflow</span>
            <h3 className="phase-tracker-title"><Bi en="Legal Aid Representation & Case Management" bn="আইনি সহায়তা প্রতিনিধিত্ব ও মামলা পরিচালনা" /></h3>
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
        <h2 id="summary-title"><Bi en="At a glance" bn="এক নজরে" /></h2>
        <dl className="facts">
          <div><dt><Bi en="Case status" bn="মামলার অবস্থা" /></dt><dd><Term code={record.status} /></dd></div>
          <div><dt><Bi en="Your assignment" bn="আপনার নিয়োগ" /></dt><dd><Term code={record.assignmentStatus} /></dd></div>
          {record.applicantName && <div><dt><Bi en="Client / Beneficiary" bn="মক্কেল / সুবিধাভোগী" /></dt><dd><strong>{record.applicantName}</strong></dd></div>}
          {record.legalNeed && <div className="wide"><dt><Bi en="Legal Need & Guidance" bn="আইনি সহায়তা প্রয়োজন" /></dt><dd>{record.legalNeed}</dd></div>}
          {record.complaintType && <div><dt><Bi en="Complaint Category" bn="অভিযোগের বিষয়" /></dt><dd><Term code={record.complaintType} /></dd></div>}
          {record.vulnerability?.length > 0 && <div className="wide"><dt><Bi en="Special Vulnerability" bn="বিশেষ সুরক্ষা / ঝুঁকি" /></dt><dd>{record.vulnerability.map(say).join(' · ')}</dd></div>}
          {!pending && <>
            <div><dt><Bi en="Next hearing" bn="পরবর্তী শুনানি" /></dt><dd>{record.nextHearingAt ? <time dateTime={record.nextHearingAt}>{when(record.nextHearingAt)}</time> : bi('Not set', 'নির্ধারিত নয়')}</dd></div>
            <div className="wide"><dt><Bi en="Next step" bn="পরবর্তী ধাপ" /></dt><dd>{record.nextAction || bi('Not set', 'নির্ধারিত নয়')}</dd></div>
          </>}
        </dl>
      </section>

      {/* Respond to assignment offer */}
      {pending && (
        <section className={`card ${isUrgent ? 'urgent-record' : ''}`} aria-labelledby="decision-title">
          <h2 id="decision-title"><Bi en="Step 1: Respond to Assignment Offer (DBLA Appointment)" bn="ধাপ ১: নিয়োগ প্রস্তাবে সিদ্ধান্ত দিন (ডিবিএলএ নিয়োগ)" /></h2>
          <p className="muted"><Bi en="As per DBLA procedure, the case remains under DLAO jurisdiction until you formally accept assignment." bn="ডিবিএলএ কার্যপদ্ধতি অনুযায়ী আপনি আনুষ্ঠানিকভাবে নিয়োগ গ্রহণ না করা পর্যন্ত মামলাটির দায়িত্ব আপনার উপর বর্তাবে না।" /></p>
          <label htmlFor="assignment-response-reason"><Bi en="Reason for accepting or declining" bn="গ্রহণ বা প্রত্যাখ্যানের কারণ" /></label>
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
              <h2 id="consult-title" className="panel-heading"><Bi en="Step 2: Case Information & Client Consultation" bn="ধাপ ২: মামলা পর্যালোচনা ও মক্কেলের পরামর্শ" /></h2>
              <p className="muted"><Bi en="Review case details, conduct initial client interview/consultation, formulate legal strategy, and record consultation notes." bn="মক্কেলের সাথে সাক্ষাৎ/পরামর্শ করুন এবং মামলার কৌশলগত নোট লিপিবদ্ধ করুন।" /></p>

              <AddForm en="Record Client Consultation" bn="মক্কেলের পরামর্শ লিপিবদ্ধ করুন">
                <form onSubmit={saveConsultation} className="form-stack inline-form">
                  <label htmlFor="consult-date"><Bi en="Consultation Date" bn="সাক্ষাৎ / পরামর্শের তারিখ" /></label>
                  <input id="consult-date" type="date" value={consultDate} onChange={(e) => setConsultDate(e.target.value)} required />

                  <label htmlFor="consult-mode"><Bi en="Meeting Mode" bn="পরামর্শের মাধ্যম" /></label>
                  <select id="consult-mode" value={consultMode} onChange={(e) => setConsultMode(e.target.value)}>
                    <option value="IN_PERSON_CHAMBER">{bi('In-Person (Lawyer Chamber / DLAO Office)', 'সরাসরি (চেম্বার / লিগ্যাল এইড অফিস)')}</option>
                    <option value="PHONE_SAFE">{bi('Safe Phone Call (Approved Route)', 'নিরাপদ ফোন কল')}</option>
                    <option value="COURT_PREMISES">{bi('Court Premises Consultation', 'আদালত চত্বরে আলোচনা')}</option>
                  </select>

                  <label htmlFor="consult-notes"><Bi en="Consultation & Strategy Notes" bn="পরামর্শ ও আইনি কৌশলের বিবরণ" /></label>
                  <textarea id="consult-notes" value={consultNotes} onChange={(e) => setConsultNotes(e.target.value)} minLength="10" maxLength="1000" placeholder="Record key facts confirmed by client, list of witnesses, relief sought, and litigation plan..." required />

                  <button type="submit" disabled={busy}><Bi en="Save Consultation Record" bn="পরামর্শ নোট সংরক্ষণ" /></button>
                </form>
              </AddForm>

              {consultations.length > 0 ? (
                <div className="version-history" style={{ marginTop: '0.75rem' }}>
                  <h4><Bi en="Consultation History" bn="পরামর্শের ইতিহাস" /></h4>
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
                <p className="muted" style={{ fontSize: '0.85rem' }}><Bi en="No consultation logged yet. Record your initial meeting with the beneficiary." bn="এখনো কোনো পরামর্শ নথিভুক্ত হয়নি। মক্কেলের সাথে প্রথম বৈঠকের তথ্য লিখুন।" /></p>
              )}
            </div>
          </section>

          {/* Step 3: Court / Legal Representation & Hearing Tracking */}
          <section className="panel" aria-labelledby="court-rep-title">
            <div className="panel-body">
              <h2 id="court-rep-title" className="panel-heading"><Bi en="Step 3: Court / Legal Representation & Hearings" bn="ধাপ ৩: আদালতে প্রতিনিধিত্ব ও শুনানি ট্র্যাকিং" /></h2>
              <p className="muted"><Bi en="File case documents in court, represent applicant in hearings, update hearing dates, and record hearing outcomes." bn="আদালতে মামলা দায়ের করুন, শুনানিতে হাজিরা দিন এবং পরবর্তী শুনানির তারিখ হালনাগাদ করুন।" /></p>

              {/* Court filing details */}
              <div style={{ background: '#fdfbf7', border: '1px solid #e8e2d2', borderRadius: '6px', padding: '1rem', margin: '0.75rem 0' }}>
                <h3 style={{ margin: '0 0 0.5rem 0' }}><Bi en="Court & Filing Reference" bn="আদালত ও মামলার বিবরণ" /></h3>
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
                      <label htmlFor="court-stage"><Bi en="Case Stage in Court" bn="আদালতে মামলার পর্যায়" /></label>
                      <select id="court-stage" value={courtStage} onChange={(e) => setCourtStage(e.target.value)}>
                        <option value="PLAINT_SUBMITTED">{bi('Plaint Filed / Cognizance', 'আরজি দাখিল / গ্রহণ')}</option>
                        <option value="SUMMONS_SERVED">{bi('Summons / Notice Served', 'সমন জারি')}</option>
                        <option value="WRITTEN_STATEMENT">{bi('Written Statement Filed', 'জবাব দাখিল')}</option>
                        <option value="FRAMING_ISSUES">{bi('Framing of Issues / Charge', 'বিচার্য বিষয় / অভিযোগ গঠন')}</option>
                        <option value="WITNESS_EVIDENCE">{bi('Evidence / Witness Hearing', 'সাক্ষ্য গ্রহণ')}</option>
                        <option value="FINAL_ARGUMENTS">{bi('Final Arguments', 'যুক্তিতর্ক')}</option>
                        <option value="FIXED_FOR_JUDGMENT">{bi('Fixed for Judgment', 'রায়ের জন্য দিন ধার্য')}</option>
                      </select>
                    </div>
                  </div>
                  <button type="submit" className="secondary-button" style={{ marginTop: '0.5rem' }}><Bi en="Save Court Information" bn="আদালতের তথ্য সংরক্ষণ" /></button>
                </form>
              </div>

              {/* Hearing appearances log */}
              <AddForm en="Record Hearing Appearance" bn="শুনানির হাজিরা লিপিবদ্ধ করুন">
                <form onSubmit={logHearing} className="form-stack inline-form">
                  <label htmlFor="hearing-date"><Bi en="Hearing Date" bn="শুনানির তারিখ" /></label>
                  <input id="hearing-date" type="date" value={hearingDate} onChange={(e) => setHearingDate(e.target.value)} required />

                  <label htmlFor="hearing-bench"><Bi en="Presiding Judge / Bench" bn="বিচারক / এজলাস" /></label>
                  <input id="hearing-bench" value={hearingBench} onChange={(e) => setHearingBench(e.target.value)} placeholder="e.g. Joint District Judge Court 1" />

                  <label htmlFor="hearing-notes"><Bi en="Hearing Proceedings & Court Order" bn="শুনানির কার্যক্রম ও আদালতের আদেশ" /></label>
                  <textarea id="hearing-notes" value={hearingNotes} onChange={(e) => setHearingNotes(e.target.value)} minLength="10" maxLength="1000" placeholder="Detail witness examination, argument points, and court's order today..." required />

                  <button type="submit"><Bi en="Log Hearing Appearance" bn="হাজিরা সংরক্ষণ করুন" /></button>
                </form>
              </AddForm>

              {hearings.length > 0 && (
                <div className="version-history" style={{ marginTop: '0.75rem' }}>
                  <h4><Bi en="Hearing Log & Appearances" bn="শুনানি ও হাজিরার ইতিহাস" /></h4>
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
          <section className="panel" aria-labelledby="updates-title"><div className="panel-body"><h2 id="updates-title" className="panel-heading"><Bi en="Required Progress Updates (DLAO Schedules)" bn="প্রয়োজনীয় অগ্রগতির আপডেট (ডিএলএও নির্ধারিত)" /></h2>
            {openUpdates.length === 0 ? <p className="muted"><Bi en="Nothing due." bn="কোনো আপডেট বাকি নেই।" /></p> : <ul className="plain-list">{openUpdates.map((update) => {
              const draft = drafts[update._id] || {}
              return <li key={update._id}><div><strong><Bi en="Update" bn="আপডেট" /> {num(update.sequence)}</strong> <Badge code={update.status} /><p>{update.instruction}</p><small><Bi en="Due" bn="শেষ সময়" /> {when(update.dueAt)}</small>
                <form onSubmit={(event) => submitUpdate(event, update)} className="form-stack inline-form">
                  <label htmlFor={`lawyer-report-${update._id}`}><Bi en="Progress report" bn="অগ্রগতির প্রতিবেদন" /></label><textarea id={`lawyer-report-${update._id}`} value={draft.report || ''} onChange={(event) => setDrafts((current) => ({ ...current, [update._id]: { ...current[update._id], report: event.target.value } }))} minLength="5" maxLength="2000" required />
                  <label htmlFor={`lawyer-next-${update._id}`}><Bi en="Next step" bn="পরবর্তী ধাপ" /></label><input id={`lawyer-next-${update._id}`} value={draft.nextAction || ''} onChange={(event) => setDrafts((current) => ({ ...current, [update._id]: { ...current[update._id], nextAction: event.target.value } }))} minLength="5" maxLength="300" required />
                  <button type="submit" disabled={busy}><Bi en="Submit progress update" bn="আপডেট জমা দিন" /></button>
                </form>
              </div></li>
            })}</ul>}
            {(record.updates || []).filter(({ report }) => report).map((update) => <div className="version-history" key={update._id}><h3><Bi en="Update" bn="আপডেট" /> {num(update.sequence)} <Badge code={update.status} /></h3><p>{update.report}</p><p><Bi en="Next step:" bn="পরবর্তী ধাপ:" /> {update.nextAction}</p><small>{when(update.submittedAt)}</small></div>)}
          </div></section>

          {/* Step 4: Case Outcome & Completion Output */}
          <section className="panel" aria-labelledby="outcome-title">
            <div className="panel-body">
              <h2 id="outcome-title" className="panel-heading"><Bi en="Step 4: Case Outcome & Completion Output" bn="ধাপ ৪: মামলার রায় ও সমাপ্তি প্রতিবেদন দাখিল" /></h2>
              <p className="muted"><Bi en="When case is disposed or resolved, record the legal outcome (Judgment/Settlement) and submit your formal completion output." bn="মামলা নিষ্পত্তি হলে রায়ের বিবরণ ও দায়িত্ব সমাপ্তি প্রতিবেদন দাখিল করুন।" /></p>

              {outcomeRecord ? (
                <div className="success" style={{ margin: '0.75rem 0' }}>
                  <h3><Bi en="Completion Output Submitted to DLAO" bn="দায়িত্ব সমাপ্তি প্রতিবেদন দাখিল সম্পন্ন" /></h3>
                  <dl className="details compact" style={{ marginTop: '0.5rem' }}>
                    <div><dt><Bi en="Legal Outcome" bn="আইনি ফলাফল" /></dt><dd><Term code={outcomeRecord.type} /></dd></div>
                    <div><dt><Bi en="Disposal Date" bn="নিষ্পত্তির তারিখ" /></dt><dd>{outcomeRecord.date}</dd></div>
                    <div><dt><Bi en="Decree / Judgment Ref" bn="ডিক্রি / আদেশ নম্বর" /></dt><dd>{outcomeRecord.referenceNo || bi('Not recorded', 'নেই')}</dd></div>
                    <div><dt><Bi en="Completion Summary" bn="চূড়ান্ত প্রতিবেদন" /></dt><dd>{outcomeRecord.report}</dd></div>
                    <div><dt><Bi en="Submitted at" bn="দাখিলের সময়" /></dt><dd>{when(outcomeRecord.submittedAt)}</dd></div>
                  </dl>
                  <p style={{ marginTop: '0.5rem', fontSize: '0.85rem' }}>
                    ✓ <Bi en="Lawyer completion output recorded. You may now submit your final fee claim below." bn="দায়িত্ব সমাপ্তি গৃহীত হয়েছে। আপনি নিম্নে ফি বিল দাবি দাখিল করতে পারবেন।" />
                  </p>
                </div>
              ) : (
                <form onSubmit={submitOutcome} className="form-stack inline-form">
                  <label htmlFor="lawyer-outcome-type"><Bi en="Disposal Outcome Type" bn="নিষ্পত্তির ধরন" /></label>
                  <select id="lawyer-outcome-type" value={outcomeType} onChange={(e) => setOutcomeType(e.target.value)}>
                    <option value="COURT_JUDGMENT_FAVOUR">{bi('Judgment in Favour of Beneficiary (পক্ষে রায়)', 'সুবিধাভোগীর পক্ষে রায়')}</option>
                    <option value="COURT_JUDGMENT_DISMISSED">{bi('Case Dismissed / Decreed (খারিজ / ডিক্রি)', 'মামলা খারিজ / ডিক্রি')}</option>
                    <option value="COMPROMISE_DECREE">{bi('Compromise / Settlement Decree (আপস নিষ্পত্তি ডিক্রি)', 'আপস নিষ্পত্তি ডিক্রি')}</option>
                    <option value="WITHDRAWN">{bi('Withdrawn on Satisfaction (প্রত্যাহার)', 'সন্তুষ্টি সাপেক্ষে প্রত্যাহার')}</option>
                  </select>

                  <label htmlFor="lawyer-outcome-date"><Bi en="Disposal Date" bn="নিষ্পত্তির তারিখ" /></label>
                  <input id="lawyer-outcome-date" type="date" value={outcomeDate} onChange={(e) => setOutcomeDate(e.target.value)} required />

                  <label htmlFor="lawyer-outcome-ref"><Bi en="Judgment / Order / Decree Number" bn="রায় / আদেশ / ডিক্রি নম্বর" /></label>
                  <input id="lawyer-outcome-ref" value={outcomeRef} onChange={(e) => setOutcomeRef(e.target.value)} placeholder="e.g. Decree dated 24/09/2026 in Suit No. 12" />

                  <label htmlFor="lawyer-completion-report"><Bi en="Completion Output Report (Summary for DLAO)" bn="দায়িত্ব সমাপ্তির প্রতিবেদন (ডিএলএও অফিসের জন্য)" /></label>
                  <textarea id="lawyer-completion-report" value={outcomeReport} onChange={(e) => setOutcomeReport(e.target.value)} minLength="10" maxLength="1500" placeholder="Summarize final hearing, terms of decree/judgment, reliefs obtained for client, and formal conclusion of advocacy..." required />

                  <button type="submit" disabled={busy} style={{ background: '#28562d', borderColor: '#1f4523' }}>
                    <Bi en="Submit Completion Output" bn="দায়িত্ব সমাপ্তি প্রতিবেদন জমা দিন" />
                  </button>
                </form>
              )}
            </div>
          </section>

          {/* Step 5: Lawyer Fee / Payment Claim Processing */}
          <section className="panel" aria-labelledby="fee-claim-title">
            <div className="panel-body">
              <h2 id="fee-claim-title" className="panel-heading"><Bi en="Step 5: Payment / Lawyer Fee Claim Processing" bn="ধাপ ৫: ফি দাবি ও পেমেন্ট প্রক্রিয়াকরণ" /></h2>
              <p className="muted"><Bi en="Process lawyer fee as per DBLA rules. Submit interim or final completion bills for officer verification and government disbursement." bn="ডিবিএলএ বিধি মোতাবেক কাজের স্তর অনুযায়ী অন্তর্বর্তী বা চূড়ান্ত ফি দাবি দাখিল করুন।" /></p>

              {/* Status display */}
              <div style={{ background: '#faf9f6', border: '1px solid #e3e2dc', borderRadius: '6px', padding: '0.85rem 1rem', margin: '0.75rem 0' }}>
                <strong><Bi en="DBLA Payment Pipeline Status:" bn="ডিবিএলএ পেমেন্ট প্রক্রিয়াকরণ অবস্থা:" /></strong>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginTop: '0.4rem', flexWrap: 'wrap' }}>
                  {record.payment ? (
                    <>
                      <Term code={record.payment.stage} />
                      <span>·</span>
                      <Badge code={record.payment.status} />
                      <span>·</span>
                      <span className="muted">{record.payment.reason}</span>
                    </>
                  ) : (
                    <span className="muted">{bi('No official payment event recorded yet.', 'এখনো কোনো সরকারি পেমেন্ট ইভেন্ট নেই।')}</span>
                  )}
                </div>
              </div>

              {/* Submit Fee Bill Form */}
              <AddForm en="Submit Fee Claim Bill" bn="ফি দাবি বিল দাখিল করুন">
                <form onSubmit={submitFeeClaim} className="form-stack inline-form">
                  <label htmlFor="fee-category"><Bi en="Bill Stage / Category" bn="বিলের পর্যায় / খাত" /></label>
                  <select id="fee-category" value={feeCategory} onChange={(e) => setFeeCategory(e.target.value)}>
                    <option value="CASE_PREPARATION">{bi('Case Preparation & Plaint Filing (ইন্টারিম ফি)', 'মামলা প্রস্তুতি ও আরজি দাখিল (অন্তর্বর্তী ফি)')}</option>
                    <option value="HEARING_ATTENDANCE">{bi('Hearing Attendance & Witnesses (শুনানি হাজিরা ফি)', 'শুনানি হাজিরা ফি')}</option>
                    <option value="FINAL_DISPOSAL">{bi('Final Case Completion & Disposal Output (চূড়ান্ত নিষ্পত্তি ফি)', 'চূড়ান্ত নিষ্পত্তি ফি')}</option>
                  </select>

                  <label htmlFor="fee-amount"><Bi en="Claim Amount (BDT)" bn="দাবিকৃত টাকার পরিমাণ (টাকা)" /></label>
                  <input id="fee-amount" type="number" min="500" max="25000" step="500" value={feeAmount} onChange={(e) => setFeeAmount(e.target.value)} required />

                  <label htmlFor="fee-notes"><Bi en="Voucher / Bill Particulars & Justification" bn="ভাউচার / বিলের বিবরণ ও প্রমাণক" /></label>
                  <textarea id="fee-notes" value={feeNotes} onChange={(e) => setFeeNotes(e.target.value)} minLength="10" maxLength="500" placeholder="Detail case appearances, court dates, and statutory fee schedule reference..." required />

                  <button type="submit" disabled={busy}><Bi en="Submit Fee Claim to DLAO Finance" bn="হিসাব শাখায় ফি বিল জমা দিন" /></button>
                </form>
              </AddForm>

              {feeClaims.length > 0 && (
                <div className="version-history" style={{ marginTop: '0.75rem' }}>
                  <h4><Bi en="Submitted Fee Claims" bn="দাখিলকৃত ফি বিলসমূহ" /></h4>
                  <ul className="plain-list">
                    {feeClaims.map((claim) => (
                      <li key={claim.id} style={{ padding: '0.65rem 0', borderBottom: '1px solid #ecebe6' }}>
                        <div>
                          <strong><Term code={claim.category} /></strong>
                          <span style={{ marginLeft: '0.5rem', fontWeight: 700 }}>৳ {claim.amount}</span>
                          <Badge code={claim.status} style={{ marginLeft: '0.5rem' }} />
                          <p style={{ margin: '0.2rem 0', fontSize: '0.85rem' }}>{claim.notes}</p>
                          <small className="muted">{when(claim.date)}</small>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </section>

          {/* Case Documents (Preserved) */}
          <section className="panel" aria-labelledby="documents-title"><div className="panel-body"><h2 id="documents-title" className="panel-heading"><Bi en="Case Documents" bn="মামলার নথি" /></h2><p className="muted"><Bi en="Restricted evidence is not shown here." bn="সীমিত প্রমাণ এখানে দেখানো হয় না।" /></p>
            {!record.documents?.length ? <p><Bi en="No documents linked." bn="কোনো নথি যুক্ত নেই।" /></p> : <ul className="plain-list">{record.documents.map((document) => <li key={document.id}><div><strong>{document.label}</strong> {document.version?.qualityState && <Badge code={document.version.qualityState} />}<p className="muted"><Bi en="Version" bn="সংস্করণ" /> {num(document.currentVersion)}</p>{document.version?.qualityState === 'READABLE' && <details><summary><Bi en="Read linked document text" bn="নথির লেখা পড়ুন" /></summary><pre>{document.version.textContent || bi('No readable text stored.', 'পড়ার মতো লেখা নেই।')}</pre></details>}{document.version?.qualityState === 'UNREADABLE' && <p><Bi en="Unreadable: a person must check it." bn="নথিটি পড়া যাচ্ছে না; একজন কর্মীকে যাচাই করতে হবে।" /></p>}</div></li>)}</ul>}
          </div></section>
        </div>
      )}
    </section>
  )
}

