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
      setNotice(bi('Cases linked. No records were merged.', 'মামলাগুলো সফলভাবে পারস্পরিকভাবে সংযুক্ত করা হয়েছে। কোনো রেকর্ড একীভূত করা হয়নি।'))
      setTitle('')
      setOtherIds('')
      setReason('')
      setRefresh((value) => value + 1)
    } catch (failure) { setError(failure.message) } finally { setBusy(false) }
  }

  return <Panel id="incident-link-title" en="Related cases" bn="সম্পর্কিত মামলাসমূহ" hint={groups && (groups.length ? bi(`${groups.length} group(s)`, `${num(groups.length)}টি সম্পর্কিত গ্রুপ`) : bi('None', 'নেই'))}>
    <p className="muted"><Bi en="Linked, never merged. Only chosen evidence is shared." bn="মামলাগুলো পারস্পরিক সংযুক্ত থাকবে, তবে কোনো রেকর্ড একীভূত হবে না। শুধুমাত্র নির্ধারিত প্রমাণাদি যৌথভাবে দেখা যাবে।" /></p>
    {error && <p role="alert" className="error">{error}</p>}
    {notice && <p role="status" className="success">{notice}</p>}
    {groups?.length > 0 && <ul className="plain-list">{groups.map((group) => <li key={group.id}><div><Link to={`/incidents/${group.id}`}><strong>{group.title}</strong></Link><p className="muted"><Bi en={`${group.memberCount} cases · ${group.sharedEvidenceCount} shared evidence`} bn={`${num(group.memberCount)}টি মামলা · ${num(group.sharedEvidenceCount)}টি যৌথ প্রমাণক`} /></p></div></li>)}</ul>}
    {groups?.length === 0 && <p><Bi en="Not linked to any group." bn="এই আবেদনটি অন্য কোনো সম্পর্কিত মামলার গ্রুপের সাথে সংযুক্ত নয়।" /></p>}
    {canManage && <AddForm en="Link cases" bn="সম্পর্কিত মামলা সংযুক্ত করুন">
      <form onSubmit={create} className="form-stack inline-form">
        <label htmlFor="incident-title"><Bi en="Group label" bn="সম্পর্কিত মামলার গ্রুপের শিরোনাম" /></label><input id="incident-title" value={title} onChange={(event) => setTitle(event.target.value)} minLength="3" maxLength="120" required />
        <label htmlFor="incident-member-ids"><Bi en="Two or more other accepted Application IDs" bn="অন্যান্য গৃহীত আবেদন নম্বর (কমপক্ষে দুটি)" /></label><textarea id="incident-member-ids" value={otherIds} onChange={(event) => setOtherIds(event.target.value)} placeholder="APP-2026-000002, APP-2026-000003" required />
        <label htmlFor="incident-link-reason"><Bi en="Why these cases are related" bn="পারস্পরিক সম্পর্কের যৌক্তিকতা ও কারণ" /></label><textarea id="incident-link-reason" value={reason} onChange={(event) => setReason(event.target.value)} minLength="10" maxLength="1000" required />
        <button type="submit" disabled={busy}><Bi en="Link cases, do not merge" bn="মামলাসমূহ সংযুক্ত করুন (একীভূত নয়)" /></button>
      </form>
    </AddForm>}
  </Panel>
}
