import { useEffect, useState } from 'react'
import { api } from '../services/api.js'
import { AddForm, Badge, Bi, Panel, Term, bi, num, say } from '../components/Bi.jsx'

const sampleDocuments = [
  ['identity-note.txt', 'Applicant identity evidence', 'READABLE'],
  ['land-deed-unreadable.txt', 'Land record or deed', 'UNREADABLE'],
  ['plot-location.txt', 'Location or plot details', 'READABLE'],
  ['village-meeting.txt', 'Other context', 'READABLE'],
  ['free-service-receipt.txt', 'Other context', 'READABLE'],
  ['map-note.txt', 'Other context', 'READABLE'],
]
const checklist = {
  FAMILY: ['Applicant identity evidence', 'Relationship record', 'Relevant communication'],
  LAND: ['Applicant identity evidence', 'Land record or deed', 'Location or plot details', 'Witness or other supporting record'],
  LABOUR: ['Applicant identity evidence', 'Employment or wage record', 'Employer communication'],
  CRIMINAL: ['Applicant identity evidence', 'Police or court document', 'Incident chronology'],
  OTHER: ['Applicant identity evidence', 'Problem chronology', 'Available supporting record'],
}
const itemNames = {
  'Applicant identity evidence': 'আবেদনকারীর পরিচয়ের প্রমাণ', 'Relationship record': 'সম্পর্কের প্রমাণ', 'Relevant communication': 'প্রাসঙ্গিক যোগাযোগ',
  'Land record or deed': 'জমির রেকর্ড বা দলিল', 'Location or plot details': 'অবস্থান বা দাগের তথ্য', 'Witness or other supporting record': 'সাক্ষী বা অন্য সহায়ক রেকর্ড',
  'Employment or wage record': 'চাকরি বা মজুরির রেকর্ড', 'Employer communication': 'মালিকের সাথে যোগাযোগ', 'Police or court document': 'পুলিশ বা আদালতের কাগজ',
  'Incident chronology': 'ঘটনার ক্রম', 'Problem chronology': 'সমস্যার ক্রম', 'Available supporting record': 'প্রাপ্ত সহায়ক রেকর্ড', 'Other context': 'অন্যান্য প্রসঙ্গ',
}
const item = (name) => itemNames[name] ? <Bi en={name} bn={itemNames[name]} /> : name

