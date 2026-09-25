import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { api } from '../services/api.js'
import { bi, num, overdueText, say, tr, when } from '../components/Bi.jsx'

const roles = {
  DLAO_OFFICER: [['DLAO officer', 'ডিএলএও কর্মকর্তা'], ['Review the shared queue and make recorded human decisions.', 'সবার কাজের তালিকা দেখুন। সিদ্ধান্তের কারণও নথিভুক্ত করুন।']],
  CASE_SUPPORT: [['Case support', 'মামলা সহায়তা'], ['Find shared records and reconstruct routine follow-up.', 'মামলার নথি খুঁজুন এবং পরবর্তী কাজের খোঁজ রাখুন।']],
  HELPLINE_AGENT: [['Helpline agent', 'হেল্পলাইন কর্মী'], ['Submit intake or give a bounded status update. This is not the live 16699 service.', 'আবেদন জমা দিন বা সীমিত অবস্থা জানান। এটি আসল ১৬৬৯৯ সেবা নয়।']],
  UDC_OPERATOR: [['UDC operator', 'ইউডিসি অপারেটর'], ['Submit a bounded assisted intake. Offline tools come later.', 'আবেদন করতে সহায়তা করুন। ইন্টারনেট না থাকলেও খসড়া রাখা যায়।']],
  PANEL_LAWYER: [['Panel lawyer', 'প্যানেল আইনজীবী'], ['Review assignment offers, required updates, hearing dates, and next steps.', 'নিয়োগ প্রস্তাব, আপডেট, শুনানির তারিখ ও পরবর্তী ধাপ দেখুন।']],
  MEDIATOR: [['Mediator', 'মধ্যস্থতাকারী'], ['Manage assigned mediation steps and review settlement drafts.', 'মধ্যস্থতার ধাপ চালান এবং মীমাংসার খসড়া দেখুন।']],
  RECEIVING_DLAO: [['Receiving DLAO', 'গ্রহণকারী ডিএলএও'], ['Acknowledge, accept, or return referral packages sent to your office.', 'আপনার অফিসে আসা রেফারেল স্বীকার, গ্রহণ বা ফেরত দিন।']],
  CLAO: [['CLAO', 'সিএলএও'], ['Review legal applicability and record certification when authorised.', 'আইনি প্রযোজ্যতা দেখুন এবং অনুমোদিত হলে সনদ দিন।']],
}
const roleName = (role) => roles[role] ? bi(...roles[role][0]) : role

