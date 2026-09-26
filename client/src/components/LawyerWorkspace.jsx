import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api, apiUrl } from '../services/api.js'
import { Bi, bi, num, when } from './Bi.jsx'

const folders = [['APPLICATION', 'Application Documents', 'আবেদনের নথি'], ['COURT', 'Court Documents', 'আদালতের নথি'], ['ORDERS', 'Orders', 'আদেশ'], ['EVIDENCE', 'Evidence', 'প্রমাণ']]
const stages = [['CASE_PREPARATION', 'Case preparation', 'মামলার প্রস্তুতি'], ['HEARING_ATTENDANCE', 'Hearing attendance', 'শুনানিতে উপস্থিতি'], ['FINAL_DISPOSAL', 'Final disposal', 'চূড়ান্ত নিষ্পত্তি']]
const progressStages = [['INITIAL_REVIEW', 'Initial review completed', 'প্রাথমিক পর্যালোচনা সম্পন্ন'], ['CLIENT_MEETING', 'Client meeting completed', 'মক্কেলের সঙ্গে সাক্ষাৎ সম্পন্ন'], ['HEARING_ATTENDED', 'Hearing attended', 'শুনানিতে উপস্থিত'], ['JUDGMENT_PENDING', 'Judgment pending', 'রায়ের অপেক্ষায়']]
const checks = [['applicantContacted', 'Applicant contacted', 'আবেদনকারীর সঙ্গে যোগাযোগ হয়েছে'], ['documentsVerified', 'Documents checked by lawyer', 'আইনজীবী নথি যাচাই করেছেন'], ['legalAdviceProvided', 'Legal advice provided', 'আইনি পরামর্শ দেওয়া হয়েছে']]
const statusText = (code) => ({ PENDING: bi('Pending review', 'পর্যালোচনার অপেক্ষায়'), APPROVED: bi('Approved', 'অনুমোদিত'), CHANGES_REQUESTED: bi('Changes requested', 'সংশোধন প্রয়োজন'), SUBMITTED: bi('Pending', 'অপেক্ষমাণ'), PAID: bi('Paid', 'পরিশোধিত'), PAYMENT_RECORDED: bi('Payment recorded', 'পরিশোধ নথিভুক্ত'), RECONCILED: bi('Approved', 'অনুমোদিত') }[code] || code)
const currency = (amount) => new Intl.NumberFormat(undefined, { style: 'currency', currency: 'BDT' }).format(amount || 0)

export function DocumentChoices({ documents = [], value, onChange, id }) {
  return <fieldset className="lawyer-attachments"><legend><Bi en="Supporting documents" bn="সহায়ক নথি" /></legend>
    {documents.length === 0 ? <p className="muted"><Bi en="Upload a PDF in Documents below, then select it here." bn="নিচের নথি বিভাগে PDF আপলোড করে এখানে নির্বাচন করুন।" /></p> : documents.map((document) => <label key={document._id} htmlFor={`${id}-${document._id}`}>
      <input id={`${id}-${document._id}`} type="checkbox" checked={value.includes(document._id)} onChange={(event) => onChange(event.target.checked ? [...value, document._id] : value.filter((item) => item !== document._id))} />
      {document.label} · {statusText(document.reviewState || 'APPROVED')}{document.sensitivity === 'RESTRICTED' ? ` · ${bi('Restricted', 'সংরক্ষিত')}` : ''}
    </label>)}
  </fieldset>
}

