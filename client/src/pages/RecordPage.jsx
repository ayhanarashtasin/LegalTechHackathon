import { Fragment, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { api, apiUrl } from '../services/api.js'
import { AddForm, Badge, Bi, Panel, Term, bi, num, overdueText, say, tr, when } from '../components/Bi.jsx'
import DocumentReview from './DocumentReview.jsx'
import ReferralPanel from './ReferralPanel.jsx'
import LawyerManagement from './LawyerManagement.jsx'
import DuplicateReview from './DuplicateReview.jsx'
import RelatedIncidentPanel from './RelatedIncidentPanel.jsx'
import TriagePanel from './TriagePanel.jsx'
import MediationPanel from './MediationPanel.jsx'
import PhaseTracker from '../components/PhaseTracker.jsx'
import { EditCaseModal } from '../components/EditCaseModal.jsx'
import { PartiesCard } from '../components/PartiesCard.jsx'

const none = () => bi('None', 'নেই')
const yesNo = (value) => value ? bi('Yes', 'হ্যাঁ') : bi('No', 'না')
// How far a fact can be relied on: still to be checked (AI output, unverified callers, an NID), confirmed by the victim,
// or reported by a representative and not yet confirmed. Staff and document entries carry their own source instead.
const factStatus = (fact) => ['AI_INFERRED', 'UNKNOWN_OR_UNVERIFIED'].includes(fact.sourceType) || fact.field === 'identity.nid' ? 'VERIFICATION_REQUIRED'
  : fact.applicantConfirmed ? 'VICTIM_CONFIRMED' : fact.sourceType === 'REPRESENTATIVE_REPORTED' ? 'REPRESENTATIVE_REPORTED' : null

// Officer-only playback of the full 16699 call. Fetched with the session token, which a bare <audio src> cannot send.
// The latest mediation or panel-lawyer start in the audit trail, so work begun on another device stays visible.
function serverPathway(events = []) {
  let pathway = ''
  for (const { action } of events) {
    if (action === 'MEDIATION_REGISTERED') pathway = 'MEDIATION'
    else if (action === 'PANEL_LAWYER_ASSIGNMENT_OFFERED') pathway = 'PANEL_LAWYER'
  }
  return pathway
}

// Who picked up follows from the outcome; older entries predate the field.
const ANSWERED_BY = { APPLICANT_REACHED: 'APPLICANT', UNKNOWN_PERSON: 'SOMEONE_ELSE', NO_ANSWER: 'NOBODY' }
const answeredByLabel = { APPLICANT: ['The applicant', 'আবেদনকারী নিজে'], SOMEONE_ELSE: ['Someone else', 'অন্য কেউ'], NOBODY: ['Nobody', 'কেউ রিসিভ করেননি'] }
// A datetime-local value for "now", so the next attempt cannot be planned in the past.
const localNow = () => { const now = new Date(); return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16) }

// One line of the contact log: what happened, which number (for officers, when it is the current plan's), who
// answered, whether anything reached someone else, whether the status was explained, and when to try again.
function ContactAttemptItem({ attempt, safeContact }) {
  const answeredBy = attempt.answeredBy ?? ANSWERED_BY[attempt.outcome]
  const number = ['PHONE', 'SMS'].includes(attempt.channel) && safeContact?.version === attempt.safeContactVersion ? safeContact.contactValue : null
  return <li><div>
    <Badge code={attempt.outcome} /> <Term code={attempt.channel} />{number && <> · {number}</>}
    <p>{attempt.reason}</p>
    <dl className="details compact">
      {answeredBy && <div><dt><Bi en="Answered by" bn="কল গ্রহণকারী" /></dt><dd>{bi(...answeredByLabel[answeredBy])}{attempt.answeredByNote && <> ({attempt.answeredByNote})</>}</dd></div>}
      {answeredBy === 'SOMEONE_ELSE' && <div><dt><Bi en="Case details disclosed" bn="মামলার সংবেদনশীল তথ্য প্রকাশ" /></dt><dd>{attempt.disclosedSensitive ? <Badge code="DISCLOSED" /> : yesNo(false)}</dd></div>}
      {answeredBy === 'APPLICANT' && typeof attempt.statusExplained === 'boolean' && <div><dt><Bi en="Status explained" bn="বর্তমান স্থিতি অবহিতকরণ" /></dt><dd>{yesNo(attempt.statusExplained)}</dd></div>}
      {attempt.nextAttemptAt && <div><dt><Bi en="Next attempt" bn="পরবর্তী যোগাযোগের নির্ধারিত সময়" /></dt><dd>{when(attempt.nextAttemptAt)}</dd></div>}
    </dl>
    <small>{when(attempt.createdAt)}</small>
  </div></li>
}

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

