import { useEffect, useRef, useState } from 'react'
import { api } from '../services/api.js'
import { bi } from './Bi.jsx'

const MicIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="9" y="2" width="6" height="12" rx="3" />
    <path d="M5 10a7 7 0 0 0 14 0" />
    <line x1="12" y1="17" x2="12" y2="22" />
  </svg>
)
const SpeakerIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
    <path d="M15.5 8.5a5 5 0 0 1 0 7" />
    <path d="M19 5a10 10 0 0 1 0 14" />
  </svg>
)

export default function CitizenCaseTracker() {
  const [trackingId, setTrackingId] = useState('')
  const [lookupCode, setLookupCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  // Spoken status (A5): a caller who cannot read asks by voice and hears the status.
  const [voiceActive, setVoiceActive] = useState(false)
  const [turn, setTurn] = useState(null) // the caller's current turn: { kind, listening }
  const [voiceLine, setVoiceLine] = useState(null)
  const [heard, setHeard] = useState(null) // what Whisper heard in the last turn; never the PIN
  const [keyed, setKeyed] = useState('') // digits typed instead of said, on a number or PIN turn
  const [spoken, setSpoken] = useState(null) // { sentence, audioUrl } of the last spoken status, kept to hear again
  const callRef = useRef(null)
  const typable = turn?.kind === 'number' || turn?.kind === 'pin'

  useEffect(() => () => callRef.current?.stop(), [])
  useEffect(() => () => { if (spoken?.audioUrl) URL.revokeObjectURL(spoken.audioUrl) }, [spoken])

  function submitKeyed(event) {
    event.preventDefault()
    callRef.current?.type(keyed)
    setKeyed('')
  }

  async function toggleVoice() {
    if (callRef.current) return callRef.current.stop()
    if (voiceActive) return // still opening the microphone
    setVoiceActive(true)
    setError(null)
    setResult(null)
    setVoiceLine(null)
    setHeard(null)
    setKeyed('')
    setSpoken(null)
    try {
      const { startStatusCall } = await import('../utils/voiceStatusCall.js')
      callRef.current = await startStatusCall({
        onLine: setVoiceLine,
        onTurn: setTurn,
        onHeard: setHeard,
        onNumber: setTrackingId,
        onResult: (data, sentence, audioUrl) => {
          setResult(data)
          setTrackingId(data.applicationId)
          setSpoken({ sentence, audioUrl })
        },
      })
      await callRef.current.done
    } catch (failure) {
      setError(['NotAllowedError', 'NotFoundError', 'NotReadableError'].includes(failure.name)
        ? bi('The microphone is not available. Type the number and tracking code instead.', 'মাইক্রোফোন পাওয়া যায়নি। নম্বর ও ট্র্যাকিং কোড লিখে খুঁজুন।')
        : failure.message)
    } finally {
      callRef.current = null
      setVoiceActive(false)
      setTurn(null)
    }
  }

  async function handleTrack() {
    const query = trackingId.trim()
    if (!query || !lookupCode.trim()) return
    setLoading(true)
    setError(null)
    setSpoken(null)
    try {
      // The private tracking code travels in the request body, never in the URL.
      const data = await api('/api/applications/track', { method: 'POST', body: { identifier: query, lookupCode: lookupCode.trim() } })
      setResult(data)
      setTrackingId(data.applicationId)
    } catch (err) {
      setResult(null)
      setError(err.message || bi('No application matched this ID and tracking code.', 'এই নম্বর ও ট্র্যাকিং কোডে কোনো আবেদন পাওয়া যায়নি।'))
    } finally {
      setLoading(false)
    }
  }

  function onSubmit(e) {
    e.preventDefault()
    handleTrack()
  }

  function onClear() {
    setTrackingId('')
    setLookupCode('')
    setResult(null)
    setError(null)
    setSpoken(null)
  }

  return (
    <section className="case-tracker-card" aria-labelledby="tracker-heading">
      <div className="case-tracker-head">
        <h2 id="tracker-heading" className="case-tracker-title">
          {bi('Track Application & Case Progress', 'আবেদন ও মামলার অগ্রগতি জানুন')}
        </h2>
      </div>

      <form className="case-tracker-form" onSubmit={onSubmit}>
        <div className="case-tracker-input-box">
          <svg className="case-tracker-search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            className="case-tracker-input"
            value={trackingId}
            onChange={(e) => setTrackingId(e.target.value)}
            placeholder={bi('Enter Application ID or Case ID (e.g. APP-2026-000039)', 'আবেদন বা মামলা নম্বর লিখুন (যেমন: APP-2026-000039)')}
            aria-label={bi('Application ID or Case ID', 'আবেদন বা মামলা নম্বর')}
            autoComplete="off"
            spellCheck="false"
            required
          />
          {trackingId && (
            <button
              type="button"
              className="case-tracker-clear-btn"
              onClick={onClear}
              aria-label={bi('Clear search', 'মুছে ফেলুন')}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
        <div className="case-tracker-input-box case-tracker-code-box">
          <input
            type="text"
            className="case-tracker-input case-tracker-code-input"
            value={lookupCode}
            onChange={(e) => setLookupCode(e.target.value)}
            placeholder={bi('Tracking code', 'ট্র্যাকিং কোড')}
            aria-label={bi('Tracking code you received when you applied', 'আবেদনের সময় পাওয়া ট্র্যাকিং কোড')}
            autoComplete="off"
            spellCheck="false"
            required
          />
        </div>
        <button type="submit" className="case-tracker-btn" disabled={loading}>
          {loading ? (
            <span>{bi('Tracking...', 'খোঁজা হচ্ছে...')}</span>
          ) : (
            <span>{bi('Track Case', 'অগ্রগতি দেখুন')}</span>
          )}
        </button>
      </form>

      <div className="case-tracker-voice">
        <button type="button" className={`case-tracker-voice-btn${voiceActive ? ' is-active' : ''}`} onClick={toggleVoice}>
          <MicIcon />
          <span>{voiceActive ? bi('Stop', 'বন্ধ করুন') : bi('Ask by Voice', 'বলে জানুন')}</span>
        </button>
        {voiceActive ? (
          <div className="case-tracker-voice-status">
            <p className="case-tracker-voice-line">
              {turn?.listening ? (
                <>
                  <span className="case-tracker-listening-dot" aria-hidden="true" />
                  <span>{bi('Listening…', 'শুনছি…')}</span>
                </>
              ) : (
                <span lang="bn">{voiceLine}</span>
              )}
            </p>
            {heard ? (
              <p className="case-tracker-voice-heard">
                {bi('You said:', 'আপনি বললেন:')} <span lang="bn">{heard}</span>
              </p>
            ) : null}
            {typable ? (
              <form className="case-tracker-voice-keypad" onSubmit={submitKeyed}>
                <label htmlFor="voice-keypad">{turn.kind === 'pin' ? bi('Or type the PIN', 'অথবা পিন লিখুন') : bi('Or type the number', 'অথবা নম্বর লিখুন')}</label>
                <input
                  id="voice-keypad"
                  type={turn.kind === 'pin' ? 'password' : 'text'}
                  inputMode="numeric"
                  autoComplete="off"
                  spellCheck="false"
                  value={keyed}
                  onChange={(event) => setKeyed(event.target.value)}
                  onFocus={() => callRef.current?.typing()}
                />
                <button type="submit" className="case-tracker-voice-btn">{bi('OK', 'ঠিক আছে')}</button>
              </form>
            ) : null}
          </div>
        ) : null}
      </div>

      {error && (
        <div className="case-tracker-alert error" role="alert">
          <p>{error}</p>
        </div>
      )}

      {result && (
        <div className="case-tracker-result" aria-live="polite">
          {spoken ? (
            <div className="tracker-spoken">
              {spoken.audioUrl ? (
                <button type="button" className="case-tracker-voice-btn" onClick={() => new Audio(spoken.audioUrl).play().catch(() => {})}>
                  <SpeakerIcon />
                  <span>{bi('Hear Again', 'আবার শুনুন')}</span>
                </button>
              ) : null}
              <p lang="bn">{spoken.sentence}</p>
            </div>
          ) : null}
          {/* Top Parcel Summary Card */}
          <div className="tracker-result-topbar">
            <div className="tracker-id-cluster">
              <span className="tracker-badge-id">{result.applicationId}</span>
              {result.caseId && (
                <span className="tracker-badge-case">{result.caseId}</span>
              )}
              {result.isUrgent && (
                <span className="tracker-badge-urgent">{bi('Urgent Case', 'জরুরি আবেদন')}</span>
              )}
            </div>

            <div className="tracker-status-cluster">
              <span className={`tracker-status-pill status-${result.status.toLowerCase()}`}>
                {result.status === 'ACCEPTED'
                  ? bi('Accepted for Legal Aid', 'আইনি সহায়তা মঞ্জুরকৃত')
                  : bi('Under Review', 'পর্যালোচনাধীন')}
              </span>
              <span className="tracker-channel-pill">
                {result.channel === 'VOICE_SIM' ? (
                  <>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ verticalAlign: '-1px', marginRight: '4px' }}>
                      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                    </svg>
                    <span>16699 Voice</span>
                  </>
                ) : (
                  result.channel
                )}
              </span>
            </div>
          </div>

          {/* Next Action / Hearing Alert Banner */}
          {result.nextHearingAt ? (
            <div className="tracker-action-banner tracker-hearing-banner">
              <div className="tracker-banner-icon" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
              </div>
              <div>
                <strong>{bi('Upcoming Court Hearing:', 'পরবর্তী শুনানির তারিখ:')}</strong>{' '}
                <span>
                  {new Date(result.nextHearingAt).toLocaleDateString(undefined, {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </span>
                {result.nextAction && (
                  <p className="tracker-banner-sub">
                    <strong>{bi('Scheduled Action:', 'করণীয়:')}</strong> {result.nextAction}
                  </p>
                )}
              </div>
            </div>
          ) : result.nextAction ? (
            <div className="tracker-action-banner">
              <div className="tracker-banner-icon" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                </svg>
              </div>
              <div>
                <strong>{bi('Current Next Step:', 'বর্তমান পরবর্তী পদক্ষেপ:')}</strong>{' '}
                <span>{result.nextAction}</span>
              </div>
            </div>
          ) : null}

          {/* 6-Milestone Parcel Tracking Visual Stepper */}
          <div className="tracker-milestones-section">
            <h3 className="tracker-section-title">
              {bi('Delivery & Progress Milestones', 'মামলার অগ্রগতি পর্যায়সমূহ')}
            </h3>

            <div className="tracker-stepper">
              {result.stages.map((stage) => {
                const isCompleted = stage.status === 'COMPLETED'
                const isCurrent = stage.status === 'CURRENT'
                return (
                  <div
                    key={stage.phase}
                    className={`stepper-step ${isCompleted ? 'step-completed' : ''} ${isCurrent ? 'step-current' : ''}`}
                  >
                    <div className="stepper-track-line" aria-hidden="true" />
                    <div className="stepper-marker">
                      {isCompleted ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      ) : (
                        <span>{stage.phase}</span>
                      )}
                    </div>
                    <div className="stepper-content">
                      <span className="stepper-title">{bi(stage.title, stage.titleBn)}</span>
                      <span className="stepper-desc">{bi(stage.description, stage.descriptionBn)}</span>
                      {stage.date && (
                        <time className="stepper-date">
                          {new Date(stage.date).toLocaleDateString(undefined, {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </time>
                      )}
                      <span className={`stepper-tag tag-${stage.status.toLowerCase()}`}>
                        {isCompleted
                          ? bi('Completed', 'সম্পন্ন')
                          : isCurrent
                            ? bi('In Progress', 'চলমান')
                            : bi('Upcoming', 'আসন্ন')}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Key Case Details Grid: progress only. The screen may be shared, so the applicant's name, the legal
              matter, and the lawyer's name are not sent here; staff see them on the record. */}
          <div className="tracker-details-grid">
            <div className="tracker-detail-card">
              <span className="detail-label">{bi('Assigned Legal Office', 'দায়িত্বপ্রাপ্ত অফিস')}</span>
              <span className="detail-value">{result.officeCode} DLAO</span>
            </div>

            <div className="tracker-detail-card">
              <span className="detail-label">{bi('Panel Lawyer', 'প্যানেল আইনজীবী')}</span>
              <span className="detail-value">
                {result.lawyer
                  ? result.lawyer.status === 'ACCEPTED' ? bi('Assigned and accepted', 'দায়িত্বপ্রাপ্ত') : bi('Pending acceptance', 'সম্মতি প্রক্রিয়াধীন')
                  : bi('Pending assignment', 'নিয়োগ প্রক্রিয়াধীন')}
              </span>
            </div>
          </div>

          {/* Chronological Checkpoint / Scan Log */}
          {result.updates && result.updates.length > 0 && (
            <div className="tracker-events-section">
              <h3 className="tracker-section-title">
                {bi('Activity & Handover Checkpoints', 'হস্তান্তর ও সকল আপডেট লগ')}
              </h3>
              <div className="tracker-timeline">
                {result.updates.map((update, idx) => (
                  <div key={update.id || idx} className="timeline-item">
                    <div className="timeline-dot" aria-hidden="true" />
                    <div className="timeline-content">
                      <div className="timeline-header">
                        <strong className="timeline-title">
                          {bi(update.title, update.titleBn)}
                        </strong>
                        {update.date && (
                          <time className="timeline-date">
                            {new Date(update.date).toLocaleString(undefined, {
                              day: 'numeric',
                              month: 'short',
                              year: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </time>
                        )}
                      </div>
                      <p className="timeline-desc">
                        {bi(update.description, update.descriptionBn)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Safe Contact Helpline Reminder */}
          <div className="tracker-footer-note">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
            <span>
              {bi(
                'Need immediate assistance or safe contact verification? Call Government Legal Aid Helpline 16699 (Toll-Free).',
                'জরুরি সহায়তা বা নিরাপদ যোগাযোগের জন্য সরকারি আইনি সেবা হেল্পলাইন ১৬৬৯৯ নম্বরে (টোল-ফ্রি) যোগাযোগ করুন।'
              )}
            </span>
          </div>
        </div>
      )}
    </section>
  )
}
