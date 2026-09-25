import { useState } from 'react'
import { api } from '../services/api.js'
import { bi } from './Bi.jsx'

export default function CitizenCaseTracker() {
  const [trackingId, setTrackingId] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  async function handleTrack(idToSearch) {
    const query = (idToSearch || trackingId).trim()
    if (!query) return
    setLoading(true)
    setError(null)
    try {
      const data = await api(`/api/applications/track/${encodeURIComponent(query)}`)
      setResult(data)
      setTrackingId(data.applicationId)
    } catch (err) {
      setResult(null)
      setError(err.message || 'No record found with this Application ID or Case ID.')
    } finally {
      setLoading(false)
    }
  }

  function onSubmit(e) {
    e.preventDefault()
    handleTrack(trackingId)
  }

  function onQuickPick(id) {
    setTrackingId(id)
    handleTrack(id)
  }

  function onClear() {
    setTrackingId('')
    setResult(null)
    setError(null)
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
        <button type="submit" className="case-tracker-btn" disabled={loading}>
          {loading ? (
            <span>{bi('Tracking...', 'খোঁজা হচ্ছে...')}</span>
          ) : (
            <span>{bi('Track Case', 'অগ্রগতি দেখুন')}</span>
          )}
        </button>
      </form>

      <div className="case-tracker-samples" role="group" aria-label={bi('Quick example cases', 'নমুনা মামলাসমূহ')}>
        <span className="case-tracker-samples-label">{bi('Quick check:', 'নমুনা আইডি:')}</span>
        <button type="button" className="case-tracker-chip" onClick={() => onQuickPick('APP-2026-000039')}>
          APP-2026-000039
        </button>
        <button type="button" className="case-tracker-chip" onClick={() => onQuickPick('APP-2026-000040')}>
          APP-2026-000040
        </button>
        <button type="button" className="case-tracker-chip" onClick={() => onQuickPick('CASE-2026-000015')}>
          CASE-2026-000015
        </button>
        <button type="button" className="case-tracker-chip" onClick={() => onQuickPick('APP-2026-000045')}>
          APP-2026-000045
        </button>
      </div>

      {error && (
        <div className="case-tracker-alert error" role="alert">
          <p>{error}</p>
        </div>
      )}

      {result && (
        <div className="case-tracker-result" aria-live="polite">
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

          {/* Key Case Details Grid */}
          <div className="tracker-details-grid">
            <div className="tracker-detail-card">
              <span className="detail-label">{bi('Applicant Name', 'আবেদনকারীর নাম')}</span>
              <span className="detail-value">{result.applicantName}</span>
            </div>

            <div className="tracker-detail-card">
              <span className="detail-label">{bi('Legal Need / Matter', 'আইনি সমস্যা')}</span>
              <span className="detail-value">{result.legalNeed}</span>
            </div>

            <div className="tracker-detail-card">
              <span className="detail-label">{bi('Assigned Legal Office', 'দায়িত্বপ্রাপ্ত অফিস')}</span>
              <span className="detail-value">{result.officeCode} DLAO</span>
            </div>

            <div className="tracker-detail-card">
              <span className="detail-label">{bi('Assigned Counsel', 'নিয়োজিত আইনজীবী')}</span>
              <span className="detail-value">
                {result.lawyer
                  ? `${result.lawyer.lawyerName} (${result.lawyer.status === 'ACCEPTED' ? bi('Accepted', 'দায়িত্বপ্রাপ্ত') : bi('Pending Acceptance', 'প্রক্রিয়াধীন')})`
                  : bi('Pending Assignment', 'নিয়োগ প্রক্রিয়াধীন')}
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
