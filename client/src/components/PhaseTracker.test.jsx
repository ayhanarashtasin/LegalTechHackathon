import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, test } from 'vitest'
import { setLang } from './Bi.jsx'
import PhaseTracker from './PhaseTracker.jsx'

describe('PhaseTracker component', () => {
  afterEach(() => setLang('en'))

  test('renders Phase 0 when no application is provided', () => {
    const html = renderToStaticMarkup(<PhaseTracker />)
    expect(html).toContain('DLAS Comprehensive End-to-End Workflow')
    expect(html).toContain('Phase 0 of 6')
    expect(html).toContain('Awaiting initial submission')
    expect(html).toContain('1. Access &amp; Application')
    expect(html).toContain('6. Case Outcome &amp; Closure')
  })

  test('renders Phase 2 for newly submitted application under review', () => {
    const app = {
      applicationId: 'APP-2026-000010',
      status: 'SUBMITTED',
      reviewState: 'PENDING_REVIEW',
      channel: 'VOICE_SIM',
    }
    const html = renderToStaticMarkup(<PhaseTracker application={app} />)
    expect(html).toContain('Phase 2 of 6')
    expect(html).toContain('16699 IVR Voice')
    expect(html).toContain('step-completed')
    expect(html).toContain('step-active')
  })

  test('renders Phase 3 for accepted application with assigned Case ID', () => {
    const app = {
      applicationId: 'APP-2026-000005',
      status: 'ACCEPTED',
      reviewState: 'ACCEPTED',
      caseId: 'CASE-2026-000002',
    }
    const html = renderToStaticMarkup(<PhaseTracker application={app} />)
    expect(html).toContain('Phase 3 of 6')
    expect(html).toContain('Jurisdiction Accepted')
    expect(html).toContain('CASE-2026-000002')
  })

  test('renders Phase 4 when mediation or ADR pathway is active', () => {
    const app = {
      applicationId: 'APP-2026-000005',
      status: 'ACCEPTED',
      caseId: 'CASE-2026-000002',
    }
    const mediation = { stage: 'FIRST_SESSION_SCHEDULED' }
    const html = renderToStaticMarkup(<PhaseTracker application={app} mediation={mediation} />)
    expect(html).toContain('Phase 4 of 6')
    expect(html).toContain('Mediation / ADR')
  })

  test('renders Phase 5 when panel lawyer is assigned', () => {
    const app = {
      applicationId: 'APP-2026-000005',
      status: 'ACCEPTED',
      caseId: 'CASE-2026-000002',
    }
    const lawyer = { lawyerName: 'Adv. Farhana Islam', assignmentStatus: 'ACCEPTED' }
    const html = renderToStaticMarkup(<PhaseTracker application={app} lawyer={lawyer} />)
    expect(html).toContain('Phase 5 of 6')
    expect(html).toContain('Adv. Farhana Islam')
  })

  test('renders Phase 6 when case is resolved or closed', () => {
    const app = {
      applicationId: 'APP-2026-000005',
      status: 'ACCEPTED',
      caseId: 'CASE-2026-000002',
    }
    const mediation = { outcome: 'AGREEMENT_REACHED' }
    const html = renderToStaticMarkup(<PhaseTracker application={app} mediation={mediation} />)
    expect(html).toContain('Phase 6 of 6')
    expect(html).toContain('Settled / Disposed')
  })

  test('renders bilingual Bengali text when language is set to bn', () => {
    setLang('bn')
    const app = {
      applicationId: 'APP-2026-000005',
      status: 'ACCEPTED',
      caseId: 'CASE-2026-000002',
    }
    const html = renderToStaticMarkup(<PhaseTracker application={app} />)
    expect(html).toContain('ডিএলএএস সমন্বিত আইনি সহায়তা প্রক্রিয়া')
    expect(html).toContain('১. আবেদন ও প্রবেশাধিকার')
    expect(html).toContain('৩. অধিক্ষেত্র ও নথি গ্রহণ')
  })
})
