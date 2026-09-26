import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { api } from '../services/api.js'
import { MediatorIdentityVerification } from '../components/IdentityVerification.jsx'
import { createSignaturePacket } from '../utils/settlementCrypto.js'
import { listSignaturePackets, loadSignaturePacket, removeSignaturePacket, saveSignaturePacket } from '../utils/offlineDrafts.js'
import { Badge, Bi, Panel, Term, bi, num, say, when } from '../components/Bi.jsx'

const pathFor = (applicationId, suffix = '') => `/api/applications/${applicationId}/mediation${suffix}`
const signerBn = { PARTY_A: 'প্রথম পক্ষ (পক্ষ ক)', PARTY_B: 'দ্বিতীয় পক্ষ (পক্ষ খ)', MEDIATOR: 'মধ্যস্থতাকারী' }
const stages = ['REGISTRATION', 'SCHEDULING_NOTICES', 'DOCUMENT_REVIEW', 'ATTENDANCE', 'MEDIATION', 'DRAFT_OUTCOME', 'SIGNATURES', 'PENDING_CLAO_CERTIFICATION', 'CERTIFIED_FINAL']
const initialLocalDateTime = () => {
  const value = new Date(Date.now() + 60 * 60 * 1000)
  value.setMinutes(value.getMinutes() - value.getTimezoneOffset())
  return value.toISOString().slice(0, 16)
}

