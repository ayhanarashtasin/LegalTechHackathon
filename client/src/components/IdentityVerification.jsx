import { useEffect, useRef, useState } from 'react'
import { api, apiUrl } from '../services/api.js'
import { Bi, bi, Term, when } from './Bi.jsx'

const statusText = {
  CAPTURING: ['Record your identity check', 'পরিচয় যাচাই রেকর্ড করুন'],
  PENDING_REVIEW: ['Waiting for the mediator', 'মধ্যস্থতাকারীর পর্যালোচনার অপেক্ষায়'],
  VERIFIED: ['Identity check approved', 'পরিচয় যাচাই অনুমোদিত'],
  RETAKE_REQUIRED: ['A new recording is needed', 'নতুন রেকর্ডিং প্রয়োজন'],
  MANUAL_REVIEW_REQUIRED: ['Contact the mediator for an assisted check', 'সহায়তাপ্রাপ্ত যাচাইয়ের জন্য মধ্যস্থতাকারীর সঙ্গে যোগাযোগ করুন'],
}

function EvidencePreview({ path, token, code, label }) {
  const [file, setFile] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    let url
    fetch(apiUrl(path), { signal: controller.signal, cache: 'no-store', headers: { ...(token ? { authorization: `Bearer ${token}` } : { 'X-Signing-Code': code }) } })
      .then(async (response) => {
        if (!response.ok) throw new Error(bi('Evidence is unavailable or expired.', 'প্রমাণ অনুপলব্ধ বা মেয়াদ শেষ।'))
        const blob = await response.blob()
        if (controller.signal.aborted) return
        url = URL.createObjectURL(blob)
        setFile({ url, mime: blob.type })
      }).catch((failure) => { if (failure.name !== 'AbortError') setError(failure.message) })
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url) }
  }, [path, token, code])
  return <div>{error && <p role="alert">{error}</p>}{file && (file.mime.startsWith('video/') ? <video className="identity-video" controls playsInline src={file.url} aria-label={label} /> : file.mime.startsWith('image/') ? <img className="identity-image" src={file.url} alt={label} /> : <a href={file.url} download="private-identity-document.pdf">{label}</a>)}</div>
}

