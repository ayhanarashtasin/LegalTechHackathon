import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { api } from '../services/api.js'
import { Bi, Term, tr } from '../components/Bi.jsx'
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
    {record && <><p className="record-sub">{tr(record.applicantName)} · <Bi en="Application" bn="আবেদন নম্বর" /> {record.applicationId}</p><div className="card panels"><MediationPanel applicationId={applicationId} session={session} role={role} /></div></>}
  </section>
}
