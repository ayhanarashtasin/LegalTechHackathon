import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { api } from '../services/api.js'
import { Badge, Bi, Term, bi, num, say, tr, when } from '../components/Bi.jsx'

export default function ReferralPage({ session }) {
  const { referralId } = useParams()
  const [data, setData] = useState(null)
  const [refresh, setRefresh] = useState(0)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [decision, setDecision] = useState('ACCEPT')
  const [reason, setReason] = useState('')
  const [opened, setOpened] = useState(null)

  useEffect(() => {
    const controller = new AbortController()
    api(`/api/referrals/${referralId}`, { token: session.token, signal: controller.signal })
      .then(setData).catch((failure) => { if (failure.name !== 'AbortError') setError(failure.message) })
    return () => controller.abort()
  }, [referralId, refresh, session.token])

  async function respond(body, success) {
    setError('')
    setNotice('')
    try {
      await api(`/api/referrals/${referralId}/respond`, { token: session.token, method: 'POST', body })
      setNotice(success)
      setReason('')
      setRefresh((value) => value + 1)
    } catch (failure) { setError(failure.message) }
  }

  async function open(document) {
    setError('')
    try { setOpened(await api(`/api/documents/${document.id}`, { token: session.token })) } catch (failure) { setError(failure.message) }
  }

  function submitResponse(event) {
    event.preventDefault()
    respond({ action: decision, reason }, decision === 'ACCEPT' ? bi('Referral accepted. The sending office can see this.', 'রেফারেল গ্রহণ করা হয়েছে এবং প্রেরক অফিসকে অবহিত করা হয়েছে।') : bi('Referral returned with your reason.', 'যৌক্তিক কারণ উল্লেখপূর্বক রেফারেলটি প্রেরক অফিসে ফেরত পাঠানো হয়েছে।'))
  }

  const live = data && data.status !== 'RETURNED'
  return <section aria-labelledby="referral-title">
    <Link to="/">← <Bi en="Workspace" bn="মূল ড্যাশবোর্ড" /></Link>
    <div className="record-head">
      <div><p className="eyebrow"><Bi en="Referral" bn="আন্তঃঅফিস রেফারেল" />{data ? ` · ${data.sendingOfficeCode} → ${data.receivingOfficeCode}` : ''}</p><h1 id="referral-title">{data?.caseId ?? bi('Referral', 'আন্তঃঅফিস রেফারেল')}</h1></div>
      {data && <span><Badge code={data.status} />{data.overdue && <> <span className="badge warn-badge"><Bi en="Acknowledgement overdue" bn="প্রাপ্তি স্বীকারের সময় উত্তীর্ণ" /></span></>}</span>}
    </div>
    {error && <p role="alert" className="error">{error}</p>}
    {notice && <p role="status" className="success">{notice}</p>}
    {!error && !data && <p role="status">{bi('Loading…', 'লোড হচ্ছে…')}</p>}
    {data && <>
      <div className="summary-grid">
        <section className="card" aria-labelledby="package-title"><h2 id="package-title"><Bi en="Package" bn="রেফারেল বিবরণ ও নথি" /></h2><dl className="details compact">
          <div><dt><Bi en="Applicant" bn="আবেদনকারী" /></dt><dd>{tr(data.applicantName)} · {data.applicationId}</dd></div>
          <div><dt><Bi en="Responsible" bn="দায়িত্বপ্রাপ্ত কর্মকর্তা" /></dt><dd>{data.responsibleName}{data.responsible ? ` (${bi('you', 'আপনি')})` : ''}</dd></div>
          <div><dt><Bi en="Sent by" bn="প্রেরক কর্মকর্তা" /></dt><dd>{data.sentByName} · {data.sendingOfficeCode} · {when(data.createdAt)}</dd></div>
          <div><dt><Bi en="Acknowledge by" bn="প্রাপ্তি স্বীকারের শেষ সময়সীমা" /></dt><dd>{when(data.dueAt)}{data.acknowledgedAt ? ` · ${bi('acknowledged', 'প্রাপ্তি স্বীকার সম্পন্ন')} ${when(data.acknowledgedAt)}` : ''}</dd></div>
          <div><dt><Bi en="Reason" bn="রেফারেল প্রেরণের কারণ" /></dt><dd>{data.reason}</dd></div>
          <div><dt><Bi en="History" bn="সংক্ষিপ্ত পূর্বাপর বিবরণ" /></dt><dd>{data.history}</dd></div>
          <div><dt><Bi en="Expected action" bn="প্রত্যাশিত করণীয় / পদক্ষেপ" /></dt><dd>{data.expectedAction}</dd></div>
          {data.responseReason && <div><dt><Bi en="Your reply" bn="আপনার জবাব / প্রদত্ত সিদ্ধান্ত" /></dt><dd>{data.responseReason}</dd></div>}
        </dl></section>
        <section className="card safety-card" aria-labelledby="referral-safe-title"><h2 id="referral-safe-title"><Bi en="Safe contact" bn="নিরাপদ যোগাযোগের নিয়মাবলী" /></h2>
          {!data.safeContact ? <p><Bi en="No safe route recorded. Do not contact until the sending office confirms one." bn="নিরাপদ যোগাযোগের কোনো নির্দিষ্ট মাধ্যম নথিতে উল্লেখ নেই। প্রেরক অফিস নিশ্চিত না করা পর্যন্ত আবেদনকারীর সাথে কোনো যোগাযোগ করবেন না।" /></p> : <dl className="details compact">
            <div><dt><Bi en="Use" bn="অনুমোদিত মাধ্যম" /></dt><dd>{data.safeContact.allowedChannels.map(say).join(', ') || bi('None', 'নেই')}</dd></div>
            <div><dt><Bi en="Never use" bn="নিষিদ্ধ মাধ্যম" /></dt><dd>{data.safeContact.prohibitedChannels.map(say).join(', ') || bi('None', 'নেই')}</dd></div>
            <div><dt><Bi en="Safe time" bn="যোগাযোগের উপযুক্ত সময়" /></dt><dd>{data.safeContact.safeTimeWindow || bi('Not recorded', 'নথিতে উল্লেখ নেই')}</dd></div>
            <div><dt><Bi en="Neutral words" bn="নিরপেক্ষ শব্দচয়ন" /></dt><dd>{data.safeContact.neutralWordingRequired ? bi('Required', 'বাধ্যতামূলক') : bi('Not required', 'বাধ্যতামূলক নয়')}</dd></div>
            <div><dt><Bi en="If someone else answers" bn="অন্য ব্যক্তি কল রিসিভ করলে করণীয়" /></dt><dd><Term code={data.safeContact.unknownAnswerAction} /></dd></div>
          </dl>}
        </section>
      </div>

      <section className="card" aria-labelledby="referral-docs-title"><h2 id="referral-docs-title"><Bi en="Documents and evidence" bn="নথিপত্র ও প্রমাণাদি" /></h2>
        {data.documents.length === 0 ? <p><Bi en="No documents shared with you." bn="এই রেফারেলের সাথে কোনো সংযুক্ত নথি প্রদান করা হয়নি।" /></p> : <ul className="plain-list">{data.documents.map((item) => <li key={item.id}><div><strong>{item.label}</strong> <Badge code={item.sensitivity} /><p className="muted"><Bi en="Version" bn="সংস্করণ" /> {num(item.currentVersion)}{item.sensitivity === 'RESTRICTED' ? ` · ${bi('opening is logged', 'প্রতিবার অ্যাক্সেসের তথ্য অডিট লগে সংরক্ষিত হয়')}` : ''}</p></div>{data.responsible && live && <button type="button" className="secondary-button" onClick={() => open(item)} aria-label={bi(`Open ${item.label}`, `${item.label} খুলুন`)}><Bi en="Open" bn="খুলুন" /></button>}</li>)}</ul>}
        {data.restrictedEvidenceCount > 0 && !data.documents.some((item) => item.sensitivity === 'RESTRICTED') && <p className="muted"><Bi en={`${data.restrictedEvidenceCount} restricted item(s): named officer only.`} bn={`${num(data.restrictedEvidenceCount)}টি সংবেদনশীল প্রমাণাদি: কেবলমাত্র দায়িত্বপ্রাপ্ত মনোনীত কর্মকর্তার জন্য সংরক্ষিত।`} /></p>}
        {opened && <div className="version-history" role="status"><h3>{opened.label}</h3><p><Bi en="Version" bn="সংস্করণ" /> {num(opened.currentVersion)} · <Term code={opened.version?.qualityState} />{opened.version?.note ? ` · ${opened.version.note}` : ''}</p></div>}
      </section>

      {data.previousReturns.length > 0 && <section className="card" aria-labelledby="returns-title"><h2 id="returns-title"><Bi en="Earlier returns of this case" bn="পূর্বে ফেরত পাঠানোর বিবরণ" /></h2><ol className="timeline compact">{data.previousReturns.map((item, index) => <li key={index}><strong>{item.receivingOfficeCode}</strong> <small>{when(item.respondedAt)}</small><p>{item.reason}</p></li>)}</ol></section>}

      <section className="card" aria-labelledby="respond-title"><h2 id="respond-title"><Bi en="Your office's response" bn="আপনার অফিসের সিদ্ধান্ত ও জবাব" /></h2>
        <p className="muted"><Bi en="Acknowledge = received. Accept = your office will act. Repeated returns go to an officer who decides the route." bn="প্রাপ্তি স্বীকার: রেফারেলটি অফিসে পৌঁছেছে। গ্রহণ: আপনার অফিস মামলাটির পরবর্তী পদক্ষেপ পরিচালনা করবে। রেফারেল একাধিকবার ফেরত এলে দায়িত্বপ্রাপ্ত কর্মকর্তা চূড়ান্ত অধিক্ষেত্র নির্ধারণ করবেন।" /></p>
        {data.status === 'SENT' && <button type="button" onClick={() => respond({ action: 'ACKNOWLEDGE' }, bi('Receipt acknowledged. The sending office can see this.', 'প্রাপ্তি স্বীকার সফলভাবে সম্পন্ন হয়েছে এবং প্রেরক অফিসকে অবহিত করা হয়েছে।'))}><Bi en="Acknowledge receipt" bn="প্রাপ্তি স্বীকার করুন" /></button>}
        {(data.status === 'SENT' || data.status === 'ACKNOWLEDGED') ? <form onSubmit={submitResponse} className="form-stack inline-form">
          <label htmlFor="referral-decision"><Bi en="Decision" bn="সিদ্ধান্ত" /></label>
          <select id="referral-decision" value={decision} onChange={(event) => setDecision(event.target.value)}><option value="ACCEPT">{bi('Accept the referral', 'রেফারেল গ্রহণ করুন')}</option><option value="RETURN">{bi('Return to the sending office', 'প্রেরক অফিসে ফেরত পাঠান')}</option></select>
          <label htmlFor="referral-response-reason"><Bi en="Response reason" bn="সিদ্ধান্তের কারণ / যৌক্তিকতা" /></label>
          <textarea id="referral-response-reason" value={reason} onChange={(event) => setReason(event.target.value)} minLength="10" maxLength="1000" required />
          <button type="submit"><Bi en="Record response" bn="সিদ্ধান্ত সংরক্ষণ করুন" /></button>
        </form> : <p><Bi en="Response recorded:" bn="আপনার অফিসের সিদ্ধান্ত নথিভুক্ত হয়েছে:" /> <Term code={data.status} /> · {when(data.respondedAt)}</p>}
      </section>
    </>}
  </section>
}