export function PartyIdentityVerification({ code, initial, onApproved }) {
  const [record, setRecord] = useState(initial.verification)
  const [mode, setMode] = useState('REMOTE_VIDEO')
  const [consent, setConsent] = useState(false)
  const [documentType, setDocumentType] = useState('PASSPORT')
  const [idFile, setIdFile] = useState(null)
  const [clip, setClip] = useState(null)
  const [recording, setRecording] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const camera = useRef(null)
  const playback = useRef(null)
  const recorder = useRef(null)
  const stream = useRef(null)
  const timer = useRef(null)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      clearTimeout(timer.current)
      if (recorder.current?.state === 'recording') recorder.current.stop()
      stream.current?.getTracks().forEach((track) => track.stop())
    }
  }, [])
  useEffect(() => {
    if (!clip) return
    const url = URL.createObjectURL(clip)
    playback.current.src = url
    return () => URL.revokeObjectURL(url)
  }, [clip])
  async function action(work) {
    setBusy(true); setError('')
    try { await work() } catch (failure) { stream.current?.getTracks().forEach((track) => track.stop()); setRecording(false); setError(failure.message) }
    finally { setBusy(false) }
  }
  async function startCamera() {
    await action(async () => {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new Error(bi('Camera recording is unavailable. Choose an in-person or assisted check.', 'ক্যামেরা রেকর্ডিং অনুপলব্ধ। সরাসরি বা সহায়তাপ্রাপ্ত যাচাই বেছে নিন।'))
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: true })
      if (!mounted.current) { stream.current.getTracks().forEach((track) => track.stop()); return }
      camera.current.srcObject = stream.current
      const mimeType = ['video/webm;codecs=vp8,opus', 'video/mp4'].find((mime) => MediaRecorder.isTypeSupported(mime))
      const chunks = []
      const capture = new MediaRecorder(stream.current, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: 500000 })
      recorder.current = capture
      capture.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data) }
      capture.onstop = () => {
        clearTimeout(timer.current)
        stream.current?.getTracks().forEach((track) => track.stop())
        if (mounted.current) { setClip(new Blob(chunks, { type: capture.mimeType.split(';')[0] })); setRecording(false) }
      }
      capture.onerror = () => { if (capture.state === 'recording') capture.stop(); clearTimeout(timer.current); stream.current?.getTracks().forEach((track) => track.stop()); if (mounted.current) { setRecording(false); setError(bi('Recording failed. Try again or choose assisted verification.', 'রেকর্ডিং ব্যর্থ। আবার চেষ্টা করুন বা সহায়তাপ্রাপ্ত যাচাই বেছে নিন।')) } }
      setClip(null); setRecording(true)
      capture.start()
      timer.current = setTimeout(() => { if (capture.state === 'recording') capture.stop() }, 10000)
    })
  }
  const canBegin = !record || ['RETAKE_REQUIRED', 'MANUAL_REVIEW_REQUIRED'].includes(record.status) || record.status === 'CAPTURING' && new Date(record.challengeExpiresAt) <= new Date()
  return <section className="form-stack inline-form" aria-labelledby="identity-title">
    <h2 id="identity-title"><Bi en="Verify your identity before signing" bn="স্বাক্ষরের আগে পরিচয় যাচাই করুন" /></h2>
    <p><Term code={initial.signerRole} /> · <Bi en="Only you and the assigned mediator can access your private evidence. The other party cannot see it. A human reviews the check; this is not certified biometric verification." bn="শুধু আপনি ও নিযুক্ত মধ্যস্থতাকারী ব্যক্তিগত প্রমাণ দেখতে পারবেন। অন্য পক্ষ দেখতে পারবেন না। এটি মানুষের পর্যালোচনা; প্রত্যয়িত বায়োমেট্রিক যাচাই নয়।" /></p>
    <p>{bi(`Uploaded evidence is encrypted and automatically removed after ${initial.retentionDays} days. Review records remain in the case history. Use fictional documents in the demo.`, `আপলোড করা প্রমাণ এনক্রিপ্ট করা হয় এবং ${initial.retentionDays} দিন পর স্বয়ংক্রিয়ভাবে মুছে যায়। পর্যালোচনার রেকর্ড মামলার ইতিহাসে থাকে। ডেমোতে কাল্পনিক নথি ব্যবহার করুন।`)}</p>
    {record && <><p role="status"><strong>{bi(...statusText[record.status])}</strong></p>{record.reason && <p>{record.reason}</p>}</>}
    {canBegin && <form className="form-stack" onSubmit={(event) => { event.preventDefault(); action(async () => { setRecord(await api('/api/mediation-signing/verification/begin', { method: 'POST', body: { code, mode, consent } })); setClip(null); setIdFile(null) }) }}>
      <label htmlFor="identity-method"><Bi en="Verification method" bn="যাচাই পদ্ধতি" /></label>
      <select id="identity-method" value={mode} onChange={(event) => setMode(event.target.value)}>
        <option value="REMOTE_VIDEO">{bi('Short video with ID', 'পরিচয়পত্রসহ সংক্ষিপ্ত ভিডিও')}</option>
        <option value="IN_PERSON">{bi('Visit the mediator — no smartphone needed', 'মধ্যস্থতাকারীর কাছে যান — স্মার্টফোন প্রয়োজন নেই')}</option>
        <option value="ASSISTED">{bi('Assisted check on an office device', 'অফিসের ডিভাইসে সহায়তাপ্রাপ্ত যাচাই')}</option>
      </select>
      <label className="checkbox-label"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} required /><Bi en="I consent to this private identity review and its stated retention period." bn="আমি ব্যক্তিগত পরিচয় পর্যালোচনা ও উল্লিখিত সংরক্ষণকালে সম্মত।" /></label>
      <button type="submit" disabled={busy || !consent}><Bi en="Start identity check" bn="পরিচয় যাচাই শুরু করুন" /></button>
    </form>}
    {record?.status === 'CAPTURING' && !canBegin && <>
      <p className="safety-note"><strong><Bi en={record.challenge} bn={record.challengeBn} /></strong><br />{bi(`Expires ${when(record.challengeExpiresAt)}. Aim for five seconds; recording stops at ten seconds.`, `মেয়াদ ${when(record.challengeExpiresAt)}। প্রায় পাঁচ সেকেন্ড রেকর্ড করুন; দশ সেকেন্ডে স্বয়ংক্রিয়ভাবে বন্ধ হবে।`)}</p>
      <p><Bi en="If speech or head movement is difficult, choose a witnessed in-person or assisted check. Do not include your ID number in the recording." bn="কথা বলা বা মাথা নাড়ানো কঠিন হলে সরাসরি বা সহায়তাপ্রাপ্ত যাচাই বেছে নিন। ভিডিওতে পরিচয়পত্রের নম্বর বলবেন না।" /></p>
      <button type="button" className="secondary-button" disabled={busy || recording} onClick={() => action(async () => { setRecord(await api('/api/mediation-signing/verification/begin', { method: 'POST', body: { code, mode: 'IN_PERSON', consent: true } })); setClip(null) })}><Bi en="Use an in-person check instead" bn="সরাসরি যাচাই বেছে নিন" /></button>
      <video className="identity-video" ref={camera} autoPlay muted playsInline aria-label={bi('Live camera preview', 'ক্যামেরার সরাসরি দৃশ্য')} />
      <button type="button" disabled={busy || recording} onClick={startCamera}><Bi en={clip ? 'Record again' : 'Record challenge video'} bn={clip ? 'আবার রেকর্ড করুন' : 'নির্দেশনা অনুযায়ী ভিডিও রেকর্ড করুন'} /></button>
      {recording && <button type="button" onClick={() => recorder.current?.stop()}><Bi en="Stop recording" bn="রেকর্ডিং বন্ধ করুন" /></button>}
      {clip && <video className="identity-video" ref={playback} controls playsInline aria-label={bi('Review your recording before submitting', 'জমা দেওয়ার আগে রেকর্ডিং দেখুন')} />}
      <label htmlFor="identity-document-type"><Bi en="Identity document type" bn="পরিচয়পত্রের ধরন" /></label>
      <select id="identity-document-type" value={documentType} onChange={(event) => setDocumentType(event.target.value)}>{['PASSPORT', 'NATIONAL_ID', 'OTHER'].map((type) => <option key={type} value={type}>{type === 'PASSPORT' ? bi('Passport', 'পাসপোর্ট') : type === 'NATIONAL_ID' ? bi('National ID', 'জাতীয় পরিচয়পত্র') : bi('Other identity document', 'অন্য পরিচয়পত্র')}</option>)}</select>
      <label htmlFor="identity-document"><Bi en="Upload ID (PNG, JPEG or PDF, up to 2 MB)" bn="পরিচয়পত্র আপলোড (PNG, JPEG বা PDF, সর্বোচ্চ ২ MB)" /></label>
      <input id="identity-document" type="file" accept="image/png,image/jpeg,application/pdf" onChange={(event) => setIdFile(event.target.files[0] ?? null)} />
      <button type="button" disabled={busy || recording || !clip || !idFile} onClick={() => action(async () => {
        if (idFile.size > 2 * 1024 * 1024 || clip.size > 4 * 1024 * 1024) throw new Error(bi('ID must be below 2 MB and video below 4 MB.', 'পরিচয়পত্র ২ MB ও ভিডিও ৪ MB-এর কম হতে হবে।'))
        await api('/api/mediation-signing/verification/evidence/ID', { method: 'POST', audio: idFile, headers: { 'X-Signing-Code': code } })
        await api('/api/mediation-signing/verification/evidence/VIDEO', { method: 'POST', audio: clip, headers: { 'X-Signing-Code': code } })
        setRecord(await api('/api/mediation-signing/verification/submit', { method: 'POST', body: { code, documentType } }))
        setClip(null); setIdFile(null)
      })}><Bi en="Submit for mediator review" bn="মধ্যস্থতাকারীর পর্যালোচনায় জমা দিন" /></button>
    </>}
    {record && ['IN_PERSON', 'ASSISTED'].includes(record.mode) && record.status === 'PENDING_REVIEW' && <p><Bi en="Bring your original identity document to the mediator. An authorised office can provide a device. You review and sign the document yourself; the helper cannot sign for you." bn="মূল পরিচয়পত্র নিয়ে মধ্যস্থতাকারীর কাছে যান। অনুমোদিত অফিস ডিভাইস দিতে পারে। আপনি নিজে নথি পড়ে স্বাক্ষর করবেন; সহায়তাকারী আপনার হয়ে স্বাক্ষর করতে পারবেন না।" /></p>}
    <button type="button" className="secondary-button" disabled={busy || recording} onClick={() => action(async () => {
      const result = await api('/api/mediation-signing/verification/state', { method: 'POST', body: { code } })
      setRecord(result.verification)
      if (result.verification?.status === 'VERIFIED') onApproved()
    })}><Bi en="Refresh identity status / continue" bn="যাচাইয়ের অবস্থা দেখুন / এগিয়ে যান" /></button>
    {error && <p role="alert" className="error">{error}</p>}
  </section>
}

