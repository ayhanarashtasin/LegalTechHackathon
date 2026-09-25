import { useEffect, useState } from 'react'
import { api } from '../services/api.js'
import { Badge, Bi, Panel, Term, bi, num, say, tr } from '../components/Bi.jsx'

const categories = ['LABOUR', 'FAMILY', 'LAND', 'CRIMINAL', 'OTHER', 'UNCERTAIN']
const dispositions = ['PRIORITIZE_FOR_HUMAN_REVIEW', 'CONTINUE_ROUTINE_REVIEW', 'SEEK_MORE_INFORMATION', 'REQUEST_JURISDICTION_REVIEW', 'NO_CHANGE']

export default function TriagePanel({ applicationId, token }) {
  const [assessments, setAssessments] = useState(null)
  const [category, setCategory] = useState('UNCERTAIN')
  const [disposition, setDisposition] = useState('PRIORITIZE_FOR_HUMAN_REVIEW')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const latest = assessments?.[0]

  useEffect(() => {
    const controller = new AbortController()
    api(`/api/applications/${applicationId}/triage`, { token, signal: controller.signal })
      .then((items) => {
        setAssessments(items)
        const recommendation = items[0]?.components.find(({ name }) => name === 'CASE_CATEGORIZER')?.recommendation
        if (categories.includes(recommendation)) setCategory(recommendation)
      }).catch((failure) => { if (failure.name !== 'AbortError') setError(failure.message) })
    return () => controller.abort()
  }, [applicationId, token])

  async function run() {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const assessment = await api(`/api/applications/${applicationId}/triage`, { token, method: 'POST', body: {} })
      setAssessments((current) => [assessment, ...(current ?? []).filter(({ id }) => id !== assessment.id)])
      const recommendation = assessment.components.find(({ name }) => name === 'CASE_CATEGORIZER')?.recommendation
      if (categories.includes(recommendation)) setCategory(recommendation)
      setNotice(bi('Suggestions ready. Nothing was changed.', 'পরামর্শ তৈরি। কিছু বদলানো হয়নি।'))
    } catch (failure) { setError(failure.message) } finally { setBusy(false) }
  }

  async function decide(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const decided = await api(`/api/applications/${applicationId}/triage/${latest.id}/decision`, {
        token, method: 'POST', body: { category, disposition, reason },
      })
      setAssessments((current) => current.map((item) => item.id === decided.id ? decided : item))
      setReason('')
      setNotice(bi('Triage decision saved. Priority and route are unchanged.', 'পর্যালোচনার সিদ্ধান্ত সংরক্ষিত হয়েছে। অগ্রাধিকার ও কোন অফিসে যাবে, সেই সিদ্ধান্ত বদলায়নি।'))
    } catch (failure) { setError(failure.message) } finally { setBusy(false) }
  }

  return <Panel id="triage-title" en="AI triage" bn="এআইয়ের প্রাথমিক পর্যালোচনা" hint={latest ? say(latest.status) : assessments && bi('Not run', 'চালানো হয়নি')}>
    <p className="muted"><Bi en="AI suggests, you decide. No names, contact details or statements are sent." bn="এআই পরামর্শ দেয়, সিদ্ধান্ত আপনার। নাম, নম্বর বা বক্তব্য পাঠানো হয় না।" /></p>
    {error && <p role="alert" className="error">{error}</p>}
    {notice && <p role="status" className="success">{notice}</p>}
    <button type="button" onClick={run} disabled={busy}>{latest?.status === 'PENDING_HUMAN_REVIEW' ? <Bi en="Run again" bn="আবার চালান" /> : <Bi en="Run triage" bn="প্রাথমিক পর্যালোচনা করুন" />}</button>
    {assessments === null && !error && <p role="status">{bi('Loading…', 'লোড হচ্ছে…')}</p>}
    {latest && <>
      <p className="muted">{latest.aiAssisted ? `${bi('AI', 'এআই')} (${latest.model})` : bi('Rules only', 'শুধু নিয়ম')} · <Term code={latest.status} /></p>
      {latest.disagreements.map((conflict, index) => <p role="alert" className="error" key={`${conflict.dimension}-${index}`}><Bi en="Components disagree:" bn="মতভেদ:" /> {tr(conflict.summary)}</p>)}
      <div className="triage-grid">{latest.components.map((component) => <article className="mini-card" key={component.name}>
        <h3><Term code={component.name} /></h3>
        <p><Badge code={component.recommendation} /> <small><Bi en="Urgency" bn="জরুরিতা" />: <Term code={component.urgencySignal} /></small></p>
        <ul>{component.reasons.map((item, index) => <li key={`${component.name}-reason-${index}`}>{tr(item)}</li>)}</ul>
        <small className="muted"><Bi en="Uncertainty" bn="যা নিশ্চিত নয়" />: {tr(component.uncertainty)}{component.evidenceRefs.length ? <> · <Bi en="Sources" bn="উৎস" />: {component.evidenceRefs.map((ref) => <code key={ref}>{ref} </code>)}</> : null}</small>
      </article>)}</div>
      {latest.routingReview && <section className="mini-card" aria-label={bi('Routing and jurisdiction review', 'অফিস নির্বাচন ও এখতিয়ার পর্যালোচনা')}>
        <h3><Bi en="Routing and jurisdiction review" bn="অফিস নির্বাচন ও এখতিয়ার পর্যালোচনা" /></h3>
        <p><Badge code={latest.routingReview.status} /></p>
        <p>{tr(latest.routingReview.reason)}</p>
        <p className="muted"><Bi en="Officer review required. Triage does not decide jurisdiction or change the route." bn="কর্মকর্তার পর্যালোচনা দরকার। প্রাথমিক পর্যালোচনা এখতিয়ার নির্ধারণ বা অফিস পরিবর্তন করে না।" /></p>
        <small className="muted"><Bi en="Sources" bn="উৎস" />: {latest.routingReview.evidenceRefs.map((ref) => <code key={ref}>{ref} </code>)}</small>
      </section>}
      {latest.status === 'PENDING_HUMAN_REVIEW' ? <form className="form-stack inline-form" onSubmit={decide}>
        <h3><Bi en="Your decision" bn="আপনার সিদ্ধান্ত" /></h3>
        <label htmlFor="triage-final-category"><Bi en="Case type" bn="মামলার ধরন" /></label>
        <select id="triage-final-category" value={category} onChange={(event) => setCategory(event.target.value)}>{categories.map((item) => <option key={item} value={item}>{say(item)}</option>)}</select>
        <label htmlFor="triage-disposition"><Bi en="Action" bn="পদক্ষেপ" /></label>
        <select id="triage-disposition" value={disposition} onChange={(event) => setDisposition(event.target.value)}>{dispositions.map((value) => <option key={value} value={value}>{say(value)}</option>)}</select>
        <label htmlFor="triage-decision-reason"><Bi en="Reason" bn="কারণ" /></label>
        <textarea id="triage-decision-reason" value={reason} onChange={(event) => setReason(event.target.value)} minLength="10" maxLength="1000" required />
        <button type="submit" disabled={busy || reason.trim().length < 10}><Bi en="Save triage decision" bn="সিদ্ধান্ত সংরক্ষণ" /></button>
      </form> : latest.humanDecision && <p role="status"><Bi en="Officer decision:" bn="কর্মকর্তার সিদ্ধান্ত:" /> <Term code={latest.humanDecision.category} /> · <Term code={latest.humanDecision.disposition} />. {latest.humanDecision.reason}</p>}
      {assessments.length > 1 && <p className="muted"><Bi en={`${assessments.length - 1} earlier run(s) kept in history.`} bn={`আগের ${num(assessments.length - 1)}টি ফলাফল ইতিহাসে আছে।`} /></p>}
    </>}
  </Panel>
}