export default function DocumentReview({ applicationId, caseType, documents, token, onChanged, readOnly = false }) {
  const [briefing, setBriefing] = useState(null)
  const [files, setFiles] = useState([])
  const [checklistItem, setChecklistItem] = useState('Other context')
  const [qualityState, setQualityState] = useState('PENDING_REVIEW')
  const [approvalReason, setApprovalReason] = useState('')
  const [sourceText, setSourceText] = useState(null)
  const [sourceBusy, setSourceBusy] = useState(false)
  const [sourceError, setSourceError] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    api(`/api/applications/${applicationId}/briefing`, { token, signal: controller.signal })
      .then(setBriefing).catch((failure) => { if (failure.name !== 'AbortError') setError(failure.message) })
    return () => controller.abort()
  }, [applicationId, token])

  async function upload(filename, textContent, checklistName, quality) {
    if (!/^[\w .()-]+\.txt$/i.test(filename) || new TextEncoder().encode(textContent).byteLength > 50000 || !textContent.trim()) throw new Error(bi('Use a non-empty fictional .txt file under 50 KB.', 'লেখা আছে এমন একটি নমুনা .txt ফাইল দিন, যার আকার ৫০ কেবির কম।'))
    return api(`/api/applications/${applicationId}/documents`, { token, method: 'POST', body: {
      label: filename.replace(/\.txt$/i, '').replaceAll('-', ' '), filename, textContent, checklistItem: checklistName, qualityState: quality,
    } })
  }

  async function uploadSelected(event) {
    event.preventDefault()
    setError(''); setNotice(''); setBusy(true)
    try {
      for (const file of files) await upload(file.name, await file.text(), checklistItem, qualityState)
      setFiles([])
      setNotice(bi(`${files.length} file(s) uploaded.`, `${num(files.length)}টি ফাইল আপলোড হয়েছে।`))
      onChanged()
    } catch (failure) { setError(failure.message) } finally { setBusy(false) }
  }

  async function uploadSamples() {
    setError(''); setNotice(''); setBusy(true)
    try {
      for (const [filename, checklistName, quality] of sampleDocuments) {
        const response = await fetch(`/samples/${filename}`, { cache: 'no-store' })
        if (!response.ok) throw new Error(bi(`Could not load sample ${filename}.`, `নমুনা ${filename} লোড হয়নি।`))
        await upload(filename, await response.text(), checklistName, quality)
      }
      setNotice(bi('Six fictional documents uploaded. The deed is unreadable and the witness item is missing on purpose.', 'ছয়টি নমুনা নথি আপলোড হয়েছে। পরীক্ষার জন্য দলিলটি পড়া যায় না এবং সাক্ষীর নথি রাখা হয়নি।'))
      onChanged()
    } catch (failure) { setError(failure.message) } finally { setBusy(false) }
  }

  async function generate() {
    setError(''); setNotice(''); setBusy(true)
    try {
      const result = await api(`/api/applications/${applicationId}/briefing`, { token, method: 'POST' })
      setBriefing(result)
      setSourceText(null)
      setNotice(bi('Draft briefing ready. Check every source before approving.', 'নথির সারসংক্ষেপের খসড়া তৈরি হয়েছে। অনুমোদনের আগে প্রতিটি তথ্যের উৎস যাচাই করুন।'))
      onChanged()
    } catch (failure) { setError(failure.message) } finally { setBusy(false) }
  }

  async function showSource(source) {
    if (sourceText?.sourceId === source.sourceId) { setSourceText(null); return }
    setSourceError(''); setSourceBusy(true)
    try {
      const result = await api(`/api/documents/${source.documentId}/versions/${source.version}/text`, { token })
      setSourceText({ ...result, sourceId: source.sourceId, label: source.label, line: source.line })
    } catch (failure) { setSourceError(failure.message) } finally { setSourceBusy(false) }
  }

  async function approve(event) {
    event.preventDefault()
    setError(''); setNotice(''); setBusy(true)
    try {
      await api(`/api/applications/${applicationId}/briefing/approve`, { token, method: 'POST', body: { reason: approvalReason } })
      setBriefing(await api(`/api/applications/${applicationId}/briefing`, { token }))
      setApprovalReason('')
      setNotice(bi('Briefing accuracy approved. This is not a legal decision.', 'সারসংক্ষেপটি নথির সঙ্গে মিলেছে বলে অনুমোদন দেওয়া হয়েছে। এটি মামলার আইনি সিদ্ধান্ত নয়।'))
      onChanged()
    } catch (failure) { setError(failure.message) } finally { setBusy(false) }
  }

  const generated = briefing && briefing.status !== 'NOT_GENERATED'
  const sourceById = new Map((briefing?.citations || []).map((source) => [source.sourceId, source]))

  return <Panel id="briefing-title" en="Document briefing" bn="নথির সারসংক্ষেপ" hint={generated ? say(briefing.status) : bi('Not generated', 'তৈরি হয়নি')}>
    <p className="muted"><Bi en="Plain-text fictional files only (50 KB). Each briefing point quotes a readable source line. Document tags and content require officer verification; unreadable text is never guessed." bn="শুধু ৫০ কেবি পর্যন্ত নমুনা টেক্সট ফাইল নেওয়া যাবে। সারসংক্ষেপের প্রতিটি তথ্য পড়া যায় এমন উৎসের লাইন থেকে নেওয়া। নথির ধরন ও বিষয়বস্তু কর্মকর্তা যাচাই করবেন; অপাঠযোগ্য লেখা অনুমান করা হবে না।" /></p>
    {error && <p role="alert" className="error">{error}</p>}
    {notice && <p role="status" className="success">{notice}</p>}
    <dl className="details compact">
      <div><dt><Bi en="Case type" bn="মামলার ধরন" /></dt><dd>{caseType ? <Term code={caseType} /> : bi('Not recorded', 'লেখা নেই')}</dd></div>
      <div><dt><Bi en="Files" bn="ফাইল" /></dt><dd>{num(documents.length)}</dd></div>
      {caseType && !generated && <div><dt><Bi en="Checklist" bn="তালিকা" /></dt><dd><ul className="chips">{checklist[caseType]?.map((name) => <li key={name}>{item(name)}</li>)}</ul></dd></div>}
    </dl>
    {!readOnly && <div className="choice-row">
      <button type="button" onClick={generate} disabled={busy || !caseType}><Bi en="Generate briefing" bn="সারসংক্ষেপ তৈরি করুন" /></button>
      {caseType === 'LAND' && <button type="button" className="secondary-button" onClick={uploadSamples} disabled={busy || documents.some(({ label }) => label === 'identity note')}><Bi en="Upload six fictional sample documents" bn="ছয়টি নমুনা নথি আপলোড" /></button>}
    </div>}
    {!readOnly && <AddForm en="Upload text files" bn="টেক্সট ফাইল আপলোড">
      <form onSubmit={uploadSelected} className="form-stack inline-form">
        <label htmlFor="document-files"><Bi en="Text files" bn="টেক্সট ফাইল" /></label><input id="document-files" name="documentFiles" type="file" accept=".txt,text/plain" multiple onChange={(event) => setFiles(Array.from(event.target.files))} required />
        <label htmlFor="document-checklist"><Bi en="Checklist item" bn="তালিকার বিষয়" /></label><select id="document-checklist" name="checklistItem" autoComplete="off" value={checklistItem} onChange={(event) => setChecklistItem(event.target.value)}>{['Other context', ...(checklist[caseType] || [])].map((name) => <option key={name} value={name}>{itemNames[name] ? bi(name, itemNames[name]) : name}</option>)}</select>
        <label htmlFor="document-quality"><Bi en="Quality" bn="মান" /></label><select id="document-quality" name="qualityState" autoComplete="off" value={qualityState} onChange={(event) => setQualityState(event.target.value)}>{['PENDING_REVIEW', 'READABLE', 'UNREADABLE'].map((code) => <option key={code} value={code}>{say(code)}</option>)}</select>
        <button type="submit" className="secondary-button" disabled={busy || files.length === 0}><Bi en="Upload" bn="আপলোড" /></button>
      </form>
    </AddForm>}
    {generated && <div className="version-history">
      <h3><Bi en="Briefing" bn="সারসংক্ষেপ" /> <Badge code={briefing.status} /></h3>
      <p>{briefing.summary} <small className="muted">({briefing.model})</small></p>
      <h3><Bi en="Points and sources" bn="তথ্য ও উৎস" /></h3>
      {briefing.points?.length ? <ol>{briefing.points.map((point, index) => {
        const source = sourceById.get(point.sourceId)
        return <li key={`${point.sourceId}-${index}`}><p>{point.text}</p><small className="muted"><Bi en="Source" bn="উৎস" />: {source ? bi(`${source.label}, version ${source.version}, line ${source.line}`, `${source.label}, সংস্করণ ${num(source.version)}, লাইন ${num(source.line)}`) : bi('Source unavailable—regenerate', 'উৎস পাওয়া যাচ্ছে না—আবার তৈরি করুন')}</small>{!readOnly && source?.documentId && <button type="button" className="text-button" disabled={sourceBusy} onClick={() => showSource(source)} aria-expanded={sourceText?.sourceId === source.sourceId}>{sourceText?.sourceId === source.sourceId ? bi('Close source', 'উৎস বন্ধ করুন') : bi(`Open source ${source.label}, line ${source.line}`, `${source.label} উৎসের লাইন ${num(source.line)} খুলুন`)}</button>}</li>
      })}</ol> : briefing.citations?.length ? <ol>{briefing.citations.map((citation) => <li key={`${citation.documentVersionId}-${citation.line}`}><strong>{bi(`${citation.label}, line ${citation.line}`, `${citation.label}, লাইন ${num(citation.line)}`)}</strong> · {citation.excerpt}</li>)}</ol> : <p><Bi en="No readable lines." bn="পড়া যায় এমন কোনো লেখা পাওয়া যায়নি।" /></p>}
      {sourceError && <p role="alert" className="error">{sourceError}</p>}
      {sourceText && <div id="briefing-source-text" className="version-history"><h4>{bi(`${sourceText.label}, version ${sourceText.version}`, `${sourceText.label}, সংস্করণ ${num(sourceText.version)}`)}</h4>{sourceText.version !== sourceText.currentVersion && <p role="alert"><Bi en="A newer version exists. Regenerate the briefing before approval." bn="নতুন সংস্করণ আছে। অনুমোদনের আগে সারসংক্ষেপ আবার তৈরি করুন।" /></p>}<ol>{sourceText.textContent.split(/\r?\n/).map((line, index) => <li key={index} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{index + 1 === sourceText.line ? <strong>{line || ' '}</strong> : line || ' '}</li>)}</ol></div>}
      <h3><Bi en="Checklist comparison" bn="নথির তালিকার তুলনা" /></h3>
      {briefing.checklist?.length ? <ul className="plain-list">{briefing.checklist.map((row) => <li key={row.item}><strong>{item(row.item)}</strong> · {row.status === 'MISSING' ? bi('Missing', 'নেই') : row.status === 'UNCERTAIN' ? bi('Tagged document unreadable or awaiting review', 'চিহ্নিত নথি অপাঠযোগ্য বা যাচাইয়ের অপেক্ষায়') : bi('Tagged readable document; verify the match', 'পাঠযোগ্য নথি চিহ্নিত; মিল যাচাই করুন')}{row.documentLabels?.length > 0 && <p className="muted"><Bi en="Tagged documents" bn="চিহ্নিত নথি" />: {row.documentLabels.join(' · ')}</p>}</li>)}</ul> : <p>{briefing.missing?.length ? briefing.missing.map((name, index) => <span key={name}>{index ? ' · ' : ''}{item(name)}</span>) : bi('No missing item recorded', 'অনুপস্থিত নথি নথিভুক্ত নেই')}</p>}
      <h3><Bi en="Unreadable or uncertain" bn="অপাঠযোগ্য বা অনিশ্চিত" /></h3><p>{briefing.unreadable.join(' · ') || bi('Nothing', 'কিছু নেই')}</p>
      {briefing.limitedSources?.length > 0 && <p role="status"><Bi en="Draft coverage is limited to the first 12 non-empty lines and first 240 characters per line. Verify the full source before approval:" bn="খসড়ায় প্রতিটি নথির প্রথম ১২টি লেখাযুক্ত লাইন ও প্রতিটি লাইনের প্রথম ২৪০টি অক্ষর নেওয়া হয়েছে। অনুমোদনের আগে পুরো নথি যাচাই করুন:" /> {briefing.limitedSources.join(' · ')}</p>}
      {!readOnly && briefing.status === 'PROPOSED' && <form onSubmit={approve} className="form-stack inline-form"><label htmlFor="briefing-reason"><Bi en="Officer verification reason" bn="যাচাইয়ের কারণ" /></label><textarea id="briefing-reason" name="briefingReason" autoComplete="off" value={approvalReason} onChange={(event) => setApprovalReason(event.target.value)} minLength="10" maxLength="500" required /><button type="submit" disabled={busy}><Bi en="Approve briefing accuracy only" bn="শুধু নথির সঙ্গে মিলেছে কি না অনুমোদন করুন" /></button></form>}
    </div>}
  </Panel>
}