function ReviewCard({ row, token, applicationId, onChanged }) {
  const record = row.verification
  const [decision, setDecision] = useState(record?.status === 'VERIFIED' ? 'RETAKE_REQUIRED' : 'VERIFIED')
  const [reason, setReason] = useState('')
  const [checks, setChecks] = useState({ idReviewed: false, personMatched: false, challengeChecked: false })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!record) return <p><Term code={row.signerRole} /> · <Bi en="Identity check not started" bn="পরিচয় যাচাই শুরু হয়নি" /></p>
  return <article className="form-stack inline-form">
    <h4><Term code={row.signerRole} /> · {bi(...statusText[record.status])}</h4>
    <p>{record.mode.replaceAll('_', ' ')} · {record.documentType ?? bi('Original ID must be checked in person', 'মূল পরিচয়পত্র সরাসরি যাচাই করতে হবে')} {record.reviewedAt && `· ${when(record.reviewedAt)}`}</p>
    {record.reason && <p>{record.reason}</p>}
    {record.challenge && <p><strong><Bi en={record.challenge} bn={record.challengeBn} /></strong></p>}
    {['idEvidenceId', 'videoEvidenceId', 'signatureEvidenceId'].map((field) => record[field] ? <EvidencePreview key={record[field]} token={token} path={`/api/applications/${applicationId}/mediation/identity/evidence/${record[field]}`} label={field === 'idEvidenceId' ? bi('Private identity document', 'ব্যক্তিগত পরিচয়পত্র') : field === 'videoEvidenceId' ? bi('Private challenge video', 'ব্যক্তিগত যাচাই ভিডিও') : bi('Uploaded signature image', 'আপলোড করা স্বাক্ষর')} /> : null)}
    {!row.usedAt && ['PENDING_REVIEW', 'VERIFIED'].includes(record.status) && <form className="form-stack" onSubmit={async (event) => {
      event.preventDefault(); setBusy(true); setError('')
      try { await api(`/api/applications/${applicationId}/mediation/identity/review`, { token, method: 'POST', body: { verificationId: record.id, status: decision, reason, ...checks } }); await onChanged() }
      catch (failure) { setError(failure.message) } finally { setBusy(false) }
    }}>
      <label htmlFor={`decision-${record.id}`}><Bi en="Identity review decision" bn="পরিচয় যাচাইয়ের সিদ্ধান্ত" /></label>
      <select id={`decision-${record.id}`} value={decision} onChange={(event) => setDecision(event.target.value)}>
        {record.status !== 'VERIFIED' && <option value="VERIFIED">{bi('Approve identity check', 'পরিচয় যাচাই অনুমোদন')}</option>}
        <option value="RETAKE_REQUIRED">{bi('Request new evidence / revoke approval', 'নতুন প্রমাণ চাই / অনুমোদন বাতিল')}</option>
        <option value="MANUAL_REVIEW_REQUIRED">{bi('Require assisted or in-person check', 'সহায়তাপ্রাপ্ত বা সরাসরি যাচাই প্রয়োজন')}</option>
      </select>
      {decision === 'VERIFIED' && Object.entries({ idReviewed: ['I checked the original or submitted identity document.', 'আমি মূল বা জমা দেওয়া পরিচয়পত্র পরীক্ষা করেছি।'], personMatched: ['I checked that the person and identity document match the party named in this case.', 'আমি নিশ্চিত করেছি যে ব্যক্তি ও পরিচয়পত্র এই মামলার সংশ্লিষ্ট পক্ষের সঙ্গে মিলে।'], challengeChecked: [record.mode === 'REMOTE_VIDEO' ? 'I watched the fresh challenge video and checked the spoken digits and movement.' : 'The party was present, consented, and I witnessed the identity check. Record the venue and any helper in the reason.', record.mode === 'REMOTE_VIDEO' ? 'আমি নতুন ভিডিওতে নির্দেশিত সংখ্যা ও নড়াচড়া পরীক্ষা করেছি।' : 'পক্ষ উপস্থিত ছিলেন, সম্মতি দিয়েছেন এবং আমি যাচাই প্রত্যক্ষ করেছি। কারণের ঘরে স্থান ও সহায়তাকারীর তথ্য লিখুন।'] }).map(([field, labels]) => <label className="checkbox-label" key={field}><input type="checkbox" checked={checks[field]} required onChange={(event) => setChecks((current) => ({ ...current, [field]: event.target.checked }))} />{bi(...labels)}</label>)}
      <label htmlFor={`review-reason-${record.id}`}><Bi en="Review reason / witnessed details (no full ID number)" bn="পর্যালোচনার কারণ / প্রত্যক্ষ যাচাইয়ের বিবরণ (পূর্ণ পরিচয়পত্র নম্বর নয়)" /></label>
      <textarea id={`review-reason-${record.id}`} minLength={10} maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} required />
      <button type="submit" disabled={busy || decision === 'VERIFIED' && record.status === 'VERIFIED'}><Bi en="Save identity decision" bn="পরিচয় যাচাইয়ের সিদ্ধান্ত সংরক্ষণ" /></button>
    </form>}
    {error && <p role="alert" className="error">{error}</p>}
  </article>
}

