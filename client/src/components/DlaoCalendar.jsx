import { useState } from 'react'
import { Link } from 'react-router'
import { bi, num, when } from './Bi.jsx'

export function DlaoCalendar({ events = [] }) {
  const [filterType, setFilterType] = useState('ALL')
  const [searchTerm, setSearchTerm] = useState('')

  const filteredEvents = events.filter((e) => {
    if (filterType !== 'ALL' && e.type !== filterType) return false
    if (!searchTerm) return true
    const term = searchTerm.toLowerCase()
    return (
      (e.title && e.title.toLowerCase().includes(term)) ||
      (e.caseId && e.caseId.toLowerCase().includes(term)) ||
      (e.applicantName && e.applicantName.toLowerCase().includes(term)) ||
      (e.lawyerName && e.lawyerName.toLowerCase().includes(term)) ||
      (e.venue && e.venue.toLowerCase().includes(term))
    )
  })

  // Group events by date key (YYYY-MM-DD)
  const grouped = filteredEvents.reduce((acc, event) => {
    const rawDate = event.date || event.scheduledAt || event.dueAt
    const d = new Date(rawDate)
    const key = isNaN(d) ? 'Undated' : d.toISOString().slice(0, 10)
    if (!acc[key]) acc[key] = []
    acc[key].push(event)
    return acc
  }, {})

  const sortedDates = Object.keys(grouped).sort()
  const todayStr = new Date().toISOString().slice(0, 10)

  const typeBadges = {
    HEARING: { bg: '#E1F3FE', color: '#1F6C9F', en: 'Court Hearing', bn: 'আদালতের শুনানী' },
    MEDIATION: { bg: '#EDF3EC', color: '#346538', en: 'Mediation Session', bn: 'মধ্যস্থতা বৈঠক' },
    LAWYER_DEADLINE: { bg: '#FBF3DB', color: '#956400', en: 'Lawyer Update Due', bn: 'আইনজীবীর আপডেটের শেষ সময়' },
  }

  return (
    <div className="dlao-calendar-container" style={{ marginTop: '1rem' }}>
      <div className="queue-controls" style={{ marginBottom: '1.25rem' }}>
        <div className="queue-chip-row" role="group" aria-label="Filter events by category">
          <button
            type="button"
            className={`queue-chip${filterType === 'ALL' ? ' is-active' : ''}`}
            onClick={() => setFilterType('ALL')}
          >
            {bi('All Events', 'সকল কার্যক্রম')} <span className="queue-chip-count">{num(events.length)}</span>
          </button>
          <button
            type="button"
            className={`queue-chip${filterType === 'HEARING' ? ' is-active' : ''}`}
            onClick={() => setFilterType('HEARING')}
          >
            {bi('Hearings (শুনানী)', 'শুনানী')} <span className="queue-chip-count">{num(events.filter(e => e.type === 'HEARING').length)}</span>
          </button>
          <button
            type="button"
            className={`queue-chip${filterType === 'MEDIATION' ? ' is-active' : ''}`}
            onClick={() => setFilterType('MEDIATION')}
          >
            {bi('Mediations (মধ্যস্থতা)', 'মধ্যস্থতা')} <span className="queue-chip-count">{num(events.filter(e => e.type === 'MEDIATION').length)}</span>
          </button>
          <button
            type="button"
            className={`queue-chip${filterType === 'LAWYER_DEADLINE' ? ' is-active' : ''}`}
            onClick={() => setFilterType('LAWYER_DEADLINE')}
          >
            {bi('Lawyer Deadlines', 'আইনজীবীর ডেডলাইন')} <span className="queue-chip-count">{num(events.filter(e => e.type === 'LAWYER_DEADLINE').length)}</span>
          </button>
        </div>

        <div className="queue-search">
          <input
            type="search"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={bi('Search calendar (case, party, lawyer, court)', 'ক্যালেন্ডারে খুঁজুন (মামলা, পক্ষ, আইনজীবী, আদালত)')}
          />
        </div>
      </div>

      {sortedDates.length === 0 ? (
        <div className="empty-state">
          <p>{bi('No scheduled hearings, mediations, or deadlines match the filter.', 'কোনো নির্ধারিত শুনানী, মধ্যস্থতা বৈঠক বা ডেডলাইন পাওয়া যায়নি।')}</p>
        </div>
      ) : (
        <div className="calendar-agenda-grid" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {sortedDates.map((dateKey) => {
            const isToday = dateKey === todayStr
            const dateObj = new Date(dateKey)
            const dateLabel = isNaN(dateObj) ? bi('Undated', 'তারিখবিহীন') : when(dateObj)

            return (
              <div
                key={dateKey}
                className="calendar-date-group"
                style={{
                  border: isToday ? '2px solid #2f54eb' : '1px solid #EAEAEA',
                  borderRadius: '8px',
                  backgroundColor: '#FFFFFF',
                  padding: '1.25rem',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    borderBottom: '1px solid #F0F0F0',
                    paddingBottom: '0.65rem',
                    marginBottom: '1rem',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                    <span style={{ fontSize: '1.05rem', fontWeight: 600, color: '#111' }}>
                      {dateLabel}
                    </span>
                    {isToday && (
                      <span
                        style={{
                          backgroundColor: '#2f54eb',
                          color: '#fff',
                          fontSize: '0.75rem',
                          padding: '0.15rem 0.5rem',
                          borderRadius: '4px',
                          fontWeight: 600,
                          letterSpacing: '0.05em',
                        }}
                      >
                        {bi('TODAY', 'আজকের কার্যক্রম')}
                      </span>
                    )}
                  </div>
                  <span className="muted" style={{ fontSize: '0.85rem' }}>
                    {num(grouped[dateKey].length)} {bi('events', 'টি কার্যক্রম')}
                  </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                  {grouped[dateKey].map((ev) => {
                    const badge = typeBadges[ev.type] || { bg: '#F5F5F5', color: '#555', en: ev.type, bn: ev.type }
                    const linkTarget = ev.caseId ? `/cases/${ev.caseId}` : ev.applicationId ? `/applications/${ev.applicationId}` : '#'

                    return (
                      <div
                        key={ev.id || `${ev.type}-${ev.date}-${Math.random()}`}
                        style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          justifyContent: 'space-between',
                          padding: '0.75rem',
                          border: '1px solid #F2F2F2',
                          borderRadius: '6px',
                          backgroundColor: '#FAFAFA',
                        }}
                      >
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                            <span
                              style={{
                                backgroundColor: badge.bg,
                                color: badge.color,
                                padding: '0.2rem 0.6rem',
                                borderRadius: '9999px',
                                fontSize: '0.75rem',
                                fontWeight: 600,
                                textTransform: 'uppercase',
                                letterSpacing: '0.03em',
                              }}
                            >
                              {bi(badge.en, badge.bn)}
                            </span>
                            <span style={{ fontWeight: 600, fontSize: '0.95rem', color: '#111' }}>
                              {ev.title}
                            </span>
                          </div>

                          <div style={{ fontSize: '0.85rem', color: '#444' }}>
                            {ev.caseId && <span><strong>{ev.caseId}</strong> · </span>}
                            {ev.applicantName && <span>{ev.applicantName} · </span>}
                            {ev.venue && <span>{bi('Venue/Court:', 'স্থান/আদালত:')} {ev.venue} · </span>}
                            {ev.lawyerName && <span>{bi('Lawyer:', 'আইনজীবী:')} {ev.lawyerName}</span>}
                          </div>

                          {ev.details && (
                            <p style={{ margin: 0, fontSize: '0.82rem', color: '#666' }}>
                              {ev.details}
                            </p>
                          )}
                        </div>

                        <div style={{ flexShrink: 0, marginLeft: '1rem' }}>
                          <Link
                            to={linkTarget}
                            className="secondary-button"
                            style={{
                              textDecoration: 'none',
                              padding: '0.35rem 0.75rem',
                              fontSize: '0.82rem',
                            }}
                          >
                            {bi('Open Case', 'মামলা দেখুন')}
                          </Link>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default DlaoCalendar
