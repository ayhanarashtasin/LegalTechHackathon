import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { api } from '../services/api.js'
import { MediatorIdentityVerification } from '../components/IdentityVerification.jsx'
import { createSignaturePacket } from '../utils/settlementCrypto.js'
import { listSignaturePackets, loadSignaturePacket, removeSignaturePacket, saveSignaturePacket } from '../utils/offlineDrafts.js'
import { Badge, Bi, Panel, Term, bi, num, say, when } from '../components/Bi.jsx'

const pathFor = (applicationId, suffix = '') => `/api/applications/${applicationId}/mediation${suffix}`
const signerBn = { PARTY_A: 'প্রথম পক্ষ (পক্ষ ক)', PARTY_B: 'দ্বিতীয় পক্ষ (পক্ষ খ)', MEDIATOR: 'মধ্যস্থতাকারী', CLAO: 'সিএলএও কর্মকর্তা' }
const stages = ['REGISTRATION', 'SCHEDULING_NOTICES', 'DOCUMENT_REVIEW', 'ATTENDANCE', 'MEDIATION', 'DRAFT_OUTCOME', 'SIGNATURES', 'PENDING_CLAO_CERTIFICATION', 'CERTIFIED_FINAL']
const filledSteps = [
  ['SCHEDULE', 'Schedule and notices', 'সময় ও নোটিশ'], ['DOCUMENT_REVIEW', 'Document review', 'নথিপত্র যাচাই'],
  ['ATTENDANCE', 'Attendance', 'উপস্থিতি'], ['OUTCOME', 'Outcome', 'ফলাফল'], ['DRAFT', 'Settlement draft', 'মীমাংসার খসড়া'],
  ['DRAFT_REVIEW', 'Draft review', 'খসড়া পর্যালোচনা'], ['MEDIATOR_SIGNATURE', 'Mediator signature', 'মধ্যস্থতাকারীর স্বাক্ষর'],
]
const byWhom = (role, name) => `${role === 'MEDIATOR' ? bi('Appointed mediator', 'নিযুক্ত মধ্যস্থতাকারী') : bi('DLAO officer', 'ডিএলএও কর্মকর্তা')}${name ? ` · ${name}` : ''}`

// The DLAO officer appoints, changes, or removes the optional mediator; changes need a reason and are audited.
function MediatorAppointment({ applicationId, token, mediation, onChanged }) {
  const [choices, setChoices] = useState(null)
  const [choice, setChoice] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const current = mediation.mediator
  const locked = ['PENDING_CLAO_CERTIFICATION', 'CERTIFIED_FINAL'].includes(mediation.stage)

  async function open() {
    setError('')
    try { setChoices(await api(pathFor(applicationId, '/mediators'), { token })) } catch (failure) { setError(failure.message) }
  }

  async function save(event, mediatorUserId) {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      const updated = await api(pathFor(applicationId, '/mediator'), { token, method: 'POST', body: { mediatorUserId, ...(reason.trim() ? { reason } : {}) } })
      onChanged(updated, mediatorUserId ? bi('Mediator appointed. You stay the case owner and see every step.', 'মধ্যস্থতাকারী নিযুক্ত হয়েছেন। আপনি মামলার দায়িত্বে থাকছেন এবং প্রতিটি ধাপ দেখতে পাবেন।') : bi('Mediator removed. You run the next steps.', 'মধ্যস্থতাকারী সরানো হয়েছে। পরবর্তী ধাপ আপনি চালাবেন।'))
      setChoices(null); setChoice(''); setReason('')
    } catch (failure) { setError(failure.message) } finally { setBusy(false) }
  }

  if (locked) return null
  return <div className="form-stack">
    {error && <p role="alert" className="error">{error}</p>}
    {!choices ? <button type="button" className="secondary-button" onClick={open}>{current ? bi('Change or remove mediator', 'মধ্যস্থতাকারী বদলান বা সরান') : bi('Appoint a mediator (optional)', 'মধ্যস্থতাকারী নিয়োগ দিন (ঐচ্ছিক)')}</button>
      : <form className="form-stack inline-form" onSubmit={(event) => save(event, choice)}>
        <label htmlFor="mediator-choice"><Bi en="Mediator in this office" bn="এই অফিসের মধ্যস্থতাকারী" /></label>
        <select id="mediator-choice" value={choice} onChange={(event) => setChoice(event.target.value)} required>
          <option value="">{bi('Choose', 'বাছাই করুন')}</option>
          {choices.filter(({ id }) => id !== current?.id).map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
        </select>
        {current && <><label htmlFor="mediator-reason"><Bi en="Reason for the change" bn="পরিবর্তনের কারণ" /></label><input id="mediator-reason" value={reason} onChange={(event) => setReason(event.target.value)} minLength="5" maxLength="500" required /></>}
        <div className="choice-row">
          <button type="submit" disabled={busy}>{current ? bi('Appoint this mediator instead', 'এই মধ্যস্থতাকারীকে নিয়োগ দিন') : bi('Appoint mediator', 'নিয়োগ দিন')}</button>
          {current && <button type="button" className="secondary-button" disabled={busy || reason.trim().length < 5} onClick={(event) => save(event, null)}>{bi('Remove mediator; I will run it', 'মধ্যস্থতাকারী সরান; আমি চালাব')}</button>}
          <button type="button" className="secondary-button" onClick={() => setChoices(null)}>{bi('Cancel', 'বাতিল')}</button>
        </div>
      </form>}
  </div>
}

const initialLocalDateTime = () => {
  const value = new Date(Date.now() + 60 * 60 * 1000)
  value.setMinutes(value.getMinutes() - value.getTimezoneOffset())
  return value.toISOString().slice(0, 16)
}

