export default function PhaseTracker({ application = null, caseRecord = null, lawyer = null, mediation = null, pathway = null }) {
  const hasApplication = Boolean(application && application.applicationId)
  const status = application?.status || null
  const reviewState = application?.reviewState || null
  const channel = application?.channel || application?.intakeChannel || null
  const isAccepted = status === 'ACCEPTED'
  const isTerminated = status === 'TERMINATED' || status === 'REJECTED' || caseRecord?.status === 'CLOSED'
  const hasLawyer = Boolean(lawyer?.lawyerName || lawyer?.assignmentStatus === 'ACCEPTED' || lawyer?.active)
  const hasMediation = Boolean(mediation?.stage)
  const isSettled = mediation?.outcome === 'AGREEMENT_REACHED' || caseRecord?.status === 'SETTLED' || caseRecord?.outcome

  // Determine current active phase (1 to 6)
  let currentStep = 0
  if (hasApplication) {
    if (isTerminated || isSettled) {
      currentStep = 6
    } else if (isAccepted && hasLawyer) {
      currentStep = 5
    } else if (isAccepted && (hasMediation || (pathway && pathway !== 'NONE'))) {
      currentStep = 4
    } else if (isAccepted) {
      currentStep = 3
    } else if (status === 'SUBMITTED' || reviewState === 'READY_FOR_DECISION' || reviewState === 'NEEDS_INFORMATION' || reviewState === 'PENDING_REVIEW') {
      currentStep = 2
    } else {
      currentStep = 1
    }
  }

  const channelLabel = !hasApplication
    ? 'Awaiting Submission'
    : channel === 'VOICE_SIM'
      ? '16699 IVR Voice'
      : channel === 'UDC'
        ? 'UDC Center'
        : 'Web Portal'

  const steps = [
    {
      num: 1,
      title: '1. Access & Application',
      subtitle: channelLabel,
      detail: hasApplication ? 'Submission received & Application ID generated' : 'Web, mobile app, 16699 IVR, or UDC',
    },
    {
      num: 2,
      title: '2. Verification & Eligibility',
      subtitle: !hasApplication ? 'Pending' : reviewState === 'READY_FOR_DECISION' ? 'Eligibility Verified' : 'Under Officer Review',
      detail: !hasApplication ? 'Awaiting submission' : reviewState === 'READY_FOR_DECISION' ? 'Identity & DBLA criteria checked' : 'Verifying identity, documents & eligibility',
    },
    {
      num: 3,
      title: '3. Jurisdiction & Routing',
      subtitle: !hasApplication ? 'Pending' : isAccepted ? 'Jurisdiction Accepted' : status === 'REJECTED' ? 'Not Approved' : 'Assessment',
      detail: isAccepted ? `Case ID: ${application.caseId || 'Assigned'}` : 'Appropriate office jurisdiction verification',
    },
    {
      num: 4,
      title: '4. Service Pathways',
      subtitle: hasMediation ? 'Mediation / ADR' : pathway === 'ADVICE' ? 'Legal Advice' : isAccepted ? 'Pathway Routing' : 'Pending',
      detail: 'Advice, Mediation (ADR/ODR), or Direct Legal Aid',
    },
    {
      num: 5,
      title: '5. Panel Lawyer Process',
      subtitle: hasLawyer ? (lawyer.lawyerName || 'Lawyer Appointed') : 'If Required',
      detail: hasLawyer ? `Assigned counsel · Hearings & court representation` : 'Financial check & panel lawyer allocation',
    },
    {
      num: 6,
      title: '6. Case Outcome & Closure',
      subtitle: isTerminated ? 'Case Closed' : isSettled ? 'Settled / Disposed' : 'Final Disposal',
      detail: isTerminated ? 'Legal outcome recorded & fee disbursed' : 'Court judgment, settlement & completion audit',
    },
  ]

  const summaryText = currentStep === 0
    ? 'Phase 0 of 6 \u2022 Awaiting initial submission'
    : `Phase ${Math.min(currentStep, 6)} of 6 \u2022 ${steps[currentStep - 1]?.title}`

  return (
    <div className="phase-tracker-card" aria-label="DLAS Comprehensive End-to-End Workflow">
      <div className="phase-tracker-header">
        <div>
          <span className="phase-tracker-badge">DLAS Comprehensive End-to-End Workflow</span>
          <h3 className="phase-tracker-title">From Application to Access to Justice</h3>
        </div>
        <div className={`phase-tracker-summary ${currentStep === 0 ? 'step-zero-summary' : ''}`}>
          {summaryText}
        </div>
      </div>

      <ol className="phase-steps-grid">
        {steps.map((step) => {
          const isCompleted = currentStep > 0 && (step.num < currentStep || (step.num === currentStep && (isTerminated || isSettled) && step.num === 6))
          const isCurrent = currentStep > 0 && step.num === currentStep && !isTerminated
          const isFuture = currentStep === 0 || step.num > currentStep

          return (
            <li
              key={step.num}
              className={`phase-step-item ${isCompleted ? 'step-completed' : ''} ${isCurrent ? 'step-active' : ''} ${isFuture ? 'step-upcoming' : ''}`}
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
                {step.num < 6 && <span className="phase-step-line" aria-hidden="true" />}
              </div>

              <div className="phase-step-content">
                <div className="phase-step-top">
                  <span className="phase-step-title">{step.title}</span>
                </div>
                <div className="phase-step-sub">{step.subtitle}</div>
                <div className="phase-step-detail">{step.detail}</div>
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

