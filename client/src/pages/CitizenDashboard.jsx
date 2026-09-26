import { useState, useEffect } from 'react'
import { Link } from 'react-router'
import { api } from '../services/api.js'
import { bi } from '../components/Bi.jsx'
import PhaseTracker from '../components/PhaseTracker.jsx'
import DigitalApplicationModal from '../components/DigitalApplicationModal.jsx'

export default function CitizenDashboard({ session }) {
  const [cases, setCases] = useState([])
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refresh, setRefresh] = useState(0)
  const [error, setError] = useState('')
  const [feedbackMsg, setFeedbackMsg] = useState('')

  // Lawyer change state
  const [selectedCaseForChange, setSelectedCaseForChange] = useState(null)
  const [changeReason, setChangeReason] = useState('')
  const [submittingChange, setSubmittingChange] = useState(false)

  // Cancel case/application state
  const [selectedCaseForCancel, setSelectedCaseForCancel] = useState(null)
  const [cancelReason, setCancelReason] = useState('')
  const [submittingCancel, setSubmittingCancel] = useState(false)

  // Digital application state
  const [showAppModal, setShowAppModal] = useState(false)
  const [submittingApp, setSubmittingApp] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    api('/api/citizen/profile', { token: session.token, signal: controller.signal })
      .then((data) => {
        if (data.profile) {
          setProfile(data.profile)
          setCases(data.profile.cases || [])
        }
        setLoading(false)
      })
      .catch((err) => {
        if (err.name !== 'AbortError') {
          api('/api/citizen/cases', { token: session.token })
            .then((caseData) => setCases(caseData.cases || []))
            .catch(() => {})
          setError(err.message)
          setLoading(false)
        }
      })
    return () => controller.abort()
  }, [session.token, refresh])

  function openAppModal() {
    setShowAppModal(true)
  }

  async function handleDigitalAppSubmit(payload) {
    setSubmittingApp(true)
    setError('')
    setFeedbackMsg('')
    try {
      const res = await api('/api/citizen/applications', {
        method: 'POST',
        token: session.token,
        body: payload,
      })
      setFeedbackMsg(res.message || bi('Application submitted successfully.', 'আইনি সহায়তার আবেদন সফলভাবে দাখিল হয়েছে।'))
      setShowAppModal(false)
      setRefresh((r) => r + 1)
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmittingApp(false)
    }
  }

  async function handleLawyerChangeSubmit(e) {
    e.preventDefault()
    if (!selectedCaseForChange || !changeReason.trim()) return

    setSubmittingChange(true)
    setFeedbackMsg('')
    try {
      const res = await api(`/api/citizen/cases/${selectedCaseForChange.applicationId}/lawyer-change`, {
        method: 'POST',
        token: session.token,
        body: { reason: changeReason.trim() },
      })
      setFeedbackMsg(res.message || bi('Lawyer change request submitted successfully.', 'আইনজীবী পরিবর্তনের আবেদন সফলভাবে দাখিল হয়েছে।'))
      setSelectedCaseForChange(null)
      setChangeReason('')
      setRefresh((r) => r + 1)
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmittingChange(false)
    }
  }

  async function handleCancelSubmit(e) {
    e.preventDefault()
    if (!selectedCaseForCancel || !cancelReason.trim()) return

    setSubmittingCancel(true)
    setFeedbackMsg('')
    try {
      const res = await api(`/api/citizen/cases/${selectedCaseForCancel.applicationId}/cancel`, {
        method: 'POST',
        token: session.token,
        body: { reason: cancelReason.trim() },
      })
      setFeedbackMsg(res.message || (res.status === 'CANCELLED'
        ? bi('Your application has been cancelled.', 'আপনার আবেদনটি বাতিল করা হয়েছে।')
        : bi('Your cancellation request has been sent to the DLAO officer for confirmation.', 'বাতিলের অনুরোধ ডিএলএও কর্মকর্তার নিকট প্রেরণ করা হয়েছে।')))
      setSelectedCaseForCancel(null)
      setCancelReason('')
      setRefresh((r) => r + 1)
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmittingCancel(false)
    }
  }

  return (
    <div className="citizen-portal-container">
      {/* Top Welcome Bar */}
      <section className="citizen-welcome-hero">
        <div className="citizen-hero-content">
          <span className="citizen-kicker">{bi('Citizen Legal Aid Portal', 'নাগরিক আইনি সহায়তা পোর্টাল')}</span>
          <h1 className="citizen-heading">
            {bi('Welcome,', 'স্বাগতম,')} {profile?.displayName || session.user.displayName || session.user.username}
          </h1>
          <p className="citizen-subhead">
            {bi(
              'Track your legal aid applications, court case progression, and advocate assignments transparently.',
              'আপনার আইনি সহায়তা আবেদন, আদালতের মামলার অগ্রগতি এবং নিযুক্ত আইনজীবীর বিবরণ স্বচ্ছভাবে পর্যবেক্ষণ করুন।'
            )}
          </p>
        </div>
        <div className="citizen-hero-actions">
          <button
            type="button"
            className="citizen-voice-cta"
            onClick={openAppModal}
          >
            {bi('Submit Digital Application', 'ডিজিটাল আবেদন দাখিল করুন')}
          </button>
          <Link to="/voice" className="citizen-voice-secondary-cta">
            {bi('Voice Intake (16699)', 'টেলিফোনে আবেদন (১৬৬৯৯)')}
          </Link>
        </div>
      </section>

      {feedbackMsg && (
        <div className="auth-alert success" role="status">
          <strong>{bi('Update: ', 'বিজ্ঞপ্তি: ')}</strong>{feedbackMsg}
        </div>
      )}

      {error && (
        <div className="auth-alert error" role="alert">
          {error}
        </div>
      )}

      {/* Main Cases & Applications Section */}
      <section className="citizen-cases-section">
        <div className="section-head">
          <h2>{bi('Your Legal Aid Applications & Cases', 'আপনার আইনি সহায়তা আবেদন ও মামলাসমূহ')}</h2>
          <span className="case-count">{cases.length} {cases.length === 1 ? bi('matter found', 'টি আবেদন/মামলা') : bi('matters found', 'টি আবেদন/মামলা')}</span>
        </div>

        {loading ? (
          <div className="loading-state-box">
            <p>{bi('Loading your case files…', 'আপনার মামলার তথ্য ও রেকর্ড লোড হচ্ছে…')}</p>
          </div>
        ) : cases.length === 0 ? (
          <div className="citizen-empty-container">
            {/* Step 0 Lifecycle Tracker */}
            <div className="phase-tracker-wrapper">
              <PhaseTracker application={null} />
            </div>

            <div className="empty-state-box">
              <p className="empty-title">{bi('No active legal aid applications found', 'বর্তমানে কোনো সক্রিয় আইনি সহায়তা আবেদন নেই')}</p>
              <p className="empty-desc">
                {bi(
                  'Submit an application online or use our 16699 voice simulation to get started. Court hearing schedules and legal aid lawyer assignment become available after DLAO review and acceptance.',
                  'অনলাইনে নতুন আবেদন দাখিল করুন অথবা ১৬৬৯৯ হেল্পলাইনের মাধ্যমে আবেদন জানান। জেলা লিগ্যাল এইড অফিসার (ডিএলএও) কর্তৃক আবেদন পর্যালোচনা ও মঞ্জুর হওয়ার পর শুনানির তারিখ ও প্যানেল আইনজীবী নিযুক্ত করা হবে।'
                )}
              </p>
            </div>
          </div>
        ) : (
          <div className="cases-list-stack">
            {cases.map((c) => {
              const pendingChangeReq = c.changeRequests?.find(cr => cr.status === 'OPEN')
              const approvedChangeReq = c.changeRequests?.find(cr => cr.status === 'APPROVED')
              const pastChangeReqs = c.changeRequests?.filter(cr => cr.status !== 'OPEN') || []
              const isAccepted = c.status === 'ACCEPTED'
              const isCancelled = c.status === 'CANCELLED'
              const pendingCancellation = c.cancellationRequest?.status === 'OPEN'
              const canRequestCancel = !isCancelled && !pendingCancellation

              return (
                <article key={c.applicationId} className="citizen-case-card">
                  <header className="case-card-top">
                    <div>
                      <div className="case-ref-row">
                        <span className="case-id-tag">
                          {c.caseId ? `Case: ${c.caseId}` : `Application: ${c.applicationId}`}
                        </span>
                        <span className={`status-pill status-${c.status?.toLowerCase()}`}>
                          {c.status}
                        </span>
                        {c.priority === 'URGENT' && (
                          <span className="urgent-badge-pill">
                            {bi('Urgent Priority', 'জরুরি অগ্রাধিকার')}
                          </span>
                        )}
                      </div>
                      <h3 className="applicant-name">{c.applicantName}</h3>
                      <p className="matter-summary">{c.summary}</p>
                      <div className="citizen-meta-pills-row">
                        {c.nidNumber && (
                          <span className="citizen-meta-pill">
                            {bi('NID: ', 'এনআইডি: ')}{c.nidNumber}
                          </span>
                        )}
                        {c.birthCertificateNumber && (
                          <span className="citizen-meta-pill">
                            {bi('BRN: ', 'জন্ম সনদ: ')}{c.birthCertificateNumber}
                          </span>
                        )}
                        {c.prottayonpotroStatus === 'YES' && (
                          <span className="citizen-meta-pill citizen-meta-pill-accent">
                            {bi('Prottayonpotro on record', 'প্রত্যয়নপত্র দাখিলকৃত')}
                          </span>
                        )}
                        {c.documents && c.documents.length > 0 && (
                          <span className="citizen-meta-pill">
                            {c.documents.length} {c.documents.length === 1 ? bi('attachment', 'টি প্রমাণক') : bi('attachments', 'টি প্রমাণক')}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="case-card-meta">
                      <span className="meta-label">{bi('Intake Channel', 'আবেদনের মাধ্যম')}</span>
                      <span className="meta-value">{c.intakeChannel}</span>
                      <span className="meta-label" style={{ marginTop: '8px' }}>{bi('Date Filed', 'আবেদনের তারিখ')}</span>
                      <span className="meta-value">{new Date(c.createdAt).toLocaleDateString()}</span>
                      {canRequestCancel && (
                        <button
                          type="button"
                          className="text-action-link"
                          style={{ marginTop: '10px', color: '#9f2f2d' }}
                          onClick={() => setSelectedCaseForCancel(c)}
                        >
                          {bi('Cancel Application/Case', 'আবেদন/মামলা বাতিল করুন')}
                        </button>
                      )}
                    </div>
                  </header>

                  {pendingCancellation && (
                    <div className="pending-reassignment-notice" role="status">
                      <span className="warning-dot" />
                      <div>
                        <strong>{bi('Cancellation Requested — Pending DLAO Review', 'বাতিলের অনুরোধ — ডিএলএও পর্যালোচনার অপেক্ষায়')}</strong>
                        <p>{bi('Reason submitted: ', 'আবেদনের কারণ: ')}&ldquo;{c.cancellationRequest.reason}&rdquo;</p>
                      </div>
                    </div>
                  )}

                  {/* 6-Phase Lifecycle Tracker */}
                  <div className="phase-tracker-wrapper">
                    <PhaseTracker
                      application={c}
                      caseRecord={c.caseRecord}
                      lawyer={c.lawyer}
                      mediation={c.mediation}
                    />
                  </div>

                  {/* Case Details Bento Grid */}
                  <div className="citizen-case-bento">
                    {/* Court / Hearing Schedule - ONLY show if accepted */}
                    {isAccepted && (
                      <div className="bento-box">
                        <h4 className="bento-title">{bi('Hearing and Action Plan', 'পরবর্তী শুনানি ও করণীয়')}</h4>
                        {c.caseRecord?.nextHearingAt ? (
                          <div>
                            <p className="bento-highlight">
                              {new Date(c.caseRecord.nextHearingAt).toLocaleString()}
                            </p>
                            <p className="bento-sub">{c.caseRecord.nextAction || bi('Review file with legal aid counsel before hearing', 'শুনানির পূর্বে দায়িত্বপ্রাপ্ত আইনজীবীর সাথে মামলার নথিপত্র পর্যালোচনা করুন')}</p>
                            {c.caseRecord.courtName && <p className="bento-court">{c.caseRecord.courtName}</p>}
                          </div>
                        ) : (
                          <p className="bento-muted">{bi('No court hearing scheduled yet.', 'আদালতে শুনানির দিন এখনো ধার্য হয়নি।')}</p>
                        )}
                      </div>
                    )}

                    {/* Appointed Legal Counsel */}
                    <div className="bento-box">
                      <div className="bento-head-between">
                        <h4 className="bento-title">{bi('Appointed Legal Counsel', 'নিয়োজিত প্যানেল আইনজীবী')}</h4>
                        {isAccepted && c.lawyer && !pendingChangeReq && !approvedChangeReq && (
                          <button
                            type="button"
                            className="text-action-link"
                            onClick={() => setSelectedCaseForChange(c)}
                          >
                            {bi('Request Change', 'আইনজীবী পরিবর্তনের আবেদন')}
                          </button>
                        )}
                      </div>

                      {!isAccepted ? (
                        <div className="pending-assignment-box">
                          <p className="bento-muted">
                            {bi('Pending DLAO review and approval.', 'ডিএলএও কর্মকর্তার পর্যালোচনা ও অনুমোদনের অপেক্ষায়।')}
                          </p>
                          <span className="disabled-action-note">
                            {bi('Lawyer reassignment is available once a legal counsel is assigned.', 'আইনজীবী নিযুক্ত হওয়ার পর পরিবর্তনের আবেদন করা যাবে।')}
                          </span>
                        </div>
                      ) : c.lawyer ? (
                        <div>
                          <p className="bento-highlight">{c.lawyer.lawyerName}</p>
                          <p className="bento-sub">{bi('Office Contact: ', 'যোগাযোগের মাধ্যম: ')}{c.lawyer.lawyerPhone || bi('Provided via DLAO office', 'ডিএলএও কার্যালয়ের মাধ্যমে যোগাযোগযোগ্য')}</p>
                          <span className="bento-status-tag">{bi('Status: Active Representation', 'স্থিতি: সক্রিয় আইনি প্রতিনিধিত্ব')}</span>

                          {pendingChangeReq && (
                            <div className="pending-reassignment-notice">
                              <span className="warning-dot" />
                              <div>
                                <strong>{bi('Reassignment Request Pending Review', 'আইনজীবী পরিবর্তনের আবেদন পর্যালোচনার অপেক্ষায়')}</strong>
                                <p>{bi('Reason submitted: ', 'আবেদনের কারণ: ')}&ldquo;{pendingChangeReq.reason}&rdquo;</p>
                              </div>
                            </div>
                          )}

                          {approvedChangeReq && (
                            <div className="pending-reassignment-notice" role="status">
                              <div>
                                <strong>{bi('Change approved; replacement pending', 'পরিবর্তনের আবেদন অনুমোদিত; নতুন আইনজীবী বরাদ্দের অপেক্ষায়')}</strong>
                                <p>{bi('The current lawyer remains assigned until a replacement accepts.', 'নতুন আইনজীবী আনুষ্ঠানিকভাবে দায়িত্ব গ্রহণ না করা পর্যন্ত বর্তমান আইনজীবীই দায়িত্বে বহাল থাকবেন।')}</p>
                              </div>
                            </div>
                          )}

                          {pastChangeReqs.length > 0 && (
                            <details className="past-requests-details">
                              <summary>{bi('View Past Change Requests', 'পূর্ববর্তী পরিবর্তনের আবেদনের বিবরণী')} ({pastChangeReqs.length})</summary>
                              <ul className="past-requests-list">
                                {pastChangeReqs.map(pr => (
                                  <li key={pr.id}>
                                    <span className="pr-date">{new Date(pr.createdAt).toLocaleDateString()}</span>
                                    <span className={`pr-status ${pr.status.toLowerCase()}`}>{pr.status}</span>
                                    <p className="pr-reason">&ldquo;{pr.reason}&rdquo;</p>
                                    {pr.reviewReason && <p className="pr-reason">{bi('Officer review: ', 'কর্মকর্তার পর্যালোচনা মন্তব্য: ')}{pr.reviewReason}</p>}
                                  </li>
                                ))}
                              </ul>
                            </details>
                          )}
                        </div>
                      ) : (
                        <div className="pending-assignment-box">
                          <p className="bento-muted">{bi('No panel lawyer assigned yet.', 'এখনো কোনো প্যানেল আইনজীবী নিযুক্ত করা হয়নি।')}</p>
                          <p className="bento-sub">{bi('The DLAO Officer will assign a legal counsel once the case is scheduled.', 'আবেদনটি আদালতে শুনানির জন্য গৃহীত হলে ডিএলএও কর্মকর্তা একজন প্যানেল আইনজীবী বরাদ্দ করবেন।')}</p>
                        </div>
                      )}
                    </div>

                    {/* Mediation Status */}
                    {c.mediation && (
                      <div className="bento-box">
                        <h4 className="bento-title">{bi('Mediation Status', 'সালিশ বা বিকল্প বিরোধ নিষ্পত্তি (এডিআর)')}</h4>
                        <p className="bento-highlight">
                          {bi('Session Status: ', 'বৈঠকের স্থিতি: ')}
                          <span className="status-pill status-accepted">{c.mediation.status || 'Active'}</span>
                        </p>
                        {c.mediation.scheduledAt && (
                          <p className="bento-sub">{bi('Scheduled for: ', 'ধার্যকৃত তারিখ ও সময়: ')}{new Date(c.mediation.scheduledAt).toLocaleString()}</p>
                        )}
                      </div>
                    )}
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </section>

      {/* Digital Application Modal */}
      <DigitalApplicationModal
        isOpen={showAppModal}
        onClose={() => setShowAppModal(false)}
        onSubmit={handleDigitalAppSubmit}
        profile={profile}
        session={session}
        isSubmitting={submittingApp}
      />

      {/* Lawyer Change Request Modal */}
      {selectedCaseForChange && (
        <div className="auth-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="change-modal-title">
          <div className="auth-modal-backdrop" onClick={() => setSelectedCaseForChange(null)} />
          <div className="auth-modal-card">
            <div className="auth-modal-header">
              <div>
                <span className="auth-modal-sub">{bi('Legal Aid Oversight', 'আইনি সহায়তা তদারকি ও সমন্বয়')}</span>
                <h3 id="change-modal-title" className="auth-modal-heading">
                  {bi('Request Lawyer Reassignment', 'প্যানেল আইনজীবী পরিবর্তনের আবেদন')}
                </h3>
              </div>
              <button
                type="button"
                className="auth-modal-close"
                onClick={() => setSelectedCaseForChange(null)}
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleLawyerChangeSubmit} className="auth-form-stack">
              <div className="case-brief-notice">
                <p><strong>{bi('Case: ', 'মামলা: ')}</strong>{selectedCaseForChange.caseId || selectedCaseForChange.applicationId}</p>
                <p><strong>{bi('Current Lawyer: ', 'বর্তমান আইনজীবী: ')}</strong>{selectedCaseForChange.lawyer?.lawyerName}</p>
              </div>

              <div>
                <label htmlFor="change-reason">
                  {bi('Reason for Reassignment Request', 'আইনজীবী পরিবর্তনের কারণ ও ব্যাখ্যা')}
                </label>
                <textarea
                  id="change-reason"
                  rows="4"
                  required
                  placeholder={bi(
                    'Describe why you are requesting a new lawyer (e.g. communication difficulties, conflict of interest, unavailability).',
                    'আইনজীবী পরিবর্তনের যৌক্তিক কারণ উল্লেখ করুন (যেমন: নিয়মিত যোগাযোগ না থাকা, স্বার্থের সংঘাত, আদালতে অনুপস্থিতি ইত্যাদি)।'
                  )}
                  value={changeReason}
                  onChange={(e) => setChangeReason(e.target.value)}
                />
              </div>

              <div className="dialog-action-row">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setSelectedCaseForChange(null)}
                  disabled={submittingChange}
                >
                  {bi('Cancel', 'বাতিল')}
                </button>
                <button
                  type="submit"
                  className="primary-action-btn"
                  disabled={submittingChange || !changeReason.trim()}
                >
                  {submittingChange ? bi('Submitting to DLAO…', 'ডিএলএও কার্যালয়ে প্রেরণ করা হচ্ছে…') : bi('Submit Request to DLAO Officer', 'ডিএলএও কর্মকর্তার নিকট আবেদন দাখিল করুন')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Cancel Application/Case Confirmation Modal */}
      {selectedCaseForCancel && (
        <div className="auth-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="cancel-modal-title">
          <div className="auth-modal-backdrop" onClick={() => setSelectedCaseForCancel(null)} />
          <div className="auth-modal-card">
            <div className="auth-modal-header">
              <div>
                <span className="auth-modal-sub">{bi('Legal Aid Oversight', 'আইনি সহায়তা তদারকি ও সমন্বয়')}</span>
                <h3 id="cancel-modal-title" className="auth-modal-heading">
                  {bi('Cancel This Application/Case', 'আবেদন/মামলা বাতিল করুন')}
                </h3>
              </div>
              <button
                type="button"
                className="auth-modal-close"
                onClick={() => setSelectedCaseForCancel(null)}
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleCancelSubmit} className="auth-form-stack">
              <div className="case-brief-notice">
                <p><strong>{bi('Case: ', 'মামলা: ')}</strong>{selectedCaseForCancel.caseId || selectedCaseForCancel.applicationId}</p>
              </div>

              <p className="bento-muted">
                {selectedCaseForCancel.status === 'ACCEPTED'
                  ? bi(
                      'This case has already been accepted by the DLAO. Cancelling it sends a request to the DLAO officer, who must confirm before the case is closed.',
                      'এই মামলাটি ইতিমধ্যে ডিএলএও কর্তৃক গৃহীত হয়েছে। বাতিল করলে তা ডিএলএও কর্মকর্তার নিকট অনুরোধ হিসেবে যাবে; কর্মকর্তা নিশ্চিত করার পরই মামলাটি বন্ধ হবে।'
                    )
                  : bi(
                      'This application has not yet been accepted, so it will be cancelled immediately.',
                      'এই আবেদনটি এখনো গৃহীত হয়নি, তাই এটি সাথে সাথেই বাতিল হয়ে যাবে।'
                    )}
              </p>

              <div>
                <label htmlFor="cancel-reason">
                  {bi('Reason for Cancellation', 'বাতিলের কারণ')}
                </label>
                <textarea
                  id="cancel-reason"
                  rows="4"
                  required
                  minLength="5"
                  placeholder={bi(
                    'Describe why you want to cancel this application or case.',
                    'কেন এই আবেদন বা মামলাটি বাতিল করতে চান তা লিখুন।'
                  )}
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                />
              </div>

              <div className="dialog-action-row">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setSelectedCaseForCancel(null)}
                  disabled={submittingCancel}
                >
                  {bi('Keep My Application', 'আবেদনটি বহাল রাখুন')}
                </button>
                <button
                  type="submit"
                  className="primary-action-btn"
                  disabled={submittingCancel || !cancelReason.trim()}
                >
                  {submittingCancel ? bi('Submitting…', 'প্রক্রিয়াধীন…') : bi('Yes, Cancel', 'হ্যাঁ, বাতিল করুন')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