// A 16699 advice request, handled on the callback: give legal information and close it, or, when formal legal aid is
// needed, record the applicant so the same record goes to DLAO review.
function AdviceCallback({ request, token, onDone }) {
  const [guidance, setGuidance] = useState('')
  const [outcome, setOutcome] = useState('INFORMATION_PROVIDED')
  const [applicantName, setApplicantName] = useState('')
  const [district, setDistrict] = useState('')
  const [nid, setNid] = useState('')
  const [error, setError] = useState('')
  const id = request.applicationId
  const formal = outcome === 'FORMAL_ASSISTANCE'

  async function submit(event) {
    event.preventDefault()
    setError('')
    try {
      await api(`/api/applications/${id}/advice-outcome`, { token, method: 'POST', body: { outcome, guidance, ...(formal ? { applicantName, district, ...(nid ? { nid } : {}) } : {}) } })
      onDone(formal ? bi(`${id} sent to DLAO review.`, `${id} ডিএলএও পর্যালোচনায় পাঠানো হয়েছে।`) : bi(`${id} closed: information given.`, `${id} বন্ধ: তথ্য দেওয়া হয়েছে।`))
    } catch (failure) { setError(failure.message) }
  }

  return <article className="card" aria-labelledby={`${id}-title`}>
    <h3 id={`${id}-title`}>{id}</h3>
    <p lang="bn">{request.topic}</p>
    <dl className="details compact">
      <div><dt>{bi('Safe number', 'নিরাপদ নম্বর')}</dt><dd>{request.contactValue}</dd></div>
      <div><dt>{bi('Safe time', 'নিরাপদ সময়')}</dt><dd>{request.safeTime}</dd></div>
      <div><dt>{bi('Received', 'পাওয়া গেছে')}</dt><dd>{when(request.createdAt)}</dd></div>
    </dl>
    <p className="muted">{bi('Call only this number at this time. If someone else answers, say nothing about the request.', 'শুধু এই নম্বরে, এই সময়েই ফোন করুন। অন্য কেউ ধরলে অনুরোধের কিছুই জানাবেন না।')}</p>
    <form onSubmit={submit} className="form-stack">
      <label htmlFor={`${id}-guidance`}>{bi('Information given on the call', 'ফোনে দেওয়া তথ্য')}</label>
      <textarea id={`${id}-guidance`} value={guidance} onChange={(event) => setGuidance(event.target.value)} minLength="10" maxLength="2000" required />
      <label htmlFor={`${id}-outcome`}>{bi('Outcome', 'ফলাফল')}</label>
      <select id={`${id}-outcome`} value={outcome} onChange={(event) => setOutcome(event.target.value)}>
        <option value="INFORMATION_PROVIDED">{bi('Information given; no case needed', 'তথ্য দেওয়া হয়েছে; মামলার দরকার নেই')}</option>
        <option value="FORMAL_ASSISTANCE">{bi('Formal legal aid needed: send to DLAO review', 'আনুষ্ঠানিক আইনি সহায়তা দরকার: ডিএলএও পর্যালোচনায় পাঠান')}</option>
      </select>
      {formal && <>
        <label htmlFor={`${id}-name`}>{bi('Applicant full name', 'আবেদনকারীর পূর্ণ নাম')}</label><input id={`${id}-name`} value={applicantName} onChange={(event) => setApplicantName(event.target.value)} minLength="2" maxLength="120" required />
        <label htmlFor={`${id}-district`}>{bi('District', 'জেলা')}</label><input id={`${id}-district`} value={district} onChange={(event) => setDistrict(event.target.value)} minLength="2" maxLength="60" required />
        <label htmlFor={`${id}-nid`}>{bi('NID number (optional; 10, 13, or 17 digits)', 'এনআইডি নম্বর (ঐচ্ছিক; ১০, ১৩ বা ১৭ অঙ্ক)')}</label><input id={`${id}-nid`} value={nid} onChange={(event) => setNid(event.target.value.trim())} inputMode="numeric" pattern="[0-9]{10}|[0-9]{13}|[0-9]{17}" autoComplete="off" />
      </>}
      {error && <p role="alert" className="error">{error}</p>}
      <button type="submit">{bi('Record outcome', 'ফলাফল সংরক্ষণ')}</button>
    </form>
  </article>
}