function ReviewForm({ id, payment = false, claim, onSubmit, busy }) {
  const [reason, setReason] = useState('')
  const [amount, setAmount] = useState(String(claim?.status === 'APPROVED' ? (claim.approvedAmount - claim.paidAmount).toFixed(2) : claim?.amount || ''))
  const [reference, setReference] = useState('')
  async function submit(event) {
    event.preventDefault()
    const decision = event.nativeEvent.submitter?.value || 'APPROVE'
    const ok = await onSubmit({ decision, reason, ...(payment && decision !== 'CHANGES_REQUESTED' ? { amount: Number(amount) } : {}), ...(decision === 'RECORD_PAYMENT' ? { paymentReference: reference } : {}) })
    if (ok) setReason('')
  }
  return <form className="form-stack inline-form no-print" onSubmit={submit}>
    <label htmlFor={`${id}-reason`}><Bi en="Officer review reason" bn="কর্মকর্তার পর্যালোচনার কারণ" /></label>
    <textarea id={`${id}-reason`} value={reason} onChange={(event) => setReason(event.target.value)} minLength={10} maxLength={1500} required />
    {payment && <><label htmlFor={`${id}-amount`}>{claim.status === 'APPROVED' ? bi('Amount being recorded as paid (BDT)', 'পরিশোধ হিসেবে নথিভুক্ত অর্থ (টাকা)') : bi('Approved amount (BDT)', 'অনুমোদিত অর্থ (টাকা)')}</label><input id={`${id}-amount`} type="number" min="0.01" max={claim.status === 'APPROVED' ? (claim.approvedAmount - claim.paidAmount).toFixed(2) : claim.amount} step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} required />
      {claim.status === 'APPROVED' && <><label htmlFor={`${id}-reference`}><Bi en="Payment reference (demo record)" bn="পরিশোধের রেফারেন্স (ডেমো রেকর্ড)" /></label><input id={`${id}-reference`} value={reference} onChange={(event) => setReference(event.target.value)} minLength={3} maxLength={200} required /></>}
    </>}
    <div className="choice-row">
      <button type="submit" value={payment && claim.status === 'APPROVED' ? 'RECORD_PAYMENT' : 'APPROVE'} disabled={busy}>{payment && claim.status === 'APPROVED' ? bi('Record payment', 'পরিশোধ নথিভুক্ত করুন') : bi('Approve', 'অনুমোদন করুন')}</button>
      {(!payment || claim.status === 'SUBMITTED') && <button type="submit" value="CHANGES_REQUESTED" className="secondary-button" disabled={busy}><Bi en="Request changes" bn="সংশোধন চাইুন" /></button>}
    </div>
  </form>
}

