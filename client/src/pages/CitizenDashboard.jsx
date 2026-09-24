import { useState, useEffect } from 'react'
import { Link } from 'react-router'
import { api } from '../services/api.js'
import { bi } from '../components/Bi.jsx'
import PhaseTracker from '../components/PhaseTracker.jsx'

const DISTRICTS = [
  'Dhaka', 'Chattogram', 'Rajshahi', 'Khulna', 'Barishal', 'Sylhet', 'Rangpur', 'Mymensingh',
  'Jhenaidah', 'Cumilla', 'Bogura', 'Gazipur', 'Narayanganj', 'Tangail', 'Faridpur', 'Cox\'s Bazar'
]

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

  // Digital application state
  const [showAppModal, setShowAppModal] = useState(false)
  const [appApplicantName, setAppApplicantName] = useState('')
  const [appProblem, setAppProblem] = useState('')
  const [appDistrict, setAppDistrict] = useState(DISTRICTS[0])
  const [appUrgent, setAppUrgent] = useState(false)
  const [appIdentityDoc, setAppIdentityDoc] = useState('NID')
  const [appPhone, setAppPhone] = useState('')
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
    setAppApplicantName(profile?.displayName || session?.user?.displayName || '')
    setAppPhone(profile?.phone || session?.user?.phone || '')
    setAppDistrict(profile?.district && DISTRICTS.includes(profile.district) ? profile.district : DISTRICTS[0])
    setAppIdentityDoc(profile?.nid ? 'NID' : 'NONE')
    setShowAppModal(true)
  }

  async function handleDigitalAppSubmit(e) {
    e.preventDefault()
    if (!appProblem.trim()) return

    setSubmittingApp(true)
    setError('')
    setFeedbackMsg('')
    try {
      const res = await api('/api/citizen/applications', {
        method: 'POST',
        token: session.token,
        body: {
          problem: appProblem.trim(),
          district: appDistrict,
          urgent: appUrgent,
          contactPhone: appPhone.trim(),
          identityDocument: appIdentityDoc,
          applicantName: appApplicantName.trim() || session.user.displayName,
        },
      })
      setFeedbackMsg(res.message || 'Application submitted successfully.')
      setShowAppModal(false)
      setAppProblem('')
      setAppUrgent(false)
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
      setFeedbackMsg(res.message || 'Lawyer change request submitted successfully.')
      setSelectedCaseForChange(null)
      setChangeReason('')
      setRefresh((r) => r + 1)
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmittingChange(false)
    }
  }

  return (
    <div className="citizen-portal-container">
      {/* Top Welcome Bar */}
      <section className="citizen-welcome-hero">
        <div className="citizen-hero-content">
          <span className="citizen-kicker">{bi('Citizen Legal Aid Portal', 'নাগরিক লিগ্যাল এইড পোর্টাল')}</span>
          <h1 className="citizen-heading">
            {bi('Welcome,', 'স্বাগতম,')} {profile?.displayName || session.user.displayName || session.user.username}
          </h1>
          <p className="citizen-subhead">
            {bi(
              'Track your legal aid applications, court case progression, and advocate assignments transparently.',
              'আপনার আইনি সহায়তা আবেদন, মামলার অগ্রগতি এবং নিযুক্ত আইনজীবীর তথ্য স্বচ্ছভাবে পর্যবেক্ষণ করুন।'
            )}
          </p>
        </div>
        <div className="citizen-hero-actions">
          <button
            type="button"
            className="citizen-voice-cta"
            onClick={openAppModal}
          >
            {bi('Submit Digital Application', 'ডিজিটাল আবেদন জমা দিন')}
          </button>
          <Link to="/voice" className="citizen-voice-secondary-cta">
            {bi('Voice Intake (16699)', 'ভয়েস আবেদন (১৬৬৯৯)')}
          </Link>
        </div>
      </section>

      {feedbackMsg && (
        <div className="auth-alert success" role="status">
          <strong>{bi('Update: ', 'আপডেট: ')}</strong>{feedbackMsg}
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
          <span className="case-count">{cases.length} {cases.length === 1 ? bi('matter found', 'টি মামলা') : bi('matters found', 'টি মামলা')}</span>
        </div>

        {loading ? (
          <div className="loading-state-box">
            <p>{bi('Loading your case files…', 'মামলার তথ্য লোড হচ্ছে…')}</p>
          </div>
        ) : cases.length === 0 ? (
          <div className="citizen-empty-container">
            {/* Step 0 Lifecycle Tracker */}
            <div className="phase-tracker-wrapper">
              <PhaseTracker application={null} />
            </div>

            <div className="empty-state-box">
              <p className="empty-title">{bi('No active legal aid applications found', 'কোনো সক্রিয় আইনি সহায়তা আবেদন পাওয়া যায়নি')}</p>
              <p className="empty-desc">
                {bi(
                  'Submit an application online or use our 16699 voice simulation to get started. Court hearing schedules and legal aid lawyer assignment become available after DLAO review and acceptance.',
                  'অনলাইনে আবেদন জমা দিন অথবা শুরু করতে আমাদের ১৬৬৯৯ ভয়েস সিমুলেশন ব্যবহার করুন। ডিএলএও পর্যালোচনা ও অনুমোদনের পর শুনানির তারিখ ও আইনজীবী নিযুক্ত করা হবে।'
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
                    </div>

                    <div className="case-card-meta">
                      <span className="meta-label">{bi('Intake Channel', 'আবেদনের মাধ্যম')}</span>
                      <span className="meta-value">{c.intakeChannel}</span>
                      <span className="meta-label" style={{ marginTop: '8px' }}>{bi('Date Filed', 'আবেদনের তারিখ')}</span>
                      <span className="meta-value">{new Date(c.createdAt).toLocaleDateString()}</span>
                    </div>
                  </header>

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
                        <h4 className="bento-title">{bi('Hearing and Action Plan', 'শুনানি ও পদক্ষেপ')}</h4>
                        {c.caseRecord?.nextHearingAt ? (
                          <div>
                            <p className="bento-highlight">
                              {new Date(c.caseRecord.nextHearingAt).toLocaleString()}
                            </p>
                            <p className="bento-sub">{c.caseRecord.nextAction || bi('Review file with legal aid counsel before hearing', 'শুনানির আগে আইনজীবীর সাথে ফাইল পর্যালোচনা করুন')}</p>
                            {c.caseRecord.courtName && <p className="bento-court">{c.caseRecord.courtName}</p>}
                          </div>
                        ) : (
                          <p className="bento-muted">{bi('No court hearing scheduled yet.', 'এখনো কোনো শুনানির তারিখ নির্ধারিত হয়নি।')}</p>
                        )}
                      </div>
                    )}

                    {/* Appointed Legal Counsel */}
                    <div className="bento-box">
                      <div className="bento-head-between">
                        <h4 className="bento-title">{bi('Appointed Legal Counsel', 'নিযুক্ত আইনজীবী')}</h4>
                        {isAccepted && c.lawyer && !pendingChangeReq && !approvedChangeReq && (
                          <button
                            type="button"
                            className="text-action-link"
                            onClick={() => setSelectedCaseForChange(c)}
                          >
                            {bi('Request Change', 'আইনজীবী বদলের আবেদন')}
                          </button>
                        )}
                      </div>

                      {!isAccepted ? (
                        <div className="pending-assignment-box">
                          <p className="bento-muted">
                            {bi('Pending DLAO review and approval.', 'ডিএলএও পর্যালোচনা ও অনুমোদনের অপেক্ষায়।')}
                          </p>
                          <span className="disabled-action-note">
                            {bi('Lawyer reassignment is available once a legal counsel is assigned.', 'আইনজীবী নিযুক্ত হওয়ার পর বদলের অনুরোধ করা যাবে।')}
                          </span>
                        </div>
                      ) : c.lawyer ? (
                        <div>
                          <p className="bento-highlight">{c.lawyer.lawyerName}</p>
                          <p className="bento-sub">{bi('Office Contact: ', 'যোগাযোগ: ')}{c.lawyer.lawyerPhone || bi('Provided via DLAO office', 'ডিএলএও অফিসের মাধ্যমে')}</p>
                          <span className="bento-status-tag">{bi('Status: Active Representation', 'অবস্থা: সক্রিয় আইনি প্রতিনিধিত্ব')}</span>

                          {pendingChangeReq && (
                            <div className="pending-reassignment-notice">
                              <span className="warning-dot" />
                              <div>
                                <strong>{bi('Reassignment Request Pending Review', 'বদলের অনুরোধ পর্যালোচনার অপেক্ষায়')}</strong>
                                <p>{bi('Reason submitted: ', 'কারণ: ')}&ldquo;{pendingChangeReq.reason}&rdquo;</p>
                              </div>
                            </div>
                          )}

                          {approvedChangeReq && (
                            <div className="pending-reassignment-notice" role="status">
                              <div>
                                <strong>{bi('Change approved; replacement pending', 'বদলের অনুরোধ অনুমোদিত; নতুন আইনজীবীর অপেক্ষায়')}</strong>
                                <p>{bi('The current lawyer remains assigned until a replacement accepts.', 'নতুন আইনজীবী দায়িত্ব না নেওয়া পর্যন্ত বর্তমান আইনজীবী নিযুক্ত থাকবেন।')}</p>
                              </div>
                            </div>
                          )}

                          {pastChangeReqs.length > 0 && (
                            <details className="past-requests-details">
                              <summary>{bi('View Past Change Requests', 'পূর্ববর্তী অনুরোধের বিবরণ')} ({pastChangeReqs.length})</summary>
                              <ul className="past-requests-list">
                                {pastChangeReqs.map(pr => (
                                  <li key={pr.id}>
                                    <span className="pr-date">{new Date(pr.createdAt).toLocaleDateString()}</span>
                                    <span className={`pr-status ${pr.status.toLowerCase()}`}>{pr.status}</span>
                                    <p className="pr-reason">&ldquo;{pr.reason}&rdquo;</p>
                                    {pr.reviewReason && <p className="pr-reason">{bi('Officer review: ', 'কর্মকর্তার পর্যালোচনা: ')}{pr.reviewReason}</p>}
                                  </li>
                                ))}
                              </ul>
                            </details>
                          )}
                        </div>
                      ) : (
                        <div className="pending-assignment-box">
                          <p className="bento-muted">{bi('No panel lawyer assigned yet.', 'এখনো কোনো আইনজীবী নিযুক্ত করা হয়নি।')}</p>
                          <p className="bento-sub">{bi('The DLAO Officer will assign a legal counsel once the case is scheduled.', 'মামলাটি শুনানির জন্য প্রস্তুত হলে ডিএলএও কর্মকর্তা আইনজীবী নিযুক্ত করবেন।')}</p>
                        </div>
                      )}
                    </div>

                    {/* Mediation Status */}
                    {c.mediation && (
                      <div className="bento-box">
                        <h4 className="bento-title">{bi('Mediation Status', 'সালিশ / মধ্যস্থতা অবস্থা')}</h4>
                        <p className="bento-highlight">
                          {bi('Session Status: ', 'অবস্থা: ')}
                          <span className="status-pill status-accepted">{c.mediation.status || 'Active'}</span>
                        </p>
                        {c.mediation.scheduledAt && (
                          <p className="bento-sub">{bi('Scheduled for: ', 'নির্ধারিত তারিখ: ')}{new Date(c.mediation.scheduledAt).toLocaleString()}</p>
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
      {showAppModal && (
        <div className="auth-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="app-modal-title">
          <div className="auth-modal-backdrop" onClick={() => setShowAppModal(false)} />
          <div className="auth-modal-card">
            <div className="auth-modal-header">
              <div>
                <span className="auth-modal-sub">{bi('Direct Legal Aid Request', 'সরাসরি আইনি আবেদন')}</span>
                <h3 id="app-modal-title" className="auth-modal-heading">
                  {bi('Submit Legal Aid Application', 'আইনি সহায়তা আবেদনপত্র')}
                </h3>
              </div>
              <button
                type="button"
                className="auth-modal-close"
                onClick={() => setShowAppModal(false)}
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleDigitalAppSubmit} className="auth-form-stack">
              <div>
                <label htmlFor="app-name">{bi('Applicant Name', 'আবেদনকারীর নাম')}</label>
                <input
                  id="app-name"
                  type="text"
                  required
                  value={appApplicantName}
                  onChange={(e) => setAppApplicantName(e.target.value)}
                />
              </div>

              <div>
                <label htmlFor="app-problem">{bi('Describe Your Legal Matter / Incident', 'আপনার আইনি সমস্যা বা ঘটনার বিবরণ')}</label>
                <textarea
                  id="app-problem"
                  rows="4"
                  required
                  placeholder={bi(
                    'Provide details regarding the dispute, family matter, labor rights, tenancy, or legal challenge.',
                    'আপনার বিরোধ, পারিবারিক বিষয়, জমি-জমা, শ্রম অধিকার বা আইনি সমস্যার বিবরণ দিন।'
                  )}
                  value={appProblem}
                  onChange={(e) => setAppProblem(e.target.value)}
                />
              </div>

              <div>
                <label htmlFor="app-district">{bi('District', 'জেলা')}</label>
                <select
                  id="app-district"
                  className="auth-select"
                  value={appDistrict}
                  onChange={(e) => setAppDistrict(e.target.value)}
                >
                  {DISTRICTS.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="app-phone">{bi('Safe Contact Phone', 'নিরাপদ যোগাযোগের ফোন নম্বর')}</label>
                <input
                  id="app-phone"
                  type="tel"
                  placeholder="01700000000"
                  value={appPhone}
                  onChange={(e) => setAppPhone(e.target.value)}
                />
              </div>

              <div>
                <label htmlFor="app-identity-doc">{bi('Identity Document Available', 'সংযুক্ত পরিচয়পত্র')}</label>
                <select
                  id="app-identity-doc"
                  className="auth-select"
                  value={appIdentityDoc}
                  onChange={(e) => setAppIdentityDoc(e.target.value)}
                >
                  <option value="NID">{bi('National ID (NID)', 'জাতীয় পরিচয়পত্র (এনআইডি)')}</option>
                  <option value="BIRTH_CERTIFICATE">{bi('Birth Certificate', 'জন্ম নিবন্ধন')}</option>
                  <option value="NONE">{bi('None or not currently available', 'নেই বা আপাতত নেই')}</option>
                </select>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '0.5rem 0' }}>
                <input
                  id="app-urgent"
                  type="checkbox"
                  style={{ width: 'auto', margin: 0 }}
                  checked={appUrgent}
                  onChange={(e) => setAppUrgent(e.target.checked)}
                />
                <label htmlFor="app-urgent" style={{ margin: 0, fontWeight: 550, cursor: 'pointer' }}>
                  {bi('Immediate danger or urgent protection requested', 'তাৎক্ষণিক বিপদের ঝুঁকি বা জরুরি সুরক্ষা প্রয়োজন')}
                </label>
              </div>

              <div className="dialog-action-row">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setShowAppModal(false)}
                  disabled={submittingApp}
                >
                  {bi('Cancel', 'বাতিল')}
                </button>
                <button
                  type="submit"
                  className="primary-action-btn"
                  disabled={submittingApp || !appProblem.trim()}
                >
                  {submittingApp ? bi('Submitting…', 'জমা হচ্ছে…') : bi('Submit Application', 'আবেদন জমা দিন')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Lawyer Change Request Modal */}
      {selectedCaseForChange && (
        <div className="auth-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="change-modal-title">
          <div className="auth-modal-backdrop" onClick={() => setSelectedCaseForChange(null)} />
          <div className="auth-modal-card">
            <div className="auth-modal-header">
              <div>
                <span className="auth-modal-sub">{bi('Legal Aid Oversight', 'আইনি সহায়তা তদারকি')}</span>
                <h3 id="change-modal-title" className="auth-modal-heading">
                  {bi('Request Lawyer Reassignment', 'আইনজীবী বদলের আবেদন')}
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
                  {bi('Reason for Reassignment Request', 'আইনজীবী বদলের কারণ')}
                </label>
                <textarea
                  id="change-reason"
                  rows="4"
                  required
                  placeholder={bi(
                    'Describe why you are requesting a new lawyer (e.g. communication difficulties, conflict of interest, unavailability).',
                    'আইনজীবী বদলের কারণ লিখুন (যেমন: যোগাযোগে সমস্যা, স্বার্থের সংঘাত, সময় না দেওয়া ইত্যাদি)।'
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
                  {submittingChange ? bi('Submitting to DLAO…', 'জমা হচ্ছে…') : bi('Submit Request to DLAO Officer', 'ডিএলএও কর্মকর্তার কাছে পাঠান')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