export default function Dashboard({ session }) {
  const navigate = useNavigate()
  const [role, setRole] = useState(session.user.assignments[0]?.role || '')
  const [workspace, setWorkspace] = useState(null)
  const [refresh, setRefresh] = useState(0)
  const [applicantName, setApplicantName] = useState('')
  const [identifier, setIdentifier] = useState('')
  const [lookupCode, setLookupCode] = useState('')
  const [callerVerified, setCallerVerified] = useState(false)
  const [contactChannel, setContactChannel] = useState('PHONE')
  const [lookup, setLookup] = useState(null)
  const [verifiedLookup, setVerifiedLookup] = useState(null)
  const [lawyerChangeReason, setLawyerChangeReason] = useState('')
  const [lawyerChangeNotice, setLawyerChangeNotice] = useState('')
  const [submitted, setSubmitted] = useState(null)
  const [notice, setNotice] = useState('')
  const [filter, setFilter] = useState('')
  const [queue, setQueue] = useState('ALL')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!role) return
    const controller = new AbortController()
    const path = role === 'PANEL_LAWYER' ? '/api/lawyers/worklist' : `/api/workspace?role=${encodeURIComponent(role)}`
    api(path, { token: session.token, signal: controller.signal })
      .then((result) => { setWorkspace(result); setLoading(false) })
      .catch((failure) => { if (failure.name !== 'AbortError') { setError(failure.message); setLoading(false) } })
    return () => controller.abort()
  }, [role, refresh, session.token])

  async function submitApplication(event) {
    event.preventDefault()
    setError('')
    setSubmitted(null)
    try {
      const result = await api('/api/applications', { token: session.token, method: 'POST', body: { applicantName } })
      setApplicantName('')
      setSubmitted(result)
      setRefresh((value) => value + 1)
    } catch (failure) { setError(failure.message) }
  }

  async function search(event) {
    event.preventDefault()
    setError('')
    try {
      const record = await api(`/api/applications/search?identifier=${encodeURIComponent(identifier.trim().toUpperCase())}`, { token: session.token })
      navigate(`/applications/${record.applicationId}`)
    } catch (failure) { setError(failure.message) }
  }

  async function statusLookup(event) {
    event.preventDefault()
    setError('')
    setLookup(null)
    setVerifiedLookup(null)
    try {
      const code = lookupCode.trim().toLowerCase()
      const result = await api('/api/applications/status-lookup', { token: session.token, method: 'POST', body: { identifier: identifier.trim().toUpperCase(), lookupCode: code, callerVerified, contactChannel } })
      setLookup(result)
      setVerifiedLookup({ applicationId: result.applicationId, lookupCode: code, contactChannel })
      setLookupCode('')
      setCallerVerified(false)
    } catch (failure) { setError(failure.message) }
  }

  async function requestLawyerChange(event) {
    event.preventDefault()
    if (!verifiedLookup) return
    setError('')
    setLawyerChangeNotice('')
    try {
      const result = await api(`/api/lawyers/applications/${verifiedLookup.applicationId}/change-requests`, { token: session.token, method: 'POST', body: {
        lookupCode: verifiedLookup.lookupCode, contactChannel: verifiedLookup.contactChannel, callerVerified: true, reason: lawyerChangeReason,
      } })
      setLawyerChangeNotice(result.nextStep)
      setLawyerChangeReason('')
      setVerifiedLookup(null)
    } catch (failure) { setError(failure.message) }
  }

  if (!role) return <p role="alert">{bi('No active provider role is assigned to this account.', 'এই অ্যাকাউন্টে কোনো সক্রিয় ভূমিকা নেই।')}</p>
  const staff = role === 'DLAO_OFFICER' || role === 'CASE_SUPPORT'
  const canSubmit = staff || role === 'HELPLINE_AGENT' || role === 'UDC_OPERATOR'
  const isUrgent = (record) => Boolean(record.urgent || record.priorityDecision === 'URGENT' || (record.priorityDecision !== 'ROUTINE' && record.flags?.some((flag) => flag.code === 'URGENT_RECOMMENDATION')))
  const isPending = (record) => !isUrgent(record) && record.status !== 'ACCEPTED'

  // Show each record once. Keyed by record ID, never by name: two applicants may share a name,
  // and possible duplicates are a DLAO officer's decision in Duplicate review.
  const seen = new Set()
  const deduplicated = (workspace?.records ?? []).filter((record) => {
    const key = record.referralId ?? record.assignmentId ?? record.applicationId
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  const filtered = deduplicated.filter((record) =>
    (queue === 'ALL' || record.flags?.some((flag) => flag.code === queue)) &&
    (!filter || [record.applicationId, record.caseId, record.applicantName].some((value) => value?.toLowerCase().includes(filter.toLowerCase())))
  )

  const sorted = [...filtered].sort((a, b) => {
    const aUrgent = isUrgent(a) ? 1 : 0
    const bUrgent = isUrgent(b) ? 1 : 0
    if (bUrgent !== aUrgent) return bUrgent - aUrgent
    const aPending = isPending(a) ? 1 : 0
    const bPending = isPending(b) ? 1 : 0
    return bPending - aPending
  })

  const visible = sorted
  const report = workspace?.report

  return <section aria-labelledby="dashboard-title">
    <p className="eyebrow">{workspace?.officeCode || bi('Demo office', 'ডেমো অফিস')} · {bi('Shared record', 'সবার জন্য একই রেকর্ড')}</p>
    <h1 id="dashboard-title">{bi(`${roles[role]?.[0][0] || 'Provider'} workspace`, `${roles[role]?.[0][1] || 'সেবাদাতা'} কর্মক্ষেত্র`)}</h1>
    <p className="lede">{roles[role] && bi(...roles[role][1])}</p>
    {session.user.assignments.length > 1 && <div className="role-switch"><label htmlFor="active-role">{bi('Active role', 'সক্রিয় ভূমিকা')}</label><select id="active-role" value={role} onChange={(event) => { setWorkspace(null); setLoading(true); setLookup(null); setVerifiedLookup(null); setRole(event.target.value) }}>{session.user.assignments.map((assignment) => <option key={`${assignment.role}-${assignment.officeCode}`} value={assignment.role}>{roleName(assignment.role)}</option>)}</select></div>}
    {error && <p role="alert" className="error">{error}</p>}
    {notice && <p role="status" className="success">{notice}</p>}
    {role === 'UDC_OPERATOR' && <p><Link to="/assisted">{bi('Open assisted intake and offline drafts', 'সহায়তায় আবেদন ও অফলাইন খসড়া খুলুন')}</Link></p>}
    {submitted && <p role="status" className="success">{bi(`Application ${submitted.applicationId} submitted to the DLAO queue. No Case ID exists yet. Give this lookup code to the caller once, through the agreed safe route:`, `আবেদন ${submitted.applicationId} ডিএলএও কর্মকর্তাদের পর্যালোচনার তালিকায় এসেছে। এখনো মামলা নম্বর নেই। সম্মত নিরাপদ পথে কলারকে এই কোডটি একবার দিন:`)} <code>{submitted.lookupCode}</code>. {bi('It will not be shown again.', 'এটি আর দেখানো হবে না।')}</p>}

    {canSubmit && <div className="dashboard-actions">
      <section className="card" aria-labelledby="intake-title"><h2 id="intake-title">{bi('New application', 'নতুন আবেদন')}</h2><p className="muted">{bi('Fictional demo records only. Identity stays incomplete until reviewed.', 'শুধু কাল্পনিক ডেমো রেকর্ড। পর্যালোচনার আগে পরিচয় অসম্পূর্ণ থাকে।')}</p><form onSubmit={submitApplication} className="form-stack"><label htmlFor="applicant-name">{bi('Fictional applicant name', 'কাল্পনিক আবেদনকারীর নাম')}</label><input id="applicant-name" value={applicantName} onChange={(event) => setApplicantName(event.target.value)} minLength="2" maxLength="120" required /><button type="submit">{bi('Submit application', 'আবেদন জমা দিন')}</button></form></section>
      {staff && <section className="card" aria-labelledby="search-title"><h2 id="search-title">{bi('Find a record', 'রেকর্ড খুঁজুন')}</h2><p className="muted">{bi('Use an exact Application ID or Case ID.', 'সঠিক আবেদন বা মামলা নম্বর লিখুন।')}</p><form onSubmit={search} className="form-stack"><label htmlFor="record-id">{bi('Application or Case ID', 'আবেদন বা মামলা নম্বর')}</label><input id="record-id" value={identifier} onChange={(event) => setIdentifier(event.target.value)} placeholder="APP-2026-000001" required /><button type="submit" className="secondary-button">{bi('Find record', 'রেকর্ড খুঁজুন')}</button></form></section>}
    </div>}

    {role === 'HELPLINE_AGENT' && <section className="card" aria-labelledby="lookup-title"><h2 id="lookup-title">{bi('Status lookup', 'অবস্থা জানুন')}</h2><p className="muted">{bi('Ask for the ID and one-time code, then do the approved caller check. The code alone is not proof of identity. Nothing is sent to the number on file.', 'আবেদন বা মামলার নম্বর এবং এককালীন কোড জেনে নিন, তারপর অনুমোদিত উপায়ে কলার যাচাই করুন। শুধু কোড পরিচয়ের প্রমাণ নয়। নথিতে থাকা ফোন নম্বরে কোনো বার্তা পাঠানো হয় না।')}</p><form onSubmit={statusLookup} className="form-stack inline-form"><label htmlFor="lookup-id">{bi('Application or Case ID', 'আবেদন বা মামলা নম্বর')}</label><input id="lookup-id" value={identifier} onChange={(event) => setIdentifier(event.target.value)} required /><label htmlFor="lookup-code">{bi('One-time lookup code or 16699 PIN', 'এককালীন কোড বা ১৬৬৯৯ পিন')}</label><input id="lookup-code" value={lookupCode} onChange={(event) => setLookupCode(event.target.value)} minLength="6" maxLength="24" autoComplete="off" required /><label htmlFor="status-channel">{bi('Permitted lookup route', 'যোগাযোগের অনুমোদিত উপায়')}</label><select id="status-channel" value={contactChannel} onChange={(event) => setContactChannel(event.target.value)}><option value="PHONE">{say('PHONE')}</option><option value="IN_PERSON">{say('IN_PERSON')}</option></select><label className="checkbox-label" htmlFor="caller-verified"><input id="caller-verified" type="checkbox" checked={callerVerified} onChange={(event) => setCallerVerified(event.target.checked)} required />{bi('I performed the approved human caller-verification procedure.', 'আমি অনুমোদিত উপায়ে কলার যাচাই করেছি।')}</label><button type="submit">{bi('Check permitted status', 'অবস্থা দেখুন')}</button></form>{lookup && <div role="status" className="success"><p>{lookup.applicationId} · {say(lookup.status)}{lookup.caseId ? ` · ${lookup.caseId}` : ''}</p><p>{bi('Next hearing:', 'পরবর্তী শুনানি:')} {lookup.nextHearingAt ? <time dateTime={lookup.nextHearingAt}>{when(lookup.nextHearingAt)}</time> : bi('Not recorded', 'লেখা নেই')}</p><p>{bi('Next step:', 'পরবর্তী ধাপ:')} {tr(lookup.nextAction || lookup.nextStep)}</p><p className="muted">{bi('Read this status to the caller. Nothing was sent.', 'কলারকে এই অবস্থা পড়ে শোনান। কিছু পাঠানো হয়নি।')}</p></div>}{verifiedLookup && lookup?.status === 'ACCEPTED' && <form onSubmit={requestLawyerChange} className="form-stack inline-form"><h3>{bi('Record a lawyer-change request', 'আইনজীবী বদলের অনুরোধ লিখুন')}</h3><p className="muted">{bi('For DLAO review only. The lawyer does not change here.', 'অনুরোধটি ডিএলএও কর্মকর্তা পর্যালোচনা করবেন। এখনই আইনজীবী বদলাবে না।')}</p><label htmlFor="lawyer-change-reason">{bi('Applicant’s stated reason', 'আবেদনকারীর বলা কারণ')}</label><textarea id="lawyer-change-reason" value={lawyerChangeReason} onChange={(event) => setLawyerChangeReason(event.target.value)} minLength="5" maxLength="1000" required /><button type="submit">{bi('Send request to DLAO review', 'ডিএলএও পর্যালোচনায় পাঠান')}</button></form>}{lawyerChangeNotice && <p role="status" className="success">{tr(lawyerChangeNotice)}</p>}</section>}

    {staff && report && <section aria-labelledby="report-title"><h2 id="report-title">{bi('Routine report', 'নিয়মিত প্রতিবেদন')}</h2><p>{bi(`${report.total} applications · ${report.accepted} accepted · ${report.counts.OVERDUE} overdue tasks · ${report.counts.LAWYER_UPDATE_OVERDUE} lawyer-update cases`, `${num(report.total)}টি আবেদন · ${num(report.accepted)}টি গৃহীত · ${num(report.counts.OVERDUE)}টি বকেয়া কাজ · ${num(report.counts.LAWYER_UPDATE_OVERDUE)}টি আইনজীবী-আপডেট বাকি`)}</p><p className="muted">{bi('Channels:', 'মাধ্যম:')} {Object.entries(report.byChannel).map(([channel, count]) => `${say(channel)} ${num(count)}`).join(' · ') || bi('none', 'নেই')}</p></section>}

    <section className="worklist" aria-labelledby="worklist-title"><div className="section-heading"><h2 id="worklist-title">{staff ? bi('Daily queue and history', 'আজকের কাজ ও আগের রেকর্ড') : role === 'PANEL_LAWYER' ? bi('Assigned cases', 'নিযুক্ত মামলা') : role === 'RECEIVING_DLAO' ? bi('Referrals to your office', 'আপনার অফিসে আসা রেফারেল') : role === 'HELPLINE_AGENT' ? bi('16699 advice callbacks', '১৬৬৯৯ পরামর্শের জন্য ফোন ফেরত') : bi('Role worklist', 'কাজের তালিকা')}</h2><span className="muted">{bi(`${workspace?.records.length || 0} records`, `${num(workspace?.records.length || 0)}টি রেকর্ড`)}</span></div>
      {staff && <div className="dashboard-actions"><div><label htmlFor="history-filter">{bi('Search shown history', 'তালিকায় খুঁজুন')}</label><input id="history-filter" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder={bi('Name, Application ID, or Case ID', 'নাম, আবেদন বা মামলা নম্বর')} /></div><div><label htmlFor="queue-filter">{bi('Queue flag', 'চিহ্ন')}</label><select id="queue-filter" value={queue} onChange={(event) => setQueue(event.target.value)}><option value="ALL">{bi('All records', 'সব রেকর্ড')}</option>{Object.entries(report?.counts || {}).map(([code, count]) => <option key={code} value={code}>{say(code)} ({num(count)})</option>)}</select></div></div>}
      {loading && <p role="status">{bi('Loading workspace…', 'লোড হচ্ছে…')}</p>}
      {!loading && workspace?.records.length === 0 && <p className="empty-state">{role === 'PANEL_LAWYER' ? bi('No current or pending panel-lawyer assignments.', 'বর্তমান বা অপেক্ষমাণ কোনো নিয়োগ নেই।') : role === 'HELPLINE_AGENT' ? bi('No advice requests are waiting for a callback.', 'ফোন ফেরতের অপেক্ষায় কোনো পরামর্শের অনুরোধ নেই।') : bi('No records are available to this role yet.', 'আপনার কাজের তালিকায় এখনো কোনো রেকর্ড নেই।')}</p>}
      {!loading && workspace?.records.length > 0 && visible.length === 0 && <p className="empty-state">{bi('No records match these filters.', 'নির্বাচিত শর্তে কোনো রেকর্ড পাওয়া যায়নি।')}</p>}
      {!loading && role === 'HELPLINE_AGENT' && visible.map((record) => <AdviceCallback key={record.applicationId} request={record} token={session.token} onDone={(message) => { setNotice(message); setRefresh((value) => value + 1) }} />)}
      {!loading && role !== 'HELPLINE_AGENT' && visible.length > 0 && <ul className="record-list">{visible.map((record) => <li key={record.referralId ?? record.assignmentId ?? record.applicationId}>{role === 'PANEL_LAWYER'
        ? <Link to={`/cases/${record.caseId}`} className={isUrgent(record) ? 'urgent-record' : ''}><strong>{record.caseId} · {say(record.assignmentStatus)}</strong><span>{record.applicantName ? <>{tr(record.applicantName)} · </> : ''}{bi('Application', 'আবেদন')} {record.applicationId}{record.nextAction ? ` · ${bi('Next:', 'পরবর্তী:')} ${record.nextAction}` : ''}</span>{isUrgent(record) && <small className="urgent-flag">{say('URGENT')}</small>}{record.nextHearingAt && <small>{bi('Hearing:', 'শুনানি:')} {when(record.nextHearingAt)}</small>}{record.updates?.map((update) => <small key={update.id}>{bi('Update', 'আপডেট')} {num(update.sequence)}: {say(update.status)} · {bi('due', 'শেষ সময়')} {when(update.dueAt)}{update.status === 'MISSED' ? ` · ${overdueText(update.dueAt)}` : ''}{update.reminderCount ? ` · ${bi(`the DLAO asked ${update.reminderCount}×`, `ডিএলএও ${num(update.reminderCount)} বার চেয়েছে`)}` : ''}</small>)}</Link>
        : role === 'RECEIVING_DLAO'
          ? <Link to={`/referrals/${record.referralId}`}><strong>{record.caseId}</strong><span>{bi(`Referral from ${record.sendingOfficeCode}`, `${record.sendingOfficeCode} থেকে রেফারেল`)} · {say(record.status)}</span><small>{bi('Acknowledge by', 'প্রাপ্তি স্বীকারের শেষ সময়')} {when(record.dueAt)}{record.overdue ? ` · ${bi('acknowledgement overdue', 'প্রাপ্তি স্বীকার বাকি')}` : ''}</small></Link>
          : <Link to={`/applications/${record.applicationId}`} className={isUrgent(record) ? 'urgent-record' : isPending(record) ? 'pending-record' : ''}><strong>{record.applicationId}</strong><span>{tr(record.applicantName)} · {say(record.status)} · {say(record.reviewState)}</span>{record.caseId && <small>{record.caseId}</small>}{isUrgent(record) && <small className="urgent-flag">{say('URGENT')}</small>}{record.priorityDecision === 'ROUTINE' && <small style={{ background: '#edf3ec', color: '#28562d', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>{say('ROUTINE')}</small>}{record.vulnerability?.length > 0 && <small>{record.vulnerability.map(say).join(' · ')}</small>}{record.complaintType && <small>{bi('Complaint type (AI suggestion):', 'অভিযোগের ধরন (এআইয়ের পরামর্শ):')} {say(record.complaintType)}</small>}{record.flags?.map((flag) => <small key={flag.code}>{say(flag.code)}: {tr(flag.reason)}</small>)}</Link>}</li>)}</ul>}
    </section>
  </section>
}
