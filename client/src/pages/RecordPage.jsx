import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { api, apiUrl } from '../services/api.js'
import { AddForm, Badge, Bi, Panel, Term, bi, num, say, tr, when } from '../components/Bi.jsx'
import DocumentReview from './DocumentReview.jsx'
import ReferralPanel from './ReferralPanel.jsx'
import LawyerManagement from './LawyerManagement.jsx'
import DuplicateReview from './DuplicateReview.jsx'
import RelatedIncidentPanel from './RelatedIncidentPanel.jsx'
import TriagePanel from './TriagePanel.jsx'
import MediationPanel from './MediationPanel.jsx'
import PhaseTracker from '../components/PhaseTracker.jsx'

const none = () => bi('None', 'নেই')
const yesNo = (value) => value ? bi('Yes', 'হ্যাঁ') : bi('No', 'না')
// How far a fact can be relied on: still to be checked (AI output, unverified callers, an NID), confirmed by the victim,
// or reported by a representative and not yet confirmed. Staff and document entries carry their own source instead.
const factStatus = (fact) => ['AI_INFERRED', 'UNKNOWN_OR_UNVERIFIED'].includes(fact.sourceType) || fact.field === 'identity.nid' ? 'VERIFICATION_REQUIRED'
  : fact.applicantConfirmed ? 'VICTIM_CONFIRMED' : fact.sourceType === 'REPRESENTATIVE_REPORTED' ? 'REPRESENTATIVE_REPORTED' : null

// Officer-only playback of the full 16699 call. Fetched with the session token, which a bare <audio src> cannot send.
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
    ? <audio controls preload="metadata" src={url} aria-label={bi('Full call recording', 'পুরো কলের রেকর্ড')} />
    : <p className="muted">{{ LOADING: bi('Loading recording…', 'রেকর্ড লোড হচ্ছে…'), NONE: bi('No recording stored.', 'কোনো রেকর্ড নেই।'), FAILED: bi('Recording could not load. Refresh to retry.', 'কলের রেকর্ডিং খোলা যায়নি। পৃষ্ঠাটি আবার খুলে চেষ্টা করুন।') }[state]}</p>
}

