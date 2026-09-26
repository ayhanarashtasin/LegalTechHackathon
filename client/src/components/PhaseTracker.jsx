import { bi } from './Bi.jsx'

export default function PhaseTracker({ application = null, caseRecord = null, lawyer = null, mediation = null, pathway = null }) {
  const hasApplication = Boolean(application && application.applicationId)
  const status = application?.status || null
  const reviewState = application?.reviewState || null
  const channel = application?.channel || application?.intakeChannel || null
  const isAccepted = status === 'ACCEPTED'
  const isTerminated = status === 'TERMINATED' || status === 'REJECTED' || status === 'CANCELLED' || caseRecord?.status === 'CLOSED'
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
    ? bi('Awaiting Submission', 'আবেদনের অপেক্ষায়')
    : channel === 'VOICE_SIM'
      ? bi('16699 IVR Voice', '১৬৬৯৯ ভয়েস হেল্পলাইন')
      : channel === 'UDC'
        ? bi('UDC Center', 'ইউনিয়ন ডিজিটাল সেন্টার')
        : bi('Web Portal', 'অনলাইন ওয়েব পোর্টাল')

  const steps = [
    {
      num: 1,
      title: bi('1. Access & Application', '১. আবেদন ও প্রবেশাধিকার'),
      subtitle: channelLabel,
      detail: hasApplication
        ? bi('Submission received & Application ID generated', 'আবেদন গৃহীত হয়েছে এবং আবেদন নম্বর বরাদ্দ করা হয়েছে')
        : bi('Web, mobile app, 16699 IVR, or UDC', 'ওয়েব, মোবাইল, ১৬৬৯৯ বা ইউডিসি থেকে আবেদন'),
    },
    {
      num: 2,
      title: bi('2. Verification & Eligibility', '২. প্রাথমিক যাচাই ও যোগ্যতা'),
      subtitle: !hasApplication
        ? bi('Pending', 'অপেক্ষমাণ')
        : reviewState === 'READY_FOR_DECISION'
          ? bi('Eligibility Verified', 'যোগ্যতা যাচাই সম্পন্ন')
          : bi('Under Officer Review', 'কর্মকর্তা পর্যায়ে যাচাইাধীন'),
      detail: !hasApplication
        ? bi('Awaiting submission', 'আবেদনের অপেক্ষায়')
        : reviewState === 'READY_FOR_DECISION'
          ? bi('Identity & DBLA criteria checked', 'পরিচয় ও আইনগত মাপকাঠি যাচাইকৃত')
          : bi('Verifying identity, documents & eligibility', 'পরিচয়, নথিপত্র ও যোগ্যতা যাচাই'),
    },
    {
      num: 3,
      title: bi('3. Jurisdiction & Routing', '৩. অধিক্ষেত্র ও নথি গ্রহণ'),
      subtitle: !hasApplication
        ? bi('Pending', 'অপেক্ষমাণ')
        : isAccepted
          ? bi('Jurisdiction Accepted', 'অধিক্ষেত্র নিশ্চিত ও গৃহীত')
          : status === 'REJECTED'
            ? bi('Not Approved', 'নামঞ্জুর')
            : bi('Assessment', 'অধিক্ষেত্র মূল্যায়ন'),
      detail: isAccepted
        ? bi(`Case ID: ${application.caseId || 'Assigned'}`, `মামলা নম্বর: ${application.caseId || 'বরাদ্দকৃত'}`)
        : bi('Appropriate office jurisdiction verification', 'উপযুক্ত জেলা কার্যালয় নির্ধারণ'),
    },
    {
      num: 4,
      title: bi('4. Service Pathways', '৪. সেবার মাধ্যম নির্ধারণ'),
      subtitle: hasMediation
        ? bi('Mediation / ADR', 'আপস-মীমাংসা / মধ্যস্থতা')
        : pathway === 'ADVICE'
          ? bi('Legal Advice', 'আইনি পরামর্শ')
          : isAccepted
            ? bi('Pathway Routing', 'সেবার পথ নির্ধারণ')
            : bi('Pending', 'অপেক্ষমাণ'),
      detail: bi('Advice, Mediation (ADR/ODR), or Direct Legal Aid', 'আইনি পরামর্শ, মধ্যস্থতা (এডিআর/ওডিআর), বা মামলা পরিচালনা'),
    },
    {
      num: 5,
      title: bi('5. Panel Lawyer Process', '৫. প্যানেল আইনজীবী প্রক্রিয়া'),
      subtitle: hasLawyer
        ? (lawyer.lawyerName || bi('Lawyer Appointed', 'আইনজীবী নিযুক্ত'))
        : bi('If Required', 'প্রয়োজনাধীন'),
      detail: hasLawyer
        ? bi('Assigned counsel · Hearings & court representation', 'নিয়োজিত আইনজীবী · শুনানি ও আদালতের কার্যক্রম')
        : bi('Financial check & panel lawyer allocation', 'আর্থিক যাচাই ও প্যানেল আইনজীবী নিয়োগ'),
    },
    {
      num: 6,
      title: bi('6. Case Outcome & Closure', '৬. মামলার নিষ্পত্তি ও সমাপ্তি'),
      subtitle: isTerminated
        ? bi('Case Closed', 'নথি সমাপ্ত')
        : isSettled
          ? bi('Settled / Disposed', 'আপসে নিষ্পত্তি')
          : bi('Final Disposal', 'চূড়ান্ত নিষ্পত্তি'),
      detail: isTerminated
        ? bi('Legal outcome recorded & fee disbursed', 'ফলাফল নথিভুক্ত ও ফি পরিশোধ সম্পন্ন')
        : bi('Court judgment, settlement & completion audit', 'রায়, আপসনামা বা সমাপ্তি নিরীক্ষা'),
    },
  ]

  const summaryText = currentStep === 0
    ? bi('Phase 0 of 6 • Awaiting initial submission', 'পর্যায় ০ / ৬ • প্রাথমিক আবেদনের অপেক্ষায়')
    : bi(
        `Phase ${Math.min(currentStep, 6)} of 6 • ${steps[currentStep - 1]?.title}`,
        `ধাপ ${Math.min(currentStep, 6)} / ৬ • ${steps[currentStep - 1]?.title}`
      )

  return (
    <div className="phase-tracker-card" aria-label={bi('DLAS Comprehensive End-to-End Workflow', 'ডিএলএএস সমন্বিত আইনি সহায়তা প্রক্রিয়া')}>
      <div className="phase-tracker-header">
        <div className="phase-tracker-header-info">
          <span className="phase-tracker-badge">{bi('DLAS Comprehensive End-to-End Workflow', 'ডিএলএএস সমন্বিত আইনি সহায়তা প্রক্রিয়া')}</span>
          <h3 className="phase-tracker-title">{bi('From Application to Access to Justice', 'আবেদন দাখিল থেকে ন্যায়বিচার প্রাপ্তি পর্যন্ত')}</h3>
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

