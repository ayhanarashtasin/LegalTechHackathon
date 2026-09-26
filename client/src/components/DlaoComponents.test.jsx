import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, test } from 'vitest'
import { setLang } from './Bi.jsx'
import DlaoCalendar from './DlaoCalendar.jsx'
import PartiesCard from './PartiesCard.jsx'
import { HearingListView, MediationCaseListView, LawyerFeedbackView, ClaoCertificationView } from './DlaoViews.jsx'

describe('DLAO Components Test Suite', () => {
  afterEach(() => setLang('en'))

  test('DlaoCalendar renders events grouped by date with filter controls', () => {
    const events = [
      {
        id: 'ev-1',
        title: 'Mediation Session #1',
        type: 'MEDIATION',
        scheduledAt: new Date().toISOString(),
        caseId: 'CASE-2026-000001',
        venue: 'Room 201',
      },
      {
        id: 'ev-2',
        title: 'Court Hearing: Final Submissions',
        type: 'HEARING',
        scheduledAt: new Date(Date.now() + 86400000).toISOString(),
        caseId: 'CASE-2026-000002',
        venue: 'District Court 3',
      },
      {
        id: 'ev-3',
        title: 'Lawyer Update Due: Adv. Farhana',
        type: 'LAWYER_DEADLINE',
        scheduledAt: new Date(Date.now() + 172800000).toISOString(),
        caseId: 'CASE-2026-000003',
      },
    ]

    const html = renderToStaticMarkup(
      <MemoryRouter>
        <DlaoCalendar events={events} />
      </MemoryRouter>
    )
    expect(html).toContain('All Events')
    expect(html).toContain('Hearings (শুনানী)')
    expect(html).toContain('Mediations (মধ্যস্থতা)')
    expect(html).toContain('Lawyer Deadlines')
    expect(html).toContain('CASE-2026-000001')
    expect(html).toContain('CASE-2026-000002')
    expect(html).toContain('CASE-2026-000003')
    expect(html).toContain('Mediation Session #1')
    expect(html).toContain('Court Hearing: Final Submissions')
  })

  test('PartiesCard renders complainant (বাদী), respondent (বিবাদী), and notice section', () => {
    const application = {
      applicationId: 'APP-2026-0001',
      applicantName: 'Rashida Begum',
      safeContactPhone: '01711223344',
      petitioner: {
        name: 'Rashida Begum',
        phone: '01711223344',
        address: 'Mirpur, Dhaka',
        nid: '19852691234567890',
      },
      respondent: {
        name: 'Abdul Malek',
        phone: '01811998877',
        address: 'Dhanmondi, Dhaka',
        relationship: 'Husband',
      },
      preMediationVerification: {
        petitionerVerified: true,
        respondentVerified: true,
        status: 'VERIFIED',
      },
      notices: [
        {
          _id: 'n-1',
          recipient: 'RESPONDENT',
          memoNo: 'RL-992144',
          deliveryMethod: 'PROCESS_SERVER',
          status: 'SENT',
          sentAt: new Date().toISOString(),
          notes: 'Notice delivered in person.',
        },
      ],
    }

    const html = renderToStaticMarkup(
      <MemoryRouter>
        <PartiesCard application={application} token="test-token" onUpdated={() => {}} />
      </MemoryRouter>
    )
    expect(html).toContain('Rashida Begum')
    expect(html).toContain('01711223344')
    expect(html).toContain('Abdul Malek')
    expect(html).toContain('01811998877')
    expect(html).toContain('Phone Verified')
    expect(html).toContain('RL-992144')
    expect(html).toContain('Process server')
  })

  test('HearingListView renders hearings and search controls', () => {
    const hearings = [
      {
        applicationId: 'APP-01',
        caseId: 'CASE-01',
        applicantName: 'Md. Tareq',
        nextHearingAt: new Date().toISOString(),
        nextAction: 'Submit affidavit',
        lawyerName: 'Adv. Parveen',
        court: 'District Judge Court',
      },
    ]

    const html = renderToStaticMarkup(
      <MemoryRouter>
        <HearingListView hearingList={hearings} />
      </MemoryRouter>
    )
    expect(html).toContain('All Hearings')
    expect(html).toContain('CASE-01')
    expect(html).toContain('Md. Tareq')
    expect(html).toContain('Adv. Parveen')
    expect(html).toContain('District Judge Court')
    expect(html).toContain('Submit affidavit')
  })

  test('MediationCaseListView renders active mediation list and stages', () => {
    const mediations = [
      {
        applicationId: 'APP-02',
        caseId: 'CASE-02',
        applicantName: 'Salma Khatun',
        stage: 'MEDIATION',
        scheduledAt: new Date().toISOString(),
        venue: 'DLAO Conference Room',
        sessionsCount: 2,
      },
    ]

    const html = renderToStaticMarkup(
      <MemoryRouter>
        <MediationCaseListView mediationList={mediations} />
      </MemoryRouter>
    )
    expect(html).toContain('All Mediation Cases')
    expect(html).toContain('CASE-02')
    expect(html).toContain('Salma Khatun')
    expect(html).toContain('DLAO Conference Room')
    expect(html).toContain('2 session(s) held')
  })

  test('LawyerFeedbackView renders lawyer reports and updates', () => {
    const feedback = [
      {
        updateId: 'up-1',
        caseId: 'CASE-03',
        sequence: 1,
        applicantName: 'Kamal Hossain',
        lawyerName: 'Adv. Hasan',
        status: 'MISSED',
        dueAt: new Date().toISOString(),
        report: 'Case submitted in court, awaiting next order.',
        nextAction: 'Submit certified copies',
      },
    ]

    const html = renderToStaticMarkup(
      <MemoryRouter>
        <LawyerFeedbackView lawyerFeedback={feedback} token="test-token" onReminderSent={() => {}} />
      </MemoryRouter>
    )
    expect(html).toContain('CASE-03')
    expect(html).toContain('Adv. Hasan')
    expect(html).toContain('Kamal Hossain')
    expect(html).toContain('Case submitted in court, awaiting next order.')
    expect(html).toContain('Submit certified copies')
    expect(html).toContain('Send Reminder')

    const readOnly = renderToStaticMarkup(
      <MemoryRouter>
        <LawyerFeedbackView lawyerFeedback={feedback} token="test-token" readOnly />
      </MemoryRouter>
    )
    expect(readOnly).toContain('Adv. Hasan')
    expect(readOnly).not.toContain('Send Reminder')
  })

  test('ClaoCertificationView lists settlements waiting for the CLAO signature and certified ones', () => {
    const certifications = [
      { applicationId: 'APP-2026-000010', caseId: 'CASE-2026-000010', stage: 'PENDING_CLAO_CERTIFICATION', applicantName: 'Rahima Begum', legalApplicability: 'APPLICABLE_VERIFIED' },
      { applicationId: 'APP-2026-000011', caseId: 'CASE-2026-000011', stage: 'PENDING_CLAO_CERTIFICATION', applicantName: 'Salma Khatun', legalApplicability: 'UNVERIFIED' },
      { applicationId: 'APP-2026-000012', caseId: 'CASE-2026-000012', stage: 'CERTIFIED_FINAL', applicantName: 'Nasima Akter', certifiedAt: new Date().toISOString() },
    ]
    const html = renderToStaticMarkup(<MemoryRouter><ClaoCertificationView certifications={certifications} /></MemoryRouter>)
    expect(html).toContain('Waiting for your signature')
    expect(html).toContain('href="/applications/APP-2026-000010"')
    expect(html).toContain('ready to sign')
    expect(html).toContain('Legal applicability not yet recorded')
    expect(html.indexOf('CASE-2026-000012')).toBeGreaterThan(html.indexOf('>Certified<'))

    const empty = renderToStaticMarkup(<MemoryRouter><ClaoCertificationView certifications={[]} /></MemoryRouter>)
    expect(empty).toContain('No settlements are waiting for CLAO certification.')
  })
})
