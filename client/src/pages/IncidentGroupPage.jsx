import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { api } from '../services/api.js'
import { Badge, Bi, bi, num } from '../components/Bi.jsx'

export default function IncidentGroupPage({ session }) {
  const { groupId } = useParams()
  const [data, setData] = useState(null)
  const [documentId, setDocumentId] = useState('')
  const [reason, setReason] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    api(`/api/incidents/${groupId}`, { token: session.token, signal: controller.signal })
      .then((group) => { setData(group); setDocumentId(group.availableDocuments[0]?.id ?? '') })
      .catch((failure) => { if (failure.name !== 'AbortError') setError(failure.message) })
    return () => controller.abort()
  }, [groupId, session.token, refresh])

  async function share(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await api(`/api/incidents/${groupId}/evidence`, { token: session.token, method: 'POST', body: { documentId, reason } })
      setNotice(bi('Evidence reference added. No document copy was created.', 'প্রমাণের সূত্র যুক্ত হয়েছে। নথির কপি তৈরি হয়নি।'))
      setReason('')
      setRefresh((value) => value + 1)
    } catch (failure) { setError(failure.message) } finally { setBusy(false) }
  }

  const back = <Link to="/">← <Bi en="Workspace" bn="কর্মক্ষেত্র" /></Link>
  if (!data) return <section aria-labelledby="group-title">{back}<h1 id="group-title"><Bi en="Related cases" bn="সম্পর্কিত মামলা" /></h1>{error ? <p role="alert" className="error">{error}</p> : <p role="status">{bi('Loading…', 'লোড হচ্ছে…')}</p>}</section>

  return <section aria-labelledby="group-title">
    {back}
    <p className="eyebrow"><Bi en="Related cases · linked, not merged" bn="সম্পর্কিত মামলাগুলো আলাদা নথিতে রাখা হয়েছে" /></p>
    <h1 id="group-title">{data.title}</h1>
    {error && <p role="alert" className="error">{error}</p>}
    {notice && <p role="status" className="success">{notice}</p>}
    <p className="safety-note"><Bi en="Only linked standard evidence is shared. Facts, instructions, outcomes and restricted evidence stay on each case." bn="শুধু নির্বাচিত সাধারণ প্রমাণ অন্য মামলায় দেখা যাবে। প্রতিটি মামলার তথ্য, নির্দেশনা, ফলাফল ও সংবেদনশীল প্রমাণ আলাদাই থাকবে।" /></p>
    <section className="card" aria-labelledby="members-title"><h2 id="members-title"><Bi en="Separate Case records" bn="আলাদা মামলার রেকর্ড" /></h2>
      <ul className="plain-list">{data.members.map((member) => <li key={member.applicationId}><div><strong>{member.applicantName}</strong><p className="muted">{member.caseId || bi('No Case ID', 'মামলা নম্বর নেই')} · {member.applicationId}</p></div><Link to={`/applications/${member.applicationId}`}><Bi en="Open case" bn="মামলা খুলুন" /></Link></li>)}</ul>
    </section>
    <section className="card" aria-labelledby="shared-evidence-title"><h2 id="shared-evidence-title"><Bi en="Shared evidence" bn="যৌথ প্রমাণ" /></h2>
      {data.sharedEvidence.length === 0 && <p className="muted"><Bi en="Nothing shared yet." bn="অন্য মামলায় দেখার জন্য এখনো কোনো প্রমাণ যুক্ত হয়নি।" /></p>}
      <ul className="plain-list">{data.sharedEvidence.map((document) => <li key={document.id}><div><strong>{document.label}</strong> <Badge code={document.qualityState} /><p className="muted"><Bi en="From" bn="উৎস" /> {document.sourceCaseId || '—'} · <Bi en="version" bn="সংস্করণ" /> {num(document.currentVersion)}</p>{document.textContent && <details><summary><Bi en="Read common evidence text" bn="প্রমাণের লেখা পড়ুন" /></summary><pre>{document.textContent}</pre></details>}</div></li>)}</ul>
      {!data.canShareEvidence && <p className="muted"><Bi en="Read-only group access. A DLAO officer controls evidence sharing." bn="শুধু দেখার অধিকার। ডিএলএও কর্মকর্তা প্রমাণ ভাগ করা নিয়ন্ত্রণ করেন।" /></p>}
      {data.canShareEvidence && data.availableDocuments.length > 0 && <form onSubmit={share} className="form-stack inline-form">
        <label htmlFor="shared-document"><Bi en="Readable document from a member case" bn="যুক্ত মামলাগুলোর একটি থেকে পড়া যায় এমন নথি" /></label><select id="shared-document" value={documentId || data.availableDocuments[0].id} onChange={(event) => setDocumentId(event.target.value)}>{data.availableDocuments.map((document) => <option key={document.id} value={document.id}>{document.label} · {document.sourceCaseId}</option>)}</select>
        <label htmlFor="shared-evidence-reason"><Bi en="Reason this common evidence is relevant" bn="কেন এই প্রমাণ সবার জন্য প্রাসঙ্গিক" /></label><textarea id="shared-evidence-reason" value={reason} onChange={(event) => setReason(event.target.value)} minLength="10" maxLength="1000" required />
        <button type="submit" disabled={busy}><Bi en="Share existing evidence reference" bn="অন্য মামলায় প্রমাণটির সূত্র দেখান" /></button>
      </form>}
    </section>
  </section>
}