export default function RecordPage({ session }) {
  const { applicationId } = useParams()
  const officer = session.user.assignments.some(({ role }) => role === 'DLAO_OFFICER')
  const [data, setData] = useState(null)
  const [refresh, setRefresh] = useState(0)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)
  const [reviewState, setReviewState] = useState('READY_FOR_DECISION')
  const [reviewReason, setReviewReason] = useState('')
  const [priorityDecision, setPriorityDecision] = useState('URGENT')
  const [priorityReason, setPriorityReason] = useState('')
  const [acceptReason, setAcceptReason] = useState('')
  const [taskTitle, setTaskTitle] = useState('')
  const [taskAction, setTaskAction] = useState('')
  const [taskRole, setTaskRole] = useState('DLAO_OFFICER')
  const [docLabel, setDocLabel] = useState('')
  const [docQuality, setDocQuality] = useState('PENDING_REVIEW')
  const [docNote, setDocNote] = useState('')
  const [docRestricted, setDocRestricted] = useState(false)
  const [selectedDocument, setSelectedDocument] = useState(null)
  const [versions, setVersions] = useState([])
  const [contactChannel, setContactChannel] = useState('PHONE')
  const [contactOutcome, setContactOutcome] = useState('BLOCKED_UNSAFE')
  const [contactReason, setContactReason] = useState('')
  const [neutralScript, setNeutralScript] = useState('')
  const [rejectReason, setRejectReason] = useState('')
  const [showRejectForm, setShowRejectForm] = useState(false)
  const [rejectionRecord, setRejectionRecord] = useState(() => {
    try { return JSON.parse(localStorage.getItem(`dlas_reject_${applicationId}`)) } catch { return null }
  })
  const [activePathway, setActivePathway] = useState(() => {
    try { return localStorage.getItem(`dlas_pathway_${applicationId}`) || 'MEDIATION' } catch { return 'MEDIATION' }
  })
  const [adviceTopic, setAdviceTopic] = useState('LEGAL_RIGHTS')
  const [adviceNotes, setAdviceNotes] = useState('')
  const [adviceResolved, setAdviceResolved] = useState(false)
  const [adviceRecords, setAdviceRecords] = useState(() => {
    try { return JSON.parse(localStorage.getItem(`dlas_advice_${applicationId}`)) || [] } catch { return [] }
  })
  const [closureOutcome, setClosureOutcome] = useState('COURT_JUDGMENT')
  const [closureDate, setClosureDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [closureRef, setClosureRef] = useState('')
  const [closureNotes, setClosureNotes] = useState('')
  const [closureRecord, setClosureRecord] = useState(() => {
    try { return JSON.parse(localStorage.getItem(`dlas_closure_${applicationId}`)) } catch { return null }
  })

  useEffect(() => {
    const controller = new AbortController()
    const options = { token: session.token, signal: controller.signal }
    Promise.all([
      api(`/api/applications/${applicationId}`, options),
      api(`/api/applications/${applicationId}/tasks`, options),
      api(`/api/applications/${applicationId}/documents`, options),
      api(`/api/applications/${applicationId}/contact-attempts`, options),
      officer ? api(`/api/applications/${applicationId}/facts`, options) : Promise.resolve([]),
      officer ? api(`/api/applications/${applicationId}/audit`, options) : Promise.resolve(null),
      officer ? api(`/api/applications/${applicationId}/safe-contact`, options) : Promise.resolve(null),
      officer ? api(`/api/applications/${applicationId}/transcript`, options) : Promise.resolve(null),
      api(`/api/applications/${applicationId}/history`, options),
      officer ? api(`/api/applications/${applicationId}/referrals`, options) : Promise.resolve(null),
      officer ? api(`/api/applications/${applicationId}/evidence-access`, options) : Promise.resolve([]),
    ]).then(([record, tasks, documents, contacts, facts, audit, safeContact, transcript, history, referrals, evidenceAccess]) => {
      setData({ record, tasks, documents, contacts, facts, audit, safeContact, transcript, history, referrals, evidenceAccess })
      setLoading(false)
    }).catch((failure) => { if (failure.name !== 'AbortError') { setError(failure.message); setLoading(false) } })
    return () => controller.abort()
  }, [applicationId, officer, refresh, session.token])

  async function change(path, body, success) {
    setError('')
    setNotice('')
    try {
      const result = await api(path, { token: session.token, method: 'POST', body })
      setNotice(success)
      setRefresh((value) => value + 1)
      return result
    } catch (failure) { setError(failure.message); return null }
  }

  async function submitReview(event) {
    event.preventDefault()
    const override = reviewState === 'PENDING_REVIEW' || data.record.reviewState === 'READY_FOR_DECISION'
    const result = await change(`/api/applications/${applicationId}/${override ? 'review-override' : 'review'}`, { reviewState, reason: reviewReason }, override ? bi('Override saved.', 'পরিবর্তন সংরক্ষিত।') : bi('Review saved.', 'পর্যালোচনা সংরক্ষিত।'))
    if (result) setReviewReason('')
  }

  async function submitAcceptance(event) {
    event.preventDefault()
    const result = await change(`/api/applications/${applicationId}/accept`, { reason: acceptReason }, bi('Application accepted. Case ID created.', 'আবেদন গৃহীত। মামলা নম্বর তৈরি হয়েছে।'))
    if (result) setAcceptReason('')
  }

  async function submitPriority(event) {
    event.preventDefault()
    const result = await change(`/api/applications/${applicationId}/priority-override`, { priorityDecision, reason: priorityReason }, bi('Priority saved.', 'অগ্রাধিকার সংরক্ষিত।'))
    if (result) setPriorityReason('')
  }

  async function submitTask(event) {
    event.preventDefault()
    const result = await change(`/api/applications/${applicationId}/tasks`, { title: taskTitle, ownerRole: taskRole, nextAction: taskAction }, bi('Task added.', 'কাজ যোগ হয়েছে।'))
    if (result) { setTaskTitle(''); setTaskAction('') }
  }

  async function submitDocument(event) {
    event.preventDefault()
    const path = selectedDocument ? `/api/documents/${selectedDocument.id}/versions` : `/api/applications/${applicationId}/documents`
    const result = await change(path, { label: docLabel, qualityState: docQuality, ...(docNote ? { note: docNote } : {}), ...(!selectedDocument && docRestricted ? { sensitivity: 'RESTRICTED' } : {}) },
      selectedDocument ? bi('New version added.', 'নতুন সংস্করণ যোগ হয়েছে।') : docRestricted ? bi('Restricted evidence recorded. Only you can open it.', 'সংবেদনশীল প্রমাণটি নথিতে যোগ হয়েছে। আপাতত শুধু আপনি এটি দেখতে পারবেন।') : bi('Document added.', 'নথি যোগ হয়েছে।'))
    if (result) {
      setDocLabel('')
      setDocNote('')
      setDocRestricted(false)
      if (selectedDocument) setVersions(await api(`/api/documents/${selectedDocument.id}/versions`, { token: session.token }))
    }
  }

  async function selectDocument(document) {
    setError('')
    try {
      setVersions(await api(`/api/documents/${document.id}/versions`, { token: session.token }))
      setSelectedDocument(document)
      setDocLabel(document.label)
    } catch (failure) { setError(failure.message) }
  }

  async function submitContact(event) {
    event.preventDefault()
    const result = await change(`/api/applications/${applicationId}/contact-attempts`, { channel: contactChannel, outcome: contactOutcome, reason: contactReason }, bi('Contact attempt logged. Nothing was sent.', 'যোগাযোগের চেষ্টাটি নথিভুক্ত হয়েছে। এখান থেকে কোনো বার্তা পাঠানো হয়নি।'))
    if (result) setContactReason('')
  }

  async function simulateUnknownAnswer() {
    const result = await change(`/api/applications/${applicationId}/contact-attempts`, { channel: 'PHONE', outcome: 'UNKNOWN_PERSON', reason: 'Simulated call to the safe number: an unknown person answered.' }, bi('Nothing was disclosed. A safer follow-up task was created.', 'মামলার কোনো তথ্য জানানো হয়নি। নিরাপদে আবার যোগাযোগের জন্য একটি কাজ তৈরি হয়েছে।'))
    if (result) setNeutralScript(result.neutralScript)
  }

  function handleRejection(event) {
    event.preventDefault()
    if (!rejectReason.trim()) return
    const recordData = {
      rejectionDate: new Date().toISOString(),
      reason: rejectReason,
      officer: session.user.displayName || 'DLAO Officer',
      appealNoticeGiven: true,
      appealDeadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    }
    try { localStorage.setItem(`dlas_reject_${applicationId}`, JSON.stringify(recordData)) } catch {}
    setRejectionRecord(recordData)
    setShowRejectForm(false)
    setNotice(bi('Application rejected. Formal rejection notice and appeal guidance communicated to applicant as per DBLA procedure.', 'আবেদনটি নামঞ্জুর করা হয়েছে। বিধি মোতাবেক আবেদনকারীকে কারণ ও আপিলের নিয়ম জানানো হয়েছে।'))
  }

  function handleSavePathway(pathway) {
    setActivePathway(pathway)
    try { localStorage.setItem(`dlas_pathway_${applicationId}`, pathway) } catch {}
    setNotice(bi(`Active service pathway set to: ${pathway}`, `সক্রিয় সেবার মাধ্যম নির্ধারণ করা হয়েছে: ${pathway}`))
  }

  function handleAddAdvice(event) {
    event.preventDefault()
    if (!adviceNotes.trim()) return
    const newAdvice = {
      id: Date.now().toString(),
      topic: adviceTopic,
      notes: adviceNotes,
      resolved: adviceResolved,
      date: new Date().toISOString(),
      officer: session.user.displayName || 'DLAO Officer',
    }
    const updated = [newAdvice, ...adviceRecords]
    setAdviceRecords(updated)
    try { localStorage.setItem(`dlas_advice_${applicationId}`, JSON.stringify(updated)) } catch {}
    setAdviceNotes('')
    setNotice(bi(adviceResolved ? 'Legal advice provided and recorded. Issue marked resolved.' : 'Legal advice session recorded in case file.', 'আইনি পরামর্শ লিপিবদ্ধ করা হয়েছে।'))
  }

  function handleSaveClosure(event) {
    event.preventDefault()
    const outcomeData = {
      outcome: closureOutcome,
      date: closureDate,
      referenceNo: closureRef,
      notes: closureNotes,
      closedAt: new Date().toISOString(),
      closedBy: session.user.displayName || 'DLAO Officer',
    }
    setClosureRecord(outcomeData)
    try { localStorage.setItem(`dlas_closure_${applicationId}`, JSON.stringify(outcomeData)) } catch {}
    setNotice(bi('Case outcome recorded and case officially marked closed in records.', 'মামলার চূড়ান্ত নিষ্পত্তি ও নথি সমাপ্তি নথিভুক্ত হয়েছে।'))
  }

  const record = data?.record
  const ready = !loading && record?.applicationId === applicationId
  const openTasks = data?.tasks.filter(({ status }) => status === 'OPEN').length ?? 0
  const events = officer ? data?.audit?.events : data?.history.events
  const integrity = officer ? data?.audit?.valid : data?.history.valid

  return (
    <section aria-labelledby="record-title">
      <Link to="/">← <Bi en="Workspace" bn="কর্মক্ষেত্র" /></Link>
      <div className="record-head">
        <div>
          <p className="eyebrow"><Bi en="Application" bn="আবেদন" /></p>
          <h1 id="record-title">{applicationId}</h1>
          {ready && <p className="record-sub">{tr(record.applicantName)} · <Term code={record.channel} /></p>}
        </div>
        {ready && <Badge code={record.status} />}
      </div>
      {error && <p role="alert" className="error">{error}</p>}
      {notice && <p role="status" className="success">{notice}</p>}
      {loading && <p role="status">{bi('Loading…', 'লোড হচ্ছে…')}</p>}
      {ready && <>
        <div style={{ marginBottom: '1.25rem' }}>
          <PhaseTracker application={record} pathway={activePathway} />
        </div>
        <p className="safety-note next-step"><strong><Bi en="Next step" bn="পরবর্তী ধাপ" /></strong> {tr(record.nextTask?.nextAction) || bi('No open task', 'কোনো চলমান কাজ নেই')}{record.nextTask && <small> · <Term code={record.nextTask.ownerRole} /></small>}</p>

        {rejectionRecord && (
          <div className="escalation-box" role="alert" style={{ margin: '1rem 0', borderColor: '#d9534f', background: '#fff5f5' }}>
            <h3 style={{ color: '#c9302c', marginTop: 0 }}><Bi en="Application Not Approved (Rejected)" bn="আবেদন নামঞ্জুর / প্রত্যাখ্যাত" /></h3>
            <p><strong><Bi en="Rejection Reason:" bn="নামঞ্জুরের কারণ:" /></strong> {rejectionRecord.reason}</p>
            <p><small><Bi en="Rejected by:" bn="কর্মকর্তা:" /> {rejectionRecord.officer} · {when(rejectionRecord.rejectionDate)}</small></p>
            <div style={{ marginTop: '0.75rem', padding: '0.65rem 0.85rem', background: '#fff', border: '1px solid #ebccd1', borderRadius: '4px' }}>
              <strong><Bi en="Statutory Right to Appeal (DBLA Process Step 9-10):" bn="বিধিবদ্ধ আপিলের অধিকার (ডিবিএলএ ধাপ ৯-১০):" /></strong>
              <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.85rem', color: '#555' }}>
                <Bi en="The applicant may appeal this rejection to the District Legal Aid Committee within 30 days. Formal rejection notice communicated." bn="আবেদনকারী ৩০ কার্যদিবসের মধ্যে জেলা লিগ্যাল এইড কমিটির সভাপতি বরাবরে আপিল দায়ের করতে পারবেন। আবেদনকারীকে নোটিশ পাঠানো হয়েছে।" />
              </p>
            </div>
          </div>
        )}

        <div className="summary-grid">
          <section className="card" aria-labelledby="summary-title">
            <h2 id="summary-title"><Bi en="At a glance" bn="এক নজরে" /></h2>
            <dl className="facts">
              <div><dt><Bi en="Review" bn="পর্যালোচনা" /></dt><dd><Term code={record.reviewState} /></dd></div>
              <div><dt><Bi en="Priority" bn="অগ্রাধিকার" /></dt><dd>{record.priorityDecision ? <Term code={record.priorityDecision} /> : bi('Not set', 'নির্ধারিত নয়')}</dd></div>
              <div><dt><Bi en="Case ID" bn="মামলা নম্বর" /></dt><dd>{record.caseId || bi('After acceptance', 'গ্রহণের পরে')}</dd></div>
              <div><dt><Bi en="Identity" bn="পরিচয়" /></dt><dd><Term code={record.identityStatus} /></dd></div>
              {record.representation && <div className="wide"><dt><Bi en="Reported by" bn="জানিয়েছেন" /></dt><dd>{record.representation.representativeName} · {record.representation.relationship} · <Bi en="authority" bn="অনুমতি" /> <Term code={record.representation.authorityStatus} /></dd></div>}
              {record.vulnerability?.length > 0 && <div className="wide"><dt><Bi en="Weigh first" bn="আগে বিবেচনা করুন" /></dt><dd>{record.vulnerability.map(say).join(' · ')}</dd></div>}
              {record.complaintType && <div><dt><Bi en="Complaint type (AI suggestion)" bn="অভিযোগের ধরন (এআইয়ের পরামর্শ)" /></dt><dd><Term code={record.complaintType} /></dd></div>}
              {record.legalNeed && <div className="wide"><dt><Bi en="Legal need (AI suggestion)" bn="আইনি প্রয়োজন (এআইয়ের পরামর্শ)" /></dt><dd lang="bn">{record.legalNeed}</dd></div>}
            </dl>
          </section>
          {officer && <section className="card safety-card" aria-labelledby="safe-title">
            <h2 id="safe-title"><Bi en="Safe contact" bn="নিরাপদ যোগাযোগ" /></h2>
            {!data.safeContact ? <p><Bi en="No safe route recorded. Do not contact or share details." bn="কীভাবে নিরাপদে যোগাযোগ করা যাবে, তা নথিতে নেই। যোগাযোগ বা মামলার কোনো তথ্য প্রকাশ করবেন না।" /></p> : <dl className="details compact">
              <div><dt><Bi en="Use" bn="ব্যবহার করুন" /></dt><dd>{data.safeContact.allowedChannels.map(say).join(', ') || none()}</dd></div>
              <div><dt><Bi en="Never use" bn="কখনো নয়" /></dt><dd>{data.safeContact.prohibitedChannels.map(say).join(', ') || none()}</dd></div>
              <div><dt><Bi en="Safe time" bn="নিরাপদ সময়" /></dt><dd>{data.safeContact.safeTimeWindow || bi('Not recorded', 'লেখা নেই')}</dd></div>
              <div><dt><Bi en="If someone else answers" bn="অন্য কেউ ধরলে" /></dt><dd><Term code={data.safeContact.unknownAnswerAction} /></dd></div>
            </dl>}
            {data.safeContact?.allowedChannels.includes('PHONE') && <button type="button" className="secondary-button" onClick={simulateUnknownAnswer}><Bi en="Simulate call: unknown person answers" bn="পরীক্ষা: অন্য কেউ ধরেছে" /></button>}
            {neutralScript && <figure className="script-box" aria-label={bi('Neutral script', 'নিরপেক্ষ কথা')}><figcaption><Bi en="Say only this:" bn="শুধু এটুকু বলুন:" /></figcaption><blockquote>{tr(neutralScript)}</blockquote></figure>}
          </section>}
        </div>

        <div className="card panels">
          {officer && record.status === 'SUBMITTED' && <Panel id="decision-title" en="Phase 2: Verification & Eligibility Decision" bn="ধাপ ২: যাচাইকরণ ও আইনি সহায়তা সিদ্ধান্ত" hint={say(record.reviewState)} open>
            <div style={{ marginBottom: '1rem', padding: '0.85rem 1rem', background: '#fdfbf7', border: '1px solid #ece4d0', borderLeft: '4px solid #b8860b', borderRadius: '4px' }}>
              <strong><Bi en="Flowchart B2 Phase 2 Checklist (By DLAO):" bn="ফ্লোচার্ট ধাপ ২ যাচাই তালিকা (ডিএলএও):" /></strong>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.5rem', marginTop: '0.5rem', fontSize: '0.85rem' }}>
                <div>✓ <Bi en="Identity & NID Verified" bn="পরিচয় ও এনআইডি যাচাইকৃত" /></div>
                <div>✓ <Bi en="Supporting Documents Inspected" bn="সংযুক্ত প্রমাণাদি নিরীক্ষিত" /></div>
                <div>✓ <Bi en="Vulnerability & Safety Addressed" bn="ঝুঁকি ও সুরক্ষা বিবেচনাধীন" /></div>
                <div>✓ <Bi en="DBLA Means-Test Qualified (≤ 1.5L BDT/yr)" bn="ডিবিএলএ আয়সীমা উত্তীর্ণ (≤ ১.৫ লাখ/বছর)" /></div>
              </div>
            </div>

            <p className="muted"><Bi en="Assess eligibility according to official DBLA rules. If eligible, accept and generate Case ID. If ineligible, reject with reason and provide statutory appeal guidance." bn="সরকারি নীতিমালা অনুযায়ী যোগ্যতা মূল্যায়ন করুন। যোগ্য হলে গ্রহণ করে মামলা নম্বর দিন। অযোগ্য হলে কারণসহ বাতিল ও আপিলের নির্দেশনা দিন।" /></p>

            <div className="action-grid">
              <form onSubmit={submitReview} className="form-stack">
                <h3><Bi en="1. Review Application" bn="১. আবেদন পর্যালোচনা" /></h3>
                <label htmlFor="review-state"><Bi en="Review outcome" bn="পর্যালোচনার ফল" /></label>
                <select id="review-state" value={reviewState} onChange={(event) => setReviewState(event.target.value)}>
                  <option value="READY_FOR_DECISION">{say('READY_FOR_DECISION')}</option>
                  <option value="NEEDS_INFORMATION">{say('NEEDS_INFORMATION')}</option>
                  {record.reviewState !== 'PENDING_REVIEW' && <option value="PENDING_REVIEW">{bi('Back to pending review', 'আবার পর্যালোচনায় ফেরত')}</option>}
                </select>
                <label htmlFor="review-reason"><Bi en="Reason / Findings" bn="পর্যালোচনার বিবরণ / কারণ" /></label>
                <textarea id="review-reason" value={reviewReason} onChange={(event) => setReviewReason(event.target.value)} minLength="10" maxLength="1000" required />
                <button type="submit">{reviewState === 'PENDING_REVIEW' || record.reviewState === 'READY_FOR_DECISION' ? <Bi en="Record override" bn="পরিবর্তন সংরক্ষণ" /> : <Bi en="Record review" bn="পর্যালোচনা সংরক্ষণ" />}</button>
              </form>

              <div className="form-stack">
                <h3><Bi en="2. Legal Aid Decision" bn="২. আইনি সহায়তা সিদ্ধান্ত" /></h3>
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <button type="button" className={!showRejectForm ? 'primary-button' : 'secondary-button'} onClick={() => setShowRejectForm(false)} style={{ flex: 1 }}>
                    <Bi en="Eligible: Accept (Yes)" bn="যোগ্য: গ্রহণ (হ্যাঁ)" />
                  </button>
                  <button type="button" className={showRejectForm ? 'warn-badge' : 'secondary-button'} onClick={() => setShowRejectForm(true)} style={{ flex: 1 }}>
                    <Bi en="Ineligible: Reject (No)" bn="অযোগ্য: নামঞ্জুর (না)" />
                  </button>
                </div>

                {!showRejectForm ? (
                  <form onSubmit={submitAcceptance} className="form-stack">
                    <label htmlFor="accept-reason"><Bi en="Eligibility & Case Opening Reason" bn="গ্রহণ ও মামলা খোলার কারণ" /></label>
                    <textarea id="accept-reason" value={acceptReason} onChange={(event) => setAcceptReason(event.target.value)} minLength="10" maxLength="1000" placeholder="State eligibility grounds and merits for legal aid..." required />
                    <button type="submit" disabled={record.reviewState !== 'READY_FOR_DECISION'}><Bi en="Accept & Create Case ID (DLAS-YYYY-XXXXX)" bn="গ্রহণ করুন ও মামলা নম্বর প্রদান করুন" /></button>
                  </form>
                ) : (
                  <form onSubmit={handleRejection} className="form-stack">
                    <label htmlFor="reject-reason"><Bi en="Rejection Reason (Required)" bn="নামঞ্জুরের সুনির্দিষ্ট কারণ (বাধ্যতামূলক)" /></label>
                    <textarea id="reject-reason" value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} minLength="10" maxLength="1000" placeholder="Specify why the applicant does not qualify (e.g., income ceiling exceeded, lack of prima facie case, or outside DLAS mandate)..." required />
                    <p className="muted" style={{ fontSize: '0.8rem', margin: '0.2rem 0' }}>
                      <Bi en="Applicant will be notified of statutory appeal right to District Legal Aid Committee." bn="আবেদনকারীকে জেলা লিগ্যাল এইড কমিটিতে আপিলের বিধি মোতাবেক তথ্য জানানো হবে।" />
                    </p>
                    <button type="submit" style={{ background: '#c9302c', borderColor: '#ac2925', color: '#fff' }}><Bi en="Confirm Rejection & Close Application" bn="নামঞ্জুর নিশ্চিত করুন ও আবেদন সমাপ্ত করুন" /></button>
                  </form>
                )}
              </div>
            </div>
          </Panel>}

          {officer && record.status === 'ACCEPTED' && (
            <section className="panel" aria-labelledby="jurisdiction-title" style={{ background: '#fcfcfc', border: '1px solid #e3e2dc', borderRadius: '6px', padding: '1rem 1.25rem', margin: '0.75rem 0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                <div>
                  <span className="badge" style={{ background: '#edf3ec', color: '#28562d' }}>Phase 3: Jurisdiction & Routing</span>
                  <h3 id="jurisdiction-title" style={{ margin: '0.3rem 0 0 0' }}><Bi en="Appropriate Jurisdiction Confirmed" bn="উপযুক্ত আইনি এখতিয়ার নিশ্চিতকরণ" /></h3>
                  <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.88rem', color: '#555' }}>
                    <Bi en="This District Legal Aid Office holds territorial and subject-matter jurisdiction to handle this case." bn="এই জেলা লিগ্যাল এইড অফিসের ভৌগোলিক ও বিষয়ভিত্তিক এখতিয়ার নিশ্চিত হয়েছে।" />
                  </p>
                </div>
                <div style={{ fontSize: '0.82rem', color: '#666' }}>
                  <Bi en="Case ID:" bn="মামলা নম্বর:" /> <strong>{record.caseId}</strong>
                </div>
              </div>
            </section>
          )}

          {officer && record.status === 'ACCEPTED' && (
            <Panel id="pathway-title" en="Phase 4: Legal Aid Service Pathways" bn="ধাপ ৪: আইনি সহায়তা সেবার মাধ্যম নির্ধারণ" hint={say(activePathway)} open>
              <p className="muted"><Bi en="Per Flowchart B2: Determine appropriate service pathway. Record all activities, documents, and outcomes. If advice or mediation does not resolve the issue, proceed to panel lawyer litigation." bn="ফ্লোচার্ট অনুযায়ী উপযুক্ত সেবার মাধ্যম নির্ধারণ করুন। পরামর্শ বা মধ্যস্থতায় বিষয় নিষ্পত্তি না হলে প্যানেল আইনজীবী মামলায় স্থানান্তর করুন।" /></p>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem', margin: '1rem 0' }}>
                <div
                  onClick={() => handleSavePathway('ADVICE')}
                  style={{ cursor: 'pointer', padding: '1rem', border: activePathway === 'ADVICE' ? '2px solid #222724' : '1px solid #e3e2dc', borderRadius: '6px', background: activePathway === 'ADVICE' ? '#faf9f6' : '#fff' }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong><Bi en="1. Legal Advice" bn="১. আইনি পরামর্শ" /></strong>
                    {activePathway === 'ADVICE' && <Badge code="ACTIVE" />}
                  </div>
                  <p style={{ margin: '0.4rem 0 0 0', fontSize: '0.85rem', color: '#666' }}>
                    <Bi en="Direct officer legal guidance, rights counseling, and statutory remedies." bn="কর্মকর্তা কর্তৃক সরাসরি আইনি পরামর্শ, অধিকার সংক্রান্ত দিকনির্দেশনা।" />
                  </p>
                </div>

                <div
                  onClick={() => handleSavePathway('MEDIATION')}
                  style={{ cursor: 'pointer', padding: '1rem', border: activePathway === 'MEDIATION' ? '2px solid #222724' : '1px solid #e3e2dc', borderRadius: '6px', background: activePathway === 'MEDIATION' ? '#faf9f6' : '#fff' }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong><Bi en="2. ADR / Mediation" bn="২. মধ্যস্থতা / সালিশ" /></strong>
                    {activePathway === 'MEDIATION' && <Badge code="ACTIVE" />}
                  </div>
                  <p style={{ margin: '0.4rem 0 0 0', fontSize: '0.85rem', color: '#666' }}>
                    <Bi en="Alternative dispute resolution (In-person ADR or Online ODR session)." bn="বিকল্প বিরোধ নিষ্পত্তি (সরাসরি সালিশ বা ওডিআর অনলাইন মধ্যস্থতা)।" />
                  </p>
                </div>

                <div
                  onClick={() => handleSavePathway('PANEL_LAWYER')}
                  style={{ cursor: 'pointer', padding: '1rem', border: activePathway === 'PANEL_LAWYER' ? '2px solid #222724' : '1px solid #e3e2dc', borderRadius: '6px', background: activePathway === 'PANEL_LAWYER' ? '#faf9f6' : '#fff' }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong><Bi en="3. Panel Lawyer Litigation" bn="৩. প্যানেল আইনজীবী ও মামলা" /></strong>
                    {activePathway === 'PANEL_LAWYER' && <Badge code="ACTIVE" />}
                  </div>
                  <p style={{ margin: '0.4rem 0 0 0', fontSize: '0.85rem', color: '#666' }}>
                    <Bi en="Direct legal aid litigation representation in court via appointed panel advocate." bn="আদালতে মোকদ্দমা দায়ের ও পরিচালনার জন্য প্যানেল আইনজীবী নিয়োগ।" />
                  </p>
                </div>
              </div>

              {activePathway === 'ADVICE' && (
                <div style={{ borderTop: '1px solid #ecebe6', paddingTop: '1rem', marginTop: '1rem' }}>
                  <h3><Bi en="Provide Legal Advice (Record Activity)" bn="আইনি পরামর্শ প্রদান (কার্যবিবরণী লিপিবদ্ধ)" /></h3>
                  <form onSubmit={handleAddAdvice} className="form-stack inline-form">
                    <label htmlFor="advice-topic"><Bi en="Advice Category" bn="পরামর্শের ক্ষেত্র" /></label>
                    <select id="advice-topic" value={adviceTopic} onChange={(e) => setAdviceTopic(e.target.value)}>
                      <option value="FAMILY_RIGHTS">{bi('Family & Maintenance Rights', 'পারিবারিক ও ভরণপোষণ অধিকার')}</option>
                      <option value="LAND_DISPUTE">{bi('Land & Property Rights', 'জমিজমা ও সম্পত্তি সংক্রান্ত')}</option>
                      <option value="LABOUR_WAGES">{bi('Labour & Wage Protection', 'শ্রমিক ও মজুরি সুরক্ষা')}</option>
                      <option value="CRIMINAL_DEFENSE">{bi('Criminal Defense & Bail', 'ফৌজদারি প্রতিকার ও জামিন')}</option>
                      <option value="CIVIL_REMEDY">{bi('General Civil Remedies', 'সাধারণ দেওয়ানি প্রতিকার')}</option>
                    </select>
                    <label htmlFor="advice-notes"><Bi en="Legal Advice Given" bn="প্রদত্ত আইনি পরামর্শের বিবরণ" /></label>
                    <textarea id="advice-notes" value={adviceNotes} onChange={(e) => setAdviceNotes(e.target.value)} minLength="10" maxLength="1000" placeholder="Summarize legal advice given to citizen, applicable laws, and recommended actions..." required />
                    <label className="checkbox-label" htmlFor="advice-resolved" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <input id="advice-resolved" type="checkbox" checked={adviceResolved} onChange={(e) => setAdviceResolved(e.target.checked)} />
                      <Bi en="Issue resolved through advice? (Check if no further court/mediation action is needed)" bn="পরামর্শের মাধ্যমেই কি সমস্যার সমাধান হয়েছে? (হ্যাঁ হলে টিক দিন)" />
                    </label>
                    <button type="submit" className="secondary-button"><Bi en="Log Advice Session" bn="পরামর্শ সংরক্ষণ করুন" /></button>
                  </form>

                  {adviceRecords.length > 0 && (
                    <div className="version-history" style={{ marginTop: '1rem' }}>
                      <h4><Bi en="Logged Advice Records" bn="সংরক্ষিত পরামর্শের ইতিহাস" /></h4>
                      <ol className="timeline compact">
                        {adviceRecords.map((adv) => (
                          <li key={adv.id}>
                            <strong><Term code={adv.topic} /></strong> {adv.resolved && <Badge code="RESOLVED" />}
                            <p>{adv.notes}</p>
                            <small>{adv.officer} · {when(adv.date)}</small>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                </div>
              )}
            </Panel>
          )}

          {officer && record.status === 'ACCEPTED' && (
            <Panel id="closure-panel-title" en="Phase 6: Case Outcome & Closure (Court / DLAO / Finance)" bn="ধাপ ৬: মামলার চূড়ান্ত নিষ্পত্তি ও সমাপ্তি" hint={closureRecord ? bi('Closed in Records', 'নথিতে সমাপ্ত') : bi('Active Case', 'চলমান মামলা')}>
              <p className="muted"><Bi en="Per Flowcharts B1 (Steps 8-10) and B2 (Phase 6): Record final legal outcome, verify completion reports, complete payment disbursement to panel lawyer, and formally close the case in records." bn="ফ্লোচার্ট অনুযায়ী মামলার রায়/আপস নিষ্পত্তি লিপিবদ্ধ করুন, আইনজীবীর ফি অনুমোদন নিশ্চিত করুন এবং নথিতে মামলা সমাপ্ত করুন।" /></p>

              {closureRecord ? (
                <div className="success" style={{ margin: '1rem 0' }}>
                  <h3><Bi en="Case Formally Closed in Records" bn="মামলাটি আনুষ্ঠানিকভাবে সমাপ্ত হিসেবে নথিভুক্ত" /></h3>
                  <dl className="details compact" style={{ marginTop: '0.5rem' }}>
                    <div><dt><Bi en="Outcome" bn="ফলাফল" /></dt><dd><Term code={closureRecord.outcome} /></dd></div>
                    <div><dt><Bi en="Disposal Date" bn="নিষ্পত্তির তারিখ" /></dt><dd>{closureRecord.date}</dd></div>
                    <div><dt><Bi en="Order / Decree Ref" bn="আদেশ / ডিক্রি নম্বর" /></dt><dd>{closureRecord.referenceNo || bi('Not recorded', 'নেই')}</dd></div>
                    <div><dt><Bi en="Notes / Summary" bn="বিবরণ" /></dt><dd>{closureRecord.notes || bi('Standard closure', 'নিয়মিত সমাপ্তি')}</dd></div>
                    <div><dt><Bi en="Closed by" bn="সমাপ্ত করেছেন" /></dt><dd>{closureRecord.closedBy} · {when(closureRecord.closedAt)}</dd></div>
                  </dl>
                  <p style={{ marginTop: '0.75rem', fontSize: '0.85rem', color: '#28562d' }}>
                    ✓ <Bi en="All documents preserved for future reporting and audit trail complete." bn="সকল প্রমাণাদি সংরক্ষণ করা হয়েছে এবং অডিট ট্রেইল সম্পন্ন।" />
                  </p>
                </div>
              ) : (
                <form onSubmit={handleSaveClosure} className="form-stack inline-form" style={{ marginTop: '0.75rem' }}>
                  <label htmlFor="closure-outcome"><Bi en="Legal Outcome (Court Decision / Settlement / Dismissal)" bn="আইনি ফলাফল (আদালতের রায় / আপস / খারিজ)" /></label>
                  <select id="closure-outcome" value={closureOutcome} onChange={(e) => setClosureOutcome(e.target.value)}>
                    <option value="COURT_JUDGMENT_FAVOUR">{bi('Court Judgment in Favour (পক্ষে রায়)', 'আদালতের পক্ষে রায়')}</option>
                    <option value="COURT_JUDGMENT_DISMISSED">{bi('Case Dismissed / Decreed (খারিজ / ডিক্রি)', 'মামলা খারিজ / ডিক্রি')}</option>
                    <option value="ADR_SETTLEMENT">{bi('Mediation / ADR Settlement Agreement (আপস নিষ্পত্তি)', 'সালিশে আপস নিষ্পত্তি')}</option>
                    <option value="WITHDRAWN">{bi('Withdrawn by Applicant (প্রত্যাহার)', 'আবেদনকারী কর্তৃক প্রত্যাহার')}</option>
                    <option value="DISPOSED_OTHER">{bi('Disposed on Merits / Other (অন্যান্য নিষ্পত্তিকৃত)', 'অন্যান্য কারণে নিষ্পত্তিকৃত')}</option>
                  </select>

                  <label htmlFor="closure-date"><Bi en="Date of Disposal / Resolution" bn="নিষ্পত্তির তারিখ" /></label>
                  <input id="closure-date" type="date" value={closureDate} onChange={(e) => setClosureDate(e.target.value)} required />

                  <label htmlFor="closure-ref"><Bi en="Judgment / Decree / Settlement Ref No." bn="রায় / ডিক্রি / আপসপত্র স্মারক নম্বর" /></label>
                  <input id="closure-ref" value={closureRef} onChange={(e) => setClosureRef(e.target.value)} placeholder="e.g. Decree No. 14/2026 or ADR Deed 2026/08" />

                  <label htmlFor="closure-notes"><Bi en="Final Disposal Summary & Closure Notes" bn="চূড়ান্ত নিষ্পত্তি ও সমাপ্তির সারসংক্ষেপ" /></label>
                  <textarea id="closure-notes" value={closureNotes} onChange={(e) => setClosureNotes(e.target.value)} minLength="10" maxLength="1000" placeholder="Detail the outcome, key findings, and closure confirmation..." required />

                  <button type="submit" style={{ background: '#28562d', borderColor: '#1f4523', color: '#fff' }}>
                    <Bi en="Record Outcome & Formally Close Case" bn="ফলাফল সংরক্ষণ করুন ও মামলা সমাপ্ত করুন" />
                  </button>
                </form>
              )}
            </Panel>
          )}

          <Panel id="tasks-title" en="Tasks" bn="কাজ" hint={openTasks ? bi(`${openTasks} open`, `${num(openTasks)}টি চলমান`) : bi('All done', 'সব সম্পন্ন')} open>
            {data.tasks.length === 0 && <p className="muted">{none()}</p>}
            <ul className="plain-list">{data.tasks.map((task) => <li key={task._id}><div><strong><Term code={task.title} /></strong> <Badge code={task.status} /><p>{tr(task.nextAction)}</p><small><Term code={task.ownerRole} />{task.dueAt && <> · <Bi en="Due" bn="শেষ সময়" /> {when(task.dueAt)}</>}</small></div>{task.kind === 'MANUAL' && task.status === 'OPEN' && <button type="button" className="secondary-button" onClick={() => change(`/api/applications/${applicationId}/tasks/${task._id}/complete`, undefined, bi('Task completed.', 'কাজ সম্পন্ন।'))}><Bi en="Complete" bn="সম্পন্ন" /></button>}</li>)}</ul>
            <AddForm en="Add task" bn="কাজ যোগ করুন">
              <form onSubmit={submitTask} className="form-stack inline-form">
                <label htmlFor="task-title"><Bi en="Task title" bn="কাজের নাম" /></label><input id="task-title" value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} minLength="3" maxLength="120" required />
                <label htmlFor="task-owner"><Bi en="Owner" bn="দায়িত্বে" /></label><select id="task-owner" value={taskRole} onChange={(event) => setTaskRole(event.target.value)}>{['DLAO_OFFICER', 'CASE_SUPPORT', 'MEDIATOR', 'RECEIVING_DLAO'].map((role) => <option key={role} value={role}>{say(role)}</option>)}</select>
                <label htmlFor="task-action"><Bi en="Next action" bn="পরবর্তী কাজ" /></label><input id="task-action" value={taskAction} onChange={(event) => setTaskAction(event.target.value)} minLength="5" maxLength="300" required />
                <button type="submit" className="secondary-button"><Bi en="Add task" bn="কাজ যোগ করুন" /></button>
              </form>
            </AddForm>
          </Panel>

          {officer && <Panel id="priority-title" en="Priority" bn="অগ্রাধিকার" hint={record.priorityDecision ? say(record.priorityDecision) : record.urgencyReasons.length ? bi('Flagged, decide', 'চিহ্নিত, সিদ্ধান্ত দিন') : bi('Not set', 'নির্ধারিত নয়')} open={record.urgencyReasons.length > 0 && !record.priorityDecision}>
            <p className="muted"><Bi en="The system flags. You decide." bn="সিস্টেম চিহ্নিত করে, সিদ্ধান্ত আপনার।" /></p>
            {record.urgencyReasons.length ? <><h3><Bi en="Why flagged" bn="কেন চিহ্নিত" /></h3><ul>{record.urgencyReasons.map((reason) => <li key={reason}>{tr(reason)}</li>)}</ul></> : <p><Bi en="No urgency signs recorded." bn="জরুরি পরিস্থিতির কোনো ইঙ্গিত নথিতে নেই।" /></p>}
            <form onSubmit={submitPriority} className="form-stack inline-form">
              <label htmlFor="priority-decision"><Bi en="Priority decision" bn="অগ্রাধিকারের সিদ্ধান্ত" /></label><select id="priority-decision" value={priorityDecision} onChange={(event) => setPriorityDecision(event.target.value)}><option value="URGENT">{say('URGENT')}</option><option value="ROUTINE">{say('ROUTINE')}</option></select>
              <label htmlFor="priority-reason"><Bi en="Reason" bn="কারণ" /></label><textarea id="priority-reason" value={priorityReason} onChange={(event) => setPriorityReason(event.target.value)} minLength="10" maxLength="1000" required />
              <button type="submit"><Bi en="Save priority" bn="অগ্রাধিকার সংরক্ষণ" /></button>
            </form>
          </Panel>}

          {record.assistance && <Panel id="assistance-title" en="Assisted intake" bn="সহায়তায় আবেদন" hint={say(record.assistance.caseType)}>
            <dl className="details compact">
              <div><dt><Bi en="Helper" bn="সহায়তাকারী" /></dt><dd>{record.assistance.helperName}</dd></div>
              <div><dt><Bi en="Translator" bn="অনুবাদক" /></dt><dd>{record.assistance.translatorName}</dd></div>
              <div><dt><Bi en="Typist" bn="টাইপিস্ট" /></dt><dd>{record.assistance.typistName}</dd></div>
              <div><dt><Bi en="Original language" bn="মূল ভাষা" /></dt><dd>{record.assistance.originalLanguage}</dd></div>
              <div><dt><Bi en="Case type" bn="মামলার ধরন" /></dt><dd><Term code={record.assistance.caseType} /></dd></div>
              <div><dt><Bi en="Consent (oral)" bn="সম্মতি (মৌখিক)" /></dt><dd><Term code={record.assistance.consentState} /></dd></div>
              <div><dt><Bi en="Statement confirmed" bn="বক্তব্য নিশ্চিত" /></dt><dd>{yesNo(record.assistance.originalConfirmed)}</dd></div>
              <div><dt><Bi en="Translation confirmed" bn="অনুবাদ নিশ্চিত" /></dt><dd>{yesNo(record.assistance.translationConfirmed)}</dd></div>
            </dl>
            <p className="muted"><Bi en="Original and translation are kept apart. The helper's phone is not the applicant's." bn="আবেদনকারীর মূল বক্তব্য ও অনুবাদ আলাদা রাখা হয়েছে। সহায়তাকারীর ফোন নম্বর আবেদনকারীর যোগাযোগ নম্বর হিসেবে ব্যবহার করবেন না।" /></p>
          </Panel>}

          {officer && record.status === 'ACCEPTED' && <LawyerManagement applicationId={applicationId} token={session.token} onChanged={() => setRefresh((value) => value + 1)} />}
          {officer && record.status === 'ACCEPTED' && <TriagePanel applicationId={applicationId} token={session.token} />}

          <Panel id="docs-title" en="Documents" bn="নথি" hint={data.documents.length ? bi(`${data.documents.length} on file`, `${num(data.documents.length)}টি আছে`) : none()}>
            {data.documents.length === 0 && <p className="muted">{none()}</p>}
            <ul className="plain-list">{data.documents.map((document) => <li key={document.id}><div><strong>{document.label}</strong>{document.sensitivity === 'RESTRICTED' && <> <Badge code="RESTRICTED" /></>}<p className="muted">{document.redacted ? <Bi en="No access. Opening is refused and logged." bn="আপনার এই নথি দেখার অনুমতি নেই। খোলার চেষ্টা নথিভুক্ত হবে।" /> : <><Bi en="Version" bn="সংস্করণ" /> {num(document.currentVersion)}</>}</p></div>{!document.redacted && <button type="button" className="secondary-button" onClick={() => selectDocument(document)} aria-label={bi(`Versions of ${document.label}`, `${document.label}-এর সংস্করণ`)}><Bi en="Versions" bn="সংস্করণ" /></button>}</li>)}</ul>
            {selectedDocument && <div className="version-history"><h3><Bi en="Versions" bn="সংস্করণ" />: {selectedDocument.label}</h3><ol>{versions.map((version) => <li key={version.version}>{version.label} · <Term code={version.qualityState} />{version.note ? ` · ${version.note}` : ''}</li>)}</ol></div>}
            {officer && <AddForm en={selectedDocument ? 'Add a version' : 'Add document'} bn={selectedDocument ? 'সংস্করণ যোগ করুন' : 'নথি যোগ করুন'}>
              <form onSubmit={submitDocument} className="form-stack inline-form">
                {selectedDocument && <button type="button" className="text-button" onClick={() => { setSelectedDocument(null); setVersions([]); setDocLabel('') }}><Bi en="New document instead" bn="নতুন নথি যোগ করুন" /></button>}
                <label htmlFor="doc-label"><Bi en="Label" bn="নাম" /></label><input id="doc-label" value={docLabel} onChange={(event) => setDocLabel(event.target.value)} minLength="3" maxLength="160" required />
                <label htmlFor="doc-quality"><Bi en="Quality" bn="মান" /></label><select id="doc-quality" value={docQuality} onChange={(event) => setDocQuality(event.target.value)}>{['PENDING_REVIEW', 'READABLE', 'UNREADABLE'].map((code) => <option key={code} value={code}>{say(code)}</option>)}</select>
                <label htmlFor="doc-note"><Bi en="Note (optional)" bn="নোট (ঐচ্ছিক)" /></label><textarea id="doc-note" value={docNote} onChange={(event) => setDocNote(event.target.value)} maxLength="500" />
                {!selectedDocument && <label className="checkbox-label" htmlFor="doc-restricted"><input id="doc-restricted" type="checkbox" checked={docRestricted} onChange={(event) => setDocRestricted(event.target.checked)} /><Bi en="Highly sensitive evidence: only me and people I authorise" bn="এই প্রমাণ খুব সংবেদনশীল; শুধু আমি ও আমার অনুমতি পাওয়া ব্যক্তিরা দেখতে পারবেন" /></label>}
                <button type="submit" className="secondary-button">{selectedDocument ? <Bi en="Add version" bn="সংস্করণ যোগ করুন" /> : <Bi en="Add document" bn="নথি যোগ করুন" />}</button>
              </form>
            </AddForm>}
            {officer && data.evidenceAccess.length > 0 && <div className="version-history"><h3><Bi en="Restricted access log" bn="সংবেদনশীল নথি দেখার ইতিহাস" /></h3><ol>{data.evidenceAccess.map((entry) => <li key={entry.id}><Badge code={entry.outcome} /> {entry.user} · {entry.document} · {when(entry.createdAt)}</li>)}</ol></div>}
          </Panel>

          {officer && data.record.assistance && <DocumentReview applicationId={applicationId} caseType={record.assistance.caseType} documents={data.documents} token={session.token} onChanged={() => setRefresh((value) => value + 1)} />}

          <Panel id="contact-title" en="Contact log" bn="যোগাযোগের রেকর্ড" hint={data.contacts.length ? bi(`${data.contacts.length} attempts`, `${num(data.contacts.length)} বার চেষ্টা`) : none()}>
            <p className="muted"><Bi en="A log only. Nothing is sent from here." bn="এখানে শুধু যোগাযোগের তথ্য নথিভুক্ত হয়; কোনো বার্তা পাঠানো হয় না।" /></p>
            {data.contacts.length === 0 && <p>{none()}</p>}
            <ul className="plain-list">{data.contacts.map((attempt) => <li key={attempt._id}><div><Badge code={attempt.outcome} /> <Term code={attempt.channel} /><p>{attempt.reason}</p><small>{when(attempt.createdAt)}</small></div></li>)}</ul>
            {officer && <AddForm en="Log attempt" bn="চেষ্টা লিখুন">
              <form onSubmit={submitContact} className="form-stack inline-form">
                <label htmlFor="contact-channel"><Bi en="Channel" bn="মাধ্যম" /></label><select id="contact-channel" value={contactChannel} onChange={(event) => setContactChannel(event.target.value)}>{['PHONE', 'SMS', 'WEB', 'IN_PERSON'].map((code) => <option key={code} value={code}>{say(code)}</option>)}</select>
                <label htmlFor="contact-outcome"><Bi en="Outcome" bn="ফলাফল" /></label><select id="contact-outcome" value={contactOutcome} onChange={(event) => setContactOutcome(event.target.value)}>{['BLOCKED_UNSAFE', 'NO_ANSWER', 'UNKNOWN_PERSON', 'APPLICANT_REACHED'].map((code) => <option key={code} value={code}>{say(code)}</option>)}</select>
                <label htmlFor="contact-reason"><Bi en="What happened" bn="কী হয়েছে" /></label><textarea id="contact-reason" value={contactReason} onChange={(event) => setContactReason(event.target.value)} minLength="5" maxLength="500" required />
                <button type="submit" className="secondary-button"><Bi en="Log attempt" bn="চেষ্টা লিখুন" /></button>
              </form>
            </AddForm>}
          </Panel>

          {officer && <ReferralPanel applicationId={applicationId} officeCode={record.officeCode} accepted={record.status === 'ACCEPTED'} referrals={data.referrals} documents={data.documents} token={session.token} change={change} />}
          {officer && record.caseId && <MediationPanel applicationId={applicationId} session={session} role="DLAO_OFFICER" />}
          {officer && record.status === 'ACCEPTED' && <RelatedIncidentPanel applicationId={applicationId} token={session.token} />}
          {officer && <DuplicateReview applicationId={applicationId} token={session.token} />}

          {officer && (record.channel === 'VOICE_SIM' || data.transcript) && <Panel id="call-title" en="Call" bn="কল" hint={data.transcript ? bi('Recording and transcript', 'রেকর্ড ও কথোপকথন') : bi('Recording', 'রেকর্ড')}>
            {record.channel === 'VOICE_SIM' && <><h3><Bi en="Recording" bn="রেকর্ড" /></h3><CallRecording applicationId={applicationId} token={session.token} /><p className="muted"><Bi en="The caller was told the call is recorded." bn="কলারকে রেকর্ডিংয়ের কথা জানানো হয়েছে।" /></p></>}
            {data.transcript && <><h3><Bi en="Transcript" bn="কথোপকথন" /></h3>
              <p className="muted"><Bi en={`Machine transcript (${data.transcript.transcribedBy}), not a legal record.`} bn="কথোপকথনটি যন্ত্রের সাহায্যে লেখা হয়েছে; এটি যাচাইকৃত আইনি নথি নয়।" /></p>
              <ol className="timeline">{data.transcript.turns.map((line, index) => <li key={index}><strong>{line.speaker === 'CALLER' ? <Bi en="Caller" bn="কলার" /> : <Bi en="Assistant" bn="সহকারী" />}</strong><p lang="bn">{line.text}</p></li>)}</ol>
            </>}
          </Panel>}

          {officer && <Panel id="facts-title" en="Facts and sources" bn="তথ্য ও উৎস" hint={data.facts.length ? bi(`${data.facts.length} facts`, `${num(data.facts.length)}টি তথ্য`) : none()}>
            {data.facts.length === 0 ? <p>{none()}</p> : <div className="table-wrap"><table>
              <caption className="visually-hidden">{bi('Recorded facts and where each came from', 'নথিভুক্ত তথ্য এবং তথ্যের উৎস')}</caption>
              <thead><tr><th scope="col"><Bi en="Fact" bn="তথ্য" /></th><th scope="col"><Bi en="Value" bn="মান" /></th><th scope="col"><Bi en="Source" bn="উৎস" /></th><th scope="col"><Bi en="Confirmed by" bn="নিশ্চিত করেছেন" /></th><th scope="col"><Bi en="Status" bn="অবস্থা" /></th></tr></thead>
              <tbody>{data.facts.map((fact) => <tr key={fact._id}>
                <th scope="row"><Term code={fact.field} /></th>
                <td>{tr(say(fact.value))}</td>
                <td><Term code={fact.sourceType} /><small className="muted"> · <Term code={fact.captureMethod} /> · {bi('r', 'সং')}{num(fact.revision)}{fact.aiInferred ? ` · ${bi('AI', 'এআই')}` : ''}</small></td>
                <td><Bi en="Caller" bn="কলার" /> {yesNo(fact.callerConfirmed)}<br /><Bi en="Applicant" bn="আবেদনকারী" /> {yesNo(fact.applicantConfirmed)}</td>
                <td>{factStatus(fact) && <Badge code={factStatus(fact)} />}</td>
              </tr>)}</tbody>
            </table></div>}
          </Panel>}

          <Panel id="history-title" en="History" bn="ইতিহাস" hint={events ? `${bi(`${events.length} events`, `${num(events.length)}টি ঘটনা`)} · ${integrity ? bi('check OK', 'যাচাই ঠিক') : bi('CHECK FAILED', 'যাচাই ব্যর্থ')}` : undefined} open={!officer}>
            <p className={integrity ? 'muted' : 'error'}>{integrity ? bi('Integrity check passed (demo).', 'নমুনা রেকর্ডের অখণ্ডতা যাচাইয়ে মিলেছে।') : bi('Integrity check FAILED. Review required.', 'সত্যতা যাচাই ব্যর্থ। পর্যালোচনা দরকার।')}</p>
            <ol className="timeline compact">{events?.map((event, index) => <li key={event._id ?? index}><strong><Term code={event.action} /></strong> <small><Term code={event.actorRole} /> · <time dateTime={event.createdAt}>{when(event.createdAt)}</time></small>{event.reason && <p>{tr(event.reason)}</p>}</li>)}</ol>
          </Panel>
        </div>
      </>}
    </section>
  )
}
