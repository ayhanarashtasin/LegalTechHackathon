import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { api } from '../services/api.js'
import { AddForm, Bi, Panel, bi, num } from '../components/Bi.jsx'

export default function RelatedIncidentPanel({ applicationId, token, canManage }) {
  const [groups, setGroups] = useState(null)
  const [refresh, setRefresh] = useState(0)
  const [title, setTitle] = useState('')
  const [otherIds, setOtherIds] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    api(`/api/applications/${applicationId}/incidents`, { token, signal: controller.signal })
      .then(setGroups).catch((failure) => { if (failure.name !== 'AbortError') setError(failure.message) })
    return () => controller.abort()
  }, [applicationId, token, refresh])

  async function create(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    const applicationIds = [...new Set([applicationId, ...otherIds.split(/[\s,;]+/).map((id) => id.trim().toUpperCase()).filter(Boolean)])]
    try {
      await api(`/api/applications/${applicationId}/incidents`, { token, method: 'POST', body: { applicationIds, title, reason } })
      setNotice(bi('Cases linked. No records were merged.', 'মামলাগুলো যুক্ত হয়েছে। কোনো রেকর্ড একীভূত হয়নি।'))
      setTitle('')
      setOtherIds('')
      setReason('')
      setRefresh((value) => value + 1)
    } catch (failure) { setError(failure.message) } finally { setBusy(false) }
  }

  return <Panel id="incident-link-title" en="Related cases" bn="সম্পর্কিত মামলা" hint={groups && (groups.length ? bi(`${groups.length} group(s)`, `${num(groups.length)}টি মামলার গুচ্ছ`) : bi('None', 'নেই'))}>
    <p className="muted"><Bi en="Linked, never merged. Only chosen evidence is shared." bn="মামলাগুলো সম্পর্কিত হিসেবে যুক্ত থাকবে, কিন্তু এক করা হবে না। শুধু নির্বাচিত প্রমাণ অন্য মামলায় দেখা যাবে।" /></p>
    {error && <p role="alert" className="error">{error}</p>}
    {notice && <p role="status" className="success">{notice}</p>}
    {groups?.length > 0 && <ul className="plain-list">{groups.map((group) => <li key={group.id}><div><Link to={`/incidents/${group.id}`}><strong>{group.title}</strong></Link><p className="muted"><Bi en={`${group.memberCount} cases · ${group.sharedEvidenceCount} shared evidence`} bn={`${num(group.memberCount)}টি মামলা · ${num(group.sharedEvidenceCount)}টি যৌথ প্রমাণ`} /></p></div></li>)}</ul>}
    {groups?.length === 0 && <p><Bi en="Not linked to any group." bn="সম্পর্কিত মামলার কোনো গুচ্ছে এটি নেই।" /></p>}
    {canManage && <AddForm en="Link cases" bn="মামলা যুক্ত করুন">
      <form onSubmit={create} className="form-stack inline-form">
        <label htmlFor="incident-title"><Bi en="Group label" bn="সম্পর্কিত মামলার গুচ্ছের নাম" /></label><input id="incident-title" value={title} onChange={(event) => setTitle(event.target.value)} minLength="3" maxLength="120" required />
        <label htmlFor="incident-member-ids"><Bi en="Two or more other accepted Application IDs" bn="আরও দুই বা ততোধিক গৃহীত আবেদন নম্বর" /></label><textarea id="incident-member-ids" value={otherIds} onChange={(event) => setOtherIds(event.target.value)} placeholder="APP-2026-000002, APP-2026-000003" required />
        <label htmlFor="incident-link-reason"><Bi en="Why these cases are related" bn="কেন সম্পর্কিত" /></label><textarea id="incident-link-reason" value={reason} onChange={(event) => setReason(event.target.value)} minLength="10" maxLength="1000" required />
        <button type="submit" disabled={busy}><Bi en="Link cases, do not merge" bn="যুক্ত করুন, একীভূত নয়" /></button>
      </form>
    </AddForm>}
  </Panel>
}