export default function MediationPanel({ applicationId, session, role }) {
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
  const [mode, setMode] = useState('IN_PERSON')
  const [scheduledAt, setScheduledAt] = useState(initialLocalDateTime)
  const [venue, setVenue] = useState('')
  const [inPersonFallback, setInPersonFallback] = useState('')
  const [notices, setNotices] = useState({
    PARTY_A: { deliveryState: 'NOT_DELIVERED', reason: '' },
    PARTY_B: { deliveryState: 'NOT_DELIVERED', reason: '' },
  })
  const [documentReason, setDocumentReason] = useState('')
  const [attendance, setAttendance] = useState({ partyA: '', partyB: '', reason: '' })
  const [outcome, setOutcome] = useState('AGREEMENT_REACHED')
  const [outcomeReason, setOutcomeReason] = useState('')
  const [template, setTemplate] = useState('MAINTENANCE')
  const [notes, setNotes] = useState('')
  const [identifiersRemoved, setIdentifiersRemoved] = useState(false)
  const [acknowledgements, setAcknowledgements] = useState({ partyAUnderstands: false, partyAConsents: false, partyBUnderstands: false, partyBConsents: false })
  const [warningsReviewed, setWarningsReviewed] = useState(false)
  const [reviewReason, setReviewReason] = useState('')
  const [draftEdits, setDraftEdits] = useState({})
  const [amendReason, setAmendReason] = useState('')
  const signerRole = 'MEDIATOR'
  const [issuedCodes, setIssuedCodes] = useState({})
  const [applicabilityBasis, setApplicabilityBasis] = useState('')
  const [certificateReason, setCertificateReason] = useState('')
  const [claoConfirmed, setClaoConfirmed] = useState(false)
  const [signatureCheck, setSignatureCheck] = useState(null)

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
    api(pathFor(applicationId), { token: session.token, signal: controller.signal }).then(({ mediation: result }) => {
      setMediation(result)
      if (result?.draft) {
        setDraftEdits(Object.fromEntries(result.draft.sections.map(({ key, text }) => [key, text])))
        setAcknowledgements(result.draft.partyAcknowledgements ?? { partyAUnderstands: false, partyAConsents: false, partyBUnderstands: false, partyBConsents: false })
        setWarningsReviewed(result.draft.warningsReviewed ?? false)
      }
      setLoaded(true)
    }).catch((failure) => { if (failure.name !== 'AbortError') { setError(failure.message); setLoaded(true) } })
    listSignaturePackets(ownerId).then(setQueue).catch(() => setError(bi('Offline signature queue is unavailable on this device.', 'এই ডিভাইসে পরে পাঠানোর জন্য রাখা স্বাক্ষরগুলো এখন দেখা যাচ্ছে না।')))
    return () => controller.abort()
  }, [applicationId, ownerId, session.token])

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
      setNotice(success)
      return result.mediation ?? result
    } catch (failure) { setError(failure.message); return null }
    finally { setBusy(false) }
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

  // The CLAO signs the exact settlement the parties and mediator signed, in this browser, then the server
  // verifies that signature and records certification in one step. The signing key is discarded afterwards.
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
  const mediatorCanAct = role === 'MEDIATOR' && assignedToMe
  const signatures = mediation?.signatures ?? []
  const signedRoles = new Set(signatures.map(({ signerRole }) => signerRole))
  const missingPartySignatures = !signedRoles.has('PARTY_A') || !signedRoles.has('PARTY_B')
  const stageIndex = stages.indexOf(mediation?.stage)
  const signing = mediatorCanAct && mediation?.draft?.status === 'APPROVED' && mediation.stage === 'SIGNATURES'
  const hasUnsavedDraftEdits = mediation?.draft?.sections.some(({ key, text }) => (draftEdits[key] ?? text) !== text) ?? false
  const verifier = <Link to={`/applications/${applicationId}/mediation/verify`}><Bi en="Open independent signature verifier" bn="আলাদাভাবে স্বাক্ষর যাচাই করুন" /></Link>

  return <Panel id="mediation-title" en="Mediation" bn="মধ্যস্থতা" hint={loaded ? mediation ? say(mediation.stage) : bi('Not started', 'শুরু হয়নি') : undefined} open={role !== 'DLAO_OFFICER'}>
    {!loaded && <p role="status">{bi('Loading…', 'লোড হচ্ছে…')}</p>}
    {error && <p role="alert" className="error">{error}</p>}
    {notice && <p role="status" className="success">{notice}</p>}
    {loaded && <p className="muted"><Bi en="Records what people do. Sends no notices and decides no legal outcome." bn="এখানে কর্মীদের কাজ নথিভুক্ত হয়। এখান থেকে নোটিশ পাঠানো বা মামলার আইনি ফল নির্ধারণ করা হয় না।" /></p>}
    {loaded && role === 'CLAO' && !mediation && !error && <p className="muted"><Bi en="No mediation is recorded on this case." bn="এই মামলায় কোনো মধ্যস্থতা নথিভুক্ত নেই।" /></p>}
    {loaded && role === 'DLAO_OFFICER' && !mediation && <button type="button" disabled={busy} onClick={() => send('', {}, bi('Mediation registered. A mediator in this office can now claim it.', 'মধ্যস্থতা নিবন্ধিত। এই অফিসের একজন মধ্যস্থতাকারী দায়িত্ব নিতে পারবেন।'))}><Bi en="Start mediation" bn="মধ্যস্থতা শুরু করুন" /></button>}
    {mediation && <>
      <ol className="journey stages" aria-label={bi('Mediation stages', 'মধ্যস্থতার ধাপ')}>{stages.map((stage, index) => <li key={stage} className={index < stageIndex ? 'done' : undefined} aria-current={index === stageIndex ? 'step' : undefined}><Term code={stage} /></li>)}</ol>
      <dl className="details compact">
        <div><dt><Bi en="Case" bn="মামলা" /></dt><dd>{mediation.caseId}</dd></div>
        <div><dt><Bi en="Stage" bn="ধাপ" /></dt><dd><Badge code={mediation.stage} /></dd></div>
        {mediation.mode && <div><dt><Bi en="Meeting" bn="সভা" /></dt><dd><Term code={mediation.mode} /> · {when(mediation.scheduledAt)}</dd></div>}
        {mediation.mode === 'IN_PERSON' && <div><dt><Bi en="Venue" bn="স্থান" /></dt><dd>{mediation.venue}</dd></div>}
        {mediation.inPersonFallback && <div><dt><Bi en="Backup plan" bn="বিকল্প পরিকল্পনা" /></dt><dd>{mediation.inPersonFallback}</dd></div>}
        <div><dt><Bi en="Legal effect" bn="আইনি কার্যকারিতা" /></dt><dd><Term code={mediation.legalEffectState} /></dd></div>
      </dl>

      {/* Multiple Mediation Sessions History */}
      <section className="mediation-sessions-section" style={{ margin: '1.25rem 0', border: '1px solid #EAEAEA', borderRadius: '6px', padding: '1rem', backgroundColor: '#FAFAFA' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.05rem', color: '#111' }}>
              <Bi en="Mediation Sessions History (বৈঠক সমূহের ইতিহাস)" bn="মধ্যস্থতার বৈঠক সমূহের ধারাবাহিক ইতিহাস" />
            </h3>
            <p className="muted" style={{ margin: '0.2rem 0 0', fontSize: '0.85rem' }}>
              <Bi en="Multiple joint & separate mediation sessions log (১ম বৈঠক, ২য় বৈঠক...)" bn="বহুস্তরীয় মধ্যস্থতা বৈঠকের ইতিহাস ও ফলাফল (১ম বৈঠক, ২য় বৈঠক...)" />
            </p>
          </div>
          {(mediatorCanAct || role === 'DLAO_OFFICER') && (
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

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
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

      {role === 'MEDIATOR' && !mediation.mediatorUserId && <button type="button" disabled={busy} onClick={() => send('/claim', {}, bi('Mediation claimed.', 'মধ্যস্থতার দায়িত্ব নেওয়া হয়েছে।'))}><Bi en="Claim this mediation" bn="দায়িত্ব নিন" /></button>}
      {role === 'MEDIATOR' && mediation.mediatorUserId && !assignedToMe && <p role="alert" className="error"><Bi en="Assigned to another mediator." bn="অন্য মধ্যস্থতাকারীর দায়িত্বে।" /></p>}

      {mediatorCanAct && ['REGISTRATION', 'SCHEDULING_NOTICES'].includes(mediation.stage) && <form className="form-stack inline-form" onSubmit={(event) => {
        event.preventDefault()
        send('/schedule', { mode, scheduledAt: new Date(scheduledAt).toISOString(), venue, inPersonFallback, notices: ['PARTY_A', 'PARTY_B'].map((party) => ({ party, ...notices[party] })) }, bi('Schedule and notices saved. Nothing was sent.', 'সভার সময় ও নোটিশের তথ্য সংরক্ষিত হয়েছে। এখান থেকে কোনো নোটিশ পাঠানো হয়নি।'))
      }}>
        <h3><Bi en="Schedule and notices" bn="সময় ও নোটিশ" /></h3>
        <p className="muted"><Bi en="Record how a person delivered each notice." bn="প্রতিটি নোটিশ কীভাবে জারি বা প্রেরণ করা হয়েছে তা লিপিবদ্ধ করুন।" /></p>
        <label htmlFor="mediation-mode"><Bi en="Meeting type" bn="সভার ধরন" /></label><select id="mediation-mode" value={mode} onChange={(event) => setMode(event.target.value)}>{['IN_PERSON', 'REMOTE', 'HYBRID'].map((code) => <option key={code} value={code}>{say(code)}</option>)}</select>
        <label htmlFor="mediation-time"><Bi en="Date and time" bn="তারিখ ও সময়" /></label><input id="mediation-time" type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} required />
        {mode === 'IN_PERSON' && <><label htmlFor="mediation-venue"><Bi en="Venue" bn="স্থান" /></label><input id="mediation-venue" value={venue} onChange={(event) => setVenue(event.target.value)} minLength="3" maxLength="200" required /></>}
        {mode !== 'IN_PERSON' && <><label htmlFor="mediation-fallback"><Bi en="In-person backup plan" bn="অনলাইন বৈঠক সম্ভব না হলে বিকল্প সরাসরি সভার স্থান ও পরিকল্পনা" /></label><textarea id="mediation-fallback" value={inPersonFallback} onChange={(event) => setInPersonFallback(event.target.value)} minLength="10" maxLength="300" required /></>}
        {['PARTY_A', 'PARTY_B'].map((party) => <fieldset key={party}><legend><Term code={party} /> · <Bi en="notice" bn="নোটিশ" /></legend><label htmlFor={`${party}-notice-state`}><Bi en="Delivered?" bn="জারি বা প্রাপ্তি সম্পন্ন?" /></label><select id={`${party}-notice-state`} value={notices[party].deliveryState} onChange={(event) => setNotices((current) => ({ ...current, [party]: { ...current[party], deliveryState: event.target.value } }))}>{['NOT_DELIVERED', 'DELIVERED'].map((code) => <option key={code} value={code}>{say(code)}</option>)}</select><label htmlFor={`${party}-notice-reason`}><Bi en="How / why" bn="কীভাবে / বিবরণ" /></label><textarea id={`${party}-notice-reason`} value={notices[party].reason} onChange={(event) => setNotices((current) => ({ ...current, [party]: { ...current[party], reason: event.target.value } }))} minLength="10" maxLength="300" required /></fieldset>)}
        <button type="submit" disabled={busy}><Bi en="Save schedule" bn="সময়সূচি সংরক্ষণ করুন" /></button>
      </form>}

      {mediatorCanAct && mediation.stage === 'SCHEDULING_NOTICES' && <button type="button" disabled={busy} className="secondary-button" onClick={() => send('/advance', {}, bi('Next: document review.', 'পরবর্তী ধাপ: নথিপত্র যাচাই।'))}><Bi en="Continue to documents" bn="নথি যাচাইয়ে যান" /></button>}

      {mediatorCanAct && mediation.stage === 'DOCUMENT_REVIEW' && <section className="form-stack inline-form" aria-labelledby="med-documents-title">
        <h3 id="med-documents-title"><Bi en="Document review" bn="নথিপত্র যাচাই" /></h3>
        {mediation.documents.length ? <ul className="plain-list">{mediation.documents.map((document) => <li key={document.id}>{document.label} · <Term code={document.qualityState} /> · v{num(document.currentVersion)}</li>)}</ul> : <p><Bi en="No documents on this case." bn="এই মামলায় কোনো নথি নেই।" /></p>}
        {mediation.documentsReviewedAt ? <p role="status"><Bi en="Reviewed" bn="যাচাই সম্পন্ন" /> {when(mediation.documentsReviewedAt)} · {mediation.documentReviewReason}</p> : <form className="form-stack" onSubmit={(event) => { event.preventDefault(); send('/documents/review', { reason: documentReason }, bi('Document review saved.', 'নথিপত্র যাচাই সংরক্ষিত হয়েছে।')) }}><label htmlFor="med-document-reason"><Bi en="Review note" bn="যাচাই সংক্রান্ত পর্যবেক্ষণ/নোট" /></label><textarea id="med-document-reason" value={documentReason} onChange={(event) => setDocumentReason(event.target.value)} minLength="10" maxLength="500" required /><button type="submit" disabled={busy}><Bi en="Save review" bn="যাচাই সংরক্ষণ করুন" /></button></form>}
        {mediation.documentsReviewedAt && <button type="button" disabled={busy} className="secondary-button" onClick={() => send('/advance', {}, bi('Next: attendance.', 'পরবর্তী ধাপ: উপস্থিতি নিশ্চিতকরণ।'))}><Bi en="Continue to attendance" bn="উপস্থিতিতে যান" /></button>}
      </section>}

      {mediatorCanAct && mediation.stage === 'ATTENDANCE' && <form className="form-stack inline-form" onSubmit={(event) => { event.preventDefault(); send('/attendance', attendance, bi('Attendance saved.', 'উপস্থিতি সংক্রান্ত তথ্য সংরক্ষিত হয়েছে।')) }}>
        <h3><Bi en="Attendance" bn="উপস্থিতি" /></h3>
        {['partyA', 'partyB'].map((party) => <div key={party}><label htmlFor={`attendance-${party}`}><Term code={party === 'partyA' ? 'PARTY_A' : 'PARTY_B'} /></label><select id={`attendance-${party}`} value={attendance[party]} onChange={(event) => setAttendance((current) => ({ ...current, [party]: event.target.value }))} required><option value="">{bi('Choose', 'বাছাই করুন')}</option>{['ATTENDED', 'REPRESENTED', 'ABSENT'].map((code) => <option key={code} value={code}>{say(code)}</option>)}</select></div>)}
        <label htmlFor="attendance-reason"><Bi en="Note" bn="উপস্থিতি সংক্রান্ত পর্যবেক্ষণ" /></label><textarea id="attendance-reason" value={attendance.reason} onChange={(event) => setAttendance((current) => ({ ...current, reason: event.target.value }))} minLength="10" maxLength="500" required /><button type="submit" disabled={busy}><Bi en="Save attendance" bn="উপস্থিতি সংরক্ষণ করুন" /></button>
        {mediation.attendance && mediation.attendance.partyA !== 'ABSENT' && mediation.attendance.partyB !== 'ABSENT' && <button type="button" disabled={busy} className="secondary-button" onClick={() => send('/advance', {}, bi('Next: mediation.', 'পরবর্তী ধাপ: আনুষ্ঠানিক মধ্যস্থতা বৈঠক।'))}><Bi en="Continue to mediation" bn="মধ্যস্থতায় যান" /></button>}
      </form>}

      {mediatorCanAct && mediation.stage === 'MEDIATION' && <>
        <form className="form-stack inline-form" onSubmit={(event) => { event.preventDefault(); send('/outcome', { outcome, reason: outcomeReason }, bi('Outcome saved.', 'মধ্যস্থতার ফলাফল সংরক্ষিত হয়েছে।')) }}>
          <h3><Bi en="Outcome" bn="ফলাফল" /></h3><label htmlFor="mediation-outcome"><Bi en="Result" bn="মীমাংসার ফলাফল" /></label><select id="mediation-outcome" value={outcome} onChange={(event) => setOutcome(event.target.value)}>{['AGREEMENT_REACHED', 'NO_AGREEMENT', 'CONTINUED'].map((code) => <option key={code} value={code}>{say(code)}</option>)}</select><label htmlFor="mediation-outcome-reason"><Bi en="Reason or next step" bn="কারণ বা পরবর্তী ধাপ" /></label><textarea id="mediation-outcome-reason" value={outcomeReason} onChange={(event) => setOutcomeReason(event.target.value)} minLength="10" maxLength="1000" required /><button type="submit" disabled={busy}><Bi en="Save outcome" bn="ফলাফল সংরক্ষণ করুন" /></button>
        </form>
        {mediation.outcome === 'AGREEMENT_REACHED' && <form className="form-stack inline-form" onSubmit={(event) => { event.preventDefault(); send('/draft', { template, notes, identifiersRemoved }, bi('Draft ready. It is not final; review it.', 'মীমাংসার প্রাথমিক খসড়া প্রস্তুত হয়েছে। এটি পর্যালোচনা সাপেক্ষে গ্রহণযোগ্য হবে।')) }}>
          <h3><Bi en="Draft the settlement" bn="মীমাংসার খসড়া" /></h3><p className="muted"><Bi en="Anonymised notes only; they may go to the AI service and are not stored." bn="শুধু পরিচয় মুছে দেওয়া নোট লিখুন। নোটটি এআই সেবায় পাঠানো হতে পারে; এই ধাপে আমাদের নথিতে তা রাখা হয় না।" /></p><label htmlFor="settlement-template"><Bi en="Template" bn="নমুনা" /></label><select id="settlement-template" value={template} onChange={(event) => setTemplate(event.target.value)}>{['MAINTENANCE', 'PROPERTY', 'LABOUR'].map((code) => <option key={code} value={code}>{say(code)}</option>)}</select><label htmlFor="mediator-notes"><Bi en="Anonymised notes" bn="ব্যক্তিগত তথ্যবর্জিত সারসংক্ষেপ/নোট" /></label><textarea id="mediator-notes" value={notes} onChange={(event) => setNotes(event.target.value)} minLength="10" maxLength="3000" required /><label className="checkbox-label" htmlFor="identifiers-removed"><input id="identifiers-removed" type="checkbox" checked={identifiersRemoved} onChange={(event) => setIdentifiersRemoved(event.target.checked)} required /><Bi en="I removed names, phone numbers, addresses and ID numbers." bn="আমি পক্ষগণের নাম, ফোন নম্বর, ঠিকানা ও জাতীয় পরিচয় নম্বর অপসারণ করেছি।" /></label><button type="submit" disabled={busy || !identifiersRemoved}><Bi en="Prepare draft" bn="খসড়া প্রস্তুত করুন" /></button>
        </form>}
      </>}

      {mediatorCanAct && mediation.stage === 'DRAFT_OUTCOME' && mediation.draft && <section className="form-stack inline-form" aria-labelledby="settlement-title">
        <h3 id="settlement-title"><Term code={mediation.draft.template} /> · <Bi en="draft" bn="খসড়া" /> v{num(mediation.draft.version)}</h3><p className="muted">{mediation.draft.aiAssisted ? bi('AI-assisted', 'এআই-সহায়তায়') : bi('Rules-only placeholder', 'শুধু নিয়মভিত্তিক')} · <Term code={mediation.draft.status} /></p>
        <p className="safety-note"><strong>{mediation.draft.aiAssisted ? bi('AI-ASSISTED DRAFT — HUMAN LEGAL REVIEW REQUIRED', 'এআই-সহায়তাপ্রাপ্ত খসড়া — দায়িত্বপ্রাপ্ত কর্মকর্তা কর্তৃক আইনি পর্যালোচনা আবশ্যক') : bi('DRAFT — HUMAN LEGAL REVIEW REQUIRED', 'খসড়া — দায়িত্বপ্রাপ্ত কর্মকর্তা কর্তৃক আইনি পর্যালোচনা আবশ্যক')}</strong> <Bi en="This fictional template still needs legal approval before real use." bn="বাস্তবে ব্যবহারের আগে এই কাল্পনিক নমুনার আইনি অনুমোদন দরকার।" /></p>
        {mediation.draft.templateExample && <p className="muted"><strong><Bi en="Reference example, not part of the signed draft" bn="নমুনা উদাহরণ, স্বাক্ষরিত খসড়ার অংশ নয়" /> {mediation.draft.templateRevision && `(${mediation.draft.templateRevision})`}:</strong> {bi(mediation.draft.templateExample, mediation.draft.templateExampleBn ?? mediation.draft.templateExample)}</p>}
        {mediation.draft.sections.map((section) => <div key={section.key}><h4>{section.label} {section.aiFilled && <span className="badge wait-badge">{bi('AI-filled', 'এআই-পূরণকৃত')}</span>}</h4>{mediation.draft.status === 'HUMAN_REVIEW' ? <><label htmlFor={`draft-section-${section.key}`}><Bi en="Reviewed text" bn="পর্যালোচিত লেখা" /></label><textarea id={`draft-section-${section.key}`} value={draftEdits[section.key] ?? section.text} onChange={(event) => setDraftEdits((current) => ({ ...current, [section.key]: event.target.value }))} maxLength="500" /></> : <p>{section.text}</p>}</div>)}
        <p className="safety-note"><Bi en="Check every amount, date and duty. AI can miss contradictions." bn="প্রতিটি অর্থের অঙ্ক, তারিখ ও করণীয় দায়িত্ব যাচাই করুন। এআই-এর তৈরি খসড়ায় অসংগতি থাকতে পারে।" /></p>
        {mediation.draft.inconsistencies.length > 0 && <div role="group" aria-label={bi('Draft warnings', 'খসড়ার সতর্কতা')}><h4><Bi en="Draft warnings" bn="খসড়ার সতর্কতা" /></h4><p className="muted"><Bi en="AI suggestions may refer to an earlier version; check them against the current draft." bn="এআই-এর সতর্কতা আগের সংস্করণ নিয়ে হতে পারে; বর্তমান খসড়ার সঙ্গে মিলিয়ে দেখুন।" /></p>{mediation.draft.inconsistencies.map((warning, index) => <p className="error" key={`${warning}-${index}`}>{mediation.draft.aiInconsistencies?.includes(warning) && <strong><Bi en="AI suggestion: " bn="এআই-এর সতর্কতা: " /></strong>}{warning}</p>)}</div>}
        {mediation.draft.status === 'HUMAN_REVIEW' && <>
          <form className="form-stack" onSubmit={async (event) => {
            event.preventDefault()
            const result = await send('/draft/amend', { template: mediation.draft.template, sections: mediation.draft.sections.map(({ key }) => ({ key, text: draftEdits[key] ?? '' })), reason: amendReason }, bi('Edits saved as a new version. Record the review again.', 'সংশোধিত খসড়া নতুন সংস্করণ হিসেবে সংরক্ষিত হয়েছে। অনুগ্রহ করে নতুন করে পর্যালোচনা সম্পন্ন করুন।'))
            if (result) { setAcknowledgements({ partyAUnderstands: false, partyAConsents: false, partyBUnderstands: false, partyBConsents: false }); setWarningsReviewed(false); setReviewReason(''); setAmendReason('') }
          }}>
            <label htmlFor="settlement-amend-reason"><Bi en="Reason for edits" bn="সম্পাদনার কারণ" /></label><textarea id="settlement-amend-reason" value={amendReason} onChange={(event) => setAmendReason(event.target.value)} minLength="10" maxLength="1000" required /><button type="submit" disabled={busy}><Bi en="Save edits as new version" bn="সংশোধিত সংস্করণ সংরক্ষণ করুন" /></button>
          </form>
          <form className="form-stack" onSubmit={(event) => { event.preventDefault(); send('/draft/review', { ...acknowledgements, warningsReviewed, reason: reviewReason }, bi('Review saved. Signing opens only if both parties understood and agreed.', 'পর্যালোচনা সংরক্ষিত হয়েছে। উভয় পক্ষ বুঝে সম্মতি প্রদান করলে তবেই স্বাক্ষরের প্রক্রিয়া শুরু হবে।')) }}>
          <h4><Bi en="Did the parties understand and agree?" bn="উভয় পক্ষ কি শর্তাবলি বুঝেছেন ও সম্মত হয়েছেন?" /></h4><p className="muted"><Bi en="Your attestation, not proof of identity or capacity." bn="আপনি যা যাচাই করেছেন, এটি তার বিবরণ; এতে কারও পরিচয় বা সিদ্ধান্ত নেওয়ার সক্ষমতা প্রমাণ হয় না।" /></p>
          {Object.entries({ partyAUnderstands: ['Party A understood', 'প্রথম পক্ষ (পক্ষ ক) শর্তাবলি বুঝেছেন'], partyAConsents: ['Party A agrees to sign', 'প্রথম পক্ষ (পক্ষ ক) স্বাক্ষরে সম্মত'], partyBUnderstands: ['Party B understood', 'দ্বিতীয় পক্ষ (পক্ষ খ) শর্তাবলি বুঝেছেন'], partyBConsents: ['Party B agrees to sign', 'দ্বিতীয় পক্ষ (পক্ষ খ) স্বাক্ষরে সম্মত'] }).map(([key, [en, bn]]) => <label className="checkbox-label" htmlFor={key} key={key}><input id={key} type="checkbox" checked={acknowledgements[key]} onChange={(event) => setAcknowledgements((current) => ({ ...current, [key]: event.target.checked }))} /><Bi en={en} bn={bn} /></label>)}
          {mediation.draft.inconsistencies.length > 0 && <label className="checkbox-label" htmlFor="settlement-warnings-reviewed"><input id="settlement-warnings-reviewed" type="checkbox" checked={warningsReviewed} onChange={(event) => setWarningsReviewed(event.target.checked)} /><Bi en="I reviewed every draft warning with the parties." bn="আমি উভয় পক্ষের সঙ্গে খসড়ার প্রতিটি সতর্কতা ও অসংগতি আলোচনা করেছি।" /></label>}
          {hasUnsavedDraftEdits && <p role="alert" className="error"><Bi en="Save your draft edits as a new version before recording the review." bn="পর্যালোচনা নথিভুক্ত করার আগে খসড়ার পরিবর্তন নতুন সংস্করণ হিসেবে সংরক্ষণ করুন।" /></p>}
          <label htmlFor="settlement-review-reason"><Bi en="Review reason" bn="পর্যালোচনার কারণ" /></label><textarea id="settlement-review-reason" value={reviewReason} onChange={(event) => setReviewReason(event.target.value)} minLength="10" maxLength="1000" required /><button type="submit" disabled={busy || hasUnsavedDraftEdits}><Bi en="Save review" bn="পর্যালোচনা সংরক্ষণ করুন" /></button>
          </form>
        </>}
      </section>}

      {signing && <section className="form-stack inline-form" aria-labelledby="signature-title">
        <h3 id="signature-title"><Bi en="Signatures" bn="স্বাক্ষর" /></h3>
        <p className="muted"><Bi en="Give each party a separate private code through a verified contact route. Each party opens the approved draft and signs in their own browser, including offline after first opening it online." bn="যাচাই করা যোগাযোগের মাধ্যমে প্রত্যেক পক্ষকে আলাদা গোপন কোড দিন। প্রত্যেকে নিজের ব্রাউজারে অনুমোদিত খসড়া খুলে স্বাক্ষর করবেন; আগে অনলাইনে খুলে থাকলে অফলাইনেও পারবেন।" /></p>
        <p><strong><Bi en="Code possession and a valid signature do not prove identity, capacity, informed consent or legal effect." bn="কোড থাকা ও বৈধ স্বাক্ষর পরিচয়, সক্ষমতা, সচেতন সম্মতি বা আইনি কার্যকারিতা প্রমাণ করে না।" /></strong></p>
        <p><Link to="/mediation/sign"><Bi en="Open the party signing page" bn="পক্ষের স্বাক্ষরের পৃষ্ঠা খুলুন" /></Link></p>
        {['PARTY_A', 'PARTY_B'].map((partyRole) => {
          const invite = mediation.signingInvitations?.find((entry) => entry.signerRole === partyRole)
          return <div key={partyRole}>
            <strong><Term code={partyRole} /></strong> · {signedRoles.has(partyRole) ? bi('Signed', 'স্বাক্ষরিত') : invite ? bi(`Code expires ${when(invite.expiresAt)}`, `কোডের মেয়াদ ${when(invite.expiresAt)}`) : bi('No code issued', 'কোড দেওয়া হয়নি')}
            {!signedRoles.has(partyRole) && <button type="button" className="secondary-button" disabled={busy || !online} onClick={() => issueCode(partyRole)}>{bi(invite ? `Replace ${partyRole.replaceAll('_', ' ')} code` : `Issue ${partyRole.replaceAll('_', ' ')} code`, invite ? `${signerBn[partyRole]}-এর কোড বদলান` : `${signerBn[partyRole]}-এর কোড দিন`)}</button>}
            {issuedCodes[partyRole] && !signedRoles.has(partyRole) && <p role="status"><Bi en="Private code, shown only now:" bn="গোপন কোড, শুধু এখন দেখানো হচ্ছে:" /> <code className="signing-code">{issuedCodes[partyRole]}</code></p>}
          </div>
        })}
        <button type="button" className="secondary-button" disabled={busy || !online} onClick={refreshSignatures}><Bi en="Refresh party signatures" bn="পক্ষগুলোর সর্বশেষ স্বাক্ষর দেখুন" /></button>
        {role === 'MEDIATOR' && mediation.stage === 'SIGNATURES' && <MediatorIdentityVerification key={`${mediation.id}:${mediation.signingInvitations?.map((invite) => invite.updatedAt).join(':')}`} applicationId={applicationId} token={session.token} />}
        <ol className="plain-list">{signatures.map((record) => <li key={record.signerRole}><strong><Term code={record.signerRole} /></strong> · {when(record.receivedAt)} · {record.documentHash.slice(0, 12)}…</li>)}</ol>
        <label htmlFor="signature-passphrase"><Bi en="Your local passphrase for an encrypted offline mediator signature" bn="মধ্যস্থতাকারীর অফলাইন স্বাক্ষরের জন্য আপনার পাসফ্রেজ" /></label><input id="signature-passphrase" type="password" autoComplete="off" minLength="8" value={signingPassphrase} onChange={(event) => setSigningPassphrase(event.target.value)} />
        <p className="muted"><Bi en="Your signing key is made in this browser and discarded. The offline signature packet contains no draft text." bn="আপনার স্বাক্ষরের চাবি এই ব্রাউজারে তৈরি হয় এবং পরে মুছে যায়। অফলাইন স্বাক্ষরের প্যাকেটে খসড়ার লেখা থাকে না।" /></p>
        <button type="button" disabled={busy || signingPassphrase.length < 8 || missingPartySignatures || signedRoles.has('MEDIATOR')} onClick={sign}>{bi(`Create mediator signature${online ? ' and sync' : ' offline'}`, `মধ্যস্থতাকারীর স্বাক্ষর ${online ? 'দিন ও সিঙ্ক করুন' : 'অফলাইনে দিন'}`)}</button>
        <p role="status">{online ? bi('Connection: online', 'সংযোগ: অনলাইন') : bi('Connection: offline', 'সংযোগ: অফলাইন')} · {bi(`encrypted signatures awaiting sync: ${queue.length}`, `সিঙ্কের অপেক্ষায়: ${num(queue.length)}`)}</p>
        {queue.length > 0 && <><button type="button" className="secondary-button" disabled={!online || signingPassphrase.length < 8 || busy} onClick={syncPending}><Bi en="Sync now" bn="এখন সিঙ্ক করুন" /></button><ul className="plain-list">{queue.map((item) => <li key={item.id}><Bi en="Encrypted signature" bn="এনক্রিপ্ট করা স্বাক্ষর" /> · {when(item.updatedAt)}</li>)}</ul></>}
        {verifier}
        {mediation.stage !== 'SIGNATURES' && <p className="safety-note"><Term code={mediation.legalEffectState} />. <Bi en="E-signing alone does not create a decree." bn="শুধু ই-স্বাক্ষর করলেই এটি আদালতের ডিক্রি হয়ে যায় না।" /></p>}
      </section>}

      {role === 'CLAO' && mediation.stage === 'PENDING_CLAO_CERTIFICATION' && <section className="form-stack inline-form clao-certify" aria-labelledby="clao-title">
        <h3 id="clao-title"><Bi en="Legal review and CLAO certification" bn="আইনি পর্যালোচনা ও সিএলএও সনদ" /></h3>
        <p className="safety-note"><strong><Term code={mediation.legalEffectState} /></strong>. <Bi en="Applicability depends on date and area; the system does not decide it." bn="আইনের প্রযোজ্যতা কার্যকর তারিখ ও এখতিয়ারভুক্ত এলাকার ওপর নির্ভরশীল; সিস্টেম নিজে কোনো আইনি সিদ্ধান্ত প্রদান করে না।" /></p>

        <h4><Bi en="1. Read the signed settlement" bn="১. স্বাক্ষরিত মীমাংসাপত্র পড়ুন" /></h4>
        {mediation.draft ? <div className="clao-document">
          <p className="muted"><Term code={mediation.draft.template} /> · <Bi en="version" bn="সংস্করণ" /> {num(mediation.draft.version)}</p>
          {mediation.draft.sections.map((section) => <div key={section.key}><h5>{section.label}</h5><p>{section.text}</p></div>)}
        </div> : <p className="error"><Bi en="The signed settlement is missing." bn="স্বাক্ষরিত মীমাংসাপত্র পাওয়া যায়নি।" /></p>}

        <h4><Bi en="2. Check the three signatures" bn="২. তিনটি স্বাক্ষর যাচাই করুন" /></h4>
        <ul className="plain-list">{['PARTY_A', 'PARTY_B', 'MEDIATOR'].map((signerRole) => {
          const record = signatures.find((item) => item.signerRole === signerRole)
          const checked = signatureCheck?.signatures.find((item) => item.signerRole === signerRole)
          return <li key={signerRole}><strong><Term code={signerRole} /></strong> · {record ? <>{bi('signed', 'স্বাক্ষরিত')} {when(record.receivedAt)}</> : bi('not signed', 'স্বাক্ষর নেই')}{checked ? <> · <strong>{checked.valid ? bi('verified', 'যাচাইকৃত') : bi('does not verify', 'যাচাই ব্যর্থ')}</strong></> : null}</li>
        })}</ul>
        <button type="button" className="secondary-button" disabled={busy} onClick={checkSignatures}><Bi en="Check signatures now" bn="এখনই স্বাক্ষর যাচাই করুন" /></button>
        {signatureCheck && <p role="status" className={signatureCheck.allValid ? 'success' : 'error'}>{signatureCheck.allValid ? bi('All three signatures match this settlement.', 'তিনটি স্বাক্ষরই এই মীমাংসাপত্রের সঙ্গে মিলেছে।') : bi('A signature is missing or does not match. Do not certify.', 'কোনো স্বাক্ষর নেই বা মেলেনি। সনদ দেবেন না।')}</p>}
        <p>{verifier}</p>

        <h4><Bi en="3. Record legal applicability" bn="৩. আইনি প্রযোজ্যতা নথিভুক্ত করুন" /></h4>
        {mediation.legalApplicability !== 'APPLICABLE_VERIFIED' ? <form className="form-stack" onSubmit={(event) => { event.preventDefault(); send('/legal-applicability', { applicability: 'APPLICABLE_VERIFIED', basis: applicabilityBasis }, bi('Applicability recorded. Now sign the certification.', 'প্রযোজ্যতা নথিভুক্ত হয়েছে। এবার সনদে স্বাক্ষর করুন।')) }}>
          <p className="muted"><Bi en="Record the legal basis and any Gazette, date or area reference." bn="আইনি ভিত্তি ও গেজেট, তারিখ বা এলাকার সূত্র লিখুন।" /></p>
          <label htmlFor="legal-basis"><Bi en="Verified legal basis" bn="যাচাইকৃত আইনি ভিত্তি" /></label><textarea id="legal-basis" value={applicabilityBasis} onChange={(event) => setApplicabilityBasis(event.target.value)} minLength="10" maxLength="500" required />
          <button type="submit" disabled={busy}><Bi en="Record verified applicability" bn="প্রযোজ্যতা সংরক্ষণ করুন" /></button>
          <button type="button" className="secondary-button" disabled={busy} onClick={() => send('/legal-applicability', { applicability: 'UNVERIFIED' }, bi('Left unverified; certification is blocked.', 'আইনগত প্রযোজ্যতা নিশ্চিত হয়নি বিধায় সনদ প্রদান স্থগিত রয়েছে।'))}><Bi en="Leave unverified" bn="অযাচাইকৃত রাখুন" /></button>
        </form> : <p><Bi en="Legal basis:" bn="আইনি ভিত্তি:" /> {mediation.legalReviewBasis}</p>}

        <h4><Bi en="4. Sign and certify" bn="৪. স্বাক্ষর করে সনদ দিন" /></h4>
        {mediation.legalApplicability === 'APPLICABLE_VERIFIED' ? <form className="form-stack" onSubmit={signAndCertify}>
          <label htmlFor="certificate-reason"><Bi en="Certification reason" bn="সনদের কারণ" /></label><textarea id="certificate-reason" value={certificateReason} onChange={(event) => setCertificateReason(event.target.value)} minLength="10" maxLength="500" required />
          <label className="checkbox-label" htmlFor="clao-confirm"><input id="clao-confirm" type="checkbox" checked={claoConfirmed} onChange={(event) => setClaoConfirmed(event.target.checked)} required /><Bi en="I read this settlement and I sign this certification myself." bn="আমি এই মীমাংসাপত্র পড়েছি এবং নিজে এই সনদে স্বাক্ষর করছি।" /></label>
          <p className="muted"><Bi en="Your signing key is made in this browser for this one signature and then discarded." bn="এই একটি স্বাক্ষরের জন্য আপনার ব্রাউজারে চাবি তৈরি হয় এবং পরে মুছে যায়।" /></p>
          <button type="submit" disabled={busy || !claoConfirmed || !online || !mediation.draft}>{busy ? bi('Signing…', 'স্বাক্ষর হচ্ছে…') : bi('Sign and certify', 'স্বাক্ষর করে সনদ দিন')}</button>
          {!online && <p role="status" className="muted"><Bi en="Connect to the internet to certify." bn="সনদ দিতে ইন্টারনেট সংযোগ দরকার।" /></p>}
        </form> : <p className="muted"><Bi en="Record verified applicability first." bn="আগে যাচাইকৃত প্রযোজ্যতা নথিভুক্ত করুন।" /></p>}
      </section>}

      {mediation.stage === 'CERTIFIED_FINAL' && <div role="status" className="safety-note">
        <p><Bi en="CLAO certification recorded. Court-decree status is not decided here." bn="সিএলএও সনদ নথিভুক্ত হয়েছে। এটি আদালতের সমমানের ডিক্রি কি না, সে সিদ্ধান্ত এখানে প্রদান করা হয় না।" /></p>
        {mediation.certifiedAt && <p><Bi en="Certified" bn="সনদের তারিখ" /> {when(mediation.certifiedAt)}{mediation.certificateReason ? ` · ${mediation.certificateReason}` : ''}</p>}
        {signatures.filter(({ signerRole }) => signerRole === 'CLAO').map((record) => <p key={record.signerRole}><Bi en="CLAO signature" bn="সিএলএও-র স্বাক্ষর" /> · {when(record.receivedAt)} · <code>{record.documentHash.slice(0, 12)}…</code></p>)}
        {role === 'CLAO' && <p>{verifier}</p>}
      </div>}
      {['SIGNATURES', 'PENDING_CLAO_CERTIFICATION', 'CERTIFIED_FINAL'].includes(mediation.stage) && role !== 'CLAO' && !signing && <p>{verifier}</p>}
    </>}
  </Panel>
}