export function MediatorIdentityVerification({ applicationId, token }) {
  const [rows, setRows] = useState([])
  const [error, setError] = useState('')
  async function refresh() {
    setError('')
    try { setRows(await api(`/api/applications/${applicationId}/mediation/identity`, { token })) } catch (failure) { setError(failure.message) }
  }
  useEffect(() => {
    const controller = new AbortController()
    api(`/api/applications/${applicationId}/mediation/identity`, { token, signal: controller.signal }).then(setRows).catch((failure) => { if (failure.name !== 'AbortError') setError(failure.message) })
    return () => controller.abort()
  }, [applicationId, token])
  return <section aria-labelledby="mediator-identity-title" className="form-stack">
    <h3 id="mediator-identity-title"><Bi en="Party identity review" bn="পক্ষের পরিচয় পর্যালোচনা" /></h3>
    <p><Bi en="Each party must complete a separate check before signing. For people without a smartphone, open the party signing page on an office device, let the party enter their code and consent, and choose an in-person or assisted check. Compare the original ID and person before approval." bn="স্বাক্ষরের আগে প্রত্যেক পক্ষের আলাদা যাচাই প্রয়োজন। স্মার্টফোন না থাকলে অফিসের ডিভাইসে স্বাক্ষরের পৃষ্ঠা খুলুন; পক্ষ নিজে কোড ও সম্মতি দিয়ে সরাসরি বা সহায়তাপ্রাপ্ত যাচাই বেছে নেবেন। অনুমোদনের আগে মূল পরিচয়পত্র ও ব্যক্তিকে মিলিয়ে দেখুন।" /></p>
    <button type="button" className="secondary-button" onClick={refresh}><Bi en="Refresh identity reviews" bn="পরিচয় পর্যালোচনা হালনাগাদ করুন" /></button>
    {rows.map((row) => <ReviewCard key={row.verification?.id ?? row.signerRole} row={row} token={token} applicationId={applicationId} onChanged={refresh} />)}
    {error && <p role="alert" className="error">{error}</p>}
  </section>
}