export default function LawyerWorkspace({ data, token, onChanged, officer = false }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [folder, setFolder] = useState('APPLICATION')
  const [label, setLabel] = useState('')
  const [restricted, setRestricted] = useState(false)
  const [file, setFile] = useState(null)
  const [stage, setStage] = useState('CASE_PREPARATION')
  const [amount, setAmount] = useState('')
  const [notes, setNotes] = useState('')
  const [attachmentIds, setAttachmentIds] = useState([])
  const [progress, setProgress] = useState({ date: new Date().toISOString().slice(0, 10), stage: 'INITIAL_REVIEW', report: '', nextAction: '', visitReport: { applicantContacted: false, documentsVerified: false, legalAdviceProvided: false } })
  const [progressAttachments, setProgressAttachments] = useState([])
  const [requestNote, setRequestNote] = useState('')
  const mutations = useRef(new Map())
  if (!data) return null
  const base = `/api/lawyers/assignments/${data.assignmentId}`
  const pendingOutcome = data.entries.filter((entry) => entry.kind === 'OUTCOME' && entry.reviewState === 'PENDING')
  async function send(path, body, message, idempotent = false) {
    const key = `${path}:${JSON.stringify(body)}`
    if (idempotent && !mutations.current.has(key)) mutations.current.set(key, crypto.randomUUID())
    setBusy(true); setError(''); setNotice('')
    try {
      await api(`${base}${path}`, { token, method: 'POST', body: { ...body, ...(idempotent ? { clientMutationId: mutations.current.get(key) } : {}) } })
      mutations.current.delete(key)
      setNotice(message); await onChanged(); return true
    } catch (failure) { setError(failure.message); return false } finally { setBusy(false) }
  }
  async function upload(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('')
    try {
      if (!file || file.size > 4 * 1024 * 1024) throw new Error(bi('Choose a PDF of at most 4 MB.', 'সর্বোচ্চ ৪ MB PDF নির্বাচন করুন।'))
      const query = new URLSearchParams({ label, category: folder, filename: file.name, sensitivity: restricted ? 'RESTRICTED' : 'STANDARD' })
      await api(`${base}/documents?${query}`, { token, method: 'POST', audio: new Blob([file], { type: 'application/pdf' }) })
      setLabel(''); setFile(null); event.target.reset(); setNotice(bi('PDF uploaded for DLAO review.', 'PDF ডিএলএও পর্যালোচনার জন্য আপলোড হয়েছে।')); await onChanged()
    } catch (failure) { setError(failure.message) } finally { setBusy(false) }
  }
  async function download(item, version) {
    setError('')
    try {
      const response = await fetch(apiUrl(`${base}/documents/${item._id}/file${version ? `?version=${version}` : ''}`), { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' })
      if (!response.ok) { const result = await response.json(); throw new Error(result.error?.message || 'Download failed.') }
      const url = URL.createObjectURL(await response.blob()); const anchor = document.createElement('a')
      anchor.href = url; anchor.download = item.versions.find((source) => source.version === (version || item.currentVersion))?.filename || 'case-document.pdf'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (failure) { setError(failure.message) }
  }
  const reportTitle = `${bi('Stage-wise payment report', 'ধাপ অনুযায়ী পরিশোধের প্রতিবেদন')} · ${data.caseId}`
  return <section className="lawyer-workspace" aria-label={bi('Reports, documents and payments', 'প্রতিবেদন, নথি ও পরিশোধ')}>
    {error && <p role="alert" className="error">{error}</p>}{notice && <p role="status" className="success">{notice}</p>}
    {!officer && data.caseStatus === 'OPEN' && <section className="panel no-print"><div className="panel-body">
      <h2><Bi en="Progress Update Form" bn="অগ্রগতি হালনাগাদ ফর্ম" /></h2>
      <form className="form-stack" onSubmit={async (event) => { event.preventDefault(); if (await send('/entries', { kind: 'PROGRESS', data: progress, attachmentIds: progressAttachments }, bi('Progress report recorded.', 'অগ্রগতি প্রতিবেদন সংরক্ষিত হয়েছে।'), true)) { setProgress((current) => ({ ...current, report: '', nextAction: '' })); setProgressAttachments([]) } }}>
        <fieldset className="lawyer-attachments"><legend><Bi en="Visit report" bn="সাক্ষাৎ প্রতিবেদন" /></legend>{checks.map(([key, en, bn]) => <label key={key}><input type="checkbox" checked={progress.visitReport[key]} onChange={(event) => setProgress((current) => ({ ...current, visitReport: { ...current.visitReport, [key]: event.target.checked } }))} />{bi(en, bn)}</label>)}</fieldset>
        <p className="muted"><Bi en="These are the lawyer’s attestations. DLAO document approval is recorded separately. This visit report does not replace a scheduled mandatory update." bn="এগুলো আইনজীবীর বিবৃতি। ডিএলএও নথির অনুমোদন পৃথকভাবে নথিভুক্ত হয়। নির্ধারিত আবশ্যিক আপডেটও আলাদাভাবে জমা দিন।" /></p>
        <label htmlFor={`visit-date-${data.assignmentId}`}><Bi en="Visit date" bn="সাক্ষাতের তারিখ" /></label><input id={`visit-date-${data.assignmentId}`} type="date" value={progress.date} onChange={(event) => setProgress({ ...progress, date: event.target.value })} required />
        <label htmlFor={`progress-stage-${data.assignmentId}`}><Bi en="Case progress" bn="মামলার অগ্রগতি" /></label><select id={`progress-stage-${data.assignmentId}`} value={progress.stage} onChange={(event) => setProgress({ ...progress, stage: event.target.value })}>{progressStages.map(([code, en, bn]) => <option key={code} value={code}>{bi(en, bn)}</option>)}</select>
        <label htmlFor={`visit-notes-${data.assignmentId}`}><Bi en="Legal action taken / Notes" bn="গৃহীত আইনি পদক্ষেপ / বিবরণ" /></label><textarea id={`visit-notes-${data.assignmentId}`} value={progress.report} onChange={(event) => setProgress({ ...progress, report: event.target.value })} minLength={5} maxLength={1500} required />
        <label htmlFor={`visit-next-${data.assignmentId}`}><Bi en="Next action" bn="পরবর্তী করণীয়" /></label><input id={`visit-next-${data.assignmentId}`} value={progress.nextAction} onChange={(event) => setProgress({ ...progress, nextAction: event.target.value })} minLength={5} maxLength={300} required />
        <DocumentChoices documents={data.documents} id="visit-attachments" value={progressAttachments} onChange={setProgressAttachments} />
        <button disabled={busy} type="submit"><Bi en="Submit visit report" bn="সাক্ষাৎ প্রতিবেদন জমা দিন" /></button>
      </form>
    </div></section>}
    <section className="panel no-print"><div className="panel-body"><h2><Bi en="Documents" bn="নথিপত্র" /></h2>
      {!officer && <form className="form-stack" onSubmit={upload}>
        <label htmlFor={`pdf-label-${data.assignmentId}`}><Bi en="Document label" bn="নথির নাম" /></label><input id={`pdf-label-${data.assignmentId}`} value={label} onChange={(event) => setLabel(event.target.value)} minLength={2} maxLength={120} required />
        <label htmlFor={`pdf-folder-${data.assignmentId}`}><Bi en="Folder" bn="ফোল্ডার" /></label><select id={`pdf-folder-${data.assignmentId}`} value={folder} onChange={(event) => setFolder(event.target.value)}>{folders.map(([code, en, bn]) => <option key={code} value={code}>{bi(en, bn)}</option>)}</select>
        <label htmlFor={`pdf-file-${data.assignmentId}`}><Bi en="PDF attachment (maximum 4 MB)" bn="PDF সংযুক্তি (সর্বোচ্চ ৪ MB)" /></label><input id={`pdf-file-${data.assignmentId}`} type="file" accept="application/pdf,.pdf" onChange={(event) => setFile(event.target.files[0] || null)} required />
        <label className="lawyer-check"><input type="checkbox" checked={restricted} onChange={(event) => setRestricted(event.target.checked)} /><Bi en="Restricted: only you and the assigning officer receive access" bn="সংরক্ষিত: শুধু আপনি এবং নিয়োগকারী কর্মকর্তা দেখতে পারবেন" /></label>
        <button disabled={busy} type="submit"><Bi en="Upload document" bn="নথি আপলোড করুন" /></button>
      </form>}
      {folders.map(([code, en, bn]) => <details key={code} open><summary>{bi(en, bn)} ({num(data.documents.filter((item) => (item.category || 'APPLICATION') === code && item.sensitivity !== 'RESTRICTED').length)})</summary>
        {data.documents.filter((item) => (item.category || 'APPLICATION') === code && item.sensitivity !== 'RESTRICTED').map((item) => <DocumentRow key={item._id} item={item} download={download} officer={officer} busy={busy} review={(body) => send(`/documents/${item._id}/review`, body, bi('Document review recorded.', 'নথির পর্যালোচনা সংরক্ষিত হয়েছে।'))} />)}
      </details>)}
      <details><summary><Bi en="Restricted documents (explicit permission required)" bn="সংরক্ষিত নথি (স্পষ্ট অনুমতি আবশ্যক)" /></summary>{data.documents.filter((item) => item.sensitivity === 'RESTRICTED').map((item) => <DocumentRow key={item._id} item={item} download={download} officer={officer} busy={busy} review={(body) => send(`/documents/${item._id}/review`, body, bi('Review recorded.', 'পর্যালোচনা সংরক্ষিত।'))} />)}</details>
      {officer && data.caseStatus === 'OPEN' && <form className="form-stack" onSubmit={async (event) => { event.preventDefault(); if (await send('/entries', { kind: 'DOCUMENT_REQUEST', data: { notes: requestNote }, attachmentIds: [] }, bi('Document request recorded.', 'নথির অনুরোধ সংরক্ষিত।'), true)) setRequestNote('') }}><label htmlFor={`request-doc-${data.assignmentId}`}><Bi en="Request a document from the lawyer" bn="আইনজীবীর কাছে নথি চাইুন" /></label><textarea id={`request-doc-${data.assignmentId}`} value={requestNote} onChange={(event) => setRequestNote(event.target.value)} minLength={5} maxLength={1500} required /><button disabled={busy}><Bi en="Send document request" bn="নথির অনুরোধ পাঠান" /></button></form>}
    </div></section>
    <section className="panel lawyer-payment-report"><div className="panel-body"><h2>{reportTitle}</h2><p><Bi en="Prototype payment records — no money is transferred." bn="প্রোটোটাইপ পরিশোধের রেকর্ড — কোনো অর্থ স্থানান্তর হয় না।" /></p>
      <dl className="details compact">{[['claimed', 'Claimed', 'দাবিকৃত'], ['approved', 'Approved', 'অনুমোদিত'], ['paid', 'Paid', 'পরিশোধিত'], ['pendingApproved', 'Approved balance pending', 'অনুমোদিত অপরিশোধিত অর্থ']].map(([key, en, bn]) => <div key={key}><dt>{bi(en, bn)}</dt><dd>{currency(data.totals[key])}</dd></div>)}</dl>
      <button type="button" className="secondary-button no-print" onClick={() => { const sheet = document.getElementById(`payment-print-${data.assignmentId}`); sheet.classList.add('print-active'); try { window.print() } finally { sheet.classList.remove('print-active') } }}><Bi en="Print report / Save as PDF" bn="প্রতিবেদন প্রিন্ট / PDF সংরক্ষণ" /></button>
      <div className="lawyer-table-scroll"><table><caption><Bi en="Payment by stage" bn="ধাপ অনুযায়ী পরিশোধ" /></caption><thead><tr>{['Stage', 'Claimed', 'Approved', 'Paid', 'Pending approved', 'Status'].map((title) => <th scope="col" key={title}>{title}</th>)}</tr></thead><tbody>{stages.map(([code, en, bn]) => {
        const claims = data.claims.filter((claim) => claim.stage === code)
        const sum = (key) => claims.reduce((total, claim) => total + Math.round((claim[key] || 0) * 100), 0) / 100
        return <tr key={code}><th scope="row">{bi(en, bn)}</th><td>{currency(sum('amount'))}</td><td>{currency(sum('approvedAmount'))}</td><td>{currency(sum('paidAmount'))}</td><td>{currency(sum('approvedAmount') - sum('paidAmount'))}</td><td>{claims.length ? sum('paidAmount') > 0 && claims.every((claim) => claim.status === 'PAID') ? bi('Paid', 'পরিশোধিত') : bi('Pending', 'অপেক্ষমাণ') : bi('No claim', 'দাবি নেই')}</td></tr>
      })}</tbody></table></div>
      {!officer && data.caseStatus !== 'CANCELLED' && <form className="form-stack no-print" onSubmit={async (event) => { event.preventDefault(); if (await send('/claims', { stage, amount: Number(amount), notes, attachmentIds }, bi('Fee claim submitted for review.', 'ফি দাবি পর্যালোচনার জন্য জমা হয়েছে।'), true)) { setNotes(''); setAmount(''); setAttachmentIds([]) } }}>
        <h3><Bi en="Submit stage fee claim" bn="ধাপের ফি দাবি জমা দিন" /></h3>
        <label htmlFor={`claim-stage-${data.assignmentId}`}><Bi en="Payment stage" bn="পরিশোধের ধাপ" /></label><select id={`claim-stage-${data.assignmentId}`} value={stage} onChange={(event) => setStage(event.target.value)}>{stages.map(([code, en, bn]) => <option key={code} value={code}>{bi(en, bn)}</option>)}</select>
        <label htmlFor={`claim-amount-${data.assignmentId}`}><Bi en="Claim amount (BDT)" bn="দাবিকৃত অর্থ (টাকা)" /></label><input id={`claim-amount-${data.assignmentId}`} type="number" min="0.01" max="10000000" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} required />
        <label htmlFor={`claim-notes-${data.assignmentId}`}><Bi en="Claim details" bn="দাবির বিবরণ" /></label><textarea id={`claim-notes-${data.assignmentId}`} value={notes} onChange={(event) => setNotes(event.target.value)} minLength={10} maxLength={1500} required />
        <DocumentChoices documents={data.documents} id={`claim-attachments-${data.assignmentId}`} value={attachmentIds} onChange={setAttachmentIds} />
        <button disabled={busy || attachmentIds.length === 0}><Bi en="Submit claim" bn="দাবি জমা দিন" /></button>
      </form>}
      {data.claims.map((claim) => <article key={claim._id} className="version-history"><h3>{bi(...(stages.find(([code]) => code === claim.stage)?.slice(1) || [claim.stage, claim.stage]))} · {statusText(claim.status)}</h3><p>{claim.notes}</p><p>{currency(claim.amount)} · {when(claim.createdAt)}</p><p>{bi('Approved:', 'অনুমোদিত:')} {currency(claim.approvedAmount)} · {bi('Paid:', 'পরিশোধিত:')} {currency(claim.paidAmount)}</p><p>{claim.reviewReason}</p><AttachmentNames ids={claim.attachmentIds} documents={data.documents} versions={claim.attachmentVersions} download={download} />
        {officer && ['SUBMITTED', 'APPROVED'].includes(claim.status) && <ReviewForm key={`${claim._id}-${claim.paidAmount}-${claim.status}`} id={claim._id} payment claim={claim} busy={busy} onSubmit={(body) => send(`/claims/${claim._id}/review`, body, bi('Claim review recorded.', 'দাবির পর্যালোচনা সংরক্ষিত।'), true)} />}
      </article>)}
      <details open className="lawyer-payment-history"><summary><Bi en="Payment history and references" bn="পরিশোধের ইতিহাস ও রেফারেন্স" /></summary>{data.paymentHistory.map((event) => <p key={event._id}>{when(event.createdAt)} · {event.stage} · {statusText(event.status)} {event.amount != null && currency(event.amount)} {event.paymentReference && `· ${event.paymentReference}`}<br />{event.reason}</p>)}</details>
    </div></section>
    {officer && pendingOutcome.map((entry) => <section className="panel no-print" key={entry._id}><div className="panel-body"><h2><Bi en="Review final report" bn="চূড়ান্ত প্রতিবেদন পর্যালোচনা" /></h2><p>{entry.data.type} · {entry.data.date}</p><p>{entry.data.report}</p><AttachmentNames ids={entry.attachmentIds} documents={data.documents} versions={entry.attachmentVersions} download={download} /><p className="muted"><Bi en="Approval closes the Case. Settlement certification follows its separate workflow." bn="অনুমোদনে মামলা বন্ধ হবে। আপসের সনদ পৃথক কার্যপ্রবাহে সম্পন্ন হয়।" /></p><ReviewForm id={entry._id} busy={busy} onSubmit={(body) => send(`/outcomes/${entry._id}/review`, body, bi('Final report review recorded.', 'চূড়ান্ত প্রতিবেদন পর্যালোচনা সংরক্ষিত।'))} /></div></section>)}
    <section className="panel no-print"><div className="panel-body"><h2><Bi en="Case preparation and report history" bn="মামলার প্রস্তুতি ও প্রতিবেদনের ইতিহাস" /></h2>{data.entries.length === 0 && <p><Bi en="No reports recorded yet." bn="এখনো প্রতিবেদন সংরক্ষিত হয়নি।" /></p>}{data.entries.map((entry) => <article className="version-history" key={entry._id}><h3>{entry.kind.replaceAll('_', ' ')} {entry.reviewState && `· ${statusText(entry.reviewState)}`}</h3><small>{when(entry.createdAt)}</small>{entry.data.rating && <p>{bi('Client rating:', 'মক্কেলের মূল্যায়ন:')} {num(entry.data.rating)}/5</p>}{entry.data.stage && <p>{progressStages.find(([code]) => code === entry.data.stage)?.[1] || entry.data.stage}</p>}{entry.data.visitReport && <ul>{checks.map(([key, en, bn]) => <li key={key}>{bi(en, bn)}: {entry.data.visitReport[key] ? bi('Yes', 'হ্যাঁ') : bi('No', 'না')}</li>)}</ul>}<p>{entry.data.notes || entry.data.report || [entry.data.courtName, entry.data.courtCaseNo, entry.data.courtStage].filter(Boolean).join(' · ')}</p>{entry.data.nextAction && <p>{bi('Next:', 'পরবর্তী:')} {entry.data.nextAction}</p>}{entry.reviewReason && <p>{entry.reviewReason}</p>}<AttachmentNames ids={entry.attachmentIds} documents={data.documents} versions={entry.attachmentVersions} download={download} /></article>)}</div></section>
    {createPortal(<section id={`payment-print-${data.assignmentId}`} className="lawyer-print-sheet"><h1>{reportTitle}</h1><p>{data.applicationId} · {when(new Date().toISOString())}</p><p><Bi en="Prototype payment records — no money transferred." bn="প্রোটোটাইপ পরিশোধের রেকর্ড — অর্থ স্থানান্তর হয়নি।" /></p><table><caption><Bi en="Claims and payments (BDT)" bn="দাবি ও পরিশোধ (টাকা)" /></caption><thead><tr>{['Stage', 'Claim date', 'Claimed', 'Approved', 'Paid', 'Pending approved', 'Status', 'Evidence'].map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead><tbody>{data.claims.map((claim) => <tr key={claim._id}><th scope="row">{stages.find(([code]) => code === claim.stage)?.[1] || claim.stage}</th><td>{when(claim.createdAt)}</td><td>{currency(claim.amount)}</td><td>{currency(claim.approvedAmount)}</td><td>{currency(claim.paidAmount)}</td><td>{currency(claim.approvedAmount - claim.paidAmount)}</td><td>{statusText(claim.status)}</td><td>{claim.attachmentIds.map((id) => `${data.documents.find((item) => item._id === id)?.label || 'Document'} (v${claim.attachmentVersions.find((snapshot) => snapshot.documentId === id)?.version || '?'})`).join(', ')}</td></tr>)}</tbody></table><p>{bi('Total claimed:', 'মোট দাবি:')} {currency(data.totals.claimed)} · {bi('Approved:', 'অনুমোদিত:')} {currency(data.totals.approved)} · {bi('Paid:', 'পরিশোধিত:')} {currency(data.totals.paid)} · {bi('Pending approved:', 'অনুমোদিত অপরিশোধিত:')} {currency(data.totals.pendingApproved)}</p><h2><Bi en="Payment history" bn="পরিশোধের ইতিহাস" /></h2>{data.paymentHistory.map((event) => <p key={event._id}>{when(event.createdAt)} · {event.stage} · {statusText(event.status)} · {currency(event.amount)} {event.paymentReference} · {event.reason}</p>)}</section>, document.body)}
  </section>
}

function AttachmentNames({ ids, documents, versions = [], download }) {
  return ids.length > 0 && <ul>{ids.map((id) => {
    const item = documents.find((document) => document._id === id)
    const version = versions.find((snapshot) => snapshot.documentId === id)?.version
    const source = item?.versions.find((source) => source.version === (version || item.currentVersion))
    return <li key={id}>{source?.label || item?.label || bi('Document', 'নথি')}{version && ` · ${bi('Version', 'সংস্করণ')} ${num(version)}`} {download && source?.filename?.toLowerCase().endsWith('.pdf') && <button type="button" className="secondary-button" onClick={() => download(item, version)}>{bi('Download supporting PDF', 'সহায়ক PDF ডাউনলোড')}</button>}</li>
  })}</ul>
}
function DocumentRow({ item, download, officer, busy, review }) {
  return <article className="version-history"><strong>{item.label}</strong> · {statusText(item.reviewState || 'APPROVED')}<p>{item.version?.filename} · {bi('Version', 'সংস্করণ')} {num(item.currentVersion)}</p>{item.reviewReason && <p>{item.reviewReason}</p>}
    {item.version?.filename?.toLowerCase().endsWith('.pdf') && <button type="button" className="secondary-button" onClick={() => download(item)}><Bi en="Download PDF" bn="PDF ডাউনলোড" /></button>}
    {officer && item.reviewState === 'PENDING' && <ReviewForm id={item._id} busy={busy} onSubmit={review} />}
  </article>
}

export function ClientFeedbackForm({ assignmentId, token }) {
  const [rating, setRating] = useState('5')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const mutationId = useRef(crypto.randomUUID())
  return <details className="no-print"><summary><Bi en="Give lawyer feedback" bn="আইনজীবী সম্পর্কে মতামত দিন" /></summary>{message ? <p role="status">{message}</p> : <form className="form-stack" onSubmit={async (event) => { event.preventDefault(); setBusy(true); setError(''); try { await api(`/api/citizen/assignments/${assignmentId}/feedback`, { token, method: 'POST', body: { rating: Number(rating), notes, clientMutationId: mutationId.current } }); setMessage(bi('Feedback recorded.', 'মতামত সংরক্ষিত হয়েছে।')) } catch (failure) { setError(failure.message) } finally { setBusy(false) } }}>
    {error && <p role="alert">{error}</p>}<label htmlFor={`rating-${assignmentId}`}><Bi en="Rating" bn="মূল্যায়ন" /></label><select id={`rating-${assignmentId}`} value={rating} onChange={(event) => setRating(event.target.value)}>{[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{num(value)}/5</option>)}</select><label htmlFor={`feedback-${assignmentId}`}><Bi en="Feedback" bn="মতামত" /></label><textarea id={`feedback-${assignmentId}`} value={notes} onChange={(event) => setNotes(event.target.value)} minLength={5} maxLength={1000} required /><button disabled={busy}><Bi en="Submit feedback" bn="মতামত জমা দিন" /></button>
  </form>}</details>
}

export function LawyerOfficerWorkspace({ assignmentId, token, onChanged }) {
  const [expanded, setExpanded] = useState(false)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    if (!expanded) return
    const controller = new AbortController()
    api(`/api/lawyers/assignments/${assignmentId}/workspace`, { token, signal: controller.signal }).then(setData).catch((failure) => { if (failure.name !== 'AbortError') setError(failure.message) })
    return () => controller.abort()
  }, [assignmentId, token, expanded, refresh])
  return <details className="lawyer-officer-workspace" onToggle={(event) => setExpanded(event.currentTarget.open)}><summary><Bi en="Lawyer reports, documents and fee claims" bn="আইনজীবীর প্রতিবেদন, নথি ও ফি দাবি" /></summary>
    {error && <p role="alert">{error}</p>}{expanded && !data && !error && <p role="status"><Bi en="Loading…" bn="লোড হচ্ছে…" /></p>}
    {expanded && data && <LawyerWorkspace data={data} token={token} officer onChanged={() => { setRefresh((value) => value + 1); onChanged?.() }} />}
  </details>
}