export default function MediationPanel({ applicationId, session, role, application: initialApplication }) {
  const ownerId = String(session.user.id)
  const [mediation, setMediation] = useState(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [online, setOnline] = useState(navigator.onLine)
  const [queue, setQueue] = useState([])
  const [signingPassphrase, setSigningPassphrase] = useState('')
  const syncInFlight = useRef(false)

  // Step 2: Safety & Consent state. Every box starts unticked so a person answers each question.
  const [isSafe, setIsSafe] = useState(false)
  const [applicantAgreed, setApplicantAgreed] = useState(false)
  const [applicantAvailable, setApplicantAvailable] = useState(false)
  const [oppositePartyWilling, setOppositePartyWilling] = useState(false)
  const [safetyNotes, setSafetyNotes] = useState('')

  // Step 3: Schedule state
  const [mode, setMode] = useState('IN_PERSON')
  const [scheduledAt, setScheduledAt] = useState(initialLocalDateTime)
  const [venue, setVenue] = useState('')
  const [inPersonFallback, setInPersonFallback] = useState('')
  const [sessionType, setSessionType] = useState('JOINT')
  const [language, setLanguage] = useState('Bangla')
  const [participants, setParticipants] = useState(['Applicant', 'Opposite Party'])
  const [notices, setNotices] = useState({
    PARTY_A: { deliveryState: 'NOT_DELIVERED', reason: '' },
    PARTY_B: { deliveryState: 'NOT_DELIVERED', reason: '' },
  })

  // Document review & attendance
  const [documentReason, setDocumentReason] = useState('')
  const [attendance, setAttendance] = useState({ partyA: '', partyB: '', reason: '' })

  // Step 4: Mediation Session Details
  const [applicantComplaint, setApplicantComplaint] = useState(() => initialApplication?.legalMatterDescription ?? '')
  const [applicantRequestedSolution, setApplicantRequestedSolution] = useState('')
  const [applicantStatements, setApplicantStatements] = useState('')
  const [oppositePartyResponse, setOppositePartyResponse] = useState('')
  const [oppositePartyPosition, setOppositePartyPosition] = useState('')
  const [oppositePartyProposedSolution, setOppositePartyProposedSolution] = useState('')
  const [issuesDiscussed, setIssuesDiscussed] = useState('')
  const [proposedSolutions, setProposedSolutions] = useState('')
  const [sessionNotes, setSessionNotes] = useState('')

  // Step 5: Negotiation Terms Ledger
  const [settlementTerms, setSettlementTerms] = useState([])
  const [newTerm, setNewTerm] = useState({
    issue: '',
    applicantDemand: '',
    oppositePartyOffer: '',
    agreedTerm: '',
    status: 'AGREED'
  })

  // Step 6: Outcome
  const [outcome, setOutcome] = useState('AGREEMENT_REACHED')
  const [outcomeReason, setOutcomeReason] = useState('')

  // Step 7: Draft
  const [template, setTemplate] = useState('MAINTENANCE')
  const [notes, setNotes] = useState('')
  const [identifiersRemoved, setIdentifiersRemoved] = useState(false)
  const [acknowledgements, setAcknowledgements] = useState({ partyAUnderstands: false, partyAConsents: false, partyBUnderstands: false, partyBConsents: false })
  const [warningsReviewed, setWarningsReviewed] = useState(false)
  const [reviewReason, setReviewReason] = useState('')
  const [draftEdits, setDraftEdits] = useState({})
  const [amendReason, setAmendReason] = useState('')
  const [followUpDate, setFollowUpDate] = useState('')

  // Step 8: Signatures
  const signerRole = 'MEDIATOR'
  const [issuedCodes, setIssuedCodes] = useState({})
  const [signatureCheck, setSignatureCheck] = useState(null)

  // Step 9: Certification / CLAO Legal Review
  const [applicabilityBasis, setApplicabilityBasis] = useState('')
  const [certificateReason, setCertificateReason] = useState('')
  const [claoConfirmed, setClaoConfirmed] = useState(false)
  const [claoReturnReasonText, setClaoReturnReasonText] = useState('')
  const [showReturnForm, setShowReturnForm] = useState(false)

  // Step 11: Follow-up State
  const [fuDueDate, setFuDueDate] = useState('')
  const [fuSettlementFollowed, setFuSettlementFollowed] = useState(true)
  const [fuPaymentStatus, setFuPaymentStatus] = useState('PAID')
  const [fuComplianceStatus, setFuComplianceStatus] = useState('COMPLIED')
  const [fuFurtherAssistance, setFuFurtherAssistance] = useState(false)
  const [fuNotes, setFuNotes] = useState('')

  // Multi-session mediation state
  const [showNewSessionForm, setShowNewSessionForm] = useState(false)
  const [sessionScheduledAt, setSessionScheduledAt] = useState(initialLocalDateTime)
  const [sessionMode, setSessionMode] = useState('IN_PERSON')
  const [sessionVenue, setSessionVenue] = useState('')
  const [sessionPartyA, setSessionPartyA] = useState('ATTENDED')
  const [sessionPartyB, setSessionPartyB] = useState('ATTENDED')
  const [sessionSummary, setSessionSummary] = useState('')
  const [sessionOutcome, setSessionOutcome] = useState('ADJOURNED_NEXT_DATE')
  const [nextSessionDate, setNextSessionDate] = useState('')
  const [savingSession, setSavingSession] = useState(false)

  async function submitSession(e) {
    e.preventDefault()
    setSavingSession(true)
    setError('')
    try {
      const res = await api(`/api/applications/${applicationId}/mediation/sessions`, {
        token: session.token,
        method: 'POST',
        body: {
          scheduledAt: new Date(sessionScheduledAt).toISOString(),
          mode: sessionMode,
          venue: sessionVenue,
          attendance: { partyA: sessionPartyA, partyB: sessionPartyB },
          summaryNotes: sessionSummary,
          outcome: sessionOutcome,
          nextSessionDate: nextSessionDate ? new Date(nextSessionDate).toISOString() : null,
        },
      })
      setMediation(res)
      setShowNewSessionForm(false)
      setSessionSummary('')
      setNotice(bi('Mediation session recorded successfully.', 'মধ্যস্থতার বৈঠক সফলভাবে নথিভুক্ত করা হয়েছে।'))
    } catch (err) {
      setError(err.message)
    } finally {
      setSavingSession(false)
    }
  }

  const refreshQueue = useCallback(async () => setQueue(await listSignaturePackets(ownerId)), [ownerId])

  useEffect(() => {
    const controller = new AbortController()
    // Load mediation record
    api(pathFor(applicationId), { token: session.token, signal: controller.signal }).then(({ mediation: result }) => {
      setMediation(result)
      if (result) {
        if (result.draft) {
          setDraftEdits(Object.fromEntries(result.draft.sections.map(({ key, text }) => [key, text])))
          setAcknowledgements(result.draft.partyAcknowledgements ?? { partyAUnderstands: false, partyAConsents: false, partyBUnderstands: false, partyBConsents: false })
          setWarningsReviewed(result.draft.warningsReviewed ?? false)
          if (result.draft.followUpDate) setFollowUpDate(result.draft.followUpDate.slice(0, 10))
        }
        if (result.safetyConsent) {
          setIsSafe(result.safetyConsent.isSafe ?? false)
          setApplicantAgreed(result.safetyConsent.applicantAgreed ?? false)
          setApplicantAvailable(result.safetyConsent.applicantAvailable ?? false)
          setOppositePartyWilling(result.safetyConsent.oppositePartyWilling ?? false)
          setSafetyNotes(result.safetyConsent.notes ?? '')
        }
        if (result.sessionType) setSessionType(result.sessionType)
        if (result.language) setLanguage(result.language)
        if (result.participants?.length) setParticipants(result.participants)
        if (result.sessionDetails) {
          setApplicantComplaint(result.sessionDetails.applicantComplaint || '')
          setApplicantRequestedSolution(result.sessionDetails.applicantRequestedSolution || '')
          setApplicantStatements(result.sessionDetails.applicantStatements || '')
          setOppositePartyResponse(result.sessionDetails.oppositePartyResponse || '')
          setOppositePartyPosition(result.sessionDetails.oppositePartyPosition || '')
          setOppositePartyProposedSolution(result.sessionDetails.oppositePartyProposedSolution || '')
          setIssuesDiscussed(result.sessionDetails.issuesDiscussed || '')
          setProposedSolutions(result.sessionDetails.proposedSolutions || '')
          setSessionNotes(result.sessionDetails.sessionNotes || '')
        }
        if (result.settlementTerms?.length) {
          setSettlementTerms(result.settlementTerms)
        }
        if (result.followUp) {
          if (result.followUp.dueDate) setFuDueDate(result.followUp.dueDate.slice(0, 10))
          setFuSettlementFollowed(result.followUp.settlementFollowed ?? true)
          setFuPaymentStatus(result.followUp.paymentStatus || 'PAID')
          setFuComplianceStatus(result.followUp.complianceStatus || 'COMPLIED')
          setFuFurtherAssistance(result.followUp.furtherAssistanceRequired ?? false)
          setFuNotes(result.followUp.notes || '')
        }
      }
      setLoaded(true)
    }).catch((failure) => { if (failure.name !== 'AbortError') { setError(failure.message); setLoaded(true) } })

    // Without an application from the parent, load it to pre-fill the complaint; saved session details win.
    if (!initialApplication) {
      api(`/api/applications/${applicationId}`, { token: session.token, signal: controller.signal })
        .then((app) => setApplicantComplaint((current) => current || app?.legalMatterDescription || ''))
        .catch(() => {})
    }

    listSignaturePackets(ownerId).then(setQueue).catch(() => setError(bi('Offline signature queue is unavailable on this device.', 'এই ডিভাইসে পরে পাঠানোর জন্য রাখা স্বাক্ষরগুলো এখন দেখা যাচ্ছে না।')))
    return () => controller.abort()
  }, [applicationId, ownerId, session.token, initialApplication])

  const syncPending = useCallback(async () => {
    if (!navigator.onLine || signingPassphrase.length < 8 || syncInFlight.current) return
    syncInFlight.current = true
    setError('')
    try {
      const pending = await listSignaturePackets(ownerId)
      setQueue(pending)
      for (const row of pending) {
        const packet = await loadSignaturePacket(row.id, ownerId, signingPassphrase)
        const { applicationId: targetApplicationId, ...signature } = packet
        if (signature.signerRole !== 'MEDIATOR') throw new Error(bi('An older party signature packet needs a new party signing code. Ask the party to sign again.', 'আগের পক্ষের স্বাক্ষরের জন্য নতুন কোড দরকার। পক্ষকে আবার স্বাক্ষর করতে বলুন।'))
        const result = await api(pathFor(targetApplicationId, '/signatures'), { token: session.token, method: 'POST', body: signature })
        await removeSignaturePacket(row.id, ownerId)
        setMediation(result.mediation ?? result)
        setNotice(bi(`Offline ${signature.signerRole.replaceAll('_', ' ')} signature synced and verified.`, `অফলাইন স্বাক্ষর (${signerBn[signature.signerRole]}) সিঙ্ক ও যাচাই হয়েছে।`))
      }
      await refreshQueue()
    } catch (failure) { setError(failure.message || bi('Signature sync is waiting for a connection.', 'স্বাক্ষরটি পাঠাতে ইন্টারনেট সংযোগ দরকার।')) }
    finally { syncInFlight.current = false }
  }, [ownerId, refreshQueue, session.token, signingPassphrase])

  useEffect(() => {
    const disconnected = () => setOnline(false)
    const connected = () => { setOnline(true); syncPending() }
    window.addEventListener('offline', disconnected)
    window.addEventListener('online', connected)
    return () => { window.removeEventListener('offline', disconnected); window.removeEventListener('online', connected) }
  }, [syncPending])

  async function send(suffix, body, success) {
    setError('')
    setNotice('')
    setBusy(true)
    try {
      const result = await api(pathFor(applicationId, suffix), { token: session.token, method: 'POST', body })
      const updated = result.mediation ?? result
      setMediation(updated)
      if (updated.draft && updated.draft.version !== mediation?.draft?.version) {
        setDraftEdits(Object.fromEntries(updated.draft.sections.map(({ key, text }) => [key, text])))
        setAcknowledgements(updated.draft.partyAcknowledgements ?? { partyAUnderstands: false, partyAConsents: false, partyBUnderstands: false, partyBConsents: false })
        setWarningsReviewed(updated.draft.warningsReviewed ?? false)
      }
      if (updated.settlementTerms?.length) {
        setSettlementTerms(updated.settlementTerms)
      }
      setNotice(success)
      return updated
    } catch (failure) { setError(failure.message); return null }
    finally { setBusy(false) }
  }

  // Step 2: Save Safety & Consent
  async function handleSafetyConsent(decision) {
    const noteText = safetyNotes.trim() || (decision === 'CONSENT_CONFIRMED'
      ? 'All 4 safety and consent factors verified by DLAO officer.'
      : decision === 'NOT_SAFE'
      ? 'Case assessed as unsafe for mediation. Halting process for referral.'
      : 'Party consent pending verification.')

    const res = await send('/safety-consent', {
      isSafe,
      applicantAgreed,
      applicantAvailable,
      oppositePartyWilling,
      decision,
      notes: noteText,
    }, decision === 'NOT_SAFE'
      ? bi('Mediation marked as NOT SAFE. Process halted. Case referral recommended.', 'মধ্যস্থতার জন্য অনিরাপদ চিহ্নিত। মধ্যস্থতা স্থগিত এবং আইনি রেফারাল বাঞ্ছনীয়।')
      : bi('Safety & consent recorded.', 'নিরাপত্তা ও সম্মতি সংক্রান্ত সিদ্ধান্ত সংরক্ষিত হয়েছে।'))
    if (res?.safetyConsent) {
      setSafetyNotes(res.safetyConsent.notes || noteText)
    }
  }

  // Step 4: Save Session Details
  async function handleSaveSessionDetails(event) {
    if (event) event.preventDefault()
    await send('/session-details', {
      applicantComplaint,
      applicantRequestedSolution,
      applicantStatements,
      oppositePartyResponse,
      oppositePartyPosition,
      oppositePartyProposedSolution,
      issuesDiscussed,
      proposedSolutions,
      sessionNotes,
    }, bi('Mediation session details saved.', 'বৈঠকের বিস্তারিত বিবরণ ও বক্তব্য সংরক্ষিত হয়েছে।'))
  }

  // Step 5: Save Negotiation Terms
  async function handleAddTerm(event) {
    event.preventDefault()
    if (!newTerm.issue.trim()) return
    const updated = [...settlementTerms, { ...newTerm }]
    setSettlementTerms(updated)
    setNewTerm({ issue: '', applicantDemand: '', oppositePartyOffer: '', agreedTerm: '', status: 'AGREED' })
    await send('/negotiation-terms', { terms: updated }, bi('Proposed settlement term added to negotiation ledger.', 'প্রস্তাবিত শর্ত নেগোসিয়েশন লেজারে যুক্ত হয়েছে।'))
  }

  async function handleRemoveTerm(index) {
    const updated = settlementTerms.filter((_, i) => i !== index)
    setSettlementTerms(updated)
    await send('/negotiation-terms', { terms: updated }, bi('Term removed.', 'শর্ত বাদ দেওয়া হয়েছে।'))
  }

  // Step 9: Return for Correction (CLAO)
  async function handleClaoReturn(event) {
    event.preventDefault()
    if (!claoReturnReasonText.trim()) return
    await send('/return-correction', { reason: claoReturnReasonText }, bi('Mediation returned to DLAO for correction.', 'সংশোধনের জন্য মধ্যস্থতাটি ডিএলএও-র নিকট ফেরত পাঠানো হয়েছে।'))
    setShowReturnForm(false)
    setClaoReturnReasonText('')
  }

  // Step 11: Save Follow-up
  async function handleFollowUp(action = 'KEEP_MONITORING') {
    await send('/follow-up', {
      dueDate: fuDueDate ? new Date(fuDueDate).toISOString() : new Date().toISOString(),
      settlementFollowed: fuSettlementFollowed,
      paymentStatus: fuPaymentStatus,
      complianceStatus: fuComplianceStatus,
      furtherAssistanceRequired: fuFurtherAssistance,
      notes: fuNotes.trim() || 'Follow-up compliance review recorded.',
      action,
    }, action === 'CLOSE_CASE'
      ? bi('Settlement complied with. Case closed successfully.', 'মীমাংসা শর্ত পালিত। মামলা চূড়ান্তভাবে নিষ্পত্তি ও বন্ধ করা হলো।')
      : action === 'REOPEN_REFERRAL'
      ? bi('Non-compliance recorded. Reopened and referred for further legal action.', 'শর্ত লঙ্ঘন চিহ্নিত। মামলা পুনর্বহাল এবং আইনি পদক্ষেপের জন্য রেফার করা হলো।')
      : bi('Follow-up status recorded.', 'ফলোআপ সংক্রান্ত অগ্রগতি নথিভুক্ত হয়েছে।'))
  }

  async function sign() {
    if (!mediation?.draft || signingPassphrase.length < 8) { setError(bi('Set a passphrase of at least 8 characters first.', 'আগে কমপক্ষে ৮ অক্ষরের পাসফ্রেজ দিন।')); return }
    setError('')
    setNotice('')
    setBusy(true)
    try {
      const packet = { applicationId, ...await createSignaturePacket(mediation.draft, signerRole) }
      if (!navigator.onLine) {
        await saveSignaturePacket({ id: packet.clientMutationId, ownerId, value: packet, passphrase: signingPassphrase })
        await refreshQueue()
        setNotice(bi(`${signerRole.replaceAll('_', ' ')} signature saved offline, encrypted, and will sync later.`, `${signerBn[signerRole]}-এর স্বাক্ষর অফলাইনে এনক্রিপ্ট করে রাখা হয়েছে, পরে সিঙ্ক হবে।`))
      } else {
        try {
          const { applicationId: targetApplicationId, ...signature } = packet
          const result = await api(pathFor(targetApplicationId, '/signatures'), { token: session.token, method: 'POST', body: signature })
          setMediation(result.mediation ?? result)
          setNotice(bi(`${signerRole.replaceAll('_', ' ')} signature was synced and verified.`, `${signerBn[signerRole]}-এর স্বাক্ষর সিঙ্ক ও যাচাই হয়েছে।`))
        } catch (failure) {
          if (!failure.status || failure.status >= 500) {
            await saveSignaturePacket({ id: packet.clientMutationId, ownerId, value: packet, passphrase: signingPassphrase })
            await refreshQueue()
            setNotice(bi('Connection failed after signing. The encrypted signature is queued for retry.', 'স্বাক্ষর করার পর সংযোগ বিচ্ছিন্ন হয়েছে। সুরক্ষিত স্বাক্ষরটি এই ডিভাইসে আছে; সংযোগ পেলে আবার পাঠানো যাবে।'))
          } else throw failure
        }
      }
    } catch (failure) { setError(failure.message) }
    finally { setBusy(false) }
  }

  async function issueCode(partyRole) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await api(pathFor(applicationId, '/signing-invitations'), { token: session.token, method: 'POST', body: { signerRole: partyRole } })
      setMediation(result.mediation)
      setIssuedCodes((current) => ({ ...current, [partyRole]: result.code }))
      setNotice(bi(`${partyRole.replaceAll('_', ' ')} code is shown below once. Share it privately; issuing another code cancels the earlier one.`, `${signerBn[partyRole]}-এর কোড নিচে একবার দেখানো হচ্ছে। গোপনে দিন; নতুন কোড দিলে আগেরটি বাতিল হবে।`))
    } catch (failure) { setError(failure.message) }
    finally { setBusy(false) }
  }

  async function signAndCertify(event) {
    event.preventDefault()
    if (!mediation?.draft) return
    setError('')
    setNotice('')
    setBusy(true)
    try {
      const signature = await createSignaturePacket(mediation.draft, 'CLAO')
      const result = await api(pathFor(applicationId, '/certify'), { token: session.token, method: 'POST', body: { reason: certificateReason, signature } })
      setMediation(result.mediation ?? result)
      setCertificateReason('')
      setClaoConfirmed(false)
      setNotice(bi('Your signature was verified and the CLAO certification is recorded. No court-decree finding is made here.', 'আপনার স্বাক্ষর যাচাই হয়েছে এবং সিএলএও সনদ নথিভুক্ত হয়েছে। এটি আদালতের ডিক্রি কি না, তা এখান থেকে নির্ধারণ করা হয় না।'))
    } catch (failure) { setError(failure.message) }
    finally { setBusy(false) }
  }

  async function checkSignatures() {
    setError('')
    setBusy(true)
    try { setSignatureCheck(await api(pathFor(applicationId, '/verify'), { token: session.token, method: 'POST', body: {} })) }
    catch (failure) { setError(failure.message) }
    finally { setBusy(false) }
  }

  async function refreshSignatures() {
    setBusy(true)
    setError('')
    try {
      const result = await api(pathFor(applicationId), { token: session.token })
      setMediation(result.mediation)
      setNotice(bi('Latest signatures loaded.', 'সর্বশেষ স্বাক্ষর দেখানো হয়েছে।'))
    } catch (failure) { setError(failure.message) }
    finally { setBusy(false) }
  }

  const assignedToMe = mediation?.mediatorUserId === ownerId
  const mediatorCanAct = (role === 'MEDIATOR' && assignedToMe) || (role === 'DLAO_OFFICER' && Boolean(mediation) && !mediation.mediatorUserId)
  const signatures = mediation?.signatures ?? []
  const signedRoles = new Set(signatures.map(({ signerRole }) => signerRole))
  const missingPartySignatures = !signedRoles.has('PARTY_A') || !signedRoles.has('PARTY_B')
  const stageIndex = stages.indexOf(mediation?.stage)
  const signing = mediatorCanAct && mediation?.draft?.status === 'APPROVED' && mediation.stage === 'SIGNATURES'
  const hasUnsavedDraftEdits = mediation?.draft?.sections.some(({ key, text }) => (draftEdits[key] ?? text) !== text) ?? false
  const verifier = <Link to={`/applications/${applicationId}/mediation/verify`}><Bi en="Open independent signature verifier" bn="আলাদাভাবে স্বাক্ষর যাচাই করুন" /></Link>

  const isUnsafe = mediation?.safetyConsent?.decision === 'NOT_SAFE'
  // Scheduling and every later step open only after a person confirms safety and consent; the server enforces the same rule.
  const safetyConfirmed = mediation?.safetyConsent?.decision === 'CONSENT_CONFIRMED'
  const canRecordSafety = mediatorCanAct || role === 'DLAO_OFFICER'
  const allSafetyChecks = isSafe && applicantAgreed && applicantAvailable && oppositePartyWilling

  return <Panel id="mediation-title" en="Mediation Workflow" bn="মধ্যস্থতা ও বিকল্প বিরোধ নিষ্পত্তি" hint={loaded ? mediation ? say(mediation.stage) : bi('Not started', 'শুরু হয়নি') : undefined} open={role !== 'DLAO_OFFICER'}>
    {!loaded && <p role="status">{bi('Loading…', 'লোড হচ্ছে…')}</p>}
    {error && <p role="alert" className="error">{error}</p>}
    {notice && <p role="status" className="success">{notice}</p>}
    {loaded && <p className="muted"><Bi en="Authoritative Case record. Human-controlled dispute resolution under Bangladesh Legal Aid Services Act." bn="অনুমোদিত মামলার সমন্বিত রেকর্ড। আইনগত সহায়তা প্রদান আইনের অধীন দায়িত্বপ্রাপ্ত কর্মকর্তা নিয়ন্ত্রিত বিকল্প বিরোধ নিষ্পত্তি।" /></p>}
    {loaded && role === 'CLAO' && !mediation && !error && <p className="muted"><Bi en="No mediation is recorded on this case." bn="এই মামলায় কোনো মধ্যস্থতা নথিভুক্ত নেই।" /></p>}

    {/* STEP 1: INITIAL MEDIATION ENTRY (2 CLEAR OPTIONS) */}
    {loaded && role === 'DLAO_OFFICER' && !mediation && (
      <div style={{ marginTop: '1rem', border: '1px solid #EAEAEA', borderRadius: '8px', padding: '1.25rem', backgroundColor: '#FFFFFF' }}>
        <h3 style={{ margin: '0 0 0.5rem', fontSize: '1.1rem' }}>
          <Bi en="Step 1 — Start Mediation Workflow" bn="১ম ধাপ — মধ্যস্থতা প্রক্রিয়া শুরু করুন" />
        </h3>
        <p className="muted" style={{ marginBottom: '1rem' }}>
          <Bi en="Select how you wish to conduct this mediation case:" bn="এই মামলায় মধ্যস্থতা পরিচালনার পদ্ধতি নির্বাচন করুন:" />
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
          {/* Option 1: Mediation by DLAO */}
          <div style={{ border: '1px solid #EAEAEA', borderRadius: '6px', padding: '1rem', backgroundColor: '#FBFBFA', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <span style={{ fontSize: '1.2rem' }}>⚖️</span>
                <strong style={{ fontSize: '1rem', color: '#111' }}>
                  <Bi en="1. Mediation by DLAO" bn="১. ডিএলএও কর্তৃক মধ্যস্থতা" />
                </strong>
              </div>
              <p style={{ fontSize: '0.88rem', color: '#555', margin: 0 }}>
                <Bi en="Conduct the dispute resolution directly under your authority as the District Legal Aid Officer." bn="জেলা লিগ্যাল এইড কর্মকর্তা হিসেবে নিজে সরাসরি মধ্যস্থতা ও নিষ্পত্তির শুনানি পরিচালনা করুন।" />
              </p>
            </div>
            <button
              type="button"
              disabled={busy}
              style={{ marginTop: '1rem', width: '100%' }}
              onClick={() => send('', {}, bi('Mediation registered under DLAO officer.', 'ডিএলএও কর্মকর্তার অধীন মধ্যস্থতা নিবন্ধিত হয়েছে।'))}
            >
              <Bi en="Start Mediation by DLAO" bn="ডিএলএও মধ্যস্থতা শুরু করুন" />
            </button>
          </div>

          {/* Option 2: Assign to Mediator */}
          <div style={{ border: '1px solid #EAEAEA', borderRadius: '6px', padding: '1rem', backgroundColor: '#FBFBFA', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <span style={{ fontSize: '1.2rem' }}>🤝</span>
                <strong style={{ fontSize: '1rem', color: '#111' }}>
                  <Bi en="2. Assign to Mediator" bn="২. মধ্যস্থতাকারীর কাছে অর্পণ" />
                </strong>
              </div>
              <p style={{ fontSize: '0.88rem', color: '#555', margin: 0 }}>
                <Bi en="Appoint an accredited mediation officer in this office to handle sessions, while retaining supervisory oversight." bn="এই অফিসের তালিকাভুক্ত মধ্যস্থতাকারীর কাছে দায়িত্ব অর্পণ করুন; তদারকি কর্তৃত্ব আপনার অধীনেই থাকবে।" />
              </p>
            </div>
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              style={{ marginTop: '1rem', width: '100%' }}
              onClick={() => send('', {}, bi('Mediation registered. Please choose an accredited mediator.', 'মধ্যস্থতা নিবন্ধিত হয়েছে। অনুগ্রহ করে মধ্যস্থতাকারী নির্বাচন করুন।'))}
            >
              <Bi en="Assign to Mediator" bn="মধ্যস্থতাকারীর কাছে অর্পণ করুন" />
            </button>
          </div>
        </div>
      </div>
    )}

    {mediation && <>
      {/* Step Indicators Header */}
      <ol className="journey stages" aria-label={bi('Mediation stages', 'মধ্যস্থতার ধাপ')}>{stages.map((stage, index) => <li key={stage} className={index < stageIndex ? 'done' : undefined} aria-current={index === stageIndex ? 'step' : undefined}><Term code={stage} /></li>)}</ol>

      <dl className="details compact">
        <div><dt><Bi en="Case" bn="মামলা" /></dt><dd>{mediation.caseId}</dd></div>
        <div><dt><Bi en="Stage" bn="ধাপ" /></dt><dd><Badge code={mediation.stage} /></dd></div>
        {mediation.mode && <div><dt><Bi en="Meeting" bn="সভা" /></dt><dd><Term code={mediation.mode} /> · {when(mediation.scheduledAt)}</dd></div>}
        {mediation.sessionType && <div><dt><Bi en="Session Type" bn="বৈঠকের ধরন" /></dt><dd>{mediation.sessionType === 'JOINT' ? bi('Joint session', 'যৌথ বৈঠক') : mediation.sessionType === 'SEPARATE_APPLICANT' ? bi('Separate (Applicant)', 'পৃথক (বাদী)') : bi('Separate (Respondent)', 'পৃথক (বিবাদী)')}</dd></div>}
        {mediation.language && <div><dt><Bi en="Language" bn="ভাষা" /></dt><dd>{mediation.language}</dd></div>}
        <div><dt><Bi en="Legal effect" bn="আইনি কার্যকারিতা" /></dt><dd><Term code={mediation.legalEffectState} /></dd></div>
        <div><dt><Bi en="Mediator" bn="মধ্যস্থতাকারী" /></dt><dd>{mediation.mediator
          ? <>{mediation.mediator.name} · <Bi en="appointed by the DLAO officer" bn="ডিএলএও কর্মকর্তা নিযুক্ত" /> {when(mediation.mediator.appointedAt)}</>
          : <Bi en="None appointed; the DLAO officer runs the mediation" bn="কেউ নিযুক্ত নন; ডিএলএও কর্মকর্তা মধ্যস্থতা চালাচ্ছেন" />}</dd></div>
        {filledSteps.filter(([key]) => mediation.filledBy?.[key]).map(([key, en, bn]) => <div key={key}><dt>{bi(en, bn)}</dt><dd><span className="record-badge is-filled">{byWhom(mediation.filledBy[key].role, mediation.filledBy[key].name)}</span> {when(mediation.filledBy[key].at)}</dd></div>)}
      </dl>

      {/* STEP 1 MANAGEMENT: SWITCH BETWEEN DLAO & MEDIATOR */}
      {role === 'DLAO_OFFICER' && (
        <div style={{ marginBottom: '1rem', border: '1px solid #EAEAEA', borderRadius: '6px', padding: '0.75rem 1rem', backgroundColor: '#F9F9F8' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.9rem' }}>
              <strong><Bi en="Mediation Mode: " bn="মধ্যস্থতা পদ্ধতি: " /></strong>
              {mediation.mediatorUserId ? bi(`Assigned to Mediator (${mediation.mediator?.name || 'Assigned'})`, `নিযুক্ত মধ্যস্থতাকারী (${mediation.mediator?.name || 'নিযুক্ত'})`) : bi('Directly by DLAO Officer', 'ডিএলএও কর্মকর্তা কর্তৃক সরাসরি')}
            </span>
          </div>
          <MediatorAppointment applicationId={applicationId} token={session.token} mediation={mediation} onChanged={(updated, message) => { setMediation(updated); setNotice(message) }} />
          {mediation.mediatorUserId && <p className="muted" style={{ margin: '0.4rem 0 0', fontSize: '0.83rem' }}><Bi en="The appointed mediator runs the steps below. You stay the case owner, see every step, and retain full oversight." bn="নিচের ধাপগুলো নিযুক্ত মধ্যস্থতাকারী চালাবেন। আপনি মামলার দায়িত্বে থাকছেন, প্রতিটি ধাপ দেখতে পাবেন এবং বৈঠক নথিভুক্ত করতে পারবেন।" /></p>}
        </div>
      )}

      {/* STEP 2: CHECK SAFETY & CONSENT */}
      <section style={{ margin: '1.25rem 0', border: '1px solid #EAEAEA', borderRadius: '6px', padding: '1rem', backgroundColor: isUnsafe ? '#FDEBEC' : '#FFFFFF' }} aria-labelledby="step2-safety-title">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
          <h3 id="step2-safety-title" style={{ margin: 0, fontSize: '1.05rem', color: isUnsafe ? '#9F2F2D' : '#111' }}>
            <Bi en="Step 2 — Check Safety & Consent (নিরাপত্তা ও সম্মতি যাচাই)" bn="২য় ধাপ — নিরাপত্তা ও সম্মতি যাচাই" />
          </h3>
          {mediation.safetyConsent?.decision && (
            <span style={{
              fontSize: '0.75rem',
              fontWeight: 600,
              padding: '0.2rem 0.6rem',
              borderRadius: '9999px',
              backgroundColor: mediation.safetyConsent.decision === 'CONSENT_CONFIRMED' ? '#EDF3EC' : mediation.safetyConsent.decision === 'NOT_SAFE' ? '#FDEBEC' : '#FBF3DB',
              color: mediation.safetyConsent.decision === 'CONSENT_CONFIRMED' ? '#346538' : mediation.safetyConsent.decision === 'NOT_SAFE' ? '#9F2F2D' : '#956400',
            }}>
              {mediation.safetyConsent.decision === 'CONSENT_CONFIRMED' ? bi('Consent Confirmed', 'সম্মতি নিশ্চিত') : mediation.safetyConsent.decision === 'NOT_SAFE' ? bi('Not Safe for Mediation', 'মধ্যস্থতার জন্য অনিরাপদ') : bi('Consent Pending', 'সম্মতি অপেক্ষমাণ')}
            </span>
          )}
        </div>

        <p className="muted" style={{ margin: '0.2rem 0 0.75rem', fontSize: '0.85rem' }}>
          <Bi en="Before scheduling or conducting mediation, confirm the 4 critical safety and willingness criteria:" bn="মধ্যস্থতার পূর্বে ৪টি মৌলিক নিরাপত্তা ও সম্মতিসূচক বিষয় যাচাই করে নিশ্চিত করুন:" />
        </p>

        {isUnsafe && (
          <div style={{ padding: '0.75rem', backgroundColor: '#FFFFFF', border: '1px solid #F8D7DA', borderRadius: '4px', margin: '0.5rem 0' }}>
            <strong style={{ color: '#9F2F2D' }}>
              🛑 <Bi en="Mediation Halted: Unsafe for Applicant" bn="মধ্যস্থতা স্থগিত: আবেদনকারীর জন্য অনিরাপদ" />
            </strong>
            <p style={{ margin: '0.3rem 0', fontSize: '0.88rem', color: '#555' }}>
              {mediation.safetyConsent?.notes || bi('Assessed as unsafe for mediation due to domestic risk or coercion.', 'সহিংসতা বা জবরদস্তির আশঙ্কায় মধ্যস্থতার জন্য অনুপযুক্ত ও অনিরাপদ ঘোষিত।')}
            </p>
            <p style={{ margin: '0.4rem 0 0', fontSize: '0.85rem' }}>
              <Bi en="Action required: Stop mediation and refer/escalate this case to a panel lawyer or protective authority." bn="প্রয়োজনীয় পদক্ষেপ: মধ্যস্থতা বন্ধ করে অবিলম্বে প্যানেল আইনজীবী বা নিরাপত্তা সুরক্ষায় রেফার/এসকেলেট করুন।" />
            </p>
            <div style={{ marginTop: '0.75rem' }}>
              <a href="#referral-title" className="secondary-button" style={{ display: 'inline-block', textDecoration: 'none', padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}>
                <Bi en="➔ Proceed to Referrals & Panel Lawyer" bn="➔ রেফারাল ও প্যানেল আইনজীবী শাখায় যান" />
              </a>
            </div>
          </div>
        )}
        {!isUnsafe && !safetyConfirmed && <p role="status" className="muted"><Bi en="Scheduling and the later steps open after a person confirms safety and consent." bn="নিরাপত্তা ও সম্মতি নিশ্চিত হলে সময়সূচি ও পরের ধাপগুলো খুলবে।" /></p>}
        {canRecordSafety && (
          <div className="form-stack">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '0.6rem', padding: '0.75rem', backgroundColor: '#F9F9F8', borderRadius: '4px' }}>
              <label className="checkbox-label" htmlFor="chk-is-safe" style={{ margin: 0 }}>
                <input id="chk-is-safe" type="checkbox" checked={isSafe} onChange={(e) => setIsSafe(e.target.checked)} />
                <Bi en="1. Is mediation safe for the applicant?" bn="১. আবেদনকারীর জন্য মধ্যস্থতা কি নিরাপদ?" />
              </label>

              <label className="checkbox-label" htmlFor="chk-applicant-agreed" style={{ margin: 0 }}>
                <input id="chk-applicant-agreed" type="checkbox" checked={applicantAgreed} onChange={(e) => setApplicantAgreed(e.target.checked)} />
                <Bi en="2. Has the applicant agreed to mediation?" bn="২. আবেদনকারী কি মধ্যস্থতায় সম্মত আছেন?" />
              </label>

              <label className="checkbox-label" htmlFor="chk-applicant-available" style={{ margin: 0 }}>
                <input id="chk-applicant-available" type="checkbox" checked={applicantAvailable} onChange={(e) => setApplicantAvailable(e.target.checked)} />
                <Bi en="3. Is the applicant available?" bn="৩. আবেদনকারী কি উপস্থিত/প্রাপ্য আছেন?" />
              </label>

              <label className="checkbox-label" htmlFor="chk-opposite-willing" style={{ margin: 0 }}>
                <input id="chk-opposite-willing" type="checkbox" checked={oppositePartyWilling} onChange={(e) => setOppositePartyWilling(e.target.checked)} />
                <Bi en="4. Is the opposite party willing to participate?" bn="৪. প্রতিপক্ষ কি অংশগ্রহণে ইচ্ছুক?" />
              </label>
            </div>

            <div style={{ marginTop: '0.5rem' }}>
              <label htmlFor="safety-notes" style={{ fontSize: '0.85rem' }}><Bi en="Safety Assessment / Verification Notes" bn="নিরাপত্তা ও সম্মতি সংক্রান্ত নোট/বিবরণ" /></label>
              <textarea
                id="safety-notes"
                value={safetyNotes}
                onChange={(e) => setSafetyNotes(e.target.value)}
                placeholder={bi('Record how consent was verified, safe contact confirmation, risk checks...', 'কীভাবে সম্মতি ও নিরাপদ যোগাযোগ যাচাই করা হয়েছে তা লিখুন...')}
                rows={2}
                maxLength={500}
              />
            </div>

            {/* 3 Safety & Consent Buttons */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem', marginTop: '0.5rem' }}>
              <button
                type="button"
                disabled={busy || !allSafetyChecks}
                style={{ backgroundColor: '#2E7D32', borderColor: '#2E7D32', color: '#FFF' }}
                onClick={() => handleSafetyConsent('CONSENT_CONFIRMED')}
              >
                ✓ <Bi en="Consent Confirmed" bn="সম্মতি নিশ্চিত" />
              </button>

              <button
                type="button"
                disabled={busy}
                style={{ backgroundColor: '#C62828', borderColor: '#C62828', color: '#FFF' }}
                onClick={() => handleSafetyConsent('NOT_SAFE')}
              >
                🛑 <Bi en="Not Safe for Mediation" bn="মধ্যস্থতার জন্য অনিরাপদ" />
              </button>

              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={() => handleSafetyConsent('CONSENT_PENDING')}
              >
                ⏳ <Bi en="Consent Pending" bn="সম্মতি অপেক্ষমাণ" />
              </button>
            </div>
            {!allSafetyChecks && <p className="muted"><Bi en="Consent can be confirmed only when all four answers are yes." bn="চারটি উত্তরই হ্যাঁ হলে তবেই সম্মতি নিশ্চিত করা যাবে।" /></p>}
          </div>
        )}
      </section>

      {/* STEP 3: SCHEDULE MEDIATION */}
      {mediatorCanAct && safetyConfirmed && ['REGISTRATION', 'SCHEDULING_NOTICES'].includes(mediation.stage) && (
        <form className="form-stack inline-form" style={{ margin: '1.25rem 0', border: '1px solid #EAEAEA', borderRadius: '6px', padding: '1rem', backgroundColor: '#FFFFFF' }} onSubmit={(event) => {
          event.preventDefault()
          send('/schedule', {
            mode,
            scheduledAt: new Date(scheduledAt).toISOString(),
            venue,
            inPersonFallback,
            sessionType,
            language,
            participants,
            notices: ['PARTY_A', 'PARTY_B'].map((party) => ({ party, ...notices[party] }))
          }, bi('Mediation scheduled and notices recorded in authoritative record.', 'মধ্যস্থতার সময়সূচি ও নোটিশ সংক্রান্ত তথ্য সংরক্ষিত হয়েছে।'))
        }}>
          <h3 style={{ margin: 0, fontSize: '1.05rem', color: '#111' }}>
            <Bi en="Step 3 — Schedule Mediation (সময়সূচি নির্ধারণ)" bn="৩য় ধাপ — মধ্যস্থতার সময়সূচি নির্ধারণ" />
          </h3>
          <p className="muted" style={{ margin: '0.2rem 0 0.75rem', fontSize: '0.85rem' }}>
            <Bi en="Select appointment parameters and record safe-contact notice dispatch." bn="বৈঠকের বিস্তারিত তথ্য নির্ধারণ করুন এবং নিরাপদ যোগাযোগে নোটিশ প্রেরণের তথ্য লিপিবদ্ধ করুন।" />
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem' }}>
            <div>
              <label htmlFor="mediation-time"><Bi en="Date and Time" bn="তারিখ ও সময়" /></label>
              <input id="mediation-time" type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} required />
            </div>

            <div>
              <label htmlFor="mediation-mode"><Bi en="Location / Online (Mode)" bn="স্থান / মাধ্যম" /></label>
              <select id="mediation-mode" value={mode} onChange={(event) => setMode(event.target.value)}>
                {['IN_PERSON', 'REMOTE', 'HYBRID'].map((code) => <option key={code} value={code}>{say(code)}</option>)}
              </select>
            </div>

            <div>
              <label htmlFor="session-type-select"><Bi en="Session Type" bn="বৈঠকের প্রকার" /></label>
              <select id="session-type-select" value={sessionType} onChange={(e) => setSessionType(e.target.value)}>
                <option value="JOINT">{bi('Joint session (উভয় পক্ষের যৌথ বৈঠক)', 'যৌথ বৈঠক')}</option>
                <option value="SEPARATE_APPLICANT">{bi('Separate session with applicant (বাদীর সাথে পৃথক)', 'বাদীর সাথে পৃথক বৈঠক')}</option>
                <option value="SEPARATE_RESPONDENT">{bi('Separate session with respondent (বিবাদীর সাথে পৃথক)', 'বিবাদীর সাথে পৃথক বৈঠক')}</option>
              </select>
            </div>

            <div>
              <label htmlFor="session-language-select"><Bi en="Language" bn="ভাষা" /></label>
              <select id="session-language-select" value={language} onChange={(e) => setLanguage(e.target.value)}>
                <option value="Bangla">বাংলা (Bangla)</option>
                <option value="English">English</option>
                <option value="Chittagonian">চাটগাঁইয়া (Chittagonian)</option>
                <option value="Sylheti">সিলেটি (Sylheti)</option>
                <option value="Other">অন্যান্য (Other)</option>
              </select>
            </div>
          </div>

          {mode === 'IN_PERSON' && (
            <div>
              <label htmlFor="mediation-venue"><Bi en="Venue / Office Room" bn="স্থান / কক্ষ নম্বর" /></label>
              <input id="mediation-venue" value={venue} onChange={(event) => setVenue(event.target.value)} placeholder={bi('e.g. DLAO Mediation Room, District Judge Court', 'যেমনঃ ডিএলএও মধ্যস্থতা কক্ষ, জেলা জজ আদালত ভবন')} minLength="3" maxLength="200" required />
            </div>
          )}

          {mode !== 'IN_PERSON' && (
            <div>
              <label htmlFor="mediation-fallback"><Bi en="In-person backup plan" bn="অনলাইন সংযোগ ব্যাহত হলে বিকল্প সরাসরি সভার স্থান ও পরিকল্পনা" /></label>
              <textarea id="mediation-fallback" value={inPersonFallback} onChange={(event) => setInPersonFallback(event.target.value)} minLength="10" maxLength="300" required />
            </div>
          )}

          <div>
            <label style={{ fontSize: '0.85rem', fontWeight: 600 }}><Bi en="Participants" bn="অংশগ্রহণকারীগণ" /></label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginTop: '0.25rem' }}>
              {['Applicant (বাদী/আবেদনকারী)', 'Opposite Party (বিবাদী)', 'Panel Lawyer (প্যানেল আইনজীবী)', 'Intermediary / Support Person (সহায়তাকারী)'].map((p) => {
                const isChecked = participants.some((item) => p.startsWith(item) || item.startsWith(p.split(' ')[0]))
                return (
                  <label key={p} className="checkbox-label" style={{ fontSize: '0.82rem', margin: 0 }}>
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={(e) => {
                        const base = p.split(' ')[0]
                        if (e.target.checked) setParticipants([...participants, base])
                        else setParticipants(participants.filter((item) => !item.startsWith(base)))
                      }}
                    />
                    {p}
                  </label>
                )
              })}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '0.75rem', marginTop: '0.5rem' }}>
            {['PARTY_A', 'PARTY_B'].map((party) => (
              <fieldset key={party} style={{ border: '1px solid #EAEAEA', borderRadius: '4px', padding: '0.75rem' }}>
                <legend style={{ fontWeight: 600, fontSize: '0.85rem' }}><Term code={party} /> · <Bi en="Notice via Safe Contact" bn="নিরাপদ মাধ্যমে নোটিশ" /></legend>
                <label htmlFor={`${party}-notice-state`} style={{ fontSize: '0.8rem' }}><Bi en="Delivered?" bn="জারি সম্পন্ন?" /></label>
                <select id={`${party}-notice-state`} value={notices[party].deliveryState} onChange={(event) => setNotices((current) => ({ ...current, [party]: { ...current[party], deliveryState: event.target.value } }))}>
                  {['NOT_DELIVERED', 'DELIVERED'].map((code) => <option key={code} value={code}>{say(code)}</option>)}
                </select>
                <label htmlFor={`${party}-notice-reason`} style={{ fontSize: '0.8rem', marginTop: '0.35rem' }}><Bi en="Delivery Method / Note" bn="বিতরণের পদ্ধতি ও পর্যবেক্ষণ" /></label>
                <textarea id={`${party}-notice-reason`} value={notices[party].reason} onChange={(event) => setNotices((current) => ({ ...current, [party]: { ...current[party], reason: event.target.value } }))} minLength="10" maxLength="300" required />
              </fieldset>
            ))}
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.75rem' }}>
            <button type="submit" disabled={busy}><Bi en="Schedule Mediation" bn="সময়সূচি নির্ধারণ করুন" /></button>
            {mediation.stage === 'SCHEDULING_NOTICES' && (
              <button type="button" disabled={busy} className="secondary-button" onClick={() => send('/advance', {}, bi('Next: document review.', 'পরবর্তী ধাপ: নথিপত্র যাচাই।'))}>
                <Bi en="Continue to Document Review ➔" bn="নথিপত্র যাচাইয়ে যান ➔" />
              </button>
            )}
          </div>
        </form>
      )}

      {/* DOCUMENT REVIEW STAGE */}
      {mediatorCanAct && safetyConfirmed && mediation.stage === 'DOCUMENT_REVIEW' && (
        <section className="form-stack inline-form" style={{ margin: '1.25rem 0', border: '1px solid #EAEAEA', borderRadius: '6px', padding: '1rem', backgroundColor: '#FFFFFF' }} aria-labelledby="med-documents-title">
          <h3 id="med-documents-title"><Bi en="Document Review" bn="নথিপত্র যাচাই" /></h3>
          {mediation.documents.length ? <ul className="plain-list">{mediation.documents.map((document) => <li key={document.id}>{document.label} · <Term code={document.qualityState} /> · v{num(document.currentVersion)}</li>)}</ul> : <p><Bi en="No documents on this case." bn="এই মামলায় কোনো নথি নেই।" /></p>}
          {mediation.documentsReviewedAt ? <p role="status"><Bi en="Reviewed" bn="যাচাই সম্পন্ন" /> {when(mediation.documentsReviewedAt)} · {mediation.documentReviewReason}</p> : <form className="form-stack" onSubmit={(event) => { event.preventDefault(); send('/documents/review', { reason: documentReason }, bi('Document review saved.', 'নথিপত্র যাচাই সংরক্ষিত হয়েছে।')) }}><label htmlFor="med-document-reason"><Bi en="Review note" bn="যাচাই সংক্রান্ত পর্যবেক্ষণ/নোট" /></label><textarea id="med-document-reason" value={documentReason} onChange={(event) => setDocumentReason(event.target.value)} minLength="10" maxLength="500" required /><button type="submit" disabled={busy}><Bi en="Save review" bn="যাচাই সংরক্ষণ করুন" /></button></form>}
          {mediation.documentsReviewedAt && <button type="button" disabled={busy} className="secondary-button" onClick={() => send('/advance', {}, bi('Next: attendance.', 'পরবর্তী ধাপ: উপস্থিতি নিশ্চিতকরণ।'))}><Bi en="Continue to attendance" bn="উপস্থিতিতে যান" /></button>}
        </section>
      )}

      {/* ATTENDANCE STAGE */}
      {mediatorCanAct && safetyConfirmed && mediation.stage === 'ATTENDANCE' && (
        <form className="form-stack inline-form" style={{ margin: '1.25rem 0', border: '1px solid #EAEAEA', borderRadius: '6px', padding: '1rem', backgroundColor: '#FFFFFF' }} onSubmit={(event) => { event.preventDefault(); send('/attendance', attendance, bi('Attendance saved.', 'উপস্থিতি সংক্রান্ত তথ্য সংরক্ষিত হয়েছে।')) }}>
          <h3><Bi en="Attendance" bn="উপস্থিতি" /></h3>
          {['partyA', 'partyB'].map((party) => <div key={party}><label htmlFor={`attendance-${party}`}><Term code={party === 'partyA' ? 'PARTY_A' : 'PARTY_B'} /></label><select id={`attendance-${party}`} value={attendance[party]} onChange={(event) => setAttendance((current) => ({ ...current, [party]: event.target.value }))} required><option value="">{bi('Choose', 'বাছাই করুন')}</option>{['ATTENDED', 'REPRESENTED', 'ABSENT'].map((code) => <option key={code} value={code}>{say(code)}</option>)}</select></div>)}
          <label htmlFor="attendance-reason"><Bi en="Note" bn="উপস্থিতি সংক্রান্ত পর্যবেক্ষণ" /></label><textarea id="attendance-reason" value={attendance.reason} onChange={(event) => setAttendance((current) => ({ ...current, reason: event.target.value }))} minLength="10" maxLength="500" required /><button type="submit" disabled={busy}><Bi en="Save attendance" bn="উপস্থিতি সংরক্ষণ করুন" /></button>
          {mediation.attendance && mediation.attendance.partyA !== 'ABSENT' && mediation.attendance.partyB !== 'ABSENT' && <button type="button" disabled={busy} className="secondary-button" onClick={() => send('/advance', {}, bi('Next: mediation session.', 'পরবর্তী ধাপ: আনুষ্ঠানিক মধ্যস্থতা বৈঠক।'))}><Bi en="Continue to Mediation Session ➔" bn="মধ্যস্থতা বৈঠকে যান ➔" /></button>}
        </form>
      )}

      {/* STEP 4 & 5 & 6: FORMAL MEDIATION SESSION */}
      {mediatorCanAct && safetyConfirmed && mediation.stage === 'MEDIATION' && (
        <div style={{ margin: '1.25rem 0', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

          {/* STEP 4: MEDIATION SESSION DUAL-SIDE VIEW */}
          <section style={{ border: '1px solid #EAEAEA', borderRadius: '8px', padding: '1.25rem', backgroundColor: '#FFFFFF' }}>
            <h3 style={{ margin: '0 0 0.35rem', fontSize: '1.1rem' }}>
              <Bi en="Step 4 — Mediation Session (উভয় পক্ষের অবস্থান ও আলোচনা)" bn="৪র্থ ধাপ — মধ্যস্থতার বৈঠক ও উভয় পক্ষের পর্যালোচনা" />
            </h3>
            <p className="muted" style={{ margin: '0 0 1rem', fontSize: '0.85rem' }}>
              <Bi en="Comparative dual-perspective view: Review both sides' claims and record mediator observations." bn="উভয় পক্ষের দাবিসমূহ পাশাপাশি পর্যালোচনা করুন এবং মধ্যস্থতাকারীর পর্যবেক্ষণ লিপিবদ্ধ করুন।" />
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1rem' }}>
              {/* Applicant's Side */}
              <div style={{ border: '1px solid #EAEAEA', borderRadius: '6px', padding: '1rem', backgroundColor: '#FBFBFA', borderTop: '4px solid #1f6c9f' }}>
                <h4 style={{ margin: '0 0 0.5rem', color: '#1f6c9f', fontSize: '0.95rem' }}>
                  <Bi en="Applicant's Side (আবেদনকারীর পক্ষ)" bn="আবেদনকারী/বাদীর পক্ষ" />
                </h4>

                <label htmlFor="app-complaint" style={{ fontSize: '0.82rem' }}><Bi en="Main Complaint" bn="মূল অভিযোগ" /></label>
                <textarea
                  id="app-complaint"
                  value={applicantComplaint}
                  onChange={(e) => setApplicantComplaint(e.target.value)}
                  placeholder={bi('e.g. Non-payment of monthly maintenance for 8 months...', 'যেমনঃ ৮ মাস যাবত খোরপোশ প্রদান না করা...')}
                  rows={2}
                />

                <label htmlFor="app-solution" style={{ fontSize: '0.82rem', marginTop: '0.4rem' }}><Bi en="Requested Solution" bn="দাবিকৃত সমাধান" /></label>
                <textarea
                  id="app-solution"
                  value={applicantRequestedSolution}
                  onChange={(e) => setApplicantRequestedSolution(e.target.value)}
                  placeholder={bi('e.g. Regular monthly maintenance ৳12,000 + educational expenses...', 'যেমনঃ মাসিক খোরপোশ ১২,০০০ টাকা ও বাচ্চার পড়ার খরচ...')}
                  rows={2}
                />

                <label htmlFor="app-statements" style={{ fontSize: '0.82rem', marginTop: '0.4rem' }}><Bi en="Applicant's Statements" bn="আবেদনকারীর বক্তব্য ও বিবৃতি" /></label>
                <textarea
                  id="app-statements"
                  value={applicantStatements}
                  onChange={(e) => setApplicantStatements(e.target.value)}
                  placeholder={bi('Statements made during the session...', 'বৈঠকে বাদীর প্রদত্ত বক্তব্য...')}
                  rows={2}
                />

                <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: '#666' }}>
                  <strong><Bi en="Supporting Documents:" bn="সংযুক্ত প্রমাণক:" /></strong>
                  {mediation.documents?.length ? (
                    <ul style={{ margin: '0.2rem 0 0', paddingLeft: '1.2rem' }}>
                      {mediation.documents.map((d) => <li key={d.id}>{d.label} (v{d.currentVersion})</li>)}
                    </ul>
                  ) : <span> <Bi en="No documents uploaded" bn="কোনো নথি সংযুক্ত নেই" /></span>}
                </div>
              </div>

              {/* Opposite Party's Side */}
              <div style={{ border: '1px solid #EAEAEA', borderRadius: '6px', padding: '1rem', backgroundColor: '#FBFBFA', borderTop: '4px solid #956400' }}>
                <h4 style={{ margin: '0 0 0.5rem', color: '#956400', fontSize: '0.95rem' }}>
                  <Bi en="Opposite Party's Side (প্রতিপক্ষের পক্ষ)" bn="বিবাদীর পক্ষ" />
                </h4>

                <label htmlFor="resp-response" style={{ fontSize: '0.82rem' }}><Bi en="Response to Complaint" bn="অভিযোগের প্রেক্ষিতে জবাব" /></label>
                <textarea
                  id="resp-response"
                  value={oppositePartyResponse}
                  onChange={(e) => setOppositePartyResponse(e.target.value)}
                  placeholder={bi('e.g. Denies total refusal, claims irregular income as reason...', 'যেমনঃ পুরোপুরি অস্বীকার না করে আয়ের অনিশ্চয়তার কারণ প্রদর্শন...')}
                  rows={2}
                />

                <label htmlFor="resp-position" style={{ fontSize: '0.82rem', marginTop: '0.4rem' }}><Bi en="Their Position / Capacity" bn="তাদের অবস্থান ও সক্ষমতা" /></label>
                <textarea
                  id="resp-position"
                  value={oppositePartyPosition}
                  onChange={(e) => setOppositePartyPosition(e.target.value)}
                  placeholder={bi('Current financial or social standing...', 'বর্তমান আর্থিক বা সামাজিক অবস্থান...')}
                  rows={2}
                />

                <label htmlFor="resp-solution" style={{ fontSize: '0.82rem', marginTop: '0.4rem' }}><Bi en="Proposed Solution" bn="প্রতিপক্ষের প্রস্তাবিত সমাধান" /></label>
                <textarea
                  id="resp-solution"
                  value={oppositePartyProposedSolution}
                  onChange={(e) => setOppositePartyProposedSolution(e.target.value)}
                  placeholder={bi('e.g. Willing to pay ৳8,000 per month starting next month...', 'যেমনঃ আগামী মাস থেকে ৮,০০০ টাকা দিতে সম্মত...')}
                  rows={2}
                />
              </div>
            </div>

            {/* DLAO Additions */}
            <div style={{ marginTop: '1rem', padding: '1rem', backgroundColor: '#FAFAFA', borderRadius: '6px', border: '1px solid #EAEAEA' }}>
              <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.95rem' }}>
                <Bi en="Mediator's Record & Discussion Notes" bn="মধ্যস্থতাকারীর নোট ও আলোচনার বিষয়সমূহ" />
              </h4>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '0.75rem' }}>
                <div>
                  <label htmlFor="med-issues" style={{ fontSize: '0.82rem' }}><Bi en="Issues Discussed" bn="আলোচিত মূল বিষয়সমূহ" /></label>
                  <textarea
                    id="med-issues"
                    value={issuesDiscussed}
                    onChange={(e) => setIssuesDiscussed(e.target.value)}
                    placeholder={bi('e.g. Monthly maintenance, child custody access, dower settlement...', 'যেমনঃ মাসিক ভরণপোষণ, সন্তানের দেখাশোনার অধিকার, দেনমোহর...')}
                    rows={2}
                  />
                </div>
                <div>
                  <label htmlFor="med-solutions" style={{ fontSize: '0.82rem' }}><Bi en="Proposed Solutions & Convergence" bn="উভয়পক্ষের কাছাকাছি আসা প্রস্তাবসমূহ" /></label>
                  <textarea
                    id="med-solutions"
                    value={proposedSolutions}
                    onChange={(e) => setProposedSolutions(e.target.value)}
                    placeholder={bi('Convergence on payment dates and amounts...', 'সম্মতির ক্ষেত্রসমূহ...')}
                    rows={2}
                  />
                </div>
              </div>

              <div style={{ marginTop: '0.5rem' }}>
                <label htmlFor="med-session-notes" style={{ fontSize: '0.82rem' }}><Bi en="Session Notes & Atmosphere" bn="বৈঠকের বিস্তারিত পর্যবেক্ষণ ও নোট" /></label>
                <textarea
                  id="med-session-notes"
                  value={sessionNotes}
                  onChange={(e) => setSessionNotes(e.target.value)}
                  placeholder={bi('General observations, attitude of parties, progress towards resolution...', 'পক্ষগণের মনোভাব ও সামগ্রিক পরিস্থিতি...')}
                  rows={2}
                />
              </div>

              <button type="button" disabled={busy} onClick={handleSaveSessionDetails} style={{ marginTop: '0.5rem' }}>
                <Bi en="Save Session Details" bn="বৈঠকের বিবরণ সংরক্ষণ করুন" />
              </button>
            </div>
          </section>

          {/* STEP 5: NEGOTIATION / SETTLEMENT TERMS LEDGER */}
          <section style={{ border: '1px solid #EAEAEA', borderRadius: '8px', padding: '1.25rem', backgroundColor: '#FFFFFF' }}>
            <h3 style={{ margin: '0 0 0.35rem', fontSize: '1.1rem' }}>
              <Bi en="Step 5 — Negotiation / Settlement Terms (শর্তাবলি ও নেগোসিয়েশন)" bn="৫ম ধাপ — মধ্যস্থতার শর্তাবলি ও আপস-রফা" />
            </h3>
            <p className="muted" style={{ margin: '0 0 0.75rem', fontSize: '0.85rem' }}>
              <Bi en="Record specific issues what both parties agree or disagree on (e.g. Maintenance: Applicant asks ৳X, Opposite party offers ৳Y)." bn="উভয় পক্ষ কোন কোন বিষয়ে একমত বা দ্বিমত পোষণ করছেন তা নির্দিষ্টভাবে লিপিবদ্ধ করুন (যেমনঃ খোরপোশ: বাদীর দাবি ৳X, বিবাদীর প্রস্তাব ৳Y)।" />
            </p>

            {/* List of settlement terms */}
            {settlementTerms.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginBottom: '1rem' }}>
                {settlementTerms.map((term, index) => (
                  <div key={index} style={{ border: '1px solid #EAEAEA', borderRadius: '6px', padding: '0.75rem 1rem', backgroundColor: '#FBFBFA', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.3rem' }}>
                        <strong style={{ fontSize: '0.95rem', color: '#111' }}>{term.issue}</strong>
                        <span style={{
                          fontSize: '0.72rem',
                          fontWeight: 600,
                          padding: '0.15rem 0.5rem',
                          borderRadius: '9999px',
                          backgroundColor: term.status === 'AGREED' ? '#EDF3EC' : term.status === 'DISAGREED' ? '#FDEBEC' : '#FBF3DB',
                          color: term.status === 'AGREED' ? '#346538' : term.status === 'DISAGREED' ? '#9F2F2D' : '#956400',
                        }}>
                          {term.status === 'AGREED' ? bi('Agreed', 'সম্মত') : term.status === 'DISAGREED' ? bi('Disagreed', 'অসম্মত') : bi('Under Negotiation', 'আলোচনাধীন')}
                        </span>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.5rem', fontSize: '0.85rem', color: '#555' }}>
                        <div><strong><Bi en="Applicant Asks:" bn="বাদীর দাবি:" /></strong> {term.applicantDemand || '—'}</div>
                        <div><strong><Bi en="Opposite Offers:" bn="বিবাদীর প্রস্তাব:" /></strong> {term.oppositePartyOffer || '—'}</div>
                        <div><strong><Bi en="Agreed Term:" bn="চূড়ান্ত নিষ্পত্তি:" /></strong> {term.agreedTerm || '—'}</div>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="secondary-button"
                      style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', marginLeft: '0.5rem', color: '#9F2F2D' }}
                      onClick={() => handleRemoveTerm(index)}
                      title={bi('Remove term', 'মুছে ফেলুন')}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Add proposed settlement term form */}
            <form onSubmit={handleAddTerm} style={{ border: '1px dashed #CCC', borderRadius: '6px', padding: '0.75rem 1rem', backgroundColor: '#FAFAFA' }}>
              <strong style={{ fontSize: '0.88rem', display: 'block', marginBottom: '0.5rem' }}>
                <Bi en="+ Add Proposed Settlement Term" bn="+ নতুন আপস শর্ত বা ইস্যু যোগ করুন" />
              </strong>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.6rem' }}>
                <div>
                  <label htmlFor="new-term-issue" style={{ fontSize: '0.8rem' }}><Bi en="Issue" bn="আলোচিত বিষয়/ইস্যু" /></label>
                  <input
                    id="new-term-issue"
                    value={newTerm.issue}
                    onChange={(e) => setNewTerm({ ...newTerm, issue: e.target.value })}
                    placeholder={bi('e.g. Maintenance, Child custody, Dower', 'যেমনঃ খোরপোশ, সন্তানের হেফাজত, দেনমোহর')}
                    required
                  />
                </div>
                <div>
                  <label htmlFor="new-term-ask" style={{ fontSize: '0.8rem' }}><Bi en="Applicant Asks (৳)" bn="বাদীর দাবি (৳ বা বিষয়)" /></label>
                  <input
                    id="new-term-ask"
                    value={newTerm.applicantDemand}
                    onChange={(e) => setNewTerm({ ...newTerm, applicantDemand: e.target.value })}
                    placeholder={bi('e.g. ৳12,000 / month', 'যেমনঃ ৳১২,০০০ / মাস')}
                  />
                </div>
                <div>
                  <label htmlFor="new-term-offer" style={{ fontSize: '0.8rem' }}><Bi en="Opposite Party Offers (৳)" bn="বিবাদীর প্রস্তাব (৳ বা বিষয়)" /></label>
                  <input
                    id="new-term-offer"
                    value={newTerm.oppositePartyOffer}
                    onChange={(e) => setNewTerm({ ...newTerm, oppositePartyOffer: e.target.value })}
                    placeholder={bi('e.g. ৳8,000 / month', 'যেমনঃ ৳৮,০০০ / মাস')}
                  />
                </div>
                <div>
                  <label htmlFor="new-term-agreed" style={{ fontSize: '0.8rem' }}><Bi en="Agreed Term (৳ / Duty)" bn="সম্মত মীমাংসা শর্ত" /></label>
                  <input
                    id="new-term-agreed"
                    value={newTerm.agreedTerm}
                    onChange={(e) => setNewTerm({ ...newTerm, agreedTerm: e.target.value })}
                    placeholder={bi('e.g. ৳10,000 / month payable by 5th', 'যেমনঃ ৳১০,০০০ / প্রতি মাসের ৫ তারিখের মধ্যে')}
                  />
                </div>
                <div>
                  <label htmlFor="new-term-status" style={{ fontSize: '0.8rem' }}><Bi en="Status" bn="পরিস্থিতি" /></label>
                  <select
                    id="new-term-status"
                    value={newTerm.status}
                    onChange={(e) => setNewTerm({ ...newTerm, status: e.target.value })}
                  >
                    <option value="AGREED">{bi('Agreed (সম্মত)', 'সম্মত')}</option>
                    <option value="DISAGREED">{bi('Disagreed (দ্বিমত)', 'দ্বিমত')}</option>
                    <option value="UNDER_NEGOTIATION">{bi('Under Negotiation (আলোচনাধীন)', 'আলোচনাধীন')}</option>
                  </select>
                </div>
              </div>

              <button type="submit" disabled={busy} style={{ marginTop: '0.6rem', fontSize: '0.85rem' }}>
                <Bi en="Add Proposed Settlement" bn="প্রস্তাবিত শর্ত যোগ করুন" />
              </button>
            </form>
          </section>

          {/* STEP 6: DECISION AFTER MEDIATION (3 OPTIONS) */}
          <section style={{ border: '1px solid #EAEAEA', borderRadius: '8px', padding: '1.25rem', backgroundColor: '#FFFFFF' }}>
            <h3 style={{ margin: '0 0 0.35rem', fontSize: '1.1rem' }}>
              <Bi en="Step 6 — Decision After Mediation (মধ্যস্থতা সমাপ্তি সিদ্ধান্ত)" bn="৬ষ্ঠ ধাপ — মধ্যস্থতা পরবর্তী চূড়ান্ত সিদ্ধান্ত" />
            </h3>
            <p className="muted" style={{ margin: '0 0 1rem', fontSize: '0.85rem' }}>
              <Bi en="At the conclusion of the session, select one of the three statutory outcomes:" bn="বৈঠকের সমাপ্তিতে ৩টি নির্ধারিত ফলাফলের যেকোনো একটি গ্রহণ করুন:" />
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
              {/* Option A: Settlement Reached */}
              <div style={{ border: outcome === 'AGREEMENT_REACHED' ? '2px solid #2E7D32' : '1px solid #EAEAEA', borderRadius: '6px', padding: '1rem', backgroundColor: '#FBFBFA', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem' }}>
                    <span style={{ fontSize: '1.2rem', color: '#2E7D32' }}>✓</span>
                    <strong style={{ fontSize: '0.98rem', color: '#111' }}>
                      <Bi en="A. Settlement Reached" bn="ক. আপস নিষ্পত্তি অর্জিত" />
                    </strong>
                  </div>
                  <p style={{ fontSize: '0.85rem', color: '#555', margin: 0 }}>
                    <Bi en="Parties have agreed on settlement terms. Proceed to generate and draft the formal settlement agreement." bn="উভয় পক্ষ শর্তে সম্মত হয়েছেন। আনুষ্ঠানিক মীমাংসাপত্র খসড়া প্রস্তুত করতে অগ্রসর হোন।" />
                  </p>
                </div>
                <button
                  type="button"
                  style={{ marginTop: '1rem', backgroundColor: '#2E7D32', borderColor: '#2E7D32', color: '#FFF' }}
                  disabled={busy}
                  onClick={() => {
                    setOutcome('AGREEMENT_REACHED')
                    send('/outcome', { outcome: 'AGREEMENT_REACHED', reason: outcomeReason.trim() || 'Settlement terms agreed upon by both parties.' }, bi('Outcome recorded as Settlement Reached. Ready to draft.', 'মীমাংসা অর্জিত হয়েছে নথিভুক্ত। খসড়া প্রস্তুত করুন।'))
                  }}
                >
                  <Bi en="Select: Settlement Reached ➔" bn="আপস নিষ্পত্তি নিশ্চিত করুন ➔" />
                </button>
              </div>

              {/* Option B: No Settlement */}
              <div style={{ border: outcome === 'NO_AGREEMENT' ? '2px solid #C62828' : '1px solid #EAEAEA', borderRadius: '6px', padding: '1rem', backgroundColor: '#FBFBFA', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem' }}>
                    <span style={{ fontSize: '1.2rem', color: '#C62828' }}>✕</span>
                    <strong style={{ fontSize: '0.98rem', color: '#111' }}>
                      <Bi en="B. No Settlement" bn="খ. মীমাংসা সম্ভব হয়নি (ব্যর্থ)" />
                    </strong>
                  </div>
                  <p style={{ fontSize: '0.85rem', color: '#555', margin: 0 }}>
                    <Bi en="Parties could not agree. Record failure reason and refer the case to the next legal step (Panel Lawyer / Litigation)." bn="আপস সম্ভব হয়নি। কারণ লিপিবদ্ধ করে মামলাটি আইনি পদক্ষেপ বা প্যানেল আইনজীবীতে প্রেরণ করুন।" />
                  </p>
                </div>
                <button
                  type="button"
                  style={{ marginTop: '1rem', backgroundColor: '#C62828', borderColor: '#C62828', color: '#FFF' }}
                  disabled={busy}
                  onClick={() => {
                    setOutcome('NO_AGREEMENT')
                    send('/outcome', { outcome: 'NO_AGREEMENT', reason: outcomeReason.trim() || 'Parties unable to agree on settlement terms.' }, bi('Outcome recorded as No Settlement. Proceed to legal referral.', 'মীমাংসা সম্ভব হয়নি নথিভুক্ত। আইনি রেফারাল বা প্যানেল আইনজীবীতে পাঠান।'))
                  }}
                >
                  <Bi en="Select: No Settlement ➔ Refer" bn="মীমাংসা ব্যর্থ ➔ রেফার করুন" />
                </button>
              </div>

              {/* Option C: Mediation Continued */}
              <div style={{ border: outcome === 'CONTINUED' ? '2px solid #956400' : '1px solid #EAEAEA', borderRadius: '6px', padding: '1rem', backgroundColor: '#FBFBFA', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem' }}>
                    <span style={{ fontSize: '1.2rem', color: '#956400' }}>🔄</span>
                    <strong style={{ fontSize: '0.98rem', color: '#111' }}>
                      <Bi en="C. Mediation Continued" bn="গ. মধ্যস্থতা অব্যাহত (পরবর্তী বৈঠক)" />
                    </strong>
                  </div>
                  <p style={{ fontSize: '0.85rem', color: '#555', margin: 0 }}>
                    <Bi en="Further discussion or document verification needed. Schedule another session date." bn="আরও আলোচনা বা নথিপত্র যাচাই প্রয়োজন। পরবর্তী সভার তারিখ নির্ধারণ করুন।" />
                  </p>
                </div>
                <button
                  type="button"
                  className="secondary-button"
                  style={{ marginTop: '1rem' }}
                  disabled={busy}
                  onClick={() => {
                    setOutcome('CONTINUED')
                    send('/outcome', { outcome: 'CONTINUED', reason: outcomeReason.trim() || 'Mediation continued for subsequent session.' }, bi('Mediation continued. Schedule next session.', 'মধ্যস্থতা অব্যাহত রাখা হয়েছে। পরবর্তী বৈঠক নির্ধারণ করুন।'))
                    setShowNewSessionForm(true)
                  }}
                >
                  <Bi en="Select: Continued ➔ Schedule Next" bn="অব্যাহত ➔ পরবর্তী বৈঠক নির্ধারণ" />
                </button>
              </div>
            </div>

            <div style={{ marginTop: '0.75rem' }}>
              <label htmlFor="outcome-reason-input" style={{ fontSize: '0.82rem' }}>
                <Bi en="Outcome Reason / Observations (কারণ বা পরবর্তী পদক্ষেপ)" bn="ফলাফলের কারণ ও পরবর্তী পদক্ষেপ" />
              </label>
              <textarea
                id="outcome-reason-input"
                value={outcomeReason}
                onChange={(e) => setOutcomeReason(e.target.value)}
                placeholder={bi('Record specific reasons for agreement or failure...', 'আপস বা ব্যর্থতার সুনির্দিষ্ট কারণ লিপিবদ্ধ করুন...')}
                rows={2}
                maxLength={1000}
              />
            </div>

            {/* If NO_AGREEMENT was chosen: Show referral link */}
            {mediation.outcome === 'NO_AGREEMENT' && (
              <div style={{ marginTop: '0.75rem', padding: '0.75rem', backgroundColor: '#FDEBEC', border: '1px solid #F5C6CB', borderRadius: '4px' }}>
                <strong style={{ color: '#9F2F2D' }}><Bi en="Next Legal Step: Case Referral" bn="পরবর্তী আইনি পদক্ষেপ: রেফারাল ও মামলা" /></strong>
                <p style={{ margin: '0.3rem 0', fontSize: '0.85rem' }}>
                  <Bi en="Since mediation was unsuccessful, refer this case to a panel lawyer for court proceedings or to an external partner." bn="যেহেতু মধ্যস্থতা ফলপ্রসূ হয়নি, তাই আদালতে মোকদ্দমা পরিচালনার জন্য প্যানেল আইনজীবী বা সংশ্লিষ্ট সংস্থায় রেফার করুন।" />
                </p>
                <a href="#referral-title" className="secondary-button" style={{ display: 'inline-block', marginTop: '0.35rem', textDecoration: 'none', padding: '0.35rem 0.75rem', fontSize: '0.82rem' }}>
                  <Bi en="➔ Send Referral / Assign Panel Lawyer" bn="➔ রেফারাল পাঠান / প্যানেল আইনজীবী নিয়োগ" />
                </a>
              </div>
            )}

            {/* If AGREEMENT_REACHED: Show button to prepare draft */}
            {mediation.outcome === 'AGREEMENT_REACHED' && (
              <form className="form-stack inline-form" style={{ marginTop: '1rem', borderTop: '1px solid #EAEAEA', paddingTop: '1rem' }} onSubmit={(event) => {
                event.preventDefault()
                // Incorporate negotiated terms into draft notes automatically
                const termsText = settlementTerms.length ? settlementTerms.map((t) => `${t.issue}: ${t.agreedTerm || t.oppositePartyOffer || t.applicantDemand}`).join('; ') : ''
                const combinedNotes = [notes.trim(), termsText ? `Agreed Terms: ${termsText}` : ''].filter(Boolean).join('\n\n')
                send('/draft', { template, notes: combinedNotes || 'Settlement reached on mutual agreement.', identifiersRemoved }, bi('Settlement draft ready. Review and proceed to signature.', 'মীমাংসাপত্রের খসড়া প্রস্তুত হয়েছে। পর্যালোচনা করে স্বাক্ষরে অগ্রসর হোন।'))
              }}>
                <h4 style={{ margin: 0, fontSize: '1rem' }}><Bi en="Prepare Settlement Agreement Draft" bn="মীমাংসাপত্রের খসড়া প্রস্তুতকরণ" /></h4>
                <p className="muted" style={{ margin: '0.2rem 0', fontSize: '0.82rem' }}>
                  <Bi en="Anonymised notes only; personal identifiers removed." bn="ব্যক্তিগত তথ্যবর্জিত খসড়া নোট।" />
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '0.75rem' }}>
                  <div>
                    <label htmlFor="settlement-template"><Bi en="Template" bn="নমুনা ফর্ম" /></label>
                    <select id="settlement-template" value={template} onChange={(event) => setTemplate(event.target.value)}>
                      {['MAINTENANCE', 'PROPERTY', 'LABOUR'].map((code) => <option key={code} value={code}>{say(code)}</option>)}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="mediator-notes"><Bi en="Anonymised Draft Notes" bn="খসড়া নোট ও বিশেষ শর্তাবলি" /></label>
                    <textarea id="mediator-notes" value={notes} onChange={(event) => setNotes(event.target.value)} minLength={10} maxLength={3000} placeholder={bi('Specific settlement details...', 'মীমাংসার সুনির্দিষ্ট বিবরণ...')} required />
                  </div>
                </div>
                <label className="checkbox-label" htmlFor="identifiers-removed">
                  <input id="identifiers-removed" type="checkbox" checked={identifiersRemoved} onChange={(event) => setIdentifiersRemoved(event.target.checked)} required />
                  <Bi en="I removed names, phone numbers, addresses and ID numbers." bn="আমি পক্ষগণের নাম, ফোন নম্বর, ঠিকানা ও জাতীয় পরিচয় নম্বর অপসারণ করেছি।" />
                </label>
                <button type="submit" disabled={busy || !identifiersRemoved}><Bi en="Prepare Settlement Draft ➔" bn="খসড়া প্রস্তুত করুন ➔" /></button>
              </form>
            )}
          </section>
        </div>
      )}

      {/* STEP 7: SETTLEMENT DRAFT */}
      {mediatorCanAct && safetyConfirmed && mediation.stage === 'DRAFT_OUTCOME' && mediation.draft && (
        <section className="form-stack inline-form" style={{ margin: '1.25rem 0', border: '1px solid #EAEAEA', borderRadius: '8px', padding: '1.25rem', backgroundColor: '#FFFFFF' }} aria-labelledby="settlement-title">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 id="settlement-title" style={{ margin: 0, fontSize: '1.1rem' }}>
              <Bi en="Step 7 — Settlement Draft (মীমাংসাপত্রের খসড়া)" bn="৭ম ধাপ — মীমাংসাপত্রের খসড়া ও পর্যালোচনা" /> · v{num(mediation.draft.version)}
            </h3>
            <span style={{ fontSize: '0.8rem', padding: '0.2rem 0.5rem', borderRadius: '4px', backgroundColor: '#EDF3EC', color: '#346538' }}>
              <Term code={mediation.draft.template} /> · <Term code={mediation.draft.status} />
            </span>
          </div>

          <p className="safety-note">
            <strong>{mediation.draft.aiAssisted ? bi('AI-ASSISTED DRAFT — HUMAN LEGAL REVIEW REQUIRED', 'এআই-সহায়তাপ্রাপ্ত খসড়া — দায়িত্বপ্রাপ্ত কর্মকর্তা কর্তৃক আইনি পর্যালোচনা আবশ্যক') : bi('DRAFT — HUMAN LEGAL REVIEW REQUIRED', 'খসড়া — দায়িত্বপ্রাপ্ত কর্মকর্তা কর্তৃক আইনি পর্যালোচনা আবশ্যক')}</strong>
            {' '}<Bi en="This template still needs human verification of terms, responsibilities, and amounts." bn="বাস্তবে ব্যবহারের আগে শর্তাবলি, দায়িত্ব ও অঙ্কের সঠিকতা মানুষ কর্তৃক যাচাই বাধ্যতামূলক।" />
          </p>

          {/* Negotiated terms summary badge */}
          {mediation.settlementTerms?.length > 0 && (
            <div style={{ padding: '0.75rem', backgroundColor: '#FAFAFA', border: '1px solid #EAEAEA', borderRadius: '4px' }}>
              <strong style={{ fontSize: '0.85rem' }}><Bi en="Agreed Settlement Terms from Step 5:" bn="৫ম ধাপ থেকে গৃহীত আপস শর্তসমূহ:" /></strong>
              <ul style={{ margin: '0.3rem 0 0', paddingLeft: '1.2rem', fontSize: '0.85rem' }}>
                {mediation.settlementTerms.map((t, idx) => (
                  <li key={idx}><strong>{t.issue}:</strong> {t.agreedTerm || t.oppositePartyOffer} ({t.status})</li>
                ))}
              </ul>
            </div>
          )}

          {/* Draft Sections Display / Editing */}
          {mediation.draft.sections.map((section) => (
            <div key={section.key} style={{ borderBottom: '1px solid #EAEAEA', paddingBottom: '0.75rem', marginTop: '0.75rem' }}>
              <h4 style={{ margin: '0 0 0.35rem', fontSize: '0.95rem' }}>
                {section.label} {section.aiFilled && <span className="badge wait-badge">{bi('AI-filled', 'এআই-পূরণকৃত')}</span>}
              </h4>
              {mediation.draft.status === 'HUMAN_REVIEW' ? (
                <>
                  <label htmlFor={`draft-section-${section.key}`} style={{ fontSize: '0.8rem' }}><Bi en="Reviewed text" bn="পর্যালোচিত খসড়া পাঠ" /></label>
                  <textarea id={`draft-section-${section.key}`} value={draftEdits[section.key] ?? section.text} onChange={(event) => setDraftEdits((current) => ({ ...current, [section.key]: event.target.value }))} maxLength={500} rows={3} />
                </>
              ) : (
                <p style={{ margin: '0.25rem 0', fontSize: '0.9rem', color: '#222', whiteSpace: 'pre-wrap' }}>{section.text}</p>
              )}
            </div>
          ))}

          {/* Follow-up Date Field */}
          <div style={{ marginTop: '0.75rem' }}>
            <label htmlFor="draft-followup-date" style={{ fontWeight: 600 }}>
              <Bi en="Follow-up Date (পরবর্তী ফলোআপের তারিখ)" bn="মীমাংসা পালনের পরবর্তী ফলোআপের তারিখ" />
            </label>
            <input
              id="draft-followup-date"
              type="date"
              value={followUpDate}
              onChange={(e) => setFollowUpDate(e.target.value)}
            />
          </div>

          {mediation.draft.inconsistencies.length > 0 && (
            <div role="group" aria-label={bi('Draft warnings', 'খসড়ার সতর্কতা')} style={{ padding: '0.75rem', backgroundColor: '#FDEBEC', border: '1px solid #F8D7DA', borderRadius: '4px' }}>
              <h4 style={{ margin: '0 0 0.25rem', color: '#9F2F2D' }}><Bi en="Draft warnings" bn="খসড়ার সতর্কতা" /></h4>
              {mediation.draft.inconsistencies.map((warning, index) => <p className="error" key={`${warning}-${index}`}>{warning}</p>)}
            </div>
          )}

          {mediation.draft.status === 'HUMAN_REVIEW' && (
            <>
              {/* Button: Edit Draft / Save Edits */}
              <form className="form-stack" onSubmit={async (event) => {
                event.preventDefault()
                const result = await send('/draft/amend', {
                  template: mediation.draft.template,
                  sections: mediation.draft.sections.map(({ key }) => ({ key, text: draftEdits[key] ?? '' })),
                  reason: amendReason,
                  followUpDate: followUpDate ? new Date(followUpDate).toISOString() : null,
                }, bi('Draft edits saved as a new version.', 'খসড়া পরিবর্তন নতুন সংস্করণ হিসেবে সংরক্ষিত হয়েছে।'))
                if (result) {
                  setAcknowledgements({ partyAUnderstands: false, partyAConsents: false, partyBUnderstands: false, partyBConsents: false })
                  setWarningsReviewed(false)
                  setReviewReason('')
                  setAmendReason('')
                }
              }}>
                <label htmlFor="settlement-amend-reason"><Bi en="Reason for edits" bn="সম্পাদনার কারণ" /></label>
                <textarea id="settlement-amend-reason" value={amendReason} onChange={(event) => setAmendReason(event.target.value)} minLength={10} maxLength={1000} required />
                <button type="submit" disabled={busy}><Bi en="Save Edits as New Version" bn="সম্পাদিত খসড়া সংরক্ষণ করুন" /></button>
              </form>

              {/* Button: Send for Review & Proceed to Signature */}
              <form className="form-stack" style={{ borderTop: '1px solid #EAEAEA', paddingTop: '1rem' }} onSubmit={(event) => {
                event.preventDefault()
                send('/draft/review', { ...acknowledgements, warningsReviewed, reason: reviewReason }, bi('Review confirmed. Proceeding to signatures.', 'পর্যালোচনা সংরক্ষিত হয়েছে। উভয় পক্ষ সম্মত থাকায় স্বাক্ষরের ধাপে অগ্রসর হওয়া হলো।'))
              }}>
                <h4><Bi en="Did both parties understand and agree to the draft?" bn="উভয় পক্ষ কি খসড়া শর্তাবলি বুঝেছেন ও সম্মত হয়েছেন?" /></h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.5rem' }}>
                  {Object.entries({
                    partyAUnderstands: ['Party A understood', 'প্রথম পক্ষ (পক্ষ ক) শর্তাবলি বুঝেছেন'],
                    partyAConsents: ['Party A agrees to sign', 'প্রথম পক্ষ (পক্ষ ক) স্বাক্ষরে সম্মত'],
                    partyBUnderstands: ['Party B understood', 'দ্বিতীয় পক্ষ (পক্ষ খ) শর্তাবলি বুঝেছেন'],
                    partyBConsents: ['Party B agrees to sign', 'দ্বিতীয় পক্ষ (পক্ষ খ) স্বাক্ষরে সম্মত']
                  }).map(([key, [en, bn]]) => (
                    <label className="checkbox-label" htmlFor={key} key={key} style={{ margin: 0 }}>
                      <input id={key} type="checkbox" checked={acknowledgements[key]} onChange={(event) => setAcknowledgements((current) => ({ ...current, [key]: event.target.checked }))} />
                      <Bi en={en} bn={bn} />
                    </label>
                  ))}
                </div>

                {mediation.draft.inconsistencies.length > 0 && (
                  <label className="checkbox-label" htmlFor="settlement-warnings-reviewed">
                    <input id="settlement-warnings-reviewed" type="checkbox" checked={warningsReviewed} onChange={(event) => setWarningsReviewed(event.target.checked)} />
                    <Bi en="I reviewed every draft warning with the parties." bn="আমি উভয় পক্ষের সঙ্গে খসড়ার প্রতিটি সতর্কতা ও অসংগতি আলোচনা করেছি।" />
                  </label>
                )}

                {hasUnsavedDraftEdits && <p role="alert" className="error"><Bi en="Save your draft edits as a new version before recording the review." bn="পর্যালোচনা নথিভুক্ত করার আগে খসড়ার পরিবর্তন নতুন সংস্করণ হিসেবে সংরক্ষণ করুন।" /></p>}

                <label htmlFor="settlement-review-reason"><Bi en="Review reason & attestation" bn="পর্যালোচনার প্রত্যয়ন ও কারণ" /></label>
                <textarea id="settlement-review-reason" value={reviewReason} onChange={(event) => setReviewReason(event.target.value)} minLength={10} maxLength={1000} required />

                <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
                  <button type="submit" disabled={busy || hasUnsavedDraftEdits || !acknowledgements.partyAConsents || !acknowledgements.partyBConsents} style={{ backgroundColor: '#2E7D32', borderColor: '#2E7D32', color: '#FFF' }}>
                    <Bi en="Proceed to Signatures ➔" bn="স্বাক্ষর ধাপে অগ্রসর হোন ➔" />
                  </button>
                </div>
              </form>
            </>
          )}
        </section>
      )}

      {/* STEP 8: SIGNATURES */}
      {signing && (
        <section className="form-stack inline-form" style={{ margin: '1.25rem 0', border: '1px solid #EAEAEA', borderRadius: '8px', padding: '1.25rem', backgroundColor: '#FFFFFF' }} aria-labelledby="signature-title">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <h3 id="signature-title" style={{ margin: 0, fontSize: '1.1rem' }}>
              <Bi en="Step 8 — Signatures (ডিজিটাল স্বাক্ষর ও প্রত্যয়ন)" bn="৮ম ধাপ — উভয় পক্ষ ও মধ্যস্থতাকারীর স্বাক্ষর" />
            </h3>
            {/* Visual Status Stepper Badge */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.78rem', fontWeight: 600 }}>
              <span style={{ padding: '0.15rem 0.45rem', borderRadius: '4px', backgroundColor: '#EDF3EC', color: '#346538' }}>Draft</span>
              <span>➔</span>
              <span style={{ padding: '0.15rem 0.45rem', borderRadius: '4px', backgroundColor: missingPartySignatures || !signedRoles.has('MEDIATOR') ? '#E1F3FE' : '#EDF3EC', color: missingPartySignatures || !signedRoles.has('MEDIATOR') ? '#1F6C9F' : '#346538' }}>
                {missingPartySignatures || !signedRoles.has('MEDIATOR') ? 'Signing…' : 'Signed'}
              </span>
              <span>➔</span>
              <span style={{ padding: '0.15rem 0.45rem', borderRadius: '4px', backgroundColor: '#FBF3DB', color: '#956400' }}>Pending Certification</span>
            </div>
          </div>

          <p className="muted" style={{ margin: '0 0 0.75rem', fontSize: '0.85rem' }}>
            <Bi en="Record signatures asynchronously: Each party enters a verified one-time code to sign in browser. DLAO/Mediator signs with local passphrase." bn="প্রত্যেক পক্ষকে পৃথক গোপন কোড প্রদান করুন। তারা নিজ ডিভাইসে খসড়া যাচাই করে স্বাক্ষর করবেন। ডিএলএও/মধ্যস্থতাকারী পাসফ্রেজের মাধ্যমে স্বাক্ষর নিশ্চিত করবেন।" />
          </p>

          <p><Link to="/mediation/sign" style={{ fontWeight: 600 }}><Bi en="Open the party signing portal (পক্ষের স্বাক্ষর পৃষ্ঠা)" bn="পক্ষের স্বাক্ষরের পোর্টাল খুলুন ↗" /></Link></p>

          {/* Party A and Party B Signature Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '0.75rem', margin: '0.5rem 0' }}>
            {['PARTY_A', 'PARTY_B'].map((partyRole) => {
              const invite = mediation.signingInvitations?.find((entry) => entry.signerRole === partyRole)
              const isSigned = signedRoles.has(partyRole)
              return (
                <div key={partyRole} style={{ border: '1px solid #EAEAEA', borderRadius: '6px', padding: '0.85rem', backgroundColor: isSigned ? '#EDF3EC' : '#FAFAFA' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                    <strong><Term code={partyRole} /></strong>
                    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: isSigned ? '#346538' : '#956400' }}>
                      {isSigned ? bi('✓ Signed', '✓ স্বাক্ষরিত') : bi('Pending', 'অপেক্ষমাণ')}
                    </span>
                  </div>
                  {!isSigned && (
                    <>
                      <button type="button" className="secondary-button" style={{ width: '100%', fontSize: '0.82rem' }} disabled={busy || !online} onClick={() => issueCode(partyRole)}>
                        {bi(invite ? `Replace ${partyRole.replaceAll('_', ' ')} Code` : `Issue ${partyRole.replaceAll('_', ' ')} Code`, invite ? `${signerBn[partyRole]}-এর কোড বদলান` : `${signerBn[partyRole]}-এর কোড প্রদান`)}
                      </button>
                      {issuedCodes[partyRole] && (
                        <p role="status" style={{ margin: '0.4rem 0 0', fontSize: '0.82rem' }}>
                          <Bi en="Private code:" bn="গোপন কোড:" /> <code className="signing-code">{issuedCodes[partyRole]}</code>
                        </p>
                      )}
                    </>
                  )}
                </div>
              )
            })}
          </div>

          <button type="button" className="secondary-button" disabled={busy || !online} onClick={refreshSignatures}>
            <Bi en="Refresh party signatures" bn="পক্ষগুলোর সর্বশেষ স্বাক্ষর রিলোড করুন" />
          </button>

          {mediatorCanAct && mediation.stage === 'SIGNATURES' && (
            <MediatorIdentityVerification key={`${mediation.id}:${mediation.signingInvitations?.map((invite) => invite.updatedAt).join(':')}`} applicationId={applicationId} token={session.token} />
          )}

          {/* Signature audit list */}
          <ol className="plain-list" style={{ marginTop: '0.5rem' }}>
            {signatures.map((record) => (
              <li key={record.signerRole}>
                <strong><Term code={record.signerRole} /></strong>
                {record.signerRole === 'MEDIATOR' ? <> · <Term code={record.authorizationMethod} /></> : null}
                {' '}· {when(record.receivedAt)} · <code>{record.documentHash.slice(0, 12)}…</code>
              </li>
            ))}
          </ol>

          {mediation.earlierSignatureCount > 0 && <p className="muted"><Bi en={`${mediation.earlierSignatureCount} signatures on an earlier version stay on record; this version needs fresh signatures.`} bn={`আগের সংস্করণের ${num(mediation.earlierSignatureCount)}টি স্বাক্ষর রেকর্ডে থাকছে; এই সংস্করণে নতুন করে স্বাক্ষর লাগবে।`} /></p>}

          {/* Mediator / DLAO Passphrase Signing */}
          <div style={{ marginTop: '0.75rem', padding: '0.85rem', backgroundColor: '#F9F9F8', borderRadius: '6px', border: '1px solid #EAEAEA' }}>
            <p role="status">{online ? bi('Connection: online', 'সংযোগ: অনলাইন') : bi('Connection: offline', 'সংযোগ: অফলাইন')} · {bi(`encrypted signatures awaiting sync: ${queue.length}`, `সিঙ্কের অপেক্ষায়: ${num(queue.length)}`)}</p>
            {queue.length > 0 && <><button type="button" className="secondary-button" disabled={!online || signingPassphrase.length < 8 || busy} onClick={syncPending}><Bi en="Sync now" bn="এখন সিঙ্ক করুন" /></button><ul className="plain-list">{queue.map((item) => <li key={item.id}><Bi en="Encrypted signature" bn="এনক্রিপ্ট করা স্বাক্ষর" /> · {when(item.updatedAt)}</li>)}</ul></>}
            <label htmlFor="signature-passphrase">
              <Bi en="Passphrase for DLAO/Mediator Signature (কমপক্ষে ৮ অক্ষর)" bn="ডিএলএও/মধ্যস্থতাকারীর স্বাক্ষরের স্থানীয় পাসফ্রেজ" />
            </label>
            <input id="signature-passphrase" type="password" autoComplete="off" minLength={8} value={signingPassphrase} onChange={(event) => setSigningPassphrase(event.target.value)} />

            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
              <button type="button" disabled={busy || signingPassphrase.length < 8 || missingPartySignatures || signedRoles.has('MEDIATOR')} onClick={sign}>
                {role === 'DLAO_OFFICER'
                  ? bi(`Sign in the mediator's place (DLAO officer)${online ? ' and sync' : ' offline'}`, `মধ্যস্থতাকারীর স্থলে স্বাক্ষর দিন (ডিএলএও কর্মকর্তা)${online ? ' ও সিঙ্ক করুন' : ' অফলাইনে'}`)
                  : bi(`Create mediator signature${online ? ' and sync' : ' offline'}`, `মধ্যস্থতাকারীর স্বাক্ষর ${online ? 'দিন ও সিঙ্ক করুন' : 'অফলাইনে দিন'}`)}
              </button>
            </div>
          </div>

          {/* STEP 9 SUBMISSION: Once all 3 signatures are recorded, advance to CLAO */}
          {!missingPartySignatures && signedRoles.has('MEDIATOR') && (
            <div style={{ marginTop: '1rem', padding: '1rem', backgroundColor: '#EDF3EC', borderRadius: '6px', border: '1px solid #B7DAB9' }}>
              <strong style={{ color: '#28562d' }}>
                ✓ <Bi en="All Parties & Mediator Have Signed!" bn="উভয় পক্ষ ও মধ্যস্থতাকারীর স্বাক্ষর সম্পন্ন হয়েছে!" />
              </strong>
              <p style={{ margin: '0.35rem 0', fontSize: '0.88rem', color: '#333' }}>
                <Bi en="Status: Signed. Proceed to Step 9 by submitting this settlement for CLAO Legal Review & Certification." bn="পরিস্থিতি: স্বাক্ষরিত। সিএলএও আইনি পর্যালোচনা ও সনদের জন্য ৯ম ধাপে জমা দিন।" />
              </p>
              <button
                type="button"
                style={{ marginTop: '0.5rem', backgroundColor: '#1F6C9F', borderColor: '#1F6C9F', color: '#FFF' }}
                disabled={busy}
                onClick={() => send('/advance', {}, bi('Submitted for CLAO Certification.', 'সিএলএও সনদের জন্য সফলভাবে প্রেরণ করা হয়েছে।'))}
              >
                <Bi en="Submit for CLAO Certification ➔" bn="সিএলএও সনদের জন্য জমা দিন ➔" />
              </button>
            </div>
          )}

          {verifier}
        </section>
      )}

      {/* STEP 9: CLAO CERTIFICATION / LEGAL REVIEW */}
      {mediation.stage === 'PENDING_CLAO_CERTIFICATION' && (
        <section className="form-stack inline-form clao-certify" style={{ margin: '1.25rem 0', border: '1px solid #EAEAEA', borderRadius: '8px', padding: '1.25rem', backgroundColor: '#FFFFFF' }} aria-labelledby="clao-title">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 id="clao-title" style={{ margin: 0, fontSize: '1.1rem' }}>
              <Bi en="Step 9 — CLAO Legal Review & Certification (আইনি পর্যালোচনা ও সনদ)" bn="৯ম ধাপ — সিএলএও আইনি পর্যালোচনা ও সনদ প্রদান" />
            </h3>
            <span style={{ fontSize: '0.78rem', fontWeight: 600, padding: '0.2rem 0.6rem', borderRadius: '9999px', backgroundColor: '#FBF3DB', color: '#956400' }}>
              <Bi en="Status: Pending CLAO Certification" bn="অবস্থা: সিএলএও সনদ অপেক্ষমাণ" />
            </span>
          </div>

          {/* DLAO View: Notice if returned for correction */}
          {mediation.claoReturnReason && (
            <div style={{ padding: '0.85rem', backgroundColor: '#FDEBEC', border: '1px solid #F5C6CB', borderRadius: '6px', margin: '0.75rem 0' }}>
              <strong style={{ color: '#9F2F2D' }}>
                ⚠️ <Bi en="Returned for Correction by CLAO" bn="সিএলএও কর্তৃক সংশোধনের জন্য ফেরত পাঠানো হয়েছে" />
              </strong>
              <p style={{ margin: '0.35rem 0', fontSize: '0.88rem' }}>
                <strong><Bi en="Reason:" bn="কারণ:" /></strong> {mediation.claoReturnReason}
              </p>
              {mediation.claoReturnedAt && (
                <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>
                  <Bi en="Returned on:" bn="ফেরত প্রদানের তারিখ:" /> {when(mediation.claoReturnedAt)}
                </p>
              )}
            </div>
          )}

          {role === 'CLAO' ? (
            <>
              <p className="safety-note"><strong><Term code={mediation.legalEffectState} /></strong>. <Bi en="Applicability depends on date and jurisdiction; verify before certifying." bn="আইনের প্রযোজ্যতা কার্যকর তারিখ ও এখতিয়ারভুক্ত এলাকার ওপর নির্ভরশীল; সনদ প্রদানের পূর্বে আইনি সঠিকতা যাচাই করুন।" /></p>

              <h4><Bi en="1. Review the Signed Settlement" bn="১. স্বাক্ষরিত মীমাংসাপত্র পর্যালোচনা করুন" /></h4>
              {mediation.draft ? <div className="clao-document" style={{ border: '1px solid #EAEAEA', padding: '0.75rem', borderRadius: '4px', backgroundColor: '#FAFAFA' }}>
                <p className="muted"><Term code={mediation.draft.template} /> · <Bi en="version" bn="সংস্করণ" /> {num(mediation.draft.version)}</p>
                {mediation.draft.sections.map((section) => <div key={section.key} style={{ margin: '0.5rem 0' }}><h5>{section.label}</h5><p style={{ margin: 0, fontSize: '0.88rem' }}>{section.text}</p></div>)}
              </div> : <p className="error"><Bi en="The signed settlement is missing." bn="স্বাক্ষরিত মীমাংসাপত্র পাওয়া যায়নি।" /></p>}

              <h4><Bi en="2. Check Signatures" bn="২. স্বাক্ষরসমূহ যাচাই করুন" /></h4>
              <ul className="plain-list">{['PARTY_A', 'PARTY_B', 'MEDIATOR'].map((signerRole) => {
                const record = signatures.find((item) => item.signerRole === signerRole)
                const checked = signatureCheck?.signatures.find((item) => item.signerRole === signerRole)
                return <li key={signerRole}><strong><Term code={signerRole} /></strong> · {record ? <>{bi('signed', 'স্বাক্ষরিত')} {when(record.receivedAt)}{signerRole === 'MEDIATOR' ? <> · <Term code={record.authorizationMethod} /></> : null}</> : bi('not signed', 'স্বাক্ষর নেই')}{checked ? <> · <strong>{checked.valid ? bi('verified', 'যাচাইকৃত') : bi('does not verify', 'যাচাই ব্যর্থ')}</strong></> : null}</li>
              })}</ul>
              <button type="button" className="secondary-button" disabled={busy} onClick={checkSignatures}><Bi en="Check signatures now" bn="এখনই স্বাক্ষর যাচাই করুন" /></button>
              {signatureCheck && <p role="status" className={signatureCheck.allValid ? 'success' : 'error'}>{signatureCheck.allValid ? bi('All three signatures match this settlement.', 'তিনটি স্বাক্ষরই এই মীমাংসাপত্রের সঙ্গে মিলেছে।') : bi('A signature is missing or does not match. Do not certify.', 'কোনো স্বাক্ষর নেই বা মেলেনি। সনদ দেবেন না।')}</p>}

              <h4><Bi en="3. Record Statutory Legal Basis" bn="৩. আইনি প্রযোজ্যতা ও ভিত্তি নির্ধারণ" /></h4>
              {mediation.legalApplicability !== 'APPLICABLE_VERIFIED' ? (
                <form className="form-stack" onSubmit={(event) => { event.preventDefault(); send('/legal-applicability', { applicability: 'APPLICABLE_VERIFIED', basis: applicabilityBasis }, bi('Applicability recorded. Now sign the certification.', 'প্রযোজ্যতা নথিভুক্ত হয়েছে। এবার সনদে স্বাক্ষর করুন।')) }}>
                  <label htmlFor="legal-basis"><Bi en="Verified legal basis (Section 21G etc.)" bn="যাচাইকৃত আইনি ভিত্তি (ধারা ২১জি ইত্যাদি)" /></label>
                  <textarea id="legal-basis" value={applicabilityBasis} onChange={(event) => setApplicabilityBasis(event.target.value)} minLength={10} maxLength={500} required />
                  <button type="submit" disabled={busy}><Bi en="Record Verified Applicability" bn="প্রযোজ্যতা সংরক্ষণ করুন" /></button>
                </form>
              ) : <p><Bi en="Legal basis:" bn="আইনি ভিত্তি:" /> {mediation.legalReviewBasis}</p>}

              <h4><Bi en="4. Certification Decision" bn="৪. সনদ প্রদান সংক্রান্ত চূড়ান্ত সিদ্ধান্ত" /></h4>
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                {mediation.legalApplicability === 'APPLICABLE_VERIFIED' && (
                  <form className="form-stack" onSubmit={signAndCertify} style={{ flex: 1, minWidth: '280px' }}>
                    <label htmlFor="certificate-reason"><Bi en="Certification Reason" bn="সনদের কারণ/বিবরণ" /></label>
                    <textarea id="certificate-reason" value={certificateReason} onChange={(event) => setCertificateReason(event.target.value)} minLength={10} maxLength={500} required />
                    <label className="checkbox-label" htmlFor="clao-confirm">
                      <input id="clao-confirm" type="checkbox" checked={claoConfirmed} onChange={(event) => setClaoConfirmed(event.target.checked)} required />
                      <Bi en="I read this settlement and I sign this certification myself." bn="আমি এই মীমাংসাপত্র পড়েছি এবং নিজে এই সনদে স্বাক্ষর করছি।" />
                    </label>
                    <button type="submit" disabled={busy || !claoConfirmed || !online || !mediation.draft} style={{ backgroundColor: '#2E7D32', borderColor: '#2E7D32', color: '#FFF' }}>
                      {busy ? bi('Signing…', 'স্বাক্ষর হচ্ছে…') : bi('Approve / Certify (অনুমোদন ও সনদ প্রদান)', 'অনুমোদন ও সনদ প্রদান')}
                    </button>
                  </form>
                )}

                {/* Return for Correction Option */}
                <div style={{ flex: 1, minWidth: '280px', borderLeft: '1px solid #EAEAEA', paddingLeft: '1rem' }}>
                  <button type="button" className="secondary-button" style={{ color: '#C62828' }} onClick={() => setShowReturnForm(!showReturnForm)}>
                    <Bi en="Return for Correction (সংশোধনের জন্য ফেরত পাঠান)" bn="সংশোধনের জন্য ফেরত পাঠান" />
                  </button>

                  {showReturnForm && (
                    <form onSubmit={handleClaoReturn} className="form-stack" style={{ marginTop: '0.5rem' }}>
                      <label htmlFor="return-reason"><Bi en="Correction Reason" bn="সংশোধনের কারণ" /></label>
                      <textarea id="return-reason" value={claoReturnReasonText} onChange={(e) => setClaoReturnReasonText(e.target.value)} placeholder={bi('Specify what terms or documents need correction...', 'কোন কোন শর্ত বা নথি সংশোধন করা প্রয়োজন তা লিখুন...')} minLength={5} maxLength={1000} required />
                      <button type="submit" disabled={busy} style={{ backgroundColor: '#C62828', borderColor: '#C62828', color: '#FFF' }}>
                        <Bi en="Confirm Return for Correction" bn="সংশোধনের জন্য ফেরত পাঠানো নিশ্চিত করুন" />
                      </button>
                    </form>
                  )}
                </div>
              </div>
            </>
          ) : (
            <p className="muted">
              <Bi en="Settlement is under legal review with the Chief Legal Aid Officer (CLAO). You will be notified once certified or returned." bn="মীমাংসাপত্রটি বর্তমানে প্রধান লিগ্যাল এইড কর্মকর্তার (সিএলএও) আইনি পর্যালোচনাধীন রয়েছে।" />
            </p>
          )}
          {verifier}
        </section>
      )}

      {/* STEP 10: CERTIFIED / COMPLETED ARCHIVE */}
      {mediation.stage === 'CERTIFIED_FINAL' && (
        <section style={{ margin: '1.25rem 0', border: '1px solid #B7DAB9', borderRadius: '8px', padding: '1.25rem', backgroundColor: '#FFFFFF' }} aria-labelledby="completed-title">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', borderBottom: '1px solid #EAEAEA', paddingBottom: '0.5rem' }}>
            <h3 id="completed-title" style={{ margin: 0, fontSize: '1.15rem', color: '#2E7D32' }}>
              ✓ <Bi en="Step 10 — Status: Mediation Completed (মধ্যস্থতা সম্পন্ন)" bn="১০ম ধাপ — ফলাফল: মধ্যস্থতা সফলভাবে সম্পন্ন" />
            </h3>
            <span style={{ fontSize: '0.8rem', fontWeight: 600, padding: '0.2rem 0.6rem', borderRadius: '9999px', backgroundColor: '#EDF3EC', color: '#346538' }}>
              <Bi en="Officially Certified" bn="সনদপ্রাপ্ত চূড়ান্ত মীমাংসা" />
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
            {/* 1. Final Settlement Summary */}
            <div style={{ border: '1px solid #EAEAEA', borderRadius: '6px', padding: '0.85rem', backgroundColor: '#FAFAFA' }}>
              <strong style={{ fontSize: '0.92rem' }}><Bi en="1. Final Settlement Agreement" bn="১. চূড়ান্ত মীমাংসাপত্র" /></strong>
              {mediation.draft ? (
                <div style={{ marginTop: '0.4rem', fontSize: '0.85rem' }}>
                  <p className="muted" style={{ margin: 0 }}><Term code={mediation.draft.template} /> · v{num(mediation.draft.version)}</p>
                  {mediation.draft.sections.map((s) => (
                    <div key={s.key} style={{ marginTop: '0.35rem' }}>
                      <span style={{ fontWeight: 600 }}>{s.label}: </span>
                      <span>{s.text}</span>
                    </div>
                  ))}
                </div>
              ) : <p className="muted"><Bi en="Draft stored" bn="খসড়া সংরক্ষিত" /></p>}
            </div>

            {/* 2. Cryptographic Signatures */}
            <div style={{ border: '1px solid #EAEAEA', borderRadius: '6px', padding: '0.85rem', backgroundColor: '#FAFAFA' }}>
              <strong style={{ fontSize: '0.92rem' }}><Bi en="2. Verified Signatures" bn="২. যাচাইকৃত স্বাক্ষরসমূহ" /></strong>
              <ul className="plain-list" style={{ marginTop: '0.4rem', fontSize: '0.82rem' }}>
                {signatures.map((sig) => (
                  <li key={sig.signerRole} style={{ margin: '0.25rem 0' }}>
                    <strong><Term code={sig.signerRole} /></strong>: {when(sig.receivedAt)} · <code>{sig.documentHash.slice(0, 10)}…</code>
                  </li>
                ))}
              </ul>
            </div>

            {/* 3. Official Certification */}
            <div style={{ border: '1px solid #EAEAEA', borderRadius: '6px', padding: '0.85rem', backgroundColor: '#FAFAFA' }}>
              <strong style={{ fontSize: '0.92rem' }}><Bi en="3. Official Certification" bn="৩. সিএলএও সনদ ও আইনি ভিত্তি" /></strong>
              <div style={{ marginTop: '0.4rem', fontSize: '0.85rem' }}>
                <p style={{ margin: '0.2rem 0' }}><strong><Bi en="Date:" bn="সনদের তারিখ:" /></strong> {when(mediation.certifiedAt)}</p>
                <p style={{ margin: '0.2rem 0' }}><strong><Bi en="Legal Basis:" bn="আইনি ভিত্তি:" /></strong> {mediation.legalReviewBasis || 'Section 21G Verified'}</p>
                {mediation.certificateReason && <p style={{ margin: '0.2rem 0' }}><strong><Bi en="Reason:" bn="সনদের কারণ:" /></strong> {mediation.certificateReason}</p>}
              </div>
            </div>

            {/* 4. Dates & Participants */}
            <div style={{ border: '1px solid #EAEAEA', borderRadius: '6px', padding: '0.85rem', backgroundColor: '#FAFAFA' }}>
              <strong style={{ fontSize: '0.92rem' }}><Bi en="4. Dates, Participants & Audit" bn="৪. সময়সূচি, অংশগ্রহণকারী ও অডিট" /></strong>
              <div style={{ marginTop: '0.4rem', fontSize: '0.85rem' }}>
                <p style={{ margin: '0.2rem 0' }}><strong><Bi en="Language:" bn="ভাষা:" /></strong> {mediation.language || 'Bangla'}</p>
                <p style={{ margin: '0.2rem 0' }}><strong><Bi en="Participants:" bn="অংশগ্রহণকারী:" /></strong> {mediation.participants?.join(', ') || 'Applicant, Opposite Party, Mediator'}</p>
                <p style={{ margin: '0.4rem 0 0' }}>{verifier}</p>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* STEP 11: SETTLEMENT COMPLIANCE & FOLLOW-UP */}
      {mediation.stage === 'CERTIFIED_FINAL' && (
        <section style={{ margin: '1.25rem 0', border: '1px solid #EAEAEA', borderRadius: '8px', padding: '1.25rem', backgroundColor: '#FFFFFF' }} aria-labelledby="followup-title">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <h3 id="followup-title" style={{ margin: 0, fontSize: '1.1rem' }}>
              <Bi en="Step 11 — Follow-up & Compliance (বাস্তবায়ন পর্যবেক্ষণ)" bn="১১তম ধাপ — মীমাংসা বাস্তবায়ন ও ফলোআপ পর্যবেক্ষণ" />
            </h3>
            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#1F6C9F' }}>
              <Bi en="Follow-up Due: " bn="ফলোআপ নির্ধারিত তারিখ: " />
              {followUpDate || mediation.followUp?.dueDate ? when(followUpDate || mediation.followUp?.dueDate) : bi('As per agreement', 'চুক্তির শর্তানুযায়ী')}
            </span>
          </div>

          <p className="muted" style={{ margin: '0 0 1rem', fontSize: '0.85rem' }}>
            <Bi en="Track whether the opposite party is adhering to maintenance payments and settlement conditions." bn="প্রতিপক্ষ নিয়মিত খোরপোশ/অর্থ প্রদান করছেন কি না এবং চুক্তির শর্ত পালন করছেন কি না তা তদারকি করুন।" />
          </p>

          <div className="form-stack">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '0.75rem', padding: '0.75rem', backgroundColor: '#F9F9F8', borderRadius: '6px' }}>
              <label className="checkbox-label" htmlFor="fu-settlement-followed" style={{ margin: 0 }}>
                <input id="fu-settlement-followed" type="checkbox" checked={fuSettlementFollowed} onChange={(e) => setFuSettlementFollowed(e.target.checked)} />
                <Bi en="Settlement being followed (শর্তাবলি মানা হচ্ছে)" bn="মীমাংসার শর্তাবলি পালন করা হচ্ছে" />
              </label>

              <div>
                <label htmlFor="fu-payment-status" style={{ fontSize: '0.8rem' }}><Bi en="Payment Status" bn="অর্থ প্রদান/পরিশোধের অবস্থা" /></label>
                <select id="fu-payment-status" value={fuPaymentStatus} onChange={(e) => setFuPaymentStatus(e.target.value)}>
                  <option value="PAID">{bi('Payment Made (পরিশোধিত)', 'পরিশোধিত')}</option>
                  <option value="NOT_PAID">{bi('Payment Not Made (অপরিশোধিত)', 'অপরিশোধিত')}</option>
                  <option value="PARTIAL">{bi('Partial Payment (আংশিক পরিশোধিত)', 'আংশিক পরিশোধিত')}</option>
                  <option value="NOT_APPLICABLE">{bi('Not Applicable (প্রযোজ্য নয়)', 'প্রযোজ্য নয়')}</option>
                </select>
              </div>

              <div>
                <label htmlFor="fu-compliance-status" style={{ fontSize: '0.8rem' }}><Bi en="Agreement Compliance" bn="চুক্তির সামগ্রিক অনুপালন" /></label>
                <select id="fu-compliance-status" value={fuComplianceStatus} onChange={(e) => setFuComplianceStatus(e.target.value)}>
                  <option value="COMPLIED">{bi('Complied with (সম্পূর্ণ পালিত)', 'সম্পূর্ণ পালিত')}</option>
                  <option value="PARTIALLY_COMPLIED">{bi('Partially Complied (আংশিক পালিত)', 'আংশিক পালিত')}</option>
                  <option value="NOT_COMPLIED">{bi('Not Complied (পালিত হয়নি)', 'পালিত হয়নি')}</option>
                </select>
              </div>

              <label className="checkbox-label" htmlFor="fu-further-assistance" style={{ margin: 0 }}>
                <input id="fu-further-assistance" type="checkbox" checked={fuFurtherAssistance} onChange={(e) => setFuFurtherAssistance(e.target.checked)} />
                <Bi en="Further legal assistance required (অতিরিক্ত সহায়তা প্রয়োজন)" bn="অতিরিক্ত আইনি সহায়তা প্রয়োজন" />
              </label>
            </div>

            <div style={{ marginTop: '0.5rem' }}>
              <label htmlFor="fu-notes" style={{ fontSize: '0.82rem' }}><Bi en="Follow-up Notes / Observations" bn="ফলোআপের বিস্তারিত পর্যবেক্ষণ" /></label>
              <textarea
                id="fu-notes"
                value={fuNotes}
                onChange={(e) => setFuNotes(e.target.value)}
                placeholder={bi('e.g. Applicant received first two installments on time; satisfaction expressed...', 'যেমনঃ বাদী প্রথম দুইটি কিস্তির টাকা সময়মতো পেয়েছেন...')}
                rows={2}
              />
            </div>

            {/* Action Buttons: Close Case or Reopen / Refer */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginTop: '0.75rem' }}>
              <button
                type="button"
                disabled={busy}
                style={{ backgroundColor: '#2E7D32', borderColor: '#2E7D32', color: '#FFF' }}
                onClick={() => handleFollowUp('CLOSE_CASE')}
              >
                ✓ <Bi en="Close Case (মামলা নিষ্পত্তি ও বন্ধ)" bn="মামলা চূড়ান্ত নিষ্পত্তি ও বন্ধ করুন" />
              </button>

              <button
                type="button"
                disabled={busy}
                style={{ backgroundColor: '#C62828', borderColor: '#C62828', color: '#FFF' }}
                onClick={() => handleFollowUp('REOPEN_REFERRAL')}
              >
                🛑 <Bi en="Reopen / Refer for Further Legal Action" bn="পুনরায় আইনি পদক্ষেপে প্রেরণ / রেফার করুন" />
              </button>

              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={() => handleFollowUp('KEEP_MONITORING')}
              >
                💾 <Bi en="Save Monitoring Update" bn="ফলোআপ তথ্য সংরক্ষণ করুন" />
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Multiple Mediation Sessions Log (Chronological History) */}
      <section className="mediation-sessions-section" style={{ margin: '1.25rem 0', border: '1px solid #EAEAEA', borderRadius: '6px', padding: '1rem', backgroundColor: '#FAFAFA' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.05rem', color: '#111' }}>
              <Bi en="Mediation Sessions History (বৈঠক সমূহের ধারাবাহিক ইতিহাস)" bn="মধ্যস্থতার বৈঠক সমূহের ধারাবাহিক ইতিহাস" />
            </h3>
            <p className="muted" style={{ margin: '0.2rem 0 0', fontSize: '0.85rem' }}>
              <Bi en="Multiple joint & separate mediation sessions log (১ম বৈঠক, ২য় বৈঠক...)" bn="বহুস্তরীয় মধ্যস্থতা বৈঠকের ইতিহাস ও ফলাফল (১ম বৈঠক, ২য় বৈঠক...)" />
            </p>
          </div>
          {(mediatorCanAct || role === 'DLAO_OFFICER') && safetyConfirmed && (
            <button
              type="button"
              className="secondary-button"
              style={{ fontSize: '0.82rem', padding: '0.35rem 0.75rem' }}
              onClick={() => setShowNewSessionForm(!showNewSessionForm)}
            >
              {showNewSessionForm ? bi('Hide Session Form', 'ফর্ম বন্ধ করুন') : bi('+ Record Session (বৈঠক নথিভুক্ত)', '+ নতুন বৈঠক লিপিবদ্ধ')}
            </button>
          )}
        </div>

        {/* Record New Session Form */}
        {showNewSessionForm && (
          <form onSubmit={submitSession} className="form-stack" style={{ marginTop: '0.75rem', padding: '1rem', backgroundColor: '#FFFFFF', border: '1px solid #D9D9D9', borderRadius: '6px' }}>
            <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.95rem' }}>
              <Bi en="Record Mediation Session Outcome & Next Date" bn="বৈঠকের ফলাফল ও পরবর্তী তারিখ নির্ধারণ" />
            </h4>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem' }}>
              <div>
                <label htmlFor="session-date"><Bi en="Session Date & Time" bn="বৈঠকের তারিখ ও সময়" /></label>
                <input
                  id="session-date"
                  type="datetime-local"
                  value={sessionScheduledAt}
                  onChange={(e) => setSessionScheduledAt(e.target.value)}
                  required
                />
              </div>
              <div>
                <label htmlFor="session-mode"><Bi en="Mode" bn="মাধ্যম" /></label>
                <select id="session-mode" value={sessionMode} onChange={(e) => setSessionMode(e.target.value)}>
                  <option value="IN_PERSON">{say('IN_PERSON')}</option>
                  <option value="REMOTE">{say('REMOTE')}</option>
                  <option value="HYBRID">{say('HYBRID')}</option>
                </select>
              </div>
              <div>
                <label htmlFor="session-venue"><Bi en="Venue / Room" bn="স্থান / কক্ষ" /></label>
                <input
                  id="session-venue"
                  value={sessionVenue}
                  onChange={(e) => setSessionVenue(e.target.value)}
                  placeholder={bi('e.g. DLAO Room 2', 'যেমনঃ ডিএলএও সম্মেলন কক্ষ')}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginTop: '0.5rem' }}>
              <div>
                <label htmlFor="session-party-a"><Bi en="Party A (Applicant / Petitioner)" bn="পক্ষ ক (বাদী)" /></label>
                <select id="session-party-a" value={sessionPartyA} onChange={(e) => setSessionPartyA(e.target.value)}>
                  <option value="ATTENDED">{say('ATTENDED')}</option>
                  <option value="REPRESENTED">{say('REPRESENTED')}</option>
                  <option value="ABSENT">{say('ABSENT')}</option>
                </select>
              </div>
              <div>
                <label htmlFor="session-party-b"><Bi en="Party B (Opposing / Respondent)" bn="পক্ষ খ (বিবাদী)" /></label>
                <select id="session-party-b" value={sessionPartyB} onChange={(e) => setSessionPartyB(e.target.value)}>
                  <option value="ATTENDED">{say('ATTENDED')}</option>
                  <option value="REPRESENTED">{say('REPRESENTED')}</option>
                  <option value="ABSENT">{say('ABSENT')}</option>
                </select>
              </div>
            </div>

            <div style={{ marginTop: '0.5rem' }}>
              <label htmlFor="session-summary"><Bi en="Session Summary & Discussion Notes" bn="বৈঠকের সারসংক্ষেপ ও আলোচনার বিবরণ" /></label>
              <textarea
                id="session-summary"
                value={sessionSummary}
                onChange={(e) => setSessionSummary(e.target.value)}
                placeholder={bi('Summarize key points discussed, claims presented, offers made...', 'আলোচিত মূল বিষয়, দাবিসমূহ ও প্রস্তাবের বিবরণ...')}
                rows={3}
                required
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginTop: '0.5rem' }}>
              <div>
                <label htmlFor="session-outcome"><Bi en="Session Outcome" bn="বৈঠকের ফলাফল" /></label>
                <select id="session-outcome" value={sessionOutcome} onChange={(e) => setSessionOutcome(e.target.value)}>
                  <option value="ADJOURNED_NEXT_DATE">{bi('Adjourned to Next Session Date', 'পরবর্তী বৈঠকের তারিখ ধার্য')}</option>
                  <option value="AGREEMENT_REACHED">{bi('Agreement Reached (আপস নিষ্পত্তি)', 'আপস নিষ্পত্তি সম্পন্ন')}</option>
                  <option value="NO_AGREEMENT">{bi('Mediation Failed / No Agreement', 'আপস সম্ভব হয়নি / ব্যর্থ')}</option>
                  <option value="CONTINUED">{bi('Continued (চলমান)', 'চলমান')}</option>
                </select>
              </div>
              <div>
                <label htmlFor="next-session-date"><Bi en="Next Session Date (If Adjourned)" bn="পরবর্তী বৈঠকের তারিখ (ধার্য থাকলে)" /></label>
                <input
                  id="next-session-date"
                  type="date"
                  value={nextSessionDate}
                  onChange={(e) => setNextSessionDate(e.target.value)}
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.75rem' }}>
              <button type="button" className="secondary-button" onClick={() => setShowNewSessionForm(false)}>
                <Bi en="Cancel" bn="বাতিল" />
              </button>
              <button type="submit" disabled={savingSession}>
                {savingSession ? bi('Saving…', 'সংরক্ষণ হচ্ছে…') : bi('Save Session Outcome', 'বৈঠকের তথ্য সংরক্ষণ')}
              </button>
            </div>
          </form>
        )}

        {/* Sessions list */}
        {(!mediation.sessions || mediation.sessions.length === 0) ? (
          <p className="muted" style={{ fontStyle: 'italic', margin: '0.5rem 0 0', fontSize: '0.88rem' }}>
            <Bi en="No formal mediation sessions recorded yet. Record the 1st session outcome once held." bn="এখনো কোনো আনুষ্ঠানিক বৈঠকের বিবরণ নথিভুক্ত করা হয়নি। ১ম বৈঠক অনুষ্ঠিত হলে ফলাফল লিপিবদ্ধ করুন।" />
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.75rem' }}>
            {mediation.sessions.map((s, idx) => {
              const sessionLabelsBn = ['১ম বৈঠক', '২য় বৈঠক', '৩য় বৈঠক', '৪র্থ বৈঠক', '৫ম বৈঠক', '৬ষ্ঠ বৈঠক', '৭ম বৈঠক', '৮ম বৈঠক']
              const banglaLabel = sessionLabelsBn[s.sessionNumber - 1] || `${num(s.sessionNumber)}তম বৈঠক`
              return (
                <div
                  key={s._id || idx}
                  style={{
                    padding: '0.75rem 1rem',
                    border: '1px solid #EAEAEA',
                    borderRadius: '5px',
                    backgroundColor: '#FFFFFF',
                    borderLeft: '4px solid #2f54eb',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                    <strong style={{ fontSize: '0.95rem', color: '#111' }}>
                      {bi(`Session ${s.sessionNumber}`, banglaLabel)} · <span style={{ fontWeight: 500, color: '#555' }}>{when(s.scheduledAt)}</span>
                    </strong>
                    <span
                      style={{
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        padding: '0.15rem 0.5rem',
                        borderRadius: '9999px',
                        backgroundColor: s.outcome === 'AGREEMENT_REACHED' ? '#EDF3EC' : s.outcome === 'NO_AGREEMENT' ? '#FDEBEC' : '#FBF3DB',
                        color: s.outcome === 'AGREEMENT_REACHED' ? '#346538' : s.outcome === 'NO_AGREEMENT' ? '#9F2F2D' : '#956400',
                      }}
                    >
                      {say(s.outcome)}
                    </span>
                  </div>

                  <p style={{ margin: '0.25rem 0', fontSize: '0.88rem', color: '#333' }}>
                    {s.summaryNotes}
                  </p>

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.85rem', fontSize: '0.8rem', color: '#666', marginTop: '0.4rem' }}>
                    <span><strong><Bi en="Party A:" bn="বাদী:" /></strong> {say(s.attendance?.partyA || 'ATTENDED')}</span>
                    <span><strong><Bi en="Party B:" bn="বিবাদী:" /></strong> {say(s.attendance?.partyB || 'ATTENDED')}</span>
                    {s.venue && <span><strong><Bi en="Venue:" bn="স্থান:" /></strong> {s.venue}</span>}
                    {s.recordedByRole && <span className="record-badge is-filled">{bi('Filled in by', 'লিপিবদ্ধ করেছেন')}: {byWhom(s.recordedByRole, s.recordedByName)}</span>}
                    {s.nextSessionDate && (
                      <span style={{ color: '#2f54eb', fontWeight: 600 }}>
                        <strong><Bi en="Adjourned to:" bn="পরবর্তী তারিখ:" /></strong> {when(s.nextSessionDate)}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>
    </>}
  </Panel>
}