export default function RecordPage({ session }) {
  const { applicationId } = useParams()
  const officer = session.user.assignments.some(({ role }) => role === 'DLAO_OFFICER')
  const caseSupport = session.user.assignments.some(({ role }) => role === 'CASE_SUPPORT')
  const [data, setData] = useState(null)
  const [refresh, setRefresh] = useState(0)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)
  const [showEditModal, setShowEditModal] = useState(false)
  const [reviewState, setReviewState] = useState('READY_FOR_DECISION')
  const [reviewReason, setReviewReason] = useState('')
  const [priorityDecision, setPriorityDecision] = useState('URGENT')
  const [priorityReason, setPriorityReason] = useState('')
  const [takeoverReason, setTakeoverReason] = useState('')
  const [cancellationReviewReason, setCancellationReviewReason] = useState('')
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
  const [safeNumber, setSafeNumber] = useState('')
  const [safeNumberTime, setSafeNumberTime] = useState('')
  const [verifyingFactId, setVerifyingFactId] = useState(null)
  const [verifyAttemptId, setVerifyAttemptId] = useState('')
  const [verifyNote, setVerifyNote] = useState('')
  const [withdrawAttemptId, setWithdrawAttemptId] = useState('')
  const [withdrawStatement, setWithdrawStatement] = useState('')
  const [answeredByNote, setAnsweredByNote] = useState('')
  const [disclosed, setDisclosed] = useState('') // the officer's answer, never a default: 'NO' or 'YES'
  const [statusExplained, setStatusExplained] = useState('')
  const [nextAttemptAt, setNextAttemptAt] = useState('')
  const [contactFormOpen, setContactFormOpen] = useState(undefined)
  const [rejectReason, setRejectReason] = useState('')
  const [showRejectForm, setShowRejectForm] = useState(false)
  const [rejectionRecord, setRejectionRecord] = useState(() => {
    try { return JSON.parse(localStorage.getItem(`dlas_reject_${applicationId}`)) } catch { return null }
  })
  const [savedPathway, setActivePathway] = useState(() => {
    try { return localStorage.getItem(`dlas_pathway_${applicationId}`) || '' } catch { return '' }
  })
  const [resolvedThroughPathway, setResolvedThroughPathway] = useState(() => {
    try { return localStorage.getItem(`dlas_resolved_${applicationId}`) || '' } catch { return '' }
  })
  const [beneficiaryRequestsLawyer, setBeneficiaryRequestsLawyer] = useState(() => {
    try { return localStorage.getItem(`dlas_requests_lawyer_${applicationId}`) || '' } catch { return '' }
  })
  const [adviceTopic, setAdviceTopic] = useState('LEGAL_RIGHTS')
  const [adviceNotes, setAdviceNotes] = useState('')
  const [adviceResolved, setAdviceResolved] = useState(false)
  const [adviceRecords, setAdviceRecords] = useState(() => {
    try { return JSON.parse(localStorage.getItem(`dlas_advice_${applicationId}`)) || [] } catch { return [] }
  })
  const [closureOutcome, setClosureOutcome] = useState('COURT_JUDGMENT_FAVOUR')
  const [closureDate, setClosureDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [closureRef, setClosureRef] = useState('')
  const [closureNotes, setClosureNotes] = useState('')
  const [closureRecord, setClosureRecord] = useState(() => {
    try { return JSON.parse(localStorage.getItem(`dlas_closure_${applicationId}`)) } catch { return null }
  })

  useEffect(() => {
    let active = true
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
      if (!active) return
      setError('')
      setData({ record, tasks, documents, contacts, facts, audit, safeContact, transcript, history, referrals, evidenceAccess })
      setLoading(false)
    }).catch((failure) => {
      if (!active || controller.signal.aborted || failure.name === 'AbortError') return
      setError(failure.message)
      setLoading(false)
    })
    return () => {
      active = false
      controller.abort()
    }
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
    const result = await change(`/api/applications/${applicationId}/${override ? 'review-override' : 'review'}`, { reviewState, reason: reviewReason }, override ? bi('Override saved.', 'সংশোধিত সিদ্ধান্ত সংরক্ষিত হয়েছে।') : bi('Review saved.', 'প্রাথমিক যাচাই সংরক্ষিত হয়েছে।'))
    if (result) setReviewReason('')
  }

  async function takeResponsibility(event) {
    event.preventDefault()
    const result = await change(`/api/applications/${applicationId}/assigned-officer`, takeoverReason.trim() ? { reason: takeoverReason } : {}, bi('You are now the assigned officer. Restricted evidence is open to you.', 'আপনি এখন দায়িত্বপ্রাপ্ত কর্মকর্তা। সংরক্ষিত প্রমাণ আপনার জন্য খোলা।'))
    if (result) setTakeoverReason('')
  }

  async function submitAcceptance(event) {
    event.preventDefault()
    await change(`/api/applications/${applicationId}/accept`, {}, bi('Application accepted. Case ID created.', 'আবেদন সফলভাবে গৃহীত হয়েছে এবং মামলা নম্বর প্রদান করা হয়েছে।'))
  }

  async function submitPriority(event) {
    event.preventDefault()
    const result = await change(`/api/applications/${applicationId}/priority-override`, { priorityDecision, reason: priorityReason }, bi('Priority saved.', 'অগ্রাধিকারের সিদ্ধান্ত সংরক্ষিত হয়েছে।'))
    if (result) setPriorityReason('')
  }

  async function submitCancellationReview(event, decision) {
    event.preventDefault()
    const requestId = data.record.cancellationRequest.id
    const result = await change(
      `/api/applications/${applicationId}/cancellation-requests/${requestId}/review`,
      { decision, reason: cancellationReviewReason },
      decision === 'APPROVE'
        ? bi('Case cancelled. Dependent tasks and lawyer work were closed out.', 'মামলাটি বাতিল করা হয়েছে। সংশ্লিষ্ট কার্যতালিকা ও আইনজীবীর দায়িত্ব বন্ধ করা হয়েছে।')
        : bi('Cancellation request declined.', 'বাতিলের অনুরোধ প্রত্যাখ্যান করা হয়েছে।'),
    )
    if (result) setCancellationReviewReason('')
  }

  async function submitTask(event) {
    event.preventDefault()
    const result = await change(`/api/applications/${applicationId}/tasks`, { title: taskTitle, ownerRole: taskRole, nextAction: taskAction }, bi('Task added.', 'নতুন কার্যতালিকা/টাস্ক যুক্ত হয়েছে।'))
    if (result) { setTaskTitle(''); setTaskAction('') }
  }

  async function submitDocument(event) {
    event.preventDefault()
    const path = selectedDocument ? `/api/documents/${selectedDocument.id}/versions` : `/api/applications/${applicationId}/documents`
    const result = await change(path, { label: docLabel, qualityState: docQuality, ...(docNote ? { note: docNote } : {}), ...(!selectedDocument && docRestricted ? { sensitivity: 'RESTRICTED' } : {}) },
      selectedDocument ? bi('New version added.', 'নথির নতুন সংস্করণ যুক্ত করা হয়েছে।') : docRestricted ? bi('Restricted evidence recorded. Only you can open it.', 'সংবেদনশীল প্রমাণাদি সংরক্ষিত হয়েছে। কেবলমাত্র দায়িত্বপ্রাপ্ত কর্মকর্তা এটি দেখতে পারবেন।') : bi('Document added.', 'নথি সফলভাবে যুক্ত করা হয়েছে।'))
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

  // A new number becomes a new safe-contact version: the earlier plan stays on record, and phone calls are now allowed
  // (SMS stays as it was). The time is kept unless the officer gives a new one.
  async function submitSafeNumber(event) {
    event.preventDefault()
    const current = data.safeContact
    const result = await change(`/api/applications/${applicationId}/safe-contact`, {
      allowedChannels: [...new Set([...(current?.allowedChannels ?? []), 'PHONE'])],
      prohibitedChannels: (current?.prohibitedChannels ?? ['SMS']).filter((code) => code !== 'PHONE'),
      contactValue: safeNumber.trim(),
      ...((safeNumberTime.trim() || current?.safeTimeWindow) ? { safeTimeWindow: safeNumberTime.trim() || current.safeTimeWindow } : {}),
      smsSafe: Boolean(current?.smsSafe), neutralWordingRequired: current?.neutralWordingRequired ?? true,
    }, bi('Safe number saved.', 'নিরাপদ নম্বর সংরক্ষিত হয়েছে।'))
    if (result) { setSafeNumber(''); setSafeNumberTime('') }
  }

  // Verified only on a call where the applicant herself was reached; undo only what was verified this way.
  async function submitFactVerification(event, fact) {
    event.preventDefault()
    const verified = !fact.applicantConfirmed
    const result = await change(`/api/applications/${applicationId}/facts/${fact._id}/verification`,
      { verified, ...(verified ? { contactAttemptId: verifyAttemptId } : {}), note: verifyNote },
      verified ? bi('Fact marked verified.', 'তথ্য যাচাইকৃত হিসেবে চিহ্নিত হয়েছে।') : bi('Verification undone.', 'তথ্য যাচাই বাতিল করা হয়েছে।'))
    if (result) { setVerifyingFactId(null); setVerifyAttemptId(''); setVerifyNote('') }
  }

  async function submitWithdrawal(event) {
    event.preventDefault()
    const result = await change(`/api/applications/${applicationId}/withdrawal`, { contactAttemptId: withdrawAttemptId, statement: withdrawStatement },
      bi('Withdrawal recorded. The record is closed.', 'প্রত্যাহার নথিভুক্ত হয়েছে। নথিটি বন্ধ করা হয়েছে।'))
    if (result) { setWithdrawAttemptId(''); setWithdrawStatement('') }
  }

  async function submitContact(event) {
    event.preventDefault()
    const someoneElse = contactOutcome === 'UNKNOWN_PERSON'
    const retry = someoneElse || contactOutcome === 'NO_ANSWER'
    const result = await change(`/api/applications/${applicationId}/contact-attempts`, {
      channel: contactChannel, outcome: contactOutcome, reason: contactReason,
      ...(someoneElse ? { disclosedSensitive: disclosed === 'YES', ...(answeredByNote.trim() ? { answeredByNote: answeredByNote.trim() } : {}) } : {}),
      ...(contactOutcome === 'APPLICANT_REACHED' ? { statusExplained: statusExplained === 'YES' } : {}),
      ...(retry && nextAttemptAt ? { nextAttemptAt: new Date(nextAttemptAt).toISOString() } : {}),
    }, someoneElse && disclosed === 'YES'
      ? bi('Attempt logged. A task to review the disclosure was created.', 'যোগাযোগের চেষ্টা নথিভুক্ত হয়েছে। তথ্য প্রকাশের ঝুঁকি পর্যালোচনার জন্য একটি টাস্ক তৈরি করা হয়েছে।')
      : retry ? bi('Attempt logged. The next attempt is on the task list.', 'যোগাযোগের চেষ্টা নথিভুক্ত হয়েছে। পরবর্তী যোগাযোগের সময়সীমা কার্য তালিকায় যুক্ত হয়েছে।')
        : bi('Contact attempt logged. Nothing was sent.', 'যোগাযোগের তথ্য সফলভাবে নথিভুক্ত হয়েছে।'))
    if (result) {
      setContactReason('')
      setAnsweredByNote('')
      setDisclosed('')
      setStatusExplained('')
      setNextAttemptAt('')
      setContactFormOpen(undefined)
    }
  }

  // A simulated call where someone else answers: the form opens with the neutral words to say, and the officer then
  // states whether anything was disclosed and plans the next attempt. Nothing is logged on their behalf.
  function simulateUnknownAnswer() {
    setContactChannel('PHONE')
    setContactOutcome('UNKNOWN_PERSON')
    setContactReason('Simulated call to the safe number: an unknown person answered.')
    setDisclosed('')
    setContactFormOpen(true)
    requestAnimationFrame(() => document.getElementById('contact-answered-by')?.focus())
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
    try { localStorage.setItem(`dlas_reject_${applicationId}`, JSON.stringify(recordData)) } catch { /* Storage may be unavailable. */ }
    setRejectionRecord(recordData)
    setShowRejectForm(false)
    setNotice(bi('Application rejected. Formal rejection notice and appeal guidance communicated to applicant as per DBLA procedure.', 'আবেদনটি নামঞ্জুর করা হয়েছে। বিধি মোতাবেক আবেদনকারীকে কারণ ও আপিলের নিয়ম জানানো হয়েছে।'))
  }

  function handleSavePathway(pathway) {
    setActivePathway(pathway)
    try { localStorage.setItem(`dlas_pathway_${applicationId}`, pathway) } catch { /* Storage may be unavailable. */ }
    setNotice(bi(`Active service pathway set to: ${pathway === 'ADVICE' ? 'Advice (Legal guidance)' : pathway === 'MEDIATION' ? 'Mediation (In-person / ODR)' : 'Direct Legal Aid / Litigation'}`, `সক্রিয় সেবার মাধ্যম নির্ধারণ করা হয়েছে।`))
  }

  function handleSetResolved(value) {
    setResolvedThroughPathway(value)
    try { localStorage.setItem(`dlas_resolved_${applicationId}`, value) } catch { /* Storage may be unavailable. */ }
  }

  function handleSetRequestsLawyer(value) {
    setBeneficiaryRequestsLawyer(value)
    try { localStorage.setItem(`dlas_requests_lawyer_${applicationId}`, value) } catch { /* Storage may be unavailable. */ }
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
    try { localStorage.setItem(`dlas_advice_${applicationId}`, JSON.stringify(updated)) } catch { /* Storage may be unavailable. */ }
    setAdviceNotes('')
    if (adviceResolved) {
      handleSetResolved('YES')
    }
    setNotice(bi(adviceResolved ? 'Legal advice provided and recorded. Issue marked resolved.' : 'Legal advice session recorded in case file.', adviceResolved ? 'আইনি পরামর্শ প্রদান সম্পন্ন হয়েছে এবং সমস্যাটি নিষ্পত্তি হিসেবে চিহ্নিত করা হয়েছে।' : 'আইনি পরামর্শ প্রদানের বিবরণী নথিভুক্ত করা হয়েছে।'))
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
    try { localStorage.setItem(`dlas_closure_${applicationId}`, JSON.stringify(outcomeData)) } catch { /* Storage may be unavailable. */ }
    handleSetResolved('YES')
    setNotice(bi('Outcome recorded and case officially marked closed in records.', 'মামলার চূড়ান্ত নিষ্পত্তি ও নথি সমাপ্তি নথিভুক্ত হয়েছে।'))
  }

  const record = data?.record
  // A pathway chosen on this device wins; otherwise open the one already started on the shared record.
  const activePathway = savedPathway || serverPathway(data?.audit?.events)
  const canManageIncidents = session.user.assignments.some(({ role, officeCode }) => role === 'DLAO_OFFICER' && officeCode === record?.officeCode)
  const canReadDuplicateSuggestions = session.user.assignments.some(({ role, officeCode }) => ['DLAO_OFFICER', 'CASE_SUPPORT'].includes(role) && officeCode === record?.officeCode)
  const canReviewDuplicates = session.user.assignments.some(({ role, officeCode }) => role === 'DLAO_OFFICER' && officeCode === record?.officeCode)
  const ready = !loading && record?.applicationId === applicationId
  const openTasks = data?.tasks.filter(({ status }) => status === 'OPEN').length ?? 0
  const events = officer ? data?.audit?.events : data?.history.events
  const integrity = officer ? data?.audit?.valid : data?.history.valid
  // Only the newest revision of each fact can change, and only a call that reached the applicant herself can verify it.
  const latestFactIds = new Set(Object.values((data?.facts ?? []).reduce((latest, fact) => {
    if (!latest[fact.field] || latest[fact.field].revision < fact.revision) latest[fact.field] = fact
    return latest
  }, {})).map(({ _id }) => _id))
  const applicantCalls = (data?.contacts ?? []).filter(({ outcome }) => outcome === 'APPLICANT_REACHED')

  return (
    <section aria-labelledby="record-title">
      <Link to="/">← <Bi en="Workspace" bn="মূল ড্যাশবোর্ড" /></Link>
      <div className="record-head">
        <div>
          <p className="eyebrow"><Bi en="Application" bn="আইনি সহায়তা আবেদন" /></p>
          <h1 id="record-title">{applicationId}</h1>
          {ready && <p className="record-sub">{tr(record.applicantName)} · <Term code={record.channel} /></p>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {ready && officer && (
            <button
              type="button"
              className="secondary-button"
              style={{ fontSize: '0.85rem', padding: '0.45rem 0.85rem' }}
              onClick={() => setShowEditModal(true)}
            >
              <Bi en="Edit Case Info" bn="মামলার তথ্য সংশোধন" />
            </button>
          )}
          {ready && <Badge code={record.withdrawal ? 'WITHDRAWN' : record.status} />}
        </div>
      </div>
      {showEditModal && (
        <EditCaseModal
          record={record}
          token={session.token}
          onClose={() => setShowEditModal(false)}
          onUpdated={(msg) => { setNotice(msg); setRefresh((r) => r + 1) }}
        />
      )}
      {error && <p role="alert" className="error">{error}</p>}
      {notice && <p role="status" className="success">{notice}</p>}
      {loading && <p role="status">{bi('Loading…', 'লোড হচ্ছে…')}</p>}
      {ready && <>
        <div style={{ marginBottom: '1.25rem' }}>
          <PhaseTracker application={record} pathway={activePathway} caseRecord={closureRecord} />
        </div>
        <p className="safety-note next-step"><strong><Bi en="Next step" bn="পরবর্তী ধাপ" /></strong> {tr(record.nextTask?.nextAction) || bi('No open task', 'কোনো অনিষ্পন্ন কাজ নেই')}{record.nextTask && <small> · <Term code={record.nextTask.ownerRole} /></small>}</p>

        {rejectionRecord && (
          <div className="escalation-box" role="alert" style={{ margin: '1rem 0', borderColor: '#d9534f', background: '#fff5f5' }}>
            <h3 style={{ color: '#c9302c', marginTop: 0 }}><Bi en="Application Not Approved (Rejected)" bn="আবেদন নামঞ্জুর / প্রত্যাখ্যাত" /></h3>
            <p><strong><Bi en="Rejection Reason:" bn="নামঞ্জুরের কারণ:" /></strong> {rejectionRecord.reason}</p>
            <p><small><Bi en="Rejected by:" bn="দায়িত্বপ্রাপ্ত কর্মকর্তা:" /> {rejectionRecord.officer} · {when(rejectionRecord.rejectionDate)}</small></p>
            <div style={{ marginTop: '0.75rem', padding: '0.65rem 0.85rem', background: '#fff', border: '1px solid #ebccd1', borderRadius: '4px' }}>
              <strong><Bi en="Statutory Right to Appeal:" bn="বিধিবদ্ধ আপিলের অধিকার:" /></strong>
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
              <div><dt><Bi en="Review" bn="প্রাথমিক যাচাই" /></dt><dd><Term code={record.reviewState} /></dd></div>
              <div><dt><Bi en="Priority" bn="অগ্রাধিকার" /></dt><dd>{record.priorityDecision ? <Term code={record.priorityDecision} /> : bi('Not set', 'নির্ধারিত নয়')}</dd></div>
              <div><dt><Bi en="Case ID" bn="মামলা নম্বর" /></dt><dd>{record.caseId || bi('After acceptance', 'আবেদন গ্রহণের পর')}</dd></div>
              <div><dt><Bi en="Identity" bn="পরিচয় যাচাই" /></dt><dd><Term code={record.identityStatus} /></dd></div>
              <div>
                <dt><Bi en="Safe contact phone" bn="নিরাপদ ফোন নম্বর" /></dt>
                <dd>
                  {(record.safeContactPhone || data.safeContact?.contactValue) ? (
                    <span className="safe-phone-highlight">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                      </svg>
                      {record.safeContactPhone || data.safeContact?.contactValue}
                    </span>
                  ) : (
                    <span className="muted" style={{ fontStyle: 'italic', fontSize: '0.88rem' }}>
                      <Bi en="Not provided on call / Not recorded" bn="কলে নম্বর দেওয়া হয়নি / নথিতে নেই" />
                    </span>
                  )}
                </dd>
              </div>
              {record.representation && <div className="wide"><dt><Bi en="Representative (not the Badi)" bn="প্রতিনিধি (বাদী নন)" /></dt><dd>{record.representation.representativeName} · {record.representation.relationship} · <Bi en="authority" bn="প্রতিনিধিত্বের ক্ষমতা" /> <Term code={record.representation.authorityStatus} /></dd></div>}
              {record.complaintSummary && (
                <div className="wide">
                  <dt><Bi en="Application / Incident Description" bn="আবেদন / ঘটনার বিবরণ" /></dt>
                  <dd style={{ background: '#fcfbf9', border: '1px solid #eaeaea', borderRadius: '6px', padding: '0.65rem 0.85rem', lineHeight: '1.5' }}>
                    {record.complaintSummary}
                  </dd>
                </div>
              )}
              {record.incident && (record.incident.what || record.incident.when || record.incident.where || record.incident.who) && (
                <div className="wide">
                  <dt><Bi en="Incident Details" bn="ঘটনার বিস্তারিত তথ্য" /></dt>
                  <dd>
                    <dl className="details compact" style={{ background: '#faf9f6', padding: '0.5rem 0.75rem', borderRadius: '6px' }}>
                      {record.incident.what && <div><dt><Bi en="What happened" bn="কী ঘটেছে" /></dt><dd>{record.incident.what}</dd></div>}
                      {record.incident.when && <div><dt><Bi en="When" bn="কখন" /></dt><dd>{record.incident.when}</dd></div>}
                      {record.incident.where && <div><dt><Bi en="Where" bn="কোথায়" /></dt><dd>{record.incident.where}</dd></div>}
                      {record.incident.who && <div><dt><Bi en="Who involved" bn="জড়িত ব্যক্তি" /></dt><dd>{record.incident.who}</dd></div>}
                    </dl>
                  </dd>
                </div>
              )}
              {record.vulnerability?.length > 0 && <div className="wide"><dt><Bi en="Weigh first" bn="অগ্রাধিকার বিবেচনা (ঝুঁকি)" /></dt><dd>{record.vulnerability.map(say).join(' · ')}</dd></div>}
              {record.category && <div><dt><Bi en="Type of matter (applicant chose)" bn="বিষয়ের ধরন (আবেদনকারী নির্বাচিত)" /></dt><dd><Term code={record.category} /></dd></div>}
              <div className="wide"><dt><Bi en="Assigned officer" bn="দায়িত্বপ্রাপ্ত কর্মকর্তা" /></dt><dd>
                {record.assignedOfficer?.name ?? bi('Not assigned yet', 'এখনো নির্ধারিত হয়নি')}
                {officer && String(record.assignedOfficer?.id) !== String(session.user.id) && <form onSubmit={takeResponsibility} className="form-stack inline-form">
                  {record.assignedOfficer && <><label htmlFor="takeover-reason"><Bi en="Why are you taking over?" bn="কেন দায়িত্ব নিচ্ছেন?" /></label><input id="takeover-reason" value={takeoverReason} onChange={(event) => setTakeoverReason(event.target.value)} minLength="5" maxLength="500" required /></>}
                  <button type="submit" className="secondary-button"><Bi en="Take responsibility for this case" bn="এই মামলার দায়িত্ব নিন" /></button>
                </form>}
                {record.vulnerability?.includes('RESTRICTED_CATEGORY') && <p className="muted"><Bi en="Evidence is restricted: only the assigned officer and an officer it is referred to can open it." bn="প্রমাণ সংরক্ষিত: শুধু দায়িত্বপ্রাপ্ত কর্মকর্তা ও যাঁর কাছে রেফার করা হয়েছে তিনি খুলতে পারবেন।" /></p>}
              </dd></div>
              {record.complaintType && <div><dt><Bi en="Complaint type (AI suggestion)" bn="অভিযোগের ধরন (এআই প্রস্তাবিত)" /></dt><dd><Term code={record.complaintType} /></dd></div>}
              {record.legalNeed && <div className="wide"><dt><Bi en="Legal need (AI suggestion)" bn="আইনি প্রতিকার (এআই প্রস্তাবিত)" /></dt><dd lang="bn">{record.legalNeed}</dd></div>}
            </dl>
          </section>
          {officer && <section className="card safety-card" aria-labelledby="safe-title">
            <h2 id="safe-title"><Bi en="Safe contact" bn="নিরাপদ যোগাযোগের নিয়মাবলী" /></h2>
            {!data.safeContact && !record.safeContactPhone ? <p><Bi en="No safe route recorded. Do not contact or share details." bn="নিরাপদ যোগাযোগের কোনো নির্দিষ্ট মাধ্যম নথিতে সংরক্ষিত নেই। নিশ্চিত না হয়ে যোগাযোগ বা মামলার তথ্য প্রকাশ করবেন না।" /></p> : <dl className="details compact">
              <div style={{ background: '#ffffff', padding: '0.45rem 0.65rem', borderRadius: '4px', border: '1px solid #d4c494' }}>
                <dt><Bi en="Safe number and time" bn="নিরাপদ ফোন নম্বর ও সময়" /></dt>
                <dd>
                  {(data.safeContact?.contactValue || record.safeContactPhone) ? (
                    <strong style={{ fontSize: '1.05rem', letterSpacing: '0.04em', color: '#1f4523' }}>
                      {data.safeContact?.contactValue || record.safeContactPhone}
                    </strong>
                  ) : (
                    <span className="muted" style={{ fontStyle: 'italic', fontSize: '0.9rem' }}>
                      <Bi en="No number" bn="নম্বর নেই" />
                    </span>
                  )}
                  {' · '}{data.safeContact?.safeTimeWindow || bi('Any time, with care', 'আবেদনকারীর সুবিধাজনক সময়')}
                </dd>
              </div>
              {data.safeContact?.trustedContactName && <div><dt><Bi en="Trusted contact name" bn="বিশ্বস্ত ব্যক্তির নাম" /></dt><dd>{data.safeContact.trustedContactName}</dd></div>}
              {data.safeContact?.safeCallReason && <div><dt><Bi en="Safety context" bn="নিরাপত্তা সতর্কতা" /></dt><dd className="warn-text">{data.safeContact.safeCallReason}</dd></div>}
              <div><dt><Bi en="Use" bn="অনুমোদিত মাধ্যম" /></dt><dd>{data.safeContact?.allowedChannels?.map(say).join(', ') || bi('PHONE', 'ফোন')}</dd></div>
              <div><dt><Bi en="Never use" bn="নিষিদ্ধ মাধ্যম" /></dt><dd>{data.safeContact?.prohibitedChannels?.map(say).join(', ') || none()}</dd></div>
              <div><dt><Bi en="If someone else answers" bn="অন্য ব্যক্তি কল রিসিভ করলে করণীয়" /></dt><dd><Term code={data.safeContact?.unknownAnswerAction || 'DISCLOSE_NOTHING'} /></dd></div>
            </dl>}
            <AddForm en="Record a new safe number" bn="নতুন নিরাপদ নম্বর যুক্ত করুন">
              <form onSubmit={submitSafeNumber} className="form-stack inline-form">
                <label htmlFor="safe-number"><Bi en="Number" bn="ফোন নম্বর" /></label>
                <input id="safe-number" type="tel" inputMode="tel" autoComplete="off" value={safeNumber} onChange={(event) => setSafeNumber(event.target.value)} minLength="3" maxLength="100" required />
                <label htmlFor="safe-number-time"><Bi en="Safe time" bn="যোগাযোগের উপযুক্ত সময়" /></label>
                <input id="safe-number-time" value={safeNumberTime} onChange={(event) => setSafeNumberTime(event.target.value)} placeholder={data.safeContact?.safeTimeWindow || ''} maxLength="100" />
                <button type="submit" className="secondary-button"><Bi en="Save number" bn="নম্বর সংরক্ষণ করুন" /></button>
              </form>
            </AddForm>
            {(data.safeContact?.allowedChannels?.includes('PHONE') || record.safeContactPhone) && <button type="button" className="secondary-button" onClick={simulateUnknownAnswer}><Bi en="Simulate call: unknown person answers" bn="মহড়া: অপরিচিত ব্যক্তি কল রিসিভ করলে" /></button>}
          </section>}
        </div>

        <PartiesCard
          record={record}
          token={session.token}
          officer={officer}
          onUpdated={() => setRefresh((r) => r + 1)}
        />

        <div className="card panels">
          {officer && <Panel id="priority-title" en="Priority" bn="অগ্রাধিকার নির্ধারণ" hint={record.priorityDecision ? say(record.priorityDecision) : record.urgencyReasons.length ? bi('Flagged, decide', 'জরুরি চিহ্নিত, সিদ্ধান্ত দিন') : bi('Not set', 'নির্ধারিত নয়')} open={record.urgencyReasons.length > 0 && !record.priorityDecision}>
            <p className="muted"><Bi en="The system flags. You decide." bn="সিস্টেম সম্ভাব্য ঝুঁকি চিহ্নিত করে; চূড়ান্ত সিদ্ধান্ত কর্মকর্তার এখতিয়ার।" /></p>
            {record.urgencyReasons.length ? <><h3><Bi en="Why flagged" bn="জরুরি হিসেবে চিহ্নিত করার কারণ" /></h3><ul>{record.urgencyReasons.map((reason) => <li key={reason}>{tr(reason)}</li>)}</ul></> : <p><Bi en="No urgency signs recorded." bn="জরুরি পরিস্থিতির কোনো ইঙ্গিত নথিতে নেই।" /></p>}
            <form onSubmit={submitPriority} className="form-stack inline-form">
              <label htmlFor="priority-decision"><Bi en="Priority decision" bn="অগ্রাধিকারের সিদ্ধান্ত" /></label>
              <select id="priority-decision" value={priorityDecision} onChange={(event) => setPriorityDecision(event.target.value)}>
                <option value="URGENT">{say('URGENT')}</option>
                <option value="ROUTINE">{say('ROUTINE')}</option>
              </select>
              <label htmlFor="priority-reason"><Bi en="Reason" bn="সিদ্ধান্তের যৌক্তিক কারণ" /></label>
              <textarea id="priority-reason" value={priorityReason} onChange={(event) => setPriorityReason(event.target.value)} minLength="10" maxLength="1000" required />
              <button type="submit"><Bi en="Save priority" bn="অগ্রাধিকার সংরক্ষণ করুন" /></button>
            </form>
          </Panel>}

          {officer && record.cancellationRequest && <Panel id="cancellation-title" en="Case Cancellation Request" bn="মামলা বাতিলের অনুরোধ" hint={bi('Awaiting decision', 'সিদ্ধান্তের অপেক্ষায়')} open>
            <p className="muted"><Bi en="The applicant requested cancellation of this accepted case. Approving closes out open tasks, the active lawyer assignment, and any pending lawyer update. This is blocked while a referral or mediation is actively in progress." bn="আবেদনকারী এই গৃহীত মামলাটি বাতিলের অনুরোধ করেছেন। অনুমোদন করলে অনিষ্পন্ন কার্যতালিকা, সক্রিয় আইনজীবী নিয়োগ, এবং অনিষ্পন্ন আইনজীবী আপডেট বন্ধ হয়ে যাবে। সক্রিয় রেফারেল বা মধ্যস্থতা চলমান থাকলে এটি অনুমোদন করা যাবে না।" /></p>
            <p><strong><Bi en="Applicant's reason:" bn="আবেদনকারীর কারণ:" /></strong> {tr(record.cancellationRequest.reason)}</p>
            <form className="form-stack">
              <label htmlFor="cancellation-review-reason"><Bi en="Officer decision reason" bn="কর্মকর্তার সিদ্ধান্তের কারণ" /></label>
              <textarea id="cancellation-review-reason" value={cancellationReviewReason} onChange={(event) => setCancellationReviewReason(event.target.value)} minLength="10" maxLength="1000" required />
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button type="button" onClick={(event) => submitCancellationReview(event, 'APPROVE')} disabled={!cancellationReviewReason.trim()} style={{ background: '#c9302c', borderColor: '#ac2925', color: '#fff' }}>
                  <Bi en="Approve cancellation" bn="বাতিল অনুমোদন করুন" />
                </button>
                <button type="button" className="secondary-button" onClick={(event) => submitCancellationReview(event, 'DECLINE')} disabled={!cancellationReviewReason.trim()}>
                  <Bi en="Decline" bn="প্রত্যাখ্যান করুন" />
                </button>
              </div>
            </form>
          </Panel>}

          {officer && record.status === 'SUBMITTED' && <Panel id="decision-title" en="Decision" bn="আবেদন গ্রহণ সংক্রান্ত সিদ্ধান্ত" hint={say(record.reviewState)} open>
            <p className="muted" style={{ margin: '0 0 1rem 0' }}>
              <Bi en="1. Review, then 2. accept. Review is not proof of identity." bn="১. প্রথমে তথ্য যাচাই, তারপর ২. আবেদন গ্রহণ। পর্যালোচনা পরিচয়ের চূড়ান্ত প্রমাণ নয়।" />
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))', gap: '1.5rem' }}>
              {/* Column 1: 1. Review */}
              <form onSubmit={submitReview} className="form-stack">
                <h3><Bi en="1. Review" bn="১. প্রাথমিক যাচাই" /></h3>
                <label htmlFor="review-state"><Bi en="Review outcome" bn="যাচাইয়ের ফলাফল" /></label>
                <select id="review-state" value={reviewState} onChange={(event) => setReviewState(event.target.value)}>
                  <option value="READY_FOR_DECISION">{say('READY_FOR_DECISION')}</option>
                  <option value="NEEDS_INFORMATION">{say('NEEDS_INFORMATION')}</option>
                  {record.reviewState !== 'PENDING_REVIEW' && <option value="PENDING_REVIEW">{bi('Back to pending review', 'পুনরায় যাচাই তালিকায় প্রেরণ')}</option>}
                </select>
                <label htmlFor="review-reason"><Bi en="Reason" bn="যাচাইয়ের পর্যবেক্ষণ ও কারণ" /></label>
                <textarea id="review-reason" value={reviewReason} onChange={(event) => setReviewReason(event.target.value)} minLength="10" maxLength="1000" placeholder="Review findings..." required />
                <button type="submit">{reviewState === 'PENDING_REVIEW' || record.reviewState === 'READY_FOR_DECISION' ? <Bi en="Record override" bn="সংশোধিত সিদ্ধান্ত সংরক্ষণ করুন" /> : <Bi en="Record review" bn="যাচাই ফলাফল সংরক্ষণ করুন" />}</button>
              </form>

              {/* Column 2: 2. Accept */}
              <div className="form-stack">
                <h3><Bi en="2. Accept" bn="২. আবেদন গ্রহণ" /></h3>
                {!showRejectForm ? (
                  <form onSubmit={submitAcceptance} className="form-stack">
                    <button type="submit" disabled={record.reviewState !== 'READY_FOR_DECISION'}>
                      <Bi en="Accept application" bn="আবেদন গ্রহণ করুন" />
                    </button>
                    {record.reviewState !== 'READY_FOR_DECISION' && (
                      <small className="muted" style={{ display: 'block', marginTop: '0.25rem' }}>
                        <Bi en="Step 1 review must be set to 'Ready for decision' before accepting." bn="আবেদন গ্রহণের পূর্বে ধাপ ১-এ 'সিদ্ধান্তের জন্য প্রস্তুত' হিসেবে চিহ্নিত করতে হবে।" />
                      </small>
                    )}
                    <button type="button" className="secondary-button" onClick={() => setShowRejectForm(true)} style={{ marginTop: '0.75rem', color: '#c9302c', borderColor: '#e0b4b4' }}>
                      <Bi en="Ineligible? Reject application" bn="অসচ্ছলতার শর্ত পূরণ না হলে: আবেদন নামঞ্জুর করুন" />
                    </button>
                  </form>
                ) : (
                  <form onSubmit={handleRejection} className="form-stack">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <label htmlFor="reject-reason"><strong><Bi en="Rejection Reason (Required)" bn="নামঞ্জুরের সুনির্দিষ্ট কারণ (বাধ্যতামূলক)" /></strong></label>
                      <button type="button" className="secondary-button" onClick={() => setShowRejectForm(false)} style={{ fontSize: '0.8rem', padding: '0.2rem 0.5rem' }}>
                        <Bi en="Back to Accept" bn="আবেদন গ্রহণ ফর্মে ফেরত" />
                      </button>
                    </div>
                    <textarea id="reject-reason" value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} minLength="10" maxLength="1000" placeholder="Specify why the applicant does not qualify per DBLA criteria..." required />
                    <p className="muted" style={{ fontSize: '0.8rem', margin: '0.2rem 0' }}>
                      <Bi en="Applicant will be notified of statutory appeal right to District Legal Aid Committee." bn="আবেদনকারীকে জেলা লিগ্যাল এইড কমিটিতে আপিলের বিধি মোতাবেক তথ্য জানানো হবে।" />
                    </p>
                    <button type="submit" style={{ background: '#c9302c', borderColor: '#ac2925', color: '#fff' }}>
                      <Bi en="Confirm Rejection & Close Application" bn="নামঞ্জুর নিশ্চিত করুন ও আবেদন সমাপ্ত করুন" />
                    </button>
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
                  <h3 id="jurisdiction-title" style={{ margin: '0.3rem 0 0 0' }}><Bi en="Appropriate Jurisdiction Confirmed" bn="আইনি অধিক্ষেত্র ও এখতিয়ার নিশ্চিতকরণ" /></h3>
                  <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.88rem', color: '#555' }}>
                    <Bi en="This District Legal Aid Office holds territorial and subject-matter jurisdiction to handle this case." bn="এই জেলা লিগ্যাল এইড অফিস এই মামলার ভৌগোলিক ও বিষয়ভিত্তিক আইনি এখতিয়ার ধারণ করে।" />
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
              
              <div style={{ marginBottom: '1rem' }}>
                <h3 style={{ margin: '0 0 0.3rem 0', fontSize: '1.05rem', fontWeight: 600 }}>
                  <Bi en="Determine appropriate service pathway" bn="উপযুক্ত সেবার মাধ্যম নির্ধারণ করুন" />
                </h3>
                <p className="muted" style={{ margin: 0, fontSize: '0.88rem' }}>
                  <Bi en="Choose one pathway: Advice, Mediation, or Direct Legal Aid / Litigation." bn="একটি মাধ্যম নির্বাচন করুন: পরামর্শ, মধ্যস্থতা, অথবা সরাসরি আইনি সহায়তা / মামলা।" />
                </p>
              </div>

              {/* 3 Pathway Cards (Single choice) */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => handleSavePathway('ADVICE')}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleSavePathway('ADVICE') }}
                  style={{
                    cursor: 'pointer',
                    padding: '1.1rem',
                    border: activePathway === 'ADVICE' ? '2px solid #1f6c9f' : '1px solid #e3e2dc',
                    borderRadius: '8px',
                    background: activePathway === 'ADVICE' ? '#e1f3fe' : '#ffffff',
                    transition: 'all 0.15s ease-in-out',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong style={{ fontSize: '0.98rem', color: activePathway === 'ADVICE' ? '#1f6c9f' : '#111' }}>
                      <Bi en="Advice" bn="আইনি পরামর্শ" />
                    </strong>
                    {activePathway === 'ADVICE' && <Badge code="ACTIVE" />}
                  </div>
                  <div style={{ fontSize: '0.84rem', color: '#666', marginTop: '0.2rem' }}>
                    <Bi en="(Legal guidance)" bn="(সরাসরি আইনি দিকনির্দেশনা)" />
                  </div>
                  <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.82rem', color: '#555', lineHeight: 1.4 }}>
                    <Bi en="Direct legal guidance, rights counseling, and statutory remedies provided by DLAO." bn="ডিএলএও কর্তৃক সরাসরি আইনি পরামর্শ, অধিকার সচেতনতা ও প্রতিকার সংক্রান্ত দিকনির্দেশনা।" />
                  </p>
                </div>

                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => handleSavePathway('MEDIATION')}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleSavePathway('MEDIATION') }}
                  style={{
                    cursor: 'pointer',
                    padding: '1.1rem',
                    border: activePathway === 'MEDIATION' ? '2px solid #5a3e7a' : '1px solid #e3e2dc',
                    borderRadius: '8px',
                    background: activePathway === 'MEDIATION' ? '#f5effb' : '#ffffff',
                    transition: 'all 0.15s ease-in-out',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong style={{ fontSize: '0.98rem', color: activePathway === 'MEDIATION' ? '#5a3e7a' : '#111' }}>
                      <Bi en="Mediation" bn="মধ্যস্থতা" />
                    </strong>
                    {activePathway === 'MEDIATION' && <Badge code="ACTIVE" />}
                  </div>
                  <div style={{ fontSize: '0.84rem', color: '#666', marginTop: '0.2rem' }}>
                    <Bi en="(In-person / ODR)" bn="(সরাসরি / অনলাইন ওডিআর)" />
                  </div>
                  <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.82rem', color: '#555', lineHeight: 1.4 }}>
                    <Bi en="Alternative dispute resolution via pre-trial in-person ADR or Online Dispute Resolution sessions." bn="বিকল্প বিরোধ নিষ্পত্তি: প্রাক-বিচার সরাসরি মধ্যস্থতা বা অনলাইন ওডিআর বৈঠক।" />
                  </p>
                </div>

                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => handleSavePathway('PANEL_LAWYER')}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleSavePathway('PANEL_LAWYER') }}
                  style={{
                    cursor: 'pointer',
                    padding: '1.1rem',
                    border: activePathway === 'PANEL_LAWYER' ? '2px solid #28562d' : '1px solid #e3e2dc',
                    borderRadius: '8px',
                    background: activePathway === 'PANEL_LAWYER' ? '#edf3ec' : '#ffffff',
                    transition: 'all 0.15s ease-in-out',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong style={{ fontSize: '0.98rem', color: activePathway === 'PANEL_LAWYER' ? '#28562d' : '#111' }}>
                      <Bi en="Direct Legal Aid / Litigation" bn="সরাসরি আইনি সহায়তা / মামলা" />
                    </strong>
                    {activePathway === 'PANEL_LAWYER' && <Badge code="ACTIVE" />}
                  </div>
                  <div style={{ fontSize: '0.84rem', color: '#666', marginTop: '0.2rem' }}>
                    <Bi en="(Where applicable)" bn="(যেখানে প্রযোজ্য)" />
                  </div>
                  <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.82rem', color: '#555', lineHeight: 1.4 }}>
                    <Bi en="Court litigation representation via appointed state-funded panel lawyer." bn="আদালতে মোকদ্দমা পরিচালনা ও আইনি প্রতিনিধিত্বের জন্য রাষ্ট্রীয় খরচে প্যানেল আইনজীবী নিয়োগ।" />
                  </p>
                </div>
              </div>

              {/* Provide service container */}
              <div style={{ background: '#fdfbf7', border: '1px solid #ece4d0', borderRadius: '8px', padding: '1.1rem 1.25rem', marginBottom: '1.5rem' }}>
                <div style={{ borderBottom: '1px solid #ece4d0', paddingBottom: '0.6rem', marginBottom: '1rem' }}>
                  <h4 style={{ margin: '0 0 0.2rem 0', fontSize: '1rem', color: '#222' }}>
                    <Bi en="Provide service" bn="সেবা প্রদান ও কার্যক্রম পরিচালনা" />
                  </h4>
                  <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
                    <Bi en="(Record all activities, documents and communications)" bn="(সকল কার্যক্রম, নথি ও যোগাযোগের বিবরণ লিপিবদ্ধ করুন)" />
                  </p>
                </div>

                {activePathway === 'ADVICE' && (
                  <div>
                    <form onSubmit={handleAddAdvice} className="form-stack inline-form">
                      <label htmlFor="advice-topic"><Bi en="Advice Category" bn="পরামর্শের ক্ষেত্র" /></label>
                      <select id="advice-topic" value={adviceTopic} onChange={(e) => setAdviceTopic(e.target.value)}>
                        <option value="FAMILY_RIGHTS">{bi('Family & Maintenance Rights', 'পারিবারিক ও ভরণপোষণ অধিকার')}</option>
                        <option value="LAND_DISPUTE">{bi('Land & Property Rights', 'জমিজমা ও সম্পত্তি সংক্রান্ত')}</option>
                        <option value="LABOUR_WAGES">{bi('Labour & Wage Protection', 'শ্রমিক ও মজুরি সুরক্ষা')}</option>
                        <option value="CRIMINAL_DEFENSE">{bi('Criminal Defense & Bail', 'ফৌজদারি প্রতিকার ও জামিন')}</option>
                        <option value="CIVIL_REMEDY">{bi('General Civil Remedies', 'সাধারণ দেওয়ানি প্রতিকার')}</option>
                      </select>
                      <label htmlFor="advice-notes"><Bi en="Legal Advice Given (Activities, guidance & documents provided)" bn="প্রদত্ত আইনি পরামর্শ (কার্যক্রম, পরামর্শ ও প্রদত্ত তথ্যাদি)" /></label>
                      <textarea id="advice-notes" value={adviceNotes} onChange={(e) => setAdviceNotes(e.target.value)} minLength="10" maxLength="1000" placeholder="Summarize legal advice given to citizen, applicable laws, documents examined, and recommended actions..." required />
                      <label className="checkbox-label" htmlFor="advice-resolved" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <input id="advice-resolved" type="checkbox" checked={adviceResolved} onChange={(e) => setAdviceResolved(e.target.checked)} />
                        <Bi en="Issue resolved through this advice? (Citizen confirmed no further action needed)" bn="এই পরামর্শের মাধ্যমে কি আইনি সমাধান হয়েছে? (নাগরিক নিশ্চিত করেছেন যে পরবর্তী আর কোনো পদক্ষেপের প্রয়োজন নেই)" />
                      </label>
                      <button type="submit" className="secondary-button"><Bi en="Log Advice & Service Activities" bn="পরামর্শ ও কার্যক্রম সংরক্ষণ করুন" /></button>
                    </form>

                    {adviceRecords.length > 0 && (
                      <div className="version-history" style={{ marginTop: '1.25rem' }}>
                        <h5><Bi en="Logged Advice & Activity Records" bn="সংরক্ষিত পরামর্শ ও কার্যক্রমের ইতিহাস" /></h5>
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

                {activePathway === 'MEDIATION' && (
                  <div>
                    <MediationPanel applicationId={applicationId} session={session} role="DLAO_OFFICER" />
                  </div>
                )}

                {activePathway === 'PANEL_LAWYER' && (
                  <div style={{ padding: '0.85rem 1rem', background: '#edf3ec', border: '1px solid #b7dab9', borderRadius: '6px', fontSize: '0.9rem', color: '#28562d' }}>
                    <strong><Bi en="Direct Legal Aid / Litigation Pathway Active" bn="সরাসরি আইনি সহায়তা / মামলা মাধ্যম সক্রিয়" /></strong>
                    <p style={{ margin: '0.3rem 0 0 0' }}>
                      <Bi en="Proceed to Phase 5 below: Financial eligibility means-test will be performed, followed by panel lawyer allocation and court case processing." bn="নিম্নে ধাপ ৫ অনুসরণ করুন: ডিবিএলএ নীতিমালা অনুযায়ী আর্থিক অসচ্ছলতা যাচাইপূর্বক প্যানেল আইনজীবী নিয়োগ ও আদালতের মোকদ্দমা পরিচালিত হবে।" />
                    </p>
                  </div>
                )}
              </div>

              {/* Decision Branch: Issue resolved through advice / mediation? */}
              {(activePathway === 'ADVICE' || activePathway === 'MEDIATION') && (
                <div style={{ margin: '1.5rem 0', padding: '1.25rem', border: '2px solid #4a5568', borderRadius: '8px', background: '#ffffff' }}>
                  <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
                    <div style={{ display: 'inline-block', padding: '0.2rem 0.6rem', background: '#f0f2f5', borderRadius: '4px', fontSize: '0.78rem', fontWeight: 600, color: '#4a5568', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.4rem' }}>
                      <Bi en="Decision Point" bn="কার্যক্রম পর্যালোচনা ও পরবর্তী সিদ্ধান্ত" />
                    </div>
                    <h4 style={{ margin: 0, fontSize: '1.08rem', color: '#1a202c' }}>
                      <Bi en="Issue resolved through advice / mediation?" bn="পরামর্শ বা মধ্যস্থতার মাধ্যমে কি সমস্যার সমাধান হয়েছে?" />
                    </h4>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      onClick={() => handleSetResolved('YES')}
                      style={{
                        minWidth: '160px',
                        padding: '0.65rem 1.25rem',
                        fontSize: '0.92rem',
                        fontWeight: 600,
                        background: resolvedThroughPathway === 'YES' ? '#28562d' : '#f7f6f3',
                        color: resolvedThroughPathway === 'YES' ? '#ffffff' : '#28562d',
                        border: '2px solid #28562d',
                        borderRadius: '6px',
                        cursor: 'pointer',
                      }}
                    >
                      ✓ <Bi en="Yes: Resolved" bn="হ্যাঁ: সমাধান হয়েছে" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSetResolved('NO')}
                      style={{
                        minWidth: '160px',
                        padding: '0.65rem 1.25rem',
                        fontSize: '0.92rem',
                        fontWeight: 600,
                        background: resolvedThroughPathway === 'NO' ? '#a94442' : '#f7f6f3',
                        color: resolvedThroughPathway === 'NO' ? '#ffffff' : '#a94442',
                        border: '2px solid #a94442',
                        borderRadius: '6px',
                        cursor: 'pointer',
                      }}
                    >
                      ✕ <Bi en="No: Not Resolved" bn="না: সমাধান হয়নি" />
                    </button>
                  </div>

                  {/* BRANCH YES: Record outcome */}
                  {resolvedThroughPathway === 'YES' && (
                    <div style={{ marginTop: '1.25rem', padding: '1.1rem', border: '1px solid #b7dab9', borderRadius: '6px', background: '#edf5ee' }}>
                      <h4 style={{ margin: '0 0 0.3rem 0', color: '#28562d' }}>
                        ✓ <Bi en="Record outcome (Settlement / Dismissal / Resolved)" bn="ফলাফল লিপিবদ্ধ করুন (আপস নিষ্পত্তি / সমাধান / খারিজ)" />
                      </h4>
                      <p style={{ margin: '0 0 0.85rem 0', fontSize: '0.85rem', color: '#4a5568' }}>
                        <Bi en="Record the formal resolution in records to complete case processing." bn="নথিতে আনুষ্ঠানিক নিষ্পত্তি লিপিবদ্ধ করে মামলা সমাপ্ত করুন।" />
                      </p>

                      {closureRecord ? (
                        <div style={{ background: '#ffffff', padding: '0.85rem 1rem', border: '1px solid #b7dab9', borderRadius: '6px' }}>
                          <strong><Bi en="Outcome Recorded & Case Closed in Records:" bn="নিষ্পত্তির বিবরণ লিপিবদ্ধ এবং নথিতে মামলা সমাপ্ত:" /></strong>
                          <dl className="details compact" style={{ marginTop: '0.5rem' }}>
                            <div><dt><Bi en="Outcome" bn="ফলাফল" /></dt><dd><Term code={closureRecord.outcome} /></dd></div>
                            <div><dt><Bi en="Disposal Date" bn="নিষ্পত্তির তারিখ" /></dt><dd>{closureRecord.date}</dd></div>
                            <div><dt><Bi en="Reference" bn="স্মারক নম্বর" /></dt><dd>{closureRecord.referenceNo || bi('Not recorded', 'নেই')}</dd></div>
                            <div><dt><Bi en="Summary Notes" bn="সংক্ষিপ্ত বিবরণ" /></dt><dd>{closureRecord.notes || bi('Standard resolution', 'নিয়মমাফিক নিষ্পত্তি')}</dd></div>
                            <div><dt><Bi en="Closed by" bn="সমাপ্ত করেছেন" /></dt><dd>{closureRecord.closedBy} · {when(closureRecord.closedAt)}</dd></div>
                          </dl>
                        </div>
                      ) : (
                        <form onSubmit={handleSaveClosure} className="form-stack inline-form" style={{ background: '#ffffff', padding: '1rem', borderRadius: '6px', border: '1px solid #d4e7d5' }}>
                          <label htmlFor="outcome-select"><Bi en="Outcome Type" bn="ফলাফলের ধরন" /></label>
                          <select id="outcome-select" value={closureOutcome} onChange={(e) => setClosureOutcome(e.target.value)}>
                            <option value="ADR_SETTLEMENT">{bi('Settlement (আপস নিষ্পত্তি)', 'আপস নিষ্পত্তি')}</option>
                            <option value="RESOLVED">{bi('Resolved through Advice / Guidance (আইনি পরামর্শে সমাধান)', 'আইনি পরামর্শে সমাধান')}</option>
                            <option value="COURT_JUDGMENT_DISMISSED">{bi('Dismissal / Rejected (খারিজ)', 'মামলা খারিজ')}</option>
                            <option value="WITHDRAWN">{bi('Withdrawn by Citizen (আবেদন প্রত্যাহার)', 'আবেদন প্রত্যাহার')}</option>
                          </select>

                          <label htmlFor="outcome-date"><Bi en="Date of Resolution" bn="নিষ্পত্তির তারিখ" /></label>
                          <input id="outcome-date" type="date" value={closureDate} onChange={(e) => setClosureDate(e.target.value)} required />

                          <label htmlFor="outcome-ref"><Bi en="Deed / Settlement / Order Ref No. (Optional)" bn="আপসপত্র / স্মারক নম্বর (ঐচ্ছিক)" /></label>
                          <input id="outcome-ref" value={closureRef} onChange={(e) => setClosureRef(e.target.value)} placeholder="e.g. ADR Deed 2026/04 or Legal Advice File #88" />

                          <label htmlFor="outcome-notes"><Bi en="Outcome Summary & Notes" bn="ফলাফলের সারসংক্ষেপ" /></label>
                          <textarea id="outcome-notes" value={closureNotes} onChange={(e) => setClosureNotes(e.target.value)} minLength="10" maxLength="1000" placeholder="Describe the terms of settlement, advice outcomes, or resolution details..." required />

                          <button type="submit" style={{ background: '#28562d', borderColor: '#1f4523', color: '#ffffff' }}>
                            <Bi en="Save Outcome & Close Case" bn="নিষ্পত্তির বিবরণ সংরক্ষণ করুন ও মামলা সমাপ্ত করুন" />
                          </button>
                        </form>
                      )}
                    </div>
                  )}

                  {/* BRANCH NO: Beneficiary requests Panel Lawyer? */}
                  {resolvedThroughPathway === 'NO' && (
                    <div style={{ marginTop: '1.25rem', padding: '1.1rem', border: '1px solid #e2ded5', borderRadius: '6px', background: '#faf9f6' }}>
                      <div style={{ marginBottom: '0.85rem' }}>
                        <h4 style={{ margin: '0 0 0.3rem 0', color: '#111', fontSize: '1.02rem' }}>
                          <Bi en="Beneficiary requests Panel Lawyer?" bn="সুবিধাভোগী কি প্যানেল আইনজীবী নিয়োগ চান?" />
                        </h4>
                        <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
                          <Bi en="The dispute was not resolved through advice or mediation. Inquire whether the applicant wishes to pursue court litigation through a panel lawyer." bn="পরামর্শ বা মধ্যস্থতায় বিরোধ নিষ্পত্তি হয়নি। আবেদনকারী প্যানেল আইনজীবীর মাধ্যমে আদালতে মামলা পরিচালনা করতে চান কিনা তা নিশ্চিত করুন।" />
                        </p>
                      </div>

                      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          onClick={() => handleSetRequestsLawyer('NO')}
                          style={{
                            padding: '0.6rem 1.1rem',
                            fontWeight: 600,
                            fontSize: '0.88rem',
                            background: beneficiaryRequestsLawyer === 'NO' ? '#c9302c' : '#ffffff',
                            color: beneficiaryRequestsLawyer === 'NO' ? '#ffffff' : '#c9302c',
                            border: '1.5px solid #c9302c',
                            borderRadius: '5px',
                            cursor: 'pointer',
                          }}
                        >
                          ✕ <Bi en="No: Beneficiary does not want lawyer" bn="না: সুবিধাভোগী প্যানেল আইনজীবী চান না" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSetRequestsLawyer('YES')}
                          style={{
                            padding: '0.6rem 1.1rem',
                            fontWeight: 600,
                            fontSize: '0.88rem',
                            background: beneficiaryRequestsLawyer === 'YES' ? '#1f6c9f' : '#ffffff',
                            color: beneficiaryRequestsLawyer === 'YES' ? '#ffffff' : '#1f6c9f',
                            border: '1.5px solid #1f6c9f',
                            borderRadius: '5px',
                            cursor: 'pointer',
                          }}
                        >
                          ✓ <Bi en="Yes: Beneficiary requests Panel Lawyer" bn="হ্যাঁ: সুবিধাভোগী প্যানেল আইনজীবী নিয়োগ চান" />
                        </button>
                      </div>

                      {/* If NO -> Continue other applicable pathway (e.g. referral, close) */}
                      {beneficiaryRequestsLawyer === 'NO' && (
                        <div style={{ marginTop: '1rem', padding: '1rem', border: '1px solid #d9534f', borderRadius: '6px', background: '#fff5f5' }}>
                          <h5 style={{ margin: '0 0 0.35rem 0', color: '#c9302c', fontSize: '0.95rem' }}>
                            <Bi en="Continue other applicable pathway (e.g., referral, close)" bn="অন্যান্য প্রযোজ্য পদক্ষেপ গ্রহণ (যেমন: আন্তঃঅফিস রেফারেল বা নথি সমাপ্তি)" />
                          </h5>
                          <p style={{ margin: '0 0 0.75rem 0', fontSize: '0.85rem', color: '#555' }}>
                            <Bi en="Beneficiary does not seek court litigation. You may refer this case to an external agency / legal aid clinic or proceed to formal closure." bn="আবেদনকারী আদালতে মামলা দায়ের করতে চান না। মামলাটি অন্য কোনো সংস্থায় রেফার করুন অথবা আনুষ্ঠানিকভাবে সমাপ্ত করুন।" />
                          </p>
                          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                            <a href="#referrals-title" className="secondary-button" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
                              <Bi en="Open Referral Process" bn="রেফারেল প্যানেল খুলুন" />
                            </a>
                            <a href="#closure-panel-title" className="secondary-button" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
                              <Bi en="Close Case Without Litigation" bn="মামলা সমাপ্তি ফর্মে যান" />
                            </a>
                          </div>
                        </div>
                      )}

                      {/* If YES -> Leads to Phase 5 */}
                      {beneficiaryRequestsLawyer === 'YES' && (
                        <div style={{ marginTop: '1rem', padding: '0.85rem 1rem', border: '1px solid #b7dab9', borderRadius: '6px', background: '#edf5ee', color: '#28562d', fontSize: '0.88rem' }}>
                          <strong>✓ <Bi en="Beneficiary requested Panel Lawyer litigation." bn="সুবিধাভোগী প্যানেল আইনজীবী নিয়োগের অনুরোধ জানিয়েছেন।" /></strong>
                          <p style={{ margin: '0.25rem 0 0 0' }}>
                            <Bi en="Proceed to Phase 5 below: Perform financial status means-check, then allocate and assign an approved panel advocate." bn="নিম্নে ধাপ ৫ অনুসরণ করুন: ডিবিএলএ নীতিমালা অনুযায়ী আর্থিক অসচ্ছলতা যাচাইপূর্বক উপযুক্ত প্যানেল আইনজীবী নিয়োগ দিন।" />
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </Panel>
          )}

          {/* Phase 5: Panel Lawyer Process (If Required) */}
          {officer && record.status === 'ACCEPTED' && (activePathway === 'PANEL_LAWYER' || beneficiaryRequestsLawyer === 'YES' || data?.tasks?.some(t => t.title?.includes('LAWYER'))) && (
            <LawyerManagement
              applicationId={applicationId}
              token={session.token}
              onChanged={() => setRefresh((value) => value + 1)}
            />
          )}

          {officer && record.status === 'ACCEPTED' && !(activePathway === 'PANEL_LAWYER' || beneficiaryRequestsLawyer === 'YES' || data?.tasks?.some(t => t.title?.includes('LAWYER'))) && (
            <div style={{ margin: '0.5rem 0 1rem 0', textAlign: 'right' }}>
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  handleSavePathway('PANEL_LAWYER')
                }}
                style={{ fontSize: '0.85rem' }}
              >
                <Bi en="Open Phase 5: Panel Lawyer Process →" bn="ধাপ ৫: প্যানেল আইনজীবী প্রক্রিয়া খুলুন →" />
              </button>
            </div>
          )}

          {officer && record.status === 'ACCEPTED' && (
            <Panel id="closure-panel-title" en="Phase 6: Case Outcome & Closure (Court / DLAO / Finance)" bn="ধাপ ৬: মামলার চূড়ান্ত নিষ্পত্তি ও সমাপ্তি" hint={closureRecord ? bi('Closed in Records', 'নথি সমাপ্ত') : bi('Active Case', 'চলমান মামলা')}>
              <p className="muted"><Bi en="Record final legal outcome, verify completion reports, complete payment disbursement to panel lawyer, and formally close the case in records." bn="মামলার চূড়ান্ত রায় বা আপস নিষ্পত্তি লিপিবদ্ধ করুন, আইনজীবীর সমাপ্তি প্রতিবেদন ও ফি বিল অনুমোদন নিশ্চিত করুন এবং মামলাটি আনুষ্ঠানিকভাবে সমাপ্ত করুন।" /></p>

              {closureRecord ? (
                <div className="success" style={{ margin: '1rem 0' }}>
                  <h3><Bi en="Case Formally Closed in Records" bn="মামলাটি আনুষ্ঠানিকভাবে সমাপ্ত হিসেবে নথিভুক্ত" /></h3>
                  <dl className="details compact" style={{ marginTop: '0.5rem' }}>
                    <div><dt><Bi en="Outcome" bn="ফলাফল" /></dt><dd><Term code={closureRecord.outcome} /></dd></div>
                    <div><dt><Bi en="Disposal Date" bn="নিষ্পত্তির তারিখ" /></dt><dd>{closureRecord.date}</dd></div>
                    <div><dt><Bi en="Order / Decree Ref" bn="আদেশ / ডিক্রি নম্বর" /></dt><dd>{closureRecord.referenceNo || bi('Not recorded', 'নেই')}</dd></div>
                    <div><dt><Bi en="Notes / Summary" bn="সংক্ষিপ্ত বিবরণ" /></dt><dd>{closureRecord.notes || bi('Standard closure', 'নিয়মমাফিক সমাপ্তি')}</dd></div>
                    <div><dt><Bi en="Closed by" bn="সমাপ্ত করেছেন" /></dt><dd>{closureRecord.closedBy} · {when(closureRecord.closedAt)}</dd></div>
                  </dl>
                  <p style={{ marginTop: '0.75rem', fontSize: '0.85rem', color: '#28562d' }}>
                    ✓ <Bi en="All documents preserved for future reporting and audit trail complete." bn="ভবিষ্যৎ প্রতিবেদন ও আইনি পর্যালোচনার জন্য সকল নথিপত্র সংরক্ষিত এবং অডিট ট্রেইল সম্পূর্ণ।" />
                  </p>
                </div>
              ) : (
                <form onSubmit={handleSaveClosure} className="form-stack inline-form" style={{ marginTop: '0.75rem' }}>
                  <label htmlFor="closure-outcome"><Bi en="Legal Outcome (Court Decision / Settlement / Dismissal)" bn="আইনি নিষ্পত্তি (আদালতের রায় / আপস নিষ্পত্তি / খারিজ)" /></label>
                  <select id="closure-outcome" value={closureOutcome} onChange={(e) => setClosureOutcome(e.target.value)}>
                    <option value="COURT_JUDGMENT_FAVOUR">{bi('Court Judgment in Favour (পক্ষে রায়)', 'সুবিধাভোগীর পক্ষে রায়')}</option>
                    <option value="COURT_JUDGMENT_DISMISSED">{bi('Case Dismissed / Decreed (খারিজ / ডিক্রি)', 'মামলা খারিজ / ডিক্রি')}</option>
                    <option value="ADR_SETTLEMENT">{bi('Mediation / ADR Settlement Agreement (আপস নিষ্পত্তি)', 'সালিশে আপস নিষ্পত্তি')}</option>
                    <option value="WITHDRAWN">{bi('Withdrawn by Applicant (প্রত্যাহার)', 'আবেদনকারী কর্তৃক প্রত্যাহার')}</option>
                    <option value="DISPOSED_OTHER">{bi('Disposed on Merits / Other (অন্যান্য নিষ্পত্তিকৃত)', 'অন্যান্য কারণে নিষ্পত্তি')}</option>
                  </select>

                  <label htmlFor="closure-date"><Bi en="Date of Disposal / Resolution" bn="নিষ্পত্তির তারিখ" /></label>
                  <input id="closure-date" type="date" value={closureDate} onChange={(e) => setClosureDate(e.target.value)} required />

                  <label htmlFor="closure-ref"><Bi en="Judgment / Decree / Settlement Ref No." bn="রায় / ডিক্রি / আপসপত্র স্মারক নম্বর" /></label>
                  <input id="closure-ref" value={closureRef} onChange={(e) => setClosureRef(e.target.value)} placeholder="e.g. Decree No. 14/2026 or ADR Deed 2026/08" />

                  <label htmlFor="closure-notes"><Bi en="Final Disposal Summary & Closure Notes" bn="চূড়ান্ত নিষ্পত্তি ও সমাপ্তির সারসংক্ষেপ" /></label>
                  <textarea id="closure-notes" value={closureNotes} onChange={(e) => setClosureNotes(e.target.value)} minLength="10" maxLength="1000" placeholder="Detail the outcome, key findings, and closure confirmation..." required />

                  <button type="submit" style={{ background: '#28562d', borderColor: '#1f4523', color: '#fff' }}>
                    <Bi en="Record Outcome & Formally Close Case" bn="নিষ্পত্তির বিবরণ সংরক্ষণ করুন ও মামলা সমাপ্ত করুন" />
                  </button>
                </form>
              )}
            </Panel>
          )}

          <Panel id="tasks-title" en="Tasks" bn="কার্যতালিকা / টাস্ক" hint={openTasks ? bi(`${openTasks} open`, `${num(openTasks)}টি অনিষ্পন্ন`) : bi('All done', 'সব সম্পন্ন')} open>
            {data.tasks.length === 0 && <p className="muted">{none()}</p>}
            <ul className="plain-list">{data.tasks.map((task) => <li key={task._id}><div><strong><Term code={task.title} /></strong> <Badge code={task.status} /><p>{tr(task.nextAction)}</p><small><Term code={task.ownerRole} />{task.dueAt && <> · <Bi en="Due" bn="সময়সীমা" /> {when(task.dueAt)}</>}{task.status === 'OPEN' && task.dueAt && overdueText(task.dueAt) && <> · <strong>{overdueText(task.dueAt)}</strong></>}</small></div>{task.kind === 'MANUAL' && task.status === 'OPEN' && <button type="button" className="secondary-button" onClick={() => change(`/api/applications/${applicationId}/tasks/${task._id}/complete`, undefined, bi('Task completed.', 'কাজ সম্পন্ন হয়েছে।'))}><Bi en="Complete" bn="সম্পন্ন করুন" /></button>}</li>)}</ul>
            <AddForm en="Add task" bn="নতুন কাজ যুক্ত করুন">
              <form onSubmit={submitTask} className="form-stack inline-form">
                <label htmlFor="task-title"><Bi en="Task title" bn="কাজের শিরোনাম" /></label><input id="task-title" value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} minLength="3" maxLength="120" required />
                <label htmlFor="task-owner"><Bi en="Owner" bn="দায়িত্বপ্রাপ্ত ভূমিকা" /></label><select id="task-owner" value={taskRole} onChange={(event) => setTaskRole(event.target.value)}>{['DLAO_OFFICER', 'CASE_SUPPORT', 'MEDIATOR', 'RECEIVING_DLAO'].map((role) => <option key={role} value={role}>{say(role)}</option>)}</select>
                <label htmlFor="task-action"><Bi en="Next action" bn="প্রত্যাশিত করণীয়" /></label><input id="task-action" value={taskAction} onChange={(event) => setTaskAction(event.target.value)} minLength="5" maxLength="300" required />
                <button type="submit" className="secondary-button"><Bi en="Add task" bn="কাজ যোগ করুন" /></button>
              </form>
            </AddForm>
          </Panel>



          {record.assistance && <Panel id="assistance-title" en="Assisted intake" bn="সহায়তাকৃত আবেদন" hint={say(record.assistance.caseType)}>
            <dl className="details compact">
              <div><dt><Bi en="Helper" bn="সহায়তাকারী" /></dt><dd>{record.assistance.helperName}</dd></div>
              <div><dt><Bi en="Translator" bn="অনুবাদক" /></dt><dd>{record.assistance.translatorName}</dd></div>
              <div><dt><Bi en="Typist" bn="টাইপিস্ট" /></dt><dd>{record.assistance.typistName}</dd></div>
              <div><dt><Bi en="Original language" bn="মূল ভাষা" /></dt><dd>{record.assistance.originalLanguage}</dd></div>
              <div><dt><Bi en="Case type" bn="মামলার ধরন" /></dt><dd><Term code={record.assistance.caseType} /></dd></div>
              <div><dt><Bi en="Consent (oral)" bn="সম্মতি (মৌখিকভাবে গৃহীত)" /></dt><dd><Term code={record.assistance.consentState} /></dd></div>
              <div><dt><Bi en="Statement confirmed" bn="মূল বক্তব্য নিশ্চিতকৃত" /></dt><dd>{yesNo(record.assistance.originalConfirmed)}</dd></div>
              <div><dt><Bi en="Translation confirmed" bn="অনুবাদ নিশ্চিতকৃত" /></dt><dd>{yesNo(record.assistance.translationConfirmed)}</dd></div>
            </dl>
            <p className="muted"><Bi en="Original and translation are kept apart. The helper's phone is not the applicant's." bn="আবেদনকারীর মূল বক্তব্য ও অনুবাদ আলাদা রাখা হয়েছে। সহায়তাকারীর ফোন নম্বর আবেদনকারীর যোগাযোগ নম্বর হিসেবে ব্যবহার করবেন না।" /></p>
          </Panel>}

          {officer && record.status === 'ACCEPTED' && <TriagePanel applicationId={applicationId} token={session.token} />}

          <Panel id="docs-title" en="Documents" bn="নথিপত্র ও প্রমাণাদি" hint={data.documents.length ? bi(`${data.documents.length} on file`, `${num(data.documents.length)}টি সংরক্ষিত`) : none()}>
            {data.documents.length === 0 && <p className="muted">{none()}</p>}
            <ul className="plain-list">{data.documents.map((document) => <li key={document.id}><div><strong>{document.label}</strong>{document.sensitivity === 'RESTRICTED' && <> <Badge code="RESTRICTED" /></>}<p className="muted">{document.redacted ? <Bi en="No access. Opening is refused and logged." bn="আপনার এই নথি দেখার অনুমতি নেই। প্রতিটি অ্যাক্সেস প্রচেষ্টা অডিট লগে নথিভুক্ত হবে।" /> : <><Bi en="Version" bn="সংস্করণ" /> {num(document.currentVersion)}</>}</p></div>{!document.redacted && <button type="button" className="secondary-button" onClick={() => selectDocument(document)} aria-label={bi(`Versions of ${document.label}`, `${document.label}-এর সংস্করণ`)}><Bi en="Versions" bn="সংস্করণ" /></button>}</li>)}</ul>
            {selectedDocument && <div className="version-history"><h3><Bi en="Versions" bn="সংস্করণ" />: {selectedDocument.label}</h3><ol>{versions.map((version) => <li key={version.version}>{version.label} · <Term code={version.qualityState} />{version.note ? ` · ${version.note}` : ''}</li>)}</ol></div>}
            {officer && <AddForm en={selectedDocument ? 'Add a version' : 'Add document'} bn={selectedDocument ? 'নতুন সংস্করণ সংযুক্ত করুন' : 'নতুন নথি সংযুক্ত করুন'}>
              <form onSubmit={submitDocument} className="form-stack inline-form">
                {selectedDocument && <button type="button" className="text-button" onClick={() => { setSelectedDocument(null); setVersions([]); setDocLabel('') }}><Bi en="New document instead" bn="পৃথক নতুন নথি সংযুক্ত করুন" /></button>}
                <label htmlFor="doc-label"><Bi en="Label" bn="নথির শিরোনাম / বিবরণ" /></label><input id="doc-label" value={docLabel} onChange={(event) => setDocLabel(event.target.value)} minLength="3" maxLength="160" required />
                <label htmlFor="doc-quality"><Bi en="Quality" bn="নথির দৃশ্যমানতা ও মান" /></label><select id="doc-quality" value={docQuality} onChange={(event) => setDocQuality(event.target.value)}>{['PENDING_REVIEW', 'READABLE', 'UNREADABLE'].map((code) => <option key={code} value={code}>{say(code)}</option>)}</select>
                <label htmlFor="doc-note"><Bi en="Note (optional)" bn="নোট বা মন্তব্য (ঐচ্ছিক)" /></label><textarea id="doc-note" value={docNote} onChange={(event) => setDocNote(event.target.value)} maxLength="500" />
                {!selectedDocument && <label className="checkbox-label" htmlFor="doc-restricted"><input id="doc-restricted" type="checkbox" checked={docRestricted} onChange={(event) => setDocRestricted(event.target.checked)} /><Bi en="Highly sensitive evidence: only me and people I authorise" bn="অত্যন্ত সংবেদনশীল প্রমাণাদি: কেবলমাত্র দায়িত্বপ্রাপ্ত কর্মকর্তা ও ক্ষমতাপ্রাপ্ত ব্যক্তিবর্গ দেখতে পারবেন" /></label>}
                <button type="submit" className="secondary-button">{selectedDocument ? <Bi en="Add version" bn="সংস্করণ সংরক্ষণ করুন" /> : <Bi en="Add document" bn="নথি সংরক্ষণ করুন" />}</button>
              </form>
            </AddForm>}
            {officer && data.evidenceAccess.length > 0 && <div className="version-history"><h3><Bi en="Restricted access log" bn="সংবেদনশীল নথির অ্যাক্সেস লগ" /></h3><ol>{data.evidenceAccess.map((entry) => <li key={entry.id}><Badge code={entry.outcome} /> {entry.user} · {entry.document} · {when(entry.createdAt)}</li>)}</ol></div>}
          </Panel>

          {(officer || caseSupport) && data.record.assistance && <DocumentReview applicationId={applicationId} caseType={record.assistance.caseType} documents={data.documents} token={session.token} readOnly={!officer} onChanged={() => setRefresh((value) => value + 1)} />}

          {record.withdrawal && <p className="safety-note"><strong><Bi en="Withdrawn by the applicant:" bn="আবেদনকারী নিজে প্রত্যাহার করেছেন:" /></strong> {tr(record.withdrawal.statement)} <small>· {when(record.withdrawal.recordedAt)}</small></p>}
          {officer && record.status !== 'CANCELLED' && <Panel id="withdrawal-title" en="Applicant withdrawal" bn="আবেদনকারীর প্রত্যাহার" hint={bi('Only on her own word', 'শুধু আবেদনকারীর নিজের কথায়')}>
            <p className="muted"><Bi en="Record only what the applicant herself said on a logged call. A representative cannot withdraw for her." bn="কেবল লগ করা কলে আবেদনকারী নিজে যা বলেছেন তা লিপিবদ্ধ করুন। প্রতিনিধি তাঁর পক্ষে প্রত্যাহার করতে পারেন না।" /></p>
            {applicantCalls.length === 0 ? <p className="warn-text"><Bi en="First log a call where the applicant herself was reached." bn="প্রথমে এমন একটি কল লিপিবদ্ধ করুন যেখানে আবেদনকারী নিজে কথা বলেছেন।" /></p> : <form onSubmit={submitWithdrawal} className="form-stack">
              <label htmlFor="withdraw-call"><Bi en="Call where she withdrew" bn="যে কলে তিনি প্রত্যাহার করেছেন" /></label>
              <select id="withdraw-call" value={withdrawAttemptId} onChange={(event) => setWithdrawAttemptId(event.target.value)} required>
                <option value="">{bi('Choose a call', 'কল নির্বাচন করুন')}</option>
                {applicantCalls.map((attempt) => <option key={attempt._id} value={attempt._id}>{when(attempt.createdAt)} · {attempt.reason.slice(0, 60)}</option>)}
              </select>
              <label htmlFor="withdraw-statement"><Bi en="Her reason, in her words" bn="তাঁর নিজের ভাষায় কারণ" /></label>
              <textarea id="withdraw-statement" value={withdrawStatement} onChange={(event) => setWithdrawStatement(event.target.value)} minLength="10" maxLength="1000" required />
              <button type="submit" style={{ background: '#c9302c', borderColor: '#ac2925', color: '#fff' }}><Bi en="Record withdrawal and close" bn="প্রত্যাহার নথিভুক্ত করে বন্ধ করুন" /></button>
            </form>}
          </Panel>}

          <Panel id="contact-title" en="Contact log" bn="যোগাযোগের বিবরণী ও লগ" open={Boolean(contactFormOpen)} hint={data.contacts.length ? bi(`${data.contacts.length} attempts`, `${num(data.contacts.length)}টি যোগাযোগ লগ`) : none()}>
            <p className="muted"><Bi en="A log only. Nothing is sent from here." bn="এখানে কেবলমাত্র যোগাযোগের প্রচেষ্টা নথিভুক্ত করা হয়; কোনো স্বয়ংক্রিয় বার্তা প্রেরিত হয় না।" /></p>
            {data.contacts.length === 0 && <p>{none()}</p>}
            <ul className="plain-list">{data.contacts.map((attempt) => <ContactAttemptItem key={attempt._id} attempt={attempt} safeContact={officer ? data.safeContact : null} />)}</ul>
            {officer && <AddForm en="Log attempt" bn="যোগাযোগের তথ্য লিপিবদ্ধ করুন" open={contactFormOpen}>
              <form onSubmit={submitContact} className="form-stack inline-form">
                <label htmlFor="contact-channel"><Bi en="Channel" bn="যোগাযোগের মাধ্যম" /></label><select id="contact-channel" value={contactChannel} onChange={(event) => setContactChannel(event.target.value)}>{['PHONE', 'SMS', 'WEB', 'IN_PERSON'].map((code) => <option key={code} value={code}>{say(code)}</option>)}</select>
                <label htmlFor="contact-outcome"><Bi en="Outcome" bn="যোগাযোগের ফলাফল" /></label><select id="contact-outcome" value={contactOutcome} onChange={(event) => setContactOutcome(event.target.value)}>{['BLOCKED_UNSAFE', 'NO_ANSWER', 'UNKNOWN_PERSON', 'APPLICANT_REACHED'].map((code) => <option key={code} value={code}>{say(code)}</option>)}</select>
                {contactOutcome === 'UNKNOWN_PERSON' && <>
                  {data.safeContact?.neutralScript && <figure className="script-box" aria-label={bi('Neutral script', 'নিরপেক্ষ বাক্য')}><figcaption><Bi en="Say only this:" bn="শুধু এটুকু বলুন:" /></figcaption><blockquote>{tr(data.safeContact.neutralScript)}</blockquote></figure>}
                  <label htmlFor="contact-answered-by"><Bi en="Who answered (optional, e.g. shop owner)" bn="কে কল গ্রহণ করেছেন (ঐচ্ছিক, যেমন: স্থানীয় ব্যবসায়ী / প্রতিবেশী)" /></label>
                  <input id="contact-answered-by" value={answeredByNote} onChange={(event) => setAnsweredByNote(event.target.value)} minLength="2" maxLength="80" autoComplete="off" />
                  <fieldset className="choice-group"><legend><Bi en="Was anything about the case disclosed to them?" bn="তাঁর কাছে কি মামলার কোনো সংবেদনশীল তথ্য প্রকাশ করা হয়েছে?" /></legend>
                    <label><input type="radio" name="contact-disclosed" value="NO" checked={disclosed === 'NO'} onChange={() => setDisclosed('NO')} required /> <Bi en="No, nothing" bn="না, কোনো তথ্য প্রকাশ করা হয়নি" /></label>
                    <label><input type="radio" name="contact-disclosed" value="YES" checked={disclosed === 'YES'} onChange={() => setDisclosed('YES')} /> <Bi en="Yes, something was disclosed" bn="হ্যাঁ, তথ্য প্রকাশ করা হয়েছে" /></label>
                  </fieldset>
                </>}
                {contactOutcome === 'APPLICANT_REACHED' && <fieldset className="choice-group"><legend><Bi en="Was the status explained?" bn="আবেদনকারীকে বর্তমান স্থিতি জানানো হয়েছে কি?" /></legend>
                  <label><input type="radio" name="contact-explained" value="YES" checked={statusExplained === 'YES'} onChange={() => setStatusExplained('YES')} required /> <Bi en="Yes" bn="হ্যাঁ" /></label>
                  <label><input type="radio" name="contact-explained" value="NO" checked={statusExplained === 'NO'} onChange={() => setStatusExplained('NO')} /> <Bi en="No" bn="না" /></label>
                </fieldset>}
                {(contactOutcome === 'UNKNOWN_PERSON' || contactOutcome === 'NO_ANSWER') && <>
                  <label htmlFor="contact-next"><Bi en="Next attempt" bn="পরবর্তী যোগাযোগের নির্ধারিত সময়" /></label>
                  <input id="contact-next" type="datetime-local" value={nextAttemptAt} min={localNow()} onChange={(event) => setNextAttemptAt(event.target.value)} aria-describedby="contact-next-hint" required />
                  <small id="contact-next-hint"><Bi en="Safe time:" bn="যোগাযোগের উপযুক্ত সময়:" /> {data.safeContact?.safeTimeWindow || bi('Not recorded', 'নথিতে উল্লেখ নেই')}</small>
                </>}
                <label htmlFor="contact-reason"><Bi en="What happened" bn="কী কথা হয়েছে / সারসংক্ষেপ" /></label><textarea id="contact-reason" value={contactReason} onChange={(event) => setContactReason(event.target.value)} minLength="5" maxLength="500" required />
                <button type="submit" className="secondary-button"><Bi en="Log attempt" bn="চেষ্টা লিপিবদ্ধ করুন" /></button>
              </form>
            </AddForm>}
          </Panel>

          {officer && <ReferralPanel applicationId={applicationId} officeCode={record.officeCode} accepted={record.status === 'ACCEPTED'} referrals={data.referrals} documents={data.documents} token={session.token} change={change} />}
          {(officer || caseSupport) && record.status === 'ACCEPTED' && <RelatedIncidentPanel applicationId={applicationId} token={session.token} canManage={canManageIncidents} />}
          {canReadDuplicateSuggestions && <DuplicateReview applicationId={applicationId} token={session.token} canReview={canReviewDuplicates} />}

          {officer && (record.channel === 'VOICE_SIM' || data.transcript) && <Panel id="call-title" en="Call" bn="কল রেকর্ডিং ও ট্রান্সক্রিপ্ট" hint={data.transcript ? bi('Recording and transcript', 'রেকর্ডিং ও লিখিত বিবরণ') : bi('Recording', 'কল রেকর্ডিং')}>
            {record.channel === 'VOICE_SIM' && <><h3><Bi en="Recording" bn="কল রেকর্ডিং" /></h3><CallRecording applicationId={applicationId} token={session.token} /><p className="muted"><Bi en="The caller was told the call is recorded." bn="কলারকে অডিও রেকর্ডিং সম্পর্কে অবহিত করে সম্মতি নেওয়া হয়েছে।" /></p></>}
            {data.transcript && <><h3><Bi en="Transcript" bn="কথোপকথনের লিখিত বিবরণ" /></h3>
              <p className="muted"><Bi en={`Machine transcript (${data.transcript.transcribedBy}), not a legal record.`} bn="কথোপকথনটি যন্ত্রের সাহায্যে প্রতিলিপি করা হয়েছে; এটি কোনো প্রত্যয়িত আইনি নথি নয়।" /></p>
              <ol className="timeline">{data.transcript.turns.map((line, index) => <li key={index}><strong>{line.speaker === 'CALLER' ? <Bi en="Caller" bn="কলার" /> : <Bi en="Assistant" bn="সহকারী কর্মকর্তা" />}</strong><p lang="bn">{line.text}</p></li>)}</ol>
            </>}
          </Panel>}

          {officer && <Panel id="facts-title" en="Facts and sources" bn="মামলার তথ্য ও তথ্যের উৎস" hint={data.facts.length ? bi(`${data.facts.length} facts`, `${num(data.facts.length)}টি সংরক্ষিত তথ্য`) : none()}>
            {data.facts.length === 0 ? <p>{none()}</p> : <div className="table-wrap"><table>
              <caption className="visually-hidden">{bi('Recorded facts and where each came from', 'নথিভুক্ত তথ্য এবং তথ্যের উৎস')}</caption>
              <thead><tr><th scope="col"><Bi en="Fact" bn="তথ্যের বিষয়" /></th><th scope="col"><Bi en="Value" bn="তথ্যমান" /></th><th scope="col"><Bi en="Source" bn="উৎস" /></th><th scope="col"><Bi en="Confirmed by" bn="যাচাইকারী" /></th><th scope="col"><Bi en="Status" bn="স্থিতি" /></th></tr></thead>
              <tbody>{data.facts.map((fact) => <Fragment key={fact._id}><tr>
                <th scope="row"><Term code={fact.field} /></th>
                <td>{tr(say(fact.value))}</td>
                <td><Term code={fact.sourceType} /><small className="muted"> · <Term code={fact.captureMethod} /> · {bi('r', 'সং')}{num(fact.revision)}{fact.aiInferred ? ` · ${bi('AI', 'এআই')}` : ''}</small></td>
                <td><Bi en="Caller" bn="কলার" /> {yesNo(fact.callerConfirmed)}<br /><Bi en="Applicant" bn="আবেদনকারী" /> {yesNo(fact.applicantConfirmed)}</td>
                <td>
                  {factStatus(fact) && <Badge code={factStatus(fact)} />}
                  {latestFactIds.has(fact._id) && fact.field !== 'identity.nid' && (!fact.applicantConfirmed || fact.confirmationContactAttemptId) && verifyingFactId !== fact._id && (
                    <button type="button" className="link-button" onClick={() => { setVerifyingFactId(fact._id); setVerifyAttemptId(''); setVerifyNote('') }}>
                      {fact.applicantConfirmed ? <Bi en="Undo" bn="বাতিল করুন" /> : <Bi en="Mark verified" bn="যাচাইকৃত চিহ্নিত করুন" />}
                    </button>
                  )}
                </td>
              </tr>
              {verifyingFactId === fact._id && <tr><td colSpan="5">
                <form onSubmit={(event) => submitFactVerification(event, fact)} className="form-stack inline-form">
                  {!fact.applicantConfirmed && (applicantCalls.length ? <>
                    <label htmlFor={`verify-call-${fact._id}`}><Bi en="Call where the applicant confirmed" bn="যে কলে আবেদনকারী নিশ্চিত করেছেন" /></label>
                    <select id={`verify-call-${fact._id}`} value={verifyAttemptId} onChange={(event) => setVerifyAttemptId(event.target.value)} required>
                      <option value="">{bi('Choose a call', 'কল নির্বাচন করুন')}</option>
                      {applicantCalls.map((attempt) => <option key={attempt._id} value={attempt._id}>{when(attempt.createdAt)} · {attempt.reason.slice(0, 60)}</option>)}
                    </select>
                  </> : <p className="warn-text"><Bi en="First log a call where the applicant herself was reached." bn="প্রথমে এমন একটি কল লিপিবদ্ধ করুন যেখানে আবেদনকারী নিজে কথা বলেছেন।" /></p>)}
                  <label htmlFor={`verify-note-${fact._id}`}>{fact.applicantConfirmed ? <Bi en="Why undo" bn="বাতিলের কারণ" /> : <Bi en="What she confirmed" bn="তিনি কী নিশ্চিত করেছেন" />}</label>
                  <textarea id={`verify-note-${fact._id}`} value={verifyNote} onChange={(event) => setVerifyNote(event.target.value)} minLength="10" maxLength="500" required />
                  <div className="button-row">
                    <button type="submit" className="secondary-button" disabled={!fact.applicantConfirmed && !applicantCalls.length}>{fact.applicantConfirmed ? <Bi en="Undo verification" bn="যাচাই বাতিল করুন" /> : <Bi en="Mark verified" bn="যাচাইকৃত চিহ্নিত করুন" />}</button>
                    <button type="button" className="secondary-button" onClick={() => setVerifyingFactId(null)}><Bi en="Cancel" bn="বাতিল" /></button>
                  </div>
                </form>
              </td></tr>}
              </Fragment>)}</tbody>
            </table></div>}
          </Panel>}

          <Panel id="history-title" en="History" bn="অডিট ট্রেইল ও কার্যক্রমের ইতিহাস" hint={events ? `${bi(`${events.length} events`, `${num(events.length)}টি অডিট ইভেন্ট`)} · ${integrity ? bi('check OK', 'অখণ্ডতা অক্ষুণ্ন') : bi('CHECK FAILED', 'অখণ্ডতা যাচাই ব্যর্থ')}` : undefined} open={!officer}>
            <p className={integrity ? 'muted' : 'error'}>{integrity ? bi('Integrity check passed (demo).', 'রেকর্ডের ক্রিপ্টোগ্রাফিক অখণ্ডতা অক্ষুণ্ন রয়েছে।') : bi('Integrity check FAILED. Review required.', 'রেকর্ডের অখণ্ডতা যাচাই ব্যর্থ হয়েছে। অবিলম্বে পর্যালোচনা প্রয়োজন।')}</p>
            <ol className="timeline compact">{events?.map((event, index) => <li key={event._id ?? index}><strong><Term code={event.action} /></strong> <small><Term code={event.actorRole} /> · <time dateTime={event.createdAt}>{when(event.createdAt)}</time></small>{event.reason && <p>{tr(event.reason)}</p>}</li>)}</ol>
          </Panel>
        </div>
      </>}
    </section>
  )
}
