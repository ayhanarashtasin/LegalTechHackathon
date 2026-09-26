import { useEffect, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router'
import { api } from '../services/api.js'
import { Bi, Term, bi, say, tr, when } from '../components/Bi.jsx'
import MediationPanel from './MediationPanel.jsx'

export default function MediationPage({ session }) {
  const { applicationId } = useParams()
  const role = session.user.assignments.some(({ role: item }) => item === 'MEDIATOR') ? 'MEDIATOR' : 'CLAO'
  const [record, setRecord] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    api(`/api/applications/${applicationId}`, { token: session.token, signal: controller.signal })
      .then(setRecord).catch((failure) => { if (failure.name !== 'AbortError') setError(failure.message) })
    return () => controller.abort()
  }, [applicationId, session.token])

  return <section aria-labelledby="mediation-page-title">
    <Link to="/">← <Bi en="Workspace" bn="মূল ড্যাশবোর্ড" /></Link>
    <p className="eyebrow"><Bi en="Case" bn="বিরোধ / মামলা" /> · <Term code={role} /></p>
    <h1 id="mediation-page-title">{record?.caseId || applicationId}</h1>
    {error && <p role="alert" className="error">{error}</p>}
    {record && <>
      <p className="record-sub">{tr(record.applicantName)} · <Bi en="Application" bn="আবেদন নম্বর" /> {record.applicationId}</p>
      {role === 'CLAO' && <CaseSummary record={record} />}
      <div className="card panels"><MediationPanel applicationId={applicationId} session={session} role={role} /></div>
    </>}
  </section>
}

// The CLAO sees the DLAO record read-only; decisions on the case stay with the DLAO office.
function CaseSummary({ record }) {
  return <section className="card" aria-labelledby="case-summary-title">
    <h2 id="case-summary-title"><Bi en="Case record" bn="মামলার রেকর্ড" /></h2>
    <p className="muted"><Bi en="View only. Decisions on this case are made by the DLAO office." bn="শুধু দেখার জন্য। এই মামলার সিদ্ধান্ত ডিএলএও কার্যালয় নেয়।" /></p>
    <dl className="details compact">
      <div><dt><Bi en="Status" bn="অবস্থা" /></dt><dd>{say(record.status)}</dd></div>
      <div><dt><Bi en="Review" bn="পর্যালোচনা" /></dt><dd>{say(record.reviewState)}</dd></div>
      <div><dt><Bi en="Channel" bn="মাধ্যম" /></dt><dd>{say(record.channel)}</dd></div>
      {record.priorityDecision && <div><dt><Bi en="Priority" bn="অগ্রাধিকার" /></dt><dd>{say(record.priorityDecision)}</dd></div>}
      {record.complaintSummary && <div><dt><Bi en="Problem" bn="সমস্যা" /></dt><dd>{record.complaintSummary}</dd></div>}
      {record.petitioner?.name && <div><dt><Bi en="Petitioner" bn="আবেদনকারী পক্ষ" /></dt><dd>{record.petitioner.name}</dd></div>}
      {record.respondent?.name && <div><dt><Bi en="Respondent" bn="প্রতিপক্ষ" /></dt><dd>{record.respondent.name}</dd></div>}
      {record.nextTask && <div><dt><Bi en="Next step" bn="পরবর্তী করণীয়" /></dt><dd>{tr(record.nextTask.title)}{record.nextTask.dueAt ? ` · ${bi('due', 'শেষ সময়')} ${when(record.nextTask.dueAt)}` : ''}</dd></div>}
    </dl>
  </section>
}

// Resolves /cases/:caseId to the authoritative /applications/:applicationId for officers, mediators, and staff.
export function CaseRedirect({ session }) {
  const { caseId } = useParams()
  const [target, setTarget] = useState(() => (caseId?.startsWith('APP-') ? caseId : null))
  const [error, setError] = useState('')

  useEffect(() => {
    if (caseId?.startsWith('APP-')) return
    const controller = new AbortController()
    api(`/api/cases/${encodeURIComponent(caseId)}`, { token: session.token, signal: controller.signal })
      .then((result) => setTarget(result.applicationId)).catch((failure) => { if (failure.name !== 'AbortError') setError(failure.message) })
    return () => controller.abort()
  }, [caseId, session.token])

  if (target) return <Navigate to={`/applications/${target}`} replace />
  return <section aria-labelledby="case-redirect-title">
    <Link to="/">← <Bi en="Workspace" bn="মূল ড্যাশবোর্ড" /></Link>
    <h1 id="case-redirect-title">{caseId}</h1>
    {error ? <p role="alert" className="error">{error}</p> : <p role="status">{bi('Loading…', 'লোড হচ্ছে…')}</p>}
  </section>
}
