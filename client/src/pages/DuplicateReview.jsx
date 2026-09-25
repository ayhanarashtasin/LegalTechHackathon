import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { api } from '../services/api.js'
import { Badge, Bi, Panel, Term, bi, num, tr } from '../components/Bi.jsx'

const shown = (value) => value || <Term code="NOT_RECORDED" />
// A matching detail is the warning sign here, so it gets the red badge.
const compare = { MATCH: ' warn-badge', SIMILAR: ' wait-badge', DIFFERENT: '' }

export default function DuplicateReview({ applicationId, token, canReview = false }) {
  const [candidates, setCandidates] = useState(null)
  const [refresh, setRefresh] = useState(0)
  const [reasons, setReasons] = useState({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    api(`/api/applications/${applicationId}/duplicates`, { token, signal: controller.signal })
      .then(setCandidates).catch((failure) => { if (failure.name !== 'AbortError') setError(failure.message) })
    return () => controller.abort()
  }, [applicationId, token, refresh])

  async function review(candidate, decision) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await api(`/api/applications/${applicationId}/duplicates/${candidate.applicationId}/review`, {
        token, method: 'POST', body: { decision, reason: reasons[candidate.applicationId] || '' },
      })
      setNotice(bi('Review saved. Both records stay separate.', 'পর্যালোচনা সংরক্ষিত। দুটি রেকর্ড আলাদাই থাকবে।'))
      setRefresh((value) => value + 1)
    } catch (failure) { setError(failure.message) } finally { setBusy(false) }
  }

  const open = candidates?.filter(({ reviewStatus }) => reviewStatus === 'OPEN').length ?? 0
  const hint = candidates && (candidates.length === 0 ? bi('None', 'নেই') : open ? canReview ? bi(`${open} to review`, `${num(open)}টি পর্যালোচনা বাকি`) : bi(`${open} suggestions for officer review`, `${num(open)}টি সম্ভাব্য মিল কর্মকর্তা পর্যালোচনা করবেন`) : bi(`${candidates.length} reviewed`, `${num(candidates.length)}টি পর্যালোচিত`))

  return <Panel id="duplicate-title" en="Possible duplicates" bn="একই ব্যক্তির হতে পারে এমন আবেদন" hint={hint}>
    <p className="muted"><Bi en="The 0–100 similarity score is an uncalibrated ranking, not confidence or proof. Records are never merged." bn="০–১০০ মিলের স্কোরটি যাচাইহীন একটি ক্রম, নিশ্চিততার পরিমাপ বা প্রমাণ নয়। আবেদনগুলো কখনো একত্র করা হয় না।" /></p>
    {!canReview && <p className="muted"><Bi en="Case support can view these suggestions. An owning-office DLAO officer must review the comparison details and record any decision." bn="কেস সহায়তা কর্মীরা এই সম্ভাব্য মিল দেখতে পারেন। তুলনার বিস্তারিত দেখা ও সিদ্ধান্ত নথিভুক্ত করবেন সংশ্লিষ্ট অফিসের ডিএলএও কর্মকর্তা।" /></p>}
    {error && <p role="alert" className="error">{error}</p>}
    {notice && <p role="status" className="success">{notice}</p>}
    {candidates === null && !error && <p role="status">{bi('Checking…', 'তথ্য মিলিয়ে দেখা হচ্ছে…')}</p>}
    {candidates?.length === 0 && <p><Bi en="No similar records in this office." bn="এই অফিসে তথ্য মেলে এমন আর কোনো আবেদন পাওয়া যায়নি।" /></p>}
    <div className="stack">{candidates?.map((candidate) => <article className="mini-card duplicate-card" key={candidate.applicationId}>
      <h3><Link to={`/applications/${candidate.applicationId}`}>{tr(candidate.applicantName)} · {candidate.applicationId}</Link></h3>
      <p className="score"><label htmlFor={`score-${candidate.applicationId}`}><Bi en="Similarity" bn="মিল" /></label> <meter id={`score-${candidate.applicationId}`} min="0" max="100" low="40" high="75" optimum="0" value={candidate.score} /> <strong>{num(`${candidate.score}/100`)}</strong> {candidate.reviewStatus !== 'OPEN' && <Badge code={candidate.reviewStatus} />}</p>
      {canReview ? <div className="table-wrap"><table>
        <caption className="visually-hidden">{bi(`${applicationId} compared with ${candidate.applicationId}`, 'দুটি আবেদনের তথ্যের তুলনা')}</caption>
        <thead><tr><th scope="col"><Bi en="Detail" bn="তথ্য" /></th><th scope="col"><Bi en="This record" bn="এই রেকর্ড" /></th><th scope="col"><Bi en="Other" bn="অন্যটি" /></th><th scope="col"><Bi en="Result" bn="ফল" /></th></tr></thead>
        <tbody>{candidate.attributes.map((attribute) => <tr key={attribute.label}>
          <th scope="row"><Term code={attribute.label} /></th><td>{tr(shown(attribute.currentValue))}</td><td>{tr(shown(attribute.candidateValue))}</td>
          <td><span className={attribute.comparison in compare ? `badge${compare[attribute.comparison]}` : 'muted'}><Term code={attribute.comparison} /></span></td>
        </tr>)}</tbody>
      </table></div> : <p className="muted"><Bi en="Field-level match details are restricted to DLAO officers." bn="কোন তথ্যগুলো মিলেছে তার বিস্তারিত শুধু ডিএলএও কর্মকর্তারা দেখতে পারবেন।" /></p>}
      {canReview && candidate.reviewStatus === 'OPEN' ? <>
        <label htmlFor={`duplicate-reason-${candidate.applicationId}`}><Bi en="Review reason" bn="পর্যালোচনার কারণ" /></label>
        <textarea id={`duplicate-reason-${candidate.applicationId}`} value={reasons[candidate.applicationId] || ''} onChange={(event) => setReasons((current) => ({ ...current, [candidate.applicationId]: event.target.value }))} minLength="10" maxLength="1000" required />
        <div className="choice-row">
          <button type="button" disabled={busy || (reasons[candidate.applicationId] || '').trim().length < 10} onClick={() => review(candidate, 'CONFIRMED_DUPLICATE')}><Bi en="Same person (keep separate)" bn="একই ব্যক্তি, আবেদন দুটি আলাদা রাখুন" /></button>
          <button type="button" className="secondary-button" disabled={busy || (reasons[candidate.applicationId] || '').trim().length < 10} onClick={() => review(candidate, 'NOT_DUPLICATE')}><Bi en="Different people" bn="ভিন্ন ব্যক্তি" /></button>
        </div>
      </> : canReview ? <p role="status"><Term code={candidate.reviewStatus} />{candidate.reviewReason ? ` · ${candidate.reviewReason}` : ''}</p> : <p role="status"><Term code={candidate.reviewStatus} /></p>}
    </article>)}</div>
  </Panel>
}
