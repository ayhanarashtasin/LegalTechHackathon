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
      setNotice(bi('Evidence reference added. No document copy was created.', 'যৌথ প্রমাণের সূত্র সংযুক্ত হয়েছে। মূল নথির অতিরিক্ত কোনো প্রতিলিপি তৈরি করা হয়নি।'))
      setReason('')
      setRefresh((value) => value + 1)
    } catch (failure) { setError(failure.message) } finally { setBusy(false) }
  }

  const back = <Link to="/">← <Bi en="Workspace" bn="কর্মক্ষেত্র" /></Link>
  if (!data) return <section aria-labelledby="group-title">{back}<h1 id="group-title"><Bi en="Related cases" bn="সম্পর্কিত মামলাসমূহ" /></h1>{error ? <p role="alert" className="error">{error}</p> : <p role="status">{bi('Loading…', 'লোড হচ্ছে…')}</p>}</section>

  return <section aria-labelledby="group-title">
    {back}
    <p className="eyebrow"><Bi en="Related cases · linked, not merged" bn="সম্পর্কিত মামলাসমূহ · আন্তঃসংযুক্ত, কিন্তু রেকর্ড একীভূত নয়" /></p>
    <h1 id="group-title">{data.title}</h1>
    {error && <p role="alert" className="error">{error}</p>}
    {notice && <p role="status" className="success">{notice}</p>}
    <p className="safety-note"><Bi en="Only linked standard evidence is shared. Facts, instructions, outcomes and restricted evidence stay on each case." bn="শুধুমাত্র নির্ধারিত সাধারণ প্রমাণাদি যৌথভাবে দেখা যাবে। মামলার মূল তথ্য, আইনগত নির্দেশনা, ফলাফল এবং সংরক্ষিত প্রমাণাদি নিজ নিজ মামলার রেকর্ডে সম্পূর্ণ স্বাধীন থাকবে।" /></p>
    <section className="card" aria-labelledby="members-title"><h2 id="members-title"><Bi en="Separate Case records" bn="পৃথক মামলাসমূহের বিবরণী" /></h2>
      <ul className="plain-list">{data.members.map((member) => <li key={member.applicationId}><div><strong>{member.applicantName}</strong><p className="muted">{member.caseId || bi('No Case ID', 'মামলা নম্বর নির্ধারিত হয়নি')} · {member.applicationId}</p></div><Link to={`/applications/${member.applicationId}`}><Bi en="Open case" bn="মামলার নথি দেখুন" /></Link></li>)}</ul>
    </section>
    <section className="card" aria-labelledby="shared-evidence-title"><h2 id="shared-evidence-title"><Bi en="Shared evidence" bn="যৌথ প্রমাণাদি" /></h2>
      {data.sharedEvidence.length === 0 && <p className="muted"><Bi en="Nothing shared yet." bn="যৌথভাবে দেখার মতো কোনো প্রমাণাদি এখনো যুক্ত করা হয়নি।" /></p>}
      <ul className="plain-list">{data.sharedEvidence.map((document) => <li key={document.id}><div><strong>{document.label}</strong> <Badge code={document.qualityState} /><p className="muted"><Bi en="From" bn="উৎস মামলা" /> {document.sourceCaseId || '—'} · <Bi en="version" bn="সংস্করণ" /> {num(document.currentVersion)}</p>{document.textContent && <details><summary><Bi en="Read common evidence text" bn="সংযুক্ত প্রমাণের বিবরণ দেখুন" /></summary><pre>{document.textContent}</pre></details>}</div></li>)}</ul>
      {!data.canShareEvidence && <p className="muted"><Bi en="Read-only group access. A DLAO officer controls evidence sharing." bn="শুধুমাত্র বিবরণ দেখার অনুমতি রয়েছে। যৌথ প্রমাণাদি সংযুক্তির বিষয়টি দায়িত্বপ্রাপ্ত ডিএলএও কর্মকর্তা নিয়ন্ত্রণ করেন।" /></p>}
      {data.canShareEvidence && data.availableDocuments.length > 0 && <form onSubmit={share} className="form-stack inline-form">
        <label htmlFor="shared-document"><Bi en="Readable document from a member case" bn="সংযুক্ত মামলাসমূহ থেকে পাঠযোগ্য কোনো নথি নির্বাচন করুন" /></label><select id="shared-document" value={documentId || data.availableDocuments[0].id} onChange={(event) => setDocumentId(event.target.value)}>{data.availableDocuments.map((document) => <option key={document.id} value={document.id}>{document.label} · {document.sourceCaseId}</option>)}</select>
        <label htmlFor="shared-evidence-reason"><Bi en="Reason this common evidence is relevant" bn="যৌথ প্রমাণ হিসেবে প্রাসঙ্গিকতার কারণ" /></label><textarea id="shared-evidence-reason" value={reason} onChange={(event) => setReason(event.target.value)} minLength="10" maxLength="1000" required />
        <button type="submit" disabled={busy}><Bi en="Share existing evidence reference" bn="যৌথ প্রমাণ হিসেবে সূত্র সংযুক্ত করুন" /></button>
      </form>}
    </section>
  </section>
}
