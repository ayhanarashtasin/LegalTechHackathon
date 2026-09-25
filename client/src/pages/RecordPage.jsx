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
  const caseSupport = session.user.assignments.some(({ role }) => role === 'CASE_SUPPORT')
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

  const record = data?.record
  const canManageIncidents = session.user.assignments.some(({ role, officeCode }) => role === 'DLAO_OFFICER' && officeCode === record?.officeCode)
  const canReadDuplicateSuggestions = session.user.assignments.some(({ role, officeCode }) => ['DLAO_OFFICER', 'CASE_SUPPORT'].includes(role) && officeCode === record?.officeCode)
  const canReviewDuplicates = session.user.assignments.some(({ role, officeCode }) => role === 'DLAO_OFFICER' && officeCode === record?.officeCode)
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
          <PhaseTracker application={record} />
        </div>
        <p className="safety-note next-step"><strong><Bi en="Next step" bn="পরবর্তী ধাপ" /></strong> {tr(record.nextTask?.nextAction) || bi('No open task', 'কোনো চলমান কাজ নেই')}{record.nextTask && <small> · <Term code={record.nextTask.ownerRole} /></small>}</p>

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
          {officer && record.status === 'SUBMITTED' && <Panel id="decision-title" en="Decision" bn="সিদ্ধান্ত" hint={say(record.reviewState)} open>
            <p className="muted"><Bi en="1. Review, then 2. accept. Review is not proof of identity." bn="প্রথমে আবেদনটি পর্যালোচনা করুন। তারপর গ্রহণের সিদ্ধান্ত নিন। শুধু পর্যালোচনা করলেই পরিচয় যাচাই হয়ে যায় না।" /></p>
            <div className="action-grid">
              <form onSubmit={submitReview} className="form-stack">
                <h3><Bi en="1. Review" bn="১. পর্যালোচনা" /></h3>
                <label htmlFor="review-state"><Bi en="Review outcome" bn="পর্যালোচনার ফল" /></label>
                <select id="review-state" value={reviewState} onChange={(event) => setReviewState(event.target.value)}>
                  <option value="READY_FOR_DECISION">{say('READY_FOR_DECISION')}</option>
                  <option value="NEEDS_INFORMATION">{say('NEEDS_INFORMATION')}</option>
                  {record.reviewState !== 'PENDING_REVIEW' && <option value="PENDING_REVIEW">{bi('Back to pending review', 'আবার পর্যালোচনায় ফেরত')}</option>}
                </select>
                <label htmlFor="review-reason"><Bi en="Reason" bn="কারণ" /></label>
                <textarea id="review-reason" value={reviewReason} onChange={(event) => setReviewReason(event.target.value)} minLength="10" maxLength="1000" required />
                <button type="submit">{reviewState === 'PENDING_REVIEW' || record.reviewState === 'READY_FOR_DECISION' ? <Bi en="Record override" bn="পরিবর্তন সংরক্ষণ" /> : <Bi en="Record review" bn="পর্যালোচনা সংরক্ষণ" />}</button>
              </form>
              <form onSubmit={submitAcceptance} className="form-stack">
                <h3><Bi en="2. Accept" bn="২. গ্রহণ" /></h3>
                <label htmlFor="accept-reason"><Bi en="Decision reason" bn="সিদ্ধান্তের কারণ" /></label>
                <textarea id="accept-reason" value={acceptReason} onChange={(event) => setAcceptReason(event.target.value)} minLength="10" maxLength="1000" required />
                <button type="submit" disabled={record.reviewState !== 'READY_FOR_DECISION'}><Bi en="Accept application" bn="আবেদন গ্রহণ করুন" /></button>
              </form>
            </div>
          </Panel>}

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

          {(officer || caseSupport) && data.record.assistance && <DocumentReview applicationId={applicationId} caseType={record.assistance.caseType} documents={data.documents} token={session.token} readOnly={!officer} onChanged={() => setRefresh((value) => value + 1)} />}

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
          {(officer || caseSupport) && record.status === 'ACCEPTED' && <RelatedIncidentPanel applicationId={applicationId} token={session.token} canManage={canManageIncidents} />}
          {canReadDuplicateSuggestions && <DuplicateReview applicationId={applicationId} token={session.token} canReview={canReviewDuplicates} />}

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
