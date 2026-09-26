import { useState } from 'react'
import { Link } from 'react-router'
import { bi, num, when, say, overdueText } from './Bi.jsx'
import { api } from '../services/api.js'

export function HearingListView({ hearings = [], hearingList = [] }) {
  const [filter, setFilter] = useState('')
  const [timeline, setTimeline] = useState('ALL') // ALL, UPCOMING, TODAY, PAST

  const activeHearings = hearings.length ? hearings : (hearingList || [])
  const todayStr = new Date().toISOString().slice(0, 10)

  const filtered = activeHearings.filter((h) => {
    if (!h.nextHearingAt && timeline !== 'ALL') return false
    if (h.nextHearingAt) {
      const hDateStr = new Date(h.nextHearingAt).toISOString().slice(0, 10)
      if (timeline === 'TODAY' && hDateStr !== todayStr) return false
      if (timeline === 'UPCOMING' && hDateStr < todayStr) return false
      if (timeline === 'PAST' && hDateStr > todayStr) return false
    }
    if (!filter) return true
    const term = filter.toLowerCase()
    return (
      (h.caseId && h.caseId.toLowerCase().includes(term)) ||
      (h.applicantName && h.applicantName.toLowerCase().includes(term)) ||
      (h.lawyerName && h.lawyerName.toLowerCase().includes(term)) ||
      (h.court && h.court.toLowerCase().includes(term))
    )
  })

  return (
    <div className="dlao-hearing-view" style={{ marginTop: '1rem' }}>
      <div className="queue-controls" style={{ marginBottom: '1.25rem' }}>
        <div className="queue-chip-row" role="group" aria-label="Filter hearings">
          <button
            type="button"
            className={`queue-chip${timeline === 'ALL' ? ' is-active' : ''}`}
            onClick={() => setTimeline('ALL')}
          >
            {bi('All Hearings', 'সকল শুনানী')} <span className="queue-chip-count">{num(activeHearings.length)}</span>
          </button>
          <button
            type="button"
            className={`queue-chip${timeline === 'TODAY' ? ' is-active' : ''}`}
            onClick={() => setTimeline('TODAY')}
          >
            {bi('Today (আজকের শুনানী)', 'আজকের শুনানী')} <span className="queue-chip-count">{num(activeHearings.filter(h => h.nextHearingAt && new Date(h.nextHearingAt).toISOString().slice(0, 10) === todayStr).length)}</span>
          </button>
          <button
            type="button"
            className={`queue-chip${timeline === 'UPCOMING' ? ' is-active' : ''}`}
            onClick={() => setTimeline('UPCOMING')}
          >
            {bi('Upcoming Hearings', 'আসন্ন শুনানী')} <span className="queue-chip-count">{num(activeHearings.filter(h => h.nextHearingAt && new Date(h.nextHearingAt).toISOString().slice(0, 10) >= todayStr).length)}</span>
          </button>
          <button
            type="button"
            className={`queue-chip${timeline === 'PAST' ? ' is-active' : ''}`}
            onClick={() => setTimeline('PAST')}
          >
            {bi('Past Hearings', 'পূর্ববর্তী শুনানী')} <span className="queue-chip-count">{num(activeHearings.filter(h => h.nextHearingAt && new Date(h.nextHearingAt).toISOString().slice(0, 10) < todayStr).length)}</span>
          </button>
        </div>

        <div className="queue-search">
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={bi('Search hearing list (case, party, lawyer, court)', 'শুনানী খুঁজুন (মামলা নম্বর, পক্ষ, আইনজীবী, আদালত)')}
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">
          <p>{bi('No hearing records match the current filter.', 'নির্বাচিত শর্তে কোনো শুনানীর রেকর্ড পাওয়া যায়নি।')}</p>
        </div>
      ) : (
        <ul className="record-list">
          {filtered.map((h) => {
            const isToday = h.nextHearingAt && new Date(h.nextHearingAt).toISOString().slice(0, 10) === todayStr
            return (
              <li key={h.caseId || h.applicationId}>
                <Link to={`/cases/${h.caseId}`} className={isToday ? 'urgent-record' : ''}>
                  <strong>{h.caseId} · {h.court || bi('Court not specified', 'আদালত নির্ধারিত নেই')}</strong>
                  <span>
                    {h.applicantName ? <>{h.applicantName} · </> : ''}
                    {bi('Assigned Lawyer:', 'নিয়োজিত আইনজীবী:')} {h.lawyerName || bi('Unassigned', 'নিয়োগ সম্পন্ন হয়নি')}
                  </span>
                  {h.nextHearingAt && (
                    <small>
                      <strong>{bi('Hearing Date:', 'শুনানীর তারিখ:')}</strong> <time dateTime={h.nextHearingAt}>{when(h.nextHearingAt)}</time>
                      {isToday && <span style={{ marginLeft: '0.5rem', color: '#d9363e', fontWeight: 600 }}>{bi('(TODAY)', '(আজ)')}</span>}
                    </small>
                  )}
                  {h.nextAction && <small>{bi('Next action:', 'পরবর্তী করণীয়:')} {h.nextAction}</small>}
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export function MediationCaseListView({ mediations = [], mediationList = [] }) {
  const [filter, setFilter] = useState('')
  const [stageFilter, setStageFilter] = useState('ALL')

  const activeMediations = mediations.length ? mediations : (mediationList || [])

  const filtered = activeMediations.filter((m) => {
    if (stageFilter !== 'ALL' && m.stage !== stageFilter) return false
    if (!filter) return true
    const term = filter.toLowerCase()
    return (
      (m.caseId && m.caseId.toLowerCase().includes(term)) ||
      (m.applicationId && m.applicationId.toLowerCase().includes(term)) ||
      (m.applicantName && m.applicantName.toLowerCase().includes(term)) ||
      (m.mediatorName && m.mediatorName.toLowerCase().includes(term)) ||
      (m.venue && m.venue.toLowerCase().includes(term))
    )
  })

  return (
    <div className="dlao-mediation-view" style={{ marginTop: '1rem' }}>
      <div className="queue-controls" style={{ marginBottom: '1.25rem' }}>
        <div className="queue-chip-row" role="group" aria-label="Filter mediations">
          <button
            type="button"
            className={`queue-chip${stageFilter === 'ALL' ? ' is-active' : ''}`}
            onClick={() => setStageFilter('ALL')}
          >
            {bi('All Mediation Cases', 'সকল মধ্যস্থতা মামলা')} <span className="queue-chip-count">{num(activeMediations.length)}</span>
          </button>
          <button
            type="button"
            className={`queue-chip${stageFilter === 'SCHEDULING_NOTICES' ? ' is-active' : ''}`}
            onClick={() => setStageFilter('SCHEDULING_NOTICES')}
          >
            {bi('Notice / Summoning', 'নোটিশ ও ডাক প্রেরণ')} <span className="queue-chip-count">{num(activeMediations.filter(m => m.stage === 'SCHEDULING_NOTICES').length)}</span>
          </button>
          <button
            type="button"
            className={`queue-chip${stageFilter === 'MEDIATION' ? ' is-active' : ''}`}
            onClick={() => setStageFilter('MEDIATION')}
          >
            {bi('Active Sessions', 'চলমান বৈঠকসমূহ')} <span className="queue-chip-count">{num(activeMediations.filter(m => m.stage === 'MEDIATION').length)}</span>
          </button>
          <button
            type="button"
            className={`queue-chip${stageFilter === 'DRAFT_OUTCOME' ? ' is-active' : ''}`}
            onClick={() => setStageFilter('DRAFT_OUTCOME')}
          >
            {bi('Settlement Draft', 'আপস মীমাংসার খসড়া')} <span className="queue-chip-count">{num(activeMediations.filter(m => m.stage === 'DRAFT_OUTCOME').length)}</span>
          </button>
        </div>

        <div className="queue-search">
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={bi('Search mediation cases (ID, party, mediator, venue)', 'মধ্যস্থতা মামলা খুঁজুন (নম্বর, পক্ষ, মধ্যস্থতাকারী, স্থান)')}
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">
          <p>{bi('No mediation cases match the current filter.', 'নির্বাচিত শর্তে কোনো মধ্যস্থতা মামলা পাওয়া যায়নি।')}</p>
        </div>
      ) : (
        <ul className="record-list">
          {filtered.map((m) => {
            const hasSessions = (m.sessionsCount || 0) > 0
            return (
              <li key={m.mediationId || m.applicationId}>
                <Link to={`/cases/${m.caseId || m.applicationId}`}>
                  <strong>{m.caseId || m.applicationId} · {say(m.stage)}</strong>
                  <span>
                    {m.applicantName ? <>{m.applicantName} · </> : ''}
                    {bi('Mediator:', 'মধ্যস্থতাকারী:')} {m.mediatorName || bi('Office Mediator', 'কার্যালয়ের মধ্যস্থতাকারী')} ·
                    <span style={{ fontWeight: 600, color: hasSessions ? '#237804' : '#666', marginLeft: '0.35rem' }}>
                      {bi(`${num(m.sessionsCount || 0)} session(s) held`, `${num(m.sessionsCount || 0)}টি বৈঠক অনুষ্ঠিত`)}
                    </span>
                  </span>
                  {m.scheduledAt && (
                    <small>
                      <strong>{bi('Next scheduled session:', 'পরবর্তী বৈঠকের তারিখ:')}</strong> <time dateTime={m.scheduledAt}>{when(m.scheduledAt)}</time>
                      {m.venue && <> · {bi('Venue:', 'স্থান:')} {m.venue}</>}
                    </small>
                  )}
                  {m.outcome && (
                    <small style={{ color: m.outcome === 'AGREEMENT_REACHED' ? '#237804' : '#ad6800' }}>
                      {bi('Outcome:', 'ফলাফল:')} {say(m.outcome)}
                    </small>
                  )}
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export function LawyerFeedbackView({ feedback = [], lawyerFeedback = [], token, onReminderSent, readOnly = false }) {
  const [filter, setFilter] = useState('')
  const [sendingReminder, setSendingReminder] = useState(null)
  const [actionNotice, setActionNotice] = useState('')

  const activeFeedback = feedback.length ? feedback : (lawyerFeedback || [])

  const filtered = activeFeedback.filter((item) => {
    if (!filter) return true
    const term = filter.toLowerCase()
    return (
      (item.caseId && item.caseId.toLowerCase().includes(term)) ||
      (item.lawyerName && item.lawyerName.toLowerCase().includes(term)) ||
      (item.applicantName && item.applicantName.toLowerCase().includes(term)) ||
      (item.report && item.report.toLowerCase().includes(term)) ||
      (item.nextAction && item.nextAction.toLowerCase().includes(term))
    )
  })

  async function handleSendReminder(item) {
    if (!token) return
    setSendingReminder(item.updateId)
    setActionNotice('')
    try {
      await api(`/api/lawyers/updates/${item.updateId}/remind`, {
        token,
        method: 'POST',
        body: { reason: 'DLAO officer routine deadline follow-up.' },
      })
      setActionNotice(bi(`Reminder recorded for ${item.lawyerName || 'lawyer'}.`, `${item.lawyerName || 'আইনজীবী'}-কে তাগিদ নথিভুক্ত করা হয়েছে।`))
      if (onReminderSent) onReminderSent()
    } catch (err) {
      setActionNotice(err.message)
    } finally {
      setSendingReminder(null)
    }
  }

  return (
    <div className="dlao-lawyer-feedback-view" style={{ marginTop: '1rem' }}>
      <div className="queue-controls" style={{ marginBottom: '1.25rem' }}>
        <div className="queue-search" style={{ width: '100%' }}>
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={bi('Search feedback (case, lawyer, report content, next action)', 'ফিডব্যাক ও প্রতিবেদন খুঁজুন (মামলা, আইনজীবী, প্রতিবেদন, পরবর্তী করণীয়)')}
          />
        </div>
      </div>

      {actionNotice && <p role="status" className="success" style={{ marginBottom: '1rem' }}>{actionNotice}</p>}

      {filtered.length === 0 ? (
        <div className="empty-state">
          <p>{bi('No lawyer updates or reports recorded.', 'কোনো আইনজীবীর প্রতিবেদন বা আপডেট নথিভুক্ত পাওয়া যায়নি।')}</p>
        </div>
      ) : (
        <ul className="record-list">
          {filtered.map((item) => {
            const isMissed = item.status === 'MISSED'
            const isSubmitted = item.status === 'SUBMITTED'

            return (
              <li key={item.updateId || `${item.caseId}-${item.sequence}`}>
                <div className="card" style={{ padding: '1rem 1.25rem', width: '100%', margin: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <strong>
                        <Link to={`/cases/${item.caseId}`} style={{ color: '#111', textDecoration: 'none' }}>
                          {item.caseId}
                        </Link>
                        {' · '}
                        <span style={{ color: isSubmitted ? '#237804' : isMissed ? '#cf1322' : '#d48806' }}>
                          {say(item.status)}
                        </span>
                        {' · '}
                        {bi(`Update #${num(item.sequence)}`, `আপডেট #${num(item.sequence)}`)}
                      </strong>

                      <p style={{ margin: '0.25rem 0', fontSize: '0.88rem', color: '#444' }}>
                        {item.applicantName ? <>{item.applicantName} · </> : ''}
                        <strong>{bi('Lawyer:', 'আইনজীবী:')}</strong> {item.lawyerName || bi('Panel Lawyer', 'প্যানেল আইনজীবী')}
                      </p>
                    </div>

                    <div>
                      {isMissed && !readOnly && (
                        <button
                          type="button"
                          className="secondary-button"
                          style={{ fontSize: '0.8rem', padding: '0.3rem 0.65rem' }}
                          disabled={sendingReminder === item.updateId}
                          onClick={() => handleSendReminder(item)}
                        >
                          {bi('Send Reminder', 'তাগিদ দিন')}
                        </button>
                      )}
                    </div>
                  </div>

                  {item.report ? (
                    <div style={{ margin: '0.65rem 0', padding: '0.65rem', backgroundColor: '#F8F9FA', borderRadius: '4px', borderLeft: '3px solid #2f54eb' }}>
                      <strong style={{ fontSize: '0.82rem', color: '#333' }}>
                        {bi('Lawyer Report / Summary of Steps Taken:', 'আইনজীবীর প্রতিবেদন ও গৃহীত পদক্ষেপের বিবরণ:')}
                      </strong>
                      <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.88rem', color: '#222', whiteSpace: 'pre-wrap' }}>
                        {item.report}
                      </p>
                    </div>
                  ) : (
                    <p style={{ margin: '0.4rem 0', fontSize: '0.85rem', color: '#777', fontStyle: 'italic' }}>
                      {bi('Pending submission from lawyer.', 'আইনজীবীর নিকট হতে প্রতিবেদন অপেক্ষমাণ।')}
                    </p>
                  )}

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.85rem', fontSize: '0.8rem', color: '#666', marginTop: '0.45rem' }}>
                    {item.dueAt && (
                      <span>
                        <strong>{bi('Due:', 'শেষ সময়:')}</strong> <time dateTime={item.dueAt}>{when(item.dueAt)}</time>
                        {isMissed && <span style={{ color: '#cf1322', marginLeft: '0.25rem' }}>({overdueText(item.dueAt)})</span>}
                      </span>
                    )}
                    {item.submittedAt && (
                      <span>
                        <strong>{bi('Submitted:', 'দাখিলের তারিখ:')}</strong> <time dateTime={item.submittedAt}>{when(item.submittedAt)}</time>
                      </span>
                    )}
                    {item.remindersCount > 0 && (
                      <span style={{ color: '#ad6800', fontWeight: 600 }}>
                        {bi(`Reminded ${num(item.remindersCount)}×`, `${num(item.remindersCount)} বার তাগিদ দেওয়া হয়েছে`)}
                      </span>
                    )}
                    {item.nextAction && (
                      <span>
                        <strong>{bi('Next Action:', 'পরবর্তী পদক্ষেপ:')}</strong> {item.nextAction}
                      </span>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

// CLAO certification list: settlements signed by both parties and the mediator wait here for the CLAO's
// signature; certified ones stay listed for reference. Opening one leads to the review-and-sign steps.
export function ClaoCertificationView({ certifications = [] }) {
  const pending = certifications.filter(({ stage }) => stage === 'PENDING_CLAO_CERTIFICATION')
  const certified = certifications.filter(({ stage }) => stage === 'CERTIFIED_FINAL')
  const item = (m) => (
    <li key={m.applicationId}>
      <Link to={`/applications/${m.applicationId}`}>
        <strong>{m.caseId || m.applicationId} · {say(m.stage)}</strong>
        <span>
          {m.applicantName ? <>{m.applicantName} · </> : ''}
          {m.respondent?.name ? <>{bi('Respondent:', 'প্রতিপক্ষ:')} {m.respondent.name} · </> : ''}
          {m.stage === 'CERTIFIED_FINAL'
            ? <>{bi('Certified', 'সনদ দেওয়া হয়েছে')}{m.certifiedAt ? <> <time dateTime={m.certifiedAt}>{when(m.certifiedAt)}</time></> : ''}</>
            : m.legalApplicability === 'APPLICABLE_VERIFIED'
              ? bi('Legal applicability recorded · ready to sign', 'আইনি প্রযোজ্যতা নথিভুক্ত · স্বাক্ষরের জন্য প্রস্তুত')
              : bi('Legal applicability not yet recorded', 'আইনি প্রযোজ্যতা এখনো নথিভুক্ত হয়নি')}
        </span>
        {m.stage !== 'CERTIFIED_FINAL' && <small>{bi('Signed by both parties and the mediator. Open to review and sign.', 'উভয় পক্ষ ও মধ্যস্থতাকারী স্বাক্ষর করেছেন। পর্যালোচনা ও স্বাক্ষরের জন্য খুলুন।')}</small>}
      </Link>
    </li>
  )

  return (
    <div className="clao-certification-view" style={{ marginTop: '1rem' }}>
      <h3>{bi('Waiting for your signature', 'আপনার স্বাক্ষরের অপেক্ষায়')}</h3>
      {pending.length ? <ul className="record-list">{pending.map(item)}</ul> : <p className="empty-state">{bi('No settlements are waiting for CLAO certification.', 'সিএলএও সনদের অপেক্ষায় কোনো মীমাংসা নেই।')}</p>}
      {certified.length > 0 && <>
        <h3>{bi('Certified', 'সনদপ্রাপ্ত')}</h3>
        <ul className="record-list">{certified.map(item)}</ul>
      </>}
    </div>
  )
}