export function SignatureImageUpload({ code, onBusy }) {
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  return <div className="form-stack">
    <label htmlFor="party-signature-image"><Bi en="Optional signature image (PNG/JPEG, up to 2 MB)" bn="ঐচ্ছিক স্বাক্ষরের ছবি (PNG/JPEG, সর্বোচ্চ ২ MB)" /></label>
    <input id="party-signature-image" type="file" accept="image/png,image/jpeg" disabled={busy} onChange={async (event) => {
      const file = event.target.files[0]
      if (!file) return
      setBusy(true); onBusy(true); setError(''); setMessage('')
      try {
        if (file.size > 2 * 1024 * 1024) throw new Error(bi('Choose an image below 2 MB.', '২ MB-এর কম ছবি বেছে নিন।'))
        await api('/api/mediation-signing/verification/evidence/SIGNATURE', { method: 'POST', audio: file, headers: { 'X-Signing-Code': code } })
        setMessage(bi('Signature image uploaded privately. Confirm the draft below to sign it.', 'স্বাক্ষরের ছবি ব্যক্তিগতভাবে আপলোড হয়েছে। স্বাক্ষর করতে নিচে খসড়ায় সম্মতি দিন।'))
      } catch (failure) { setError(failure.message) } finally { setBusy(false); onBusy(false) }
    }} />
    <p className="muted"><Bi en="An image supports your signature record. The Sign button records your cryptographic signature on this exact approved draft." bn="ছবি আপনার স্বাক্ষরের রেকর্ডের সহায়ক। স্বাক্ষর বোতাম এই নির্দিষ্ট অনুমোদিত খসড়ায় ক্রিপ্টোগ্রাফিক স্বাক্ষর নথিভুক্ত করে।" /></p>
    {message && <p role="status">{message}</p>}{error && <p role="alert" className="error">{error}</p>}
  </div>
}
