import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { api } from '../services/api.js'
import { listDrafts, loadDraft, removeDraft, saveDraft } from '../utils/offlineDrafts.js'
import { bi, num, say } from '../components/Bi.jsx'

const blank = () => ({ applicantName: '', translatorName: '', typistName: '', helperPhone: '', originalLanguage: 'Marma', originalStatement: '', translatedStatement: '', caseType: 'LAND', consentAttestation: '', originalConfirmed: false, translationConfirmed: false, contactChannel: 'IN_PERSON', contactValue: '', safeTime: '' })
const checklist = {
  FAMILY: ['Applicant identity evidence', 'Relationship record', 'Relevant communication'],
  LAND: ['Applicant identity evidence', 'Land record or deed', 'Location or plot details', 'Witness or other supporting record'],
  LABOUR: ['Applicant identity evidence', 'Employment or wage record', 'Employer communication'],
  CRIMINAL: ['Applicant identity evidence', 'Police or court document', 'Incident chronology'],
  OTHER: ['Applicant identity evidence', 'Problem chronology', 'Available supporting record'],
}
const itemsBn = {
  'Applicant identity evidence': 'আবেদনকারীর পরিচয়ের প্রমাণ', 'Relationship record': 'সম্পর্কের প্রমাণ', 'Relevant communication': 'প্রাসঙ্গিক যোগাযোগ',
  'Land record or deed': 'জমির রেকর্ড বা দলিল', 'Location or plot details': 'অবস্থান বা দাগের তথ্য', 'Witness or other supporting record': 'সাক্ষী বা অন্য সহায়ক রেকর্ড',
  'Employment or wage record': 'চাকরি বা মজুরির রেকর্ড', 'Employer communication': 'মালিকের সাথে যোগাযোগ', 'Police or court document': 'পুলিশ বা আদালতের কাগজ',
  'Incident chronology': 'ঘটনার ক্রম', 'Problem chronology': 'সমস্যার ক্রম', 'Available supporting record': 'প্রাপ্ত সহায়ক রেকর্ড',
}
const emptyDraft = () => crypto.randomUUID()

export default function AssistedIntake({ session }) {
  const ownerId = String(session.user.id)
  const [passphrase, setPassphrase] = useState('')
  const [form, setForm] = useState(blank)
  const [draftId, setDraftId] = useState(emptyDraft)
  const [mode, setMode] = useState('CREATE')
  const [intakeTask, setIntakeTask] = useState('NEW')
  const [applicationId, setApplicationId] = useState('')
  const [baseVersion, setBaseVersion] = useState(null)
  const [startedAt, setStartedAt] = useState(() => new Date().toISOString())
  const [drafts, setDrafts] = useState([])
  const [online, setOnline] = useState(navigator.onLine)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [receipt, setReceipt] = useState(null)
  const [conflict, setConflict] = useState(null)
  const [resolutionReason, setResolutionReason] = useState('')
  const [saving, setSaving] = useState(false)
  const saveInFlight = useRef(Promise.resolve())

  const refreshDrafts = useCallback(async () => { setDrafts(await listDrafts(ownerId)) }, [ownerId])
  useEffect(() => { listDrafts(ownerId).then(setDrafts).catch(() => setError(bi('Local draft storage is unavailable.', 'এই ডিভাইসে খসড়া রাখার জায়গা নেই।'))) }, [ownerId])

  useEffect(() => {
    if (passphrase.length < 8 || !(form.applicantName || form.originalStatement)) return
    const timer = setTimeout(() => {
      setSaving(true)
      saveInFlight.current = saveDraft({ id: draftId, ownerId, status: 'DRAFT', passphrase,
        value: { kind: 'DRAFT', mode, form, applicationId, baseVersion, startedAt } })
        .then(refreshDrafts).catch(() => setError(bi('Could not save the encrypted local draft.', 'এনক্রিপ্ট করা খসড়া সংরক্ষণ হয়নি।'))).finally(() => setSaving(false))
    }, 450)
    return () => clearTimeout(timer)
  }, [form, passphrase, draftId, ownerId, mode, applicationId, baseVersion, startedAt, refreshDrafts])

  function change(field, value) { setForm((current) => ({ ...current, [field]: value })) }

  function reset() {
    setForm(blank())
    setDraftId(emptyDraft())
    setMode('CREATE')
    setIntakeTask('NEW')
    setApplicationId('')
    setBaseVersion(null)
    setStartedAt(new Date().toISOString())
    setConflict(null)
  }

  async function openLocal(id) {
    setError('')
    try {
      const row = await loadDraft(id, ownerId, passphrase)
      if (row.status === 'DRAFT') {
        setDraftId(id)
        setForm(row.value.form)
        setMode(row.value.mode)
        setApplicationId(row.value.applicationId)
        setBaseVersion(row.value.baseVersion)
        setStartedAt(row.value.startedAt)
        setNotice(bi('Encrypted draft unlocked and integrity verified.', 'খসড়া খোলা হয়েছে, সত্যতা যাচাই হয়েছে।'))
      } else if (row.status === 'CONFLICT') {
        setConflict({ id, ...row.value.conflict })
      } else setNotice(bi('Queued item verified. Use Sync now when connected.', 'পাঠানোর অপেক্ষায় থাকা খসড়াটি যাচাই হয়েছে। ইন্টারনেট সংযোগ পেলে ‘এখন সিঙ্ক করুন’ চাপুন।'))
    } catch (failure) { setError(failure.message) }
  }

  const syncQueued = useCallback(async (secret = passphrase) => {
    if (secret.length < 8 || !navigator.onLine) return
    setError('')
    for (const row of await listDrafts(ownerId)) {
      if (row.status !== 'QUEUED') continue
      let saved
      try {
        saved = await loadDraft(row.id, ownerId, secret)
        const { kind, payload, applicationId: target } = saved.value
        const result = await api(kind === 'CREATE' ? '/api/assisted' : `/api/assisted/${target}/revisions`, { token: session.token, method: 'POST', body: payload })
        await removeDraft(row.id)
        setReceipt(result)
        setNotice(kind === 'CREATE' && !result.lookupCode
          ? bi(`${result.applicationId} was already synced. Its one-time code cannot be shown again; ask an authorised officer through a safe route if needed.`, `${result.applicationId} আগেই সিঙ্ক হয়েছে। এককালীন কোড আর দেখানো যাবে না; দরকার হলে নিরাপদ পথে অনুমোদিত কর্মকর্তাকে জিজ্ঞেস করুন।`)
          : bi(`${kind === 'CREATE' ? 'Created' : 'Updated'} ${result.applicationId}; encrypted queued copy purged.`, `${result.applicationId} ${kind === 'CREATE' ? 'তৈরি' : 'হালনাগাদ'} হয়েছে; এই ডিভাইসে অপেক্ষায় রাখা সুরক্ষিত কপিটি মুছে ফেলা হয়েছে।`))
      } catch (failure) {
        if (failure.status === 409 && failure.data?.kind === 'CONFLICT' && saved) {
          await saveDraft({ id: row.id, ownerId, status: 'CONFLICT', passphrase: secret, value: { ...saved.value, conflict: failure.data, resolutionMutationId: crypto.randomUUID() } })
          setConflict({ id: row.id, ...failure.data })
          setNotice(bi('A version conflict needs human review. Both versions are shown below.', 'দুটি সংস্করণের তথ্য মিলছে না। নিচে দুটিই দেখানো হয়েছে; একজন কর্মীকে যাচাই করতে হবে।'))
        } else { setError(failure.message || bi('Sync is waiting for a working connection.', 'তথ্য পাঠাতে ইন্টারনেট সংযোগ দরকার।')); break }
      }
    }
    await refreshDrafts()
  }, [ownerId, passphrase, refreshDrafts, session.token])

  useEffect(() => {
    const disconnected = () => setOnline(false)
    const connected = () => { setOnline(true); if (passphrase.length >= 8) syncQueued(passphrase).catch(() => {}) }
    window.addEventListener('offline', disconnected)
    window.addEventListener('online', connected)
    return () => { window.removeEventListener('offline', disconnected); window.removeEventListener('online', connected) }
  }, [passphrase, syncQueued])

  async function queue(event) {
    event.preventDefault()
    setError('')
    if (passphrase.length < 8) { setError(bi('Set a local passphrase of at least 8 characters before saving sensitive draft text.', 'সংবেদনশীল খসড়া রাখার আগে কমপক্ষে ৮ অক্ষরের পাসফ্রেজ দিন।')); return }
    try {
      await saveInFlight.current
      const clientMutationId = crypto.randomUUID()
      const payload = mode === 'CREATE' ? {
        temporaryId: draftId, clientMutationId, offlineCreatedAt: startedAt,
        applicantName: form.applicantName, translatorName: form.translatorName, typistName: form.typistName,
        ...(form.helperPhone ? { helperPhone: form.helperPhone } : {}), originalLanguage: form.originalLanguage,
        originalStatement: form.originalStatement, translatedStatement: form.translatedStatement,
        caseType: form.caseType, consentAttestation: form.consentAttestation,
        originalConfirmed: form.originalConfirmed, translationConfirmed: form.translationConfirmed,
        contactChannel: form.contactChannel, ...(form.contactChannel === 'PHONE' ? { contactValue: form.contactValue } : {}),
        ...(form.safeTime ? { safeTime: form.safeTime } : {}),
      } : { temporaryId: draftId, clientMutationId, baseVersion,
        originalStatement: form.originalStatement, translatedStatement: form.translatedStatement,
        originalConfirmed: form.originalConfirmed, translationConfirmed: form.translationConfirmed }
      await saveDraft({ id: draftId, ownerId, status: 'QUEUED', passphrase, value: { kind: mode, payload, applicationId } })
      setNotice(bi(`Queued with temporary ID ${draftId}. It will sync once connected.`, `খসড়াটি অস্থায়ী নম্বর ${draftId} দিয়ে এই ডিভাইসে রাখা হয়েছে। ইন্টারনেট সংযোগ পেলে পাঠানো হবে।`))
      reset()
      await refreshDrafts()
      if (navigator.onLine) await syncQueued()
    } catch (failure) { setError(failure.message) }
  }

  async function openRevision(event) {
    event.preventDefault()
    setError('')
    try {
      const record = await api(`/api/assisted/${applicationId.trim().toUpperCase()}`, { token: session.token })
      setMode('REVISION')
      setIntakeTask('CORRECTION')
      setApplicationId(record.applicationId)
      setBaseVersion(record.version)
      setDraftId(emptyDraft())
      setStartedAt(new Date().toISOString())
      setForm({ ...blank(), originalStatement: record.originalStatement, translatedStatement: record.translatedStatement,
        originalConfirmed: record.originalConfirmed, translationConfirmed: record.translationConfirmed })
      setNotice(bi(`Limited correction opened at version ${record.version}. Audit check: ${record.integrityValid ? 'valid' : 'check required'}.`, `সংস্করণ ${num(record.version)} সংশোধনের জন্য খোলা হয়েছে। রেকর্ডের অখণ্ডতা ${record.integrityValid ? 'যাচাই হয়েছে' : 'যাচাই করা দরকার'}।`))
    } catch (failure) { setError(failure.message) }
  }

  async function resolve(choice) {
    setError('')
    try {
      const saved = await loadDraft(conflict.id, ownerId, passphrase)
      const result = await api(`/api/assisted/${conflict.applicationId}/conflicts/resolve`, { token: session.token, method: 'POST', body: {
        temporaryId: saved.value.payload.temporaryId, clientMutationId: saved.value.resolutionMutationId,
        conflictMutationId: conflict.conflictMutationId, expectedVersion: conflict.serverVersion,
        choice, reason: resolutionReason,
      } })
      await removeDraft(conflict.id)
      await refreshDrafts()
      setConflict(null)
      setResolutionReason('')
      setNotice(bi(`Human resolution recorded: ${result.choice.toLowerCase()} version kept at version ${result.version}.`, `কর্মীর সিদ্ধান্ত নথিভুক্ত হয়েছে। ${say(result.choice)} সংস্করণটি রাখা হয়েছে; নতুন সংস্করণ নম্বর ${num(result.version)}।`))
    } catch (failure) { setError(failure.message) }
  }

  async function verifyIntegrity() {
    setError('')
    try {
      for (const item of drafts) await loadDraft(item.id, ownerId, passphrase)
      setNotice(bi(`${drafts.length} local encrypted draft${drafts.length === 1 ? '' : 's'} verified. Each hash and AES-GCM tag matches.`, `${num(drafts.length)}টি সংরক্ষিত খসড়া যাচাই হয়েছে। প্রতিটি কপির সত্যতা ও ডিজিটাল সুরক্ষা নিশ্চিত আছে।`))
    } catch (failure) { setError(failure.message) }
  }

  function loadExample() {
    setForm({ ...blank(), applicantName: 'Fictional Nuching Marma', translatorName: 'Fictional Marma translator', typistName: session.user.displayName,
      helperPhone: '01700000000', originalLanguage: 'Marma', originalStatement: 'Fictional original account spoken in Marma, captured by the named typist.',
      translatedStatement: 'নমুনা বাংলা অনুবাদ: জমির নথিটি একজন কর্মকর্তার দেখে দেওয়া দরকার।', caseType: 'LAND',
      consentAttestation: 'Oral assisted-intake consent was given through the named translator for this fictional demo.', safeTime: 'Weekday morning' })
  }

  const item = (name) => bi(name, itemsBn[name] || name)
  const queuedCount = drafts.filter((row) => row.status === 'QUEUED').length

  return <section aria-labelledby="assisted-title">
    <Link to="/">← {bi('Workspace', 'কর্মক্ষেত্র')}</Link>
    <p className="eyebrow">{bi('UDC assisted access · fictional data only', 'ইউডিসি সহায়তা · শুধু কাল্পনিক তথ্য')}</p>
    <h1 id="assisted-title">{bi('Assisted intake and offline drafts', 'সহায়তায় আবেদন ও অফলাইন খসড়া')}</h1>
    <div className={online ? 'connection-banner connected' : 'connection-banner disconnected'} role="status" aria-live="polite">
      <strong>{online ? bi('Internet connected', 'ইন্টারনেট সংযুক্ত') : bi('No internet connection', 'ইন্টারনেট সংযোগ নেই')}</strong>
      <span>{saving ? bi('Saving a protected copy on this device…', 'এই ডিভাইসে সুরক্ষিত কপি রাখা হচ্ছে…') : online ? bi('Saved applications can be sent to the server.', 'সংরক্ষিত আবেদন সার্ভারে পাঠানো যাবে।') : bi('Continue working. The application stays on this device until you reconnect.', 'কাজ চালিয়ে যান। সংযোগ ফিরে না আসা পর্যন্ত আবেদনটি এই ডিভাইসেই থাকবে।')}</span>
    </div>
    <p className="safety-note"><strong>{bi('Legal aid is free.', 'আইনি সহায়তা বিনামূল্যে।')}</strong> {bi("No UDC worker may charge for this. The applicant's original words, Bangla translation, and the typist are recorded separately; an officer checks them later.", 'কোনো ইউডিসি কর্মী এর জন্য টাকা নিতে পারবেন না। আবেদনকারীর মূল কথা, বাংলা অনুবাদ ও টাইপিস্টের পরিচয় আলাদাভাবে নথিভুক্ত করা হয়; পরে একজন কর্মকর্তা যাচাই করেন।')}</p>
    {error && <p role="alert" className="error">{error}</p>}
    {notice && <p role="status" aria-live="polite" className="success">{notice}</p>}
    {receipt?.lookupCode && <p className="safety-note">{bi('Application', 'আবেদন')} {receipt.applicationId} · {bi('one-time lookup code:', 'একবার ব্যবহারযোগ্য কোড:')} <code>{receipt.lookupCode}</code>. {bi('Share only by an agreed safe route.', 'শুধু সম্মত নিরাপদ পথে জানান।')}</p>}

    <div className="assisted-workspace">
      <aside className="card draft-workspace" aria-labelledby="drafts-title">
        <h2 id="drafts-title">{bi('Saved drafts and sync', 'সংরক্ষিত খসড়া ও সিঙ্ক')}</h2>
        <p className="muted">{bi('Applications save on this device first. When the internet returns, send waiting applications to the server.', 'আবেদন আগে এই ডিভাইসে সংরক্ষিত হয়। ইন্টারনেট ফিরলে অপেক্ষমাণ আবেদন সার্ভারে পাঠান।')}</p>
        <div className="draft-counts" aria-label={bi('Draft counts', 'খসড়ার হিসাব')}>
          <div><strong>{drafts.length}</strong><span>{bi('Saved here', 'এখানে সংরক্ষিত')}</span></div>
          <div><strong>{queuedCount}</strong><span>{bi('Waiting to send', 'পাঠানোর অপেক্ষায়')}</span></div>
        </div>
        <div className="form-stack passphrase-field">
          <label htmlFor="draft-passphrase">{bi('Device passphrase', 'ডিভাইসের পাসফ্রেজ')}</label>
          <input id="draft-passphrase" name="draftPassphrase" type="password" minLength="8" autoComplete="off" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} aria-describedby="passphrase-help" />
          <p id="passphrase-help" className="muted">{bi('Use the same passphrase to open, check, or send drafts. Use at least 8 characters. It is never sent to the server. If forgotten, drafts cannot be recovered; signing out clears them.', 'খসড়া খুলতে, যাচাই করতে বা পাঠাতে একই পাসফ্রেজ ব্যবহার করুন। কমপক্ষে ৮ অক্ষর দিন। এটি সার্ভারে পাঠানো হয় না। ভুলে গেলে খসড়া ফেরত পাওয়া যাবে না; সাইন আউট করলে মুছে যাবে।')}</p>
        </div>
        <div className="draft-actions">
          <button type="button" onClick={() => syncQueued()} disabled={!online || passphrase.length < 8 || queuedCount === 0}>{bi('Send waiting applications', 'অপেক্ষমাণ আবেদন পাঠান')}</button>
          <button type="button" className="secondary-button" onClick={verifyIntegrity} disabled={passphrase.length < 8 || drafts.length === 0}>{bi('Check saved drafts', 'সংরক্ষিত খসড়া যাচাই করুন')}</button>
        </div>
        {!online && <p className="muted">{bi('Sending pauses while offline. Your saved drafts stay on this device.', 'অফলাইনে আবেদন পাঠানো বন্ধ থাকে। সংরক্ষিত খসড়া এই ডিভাইসে থাকে।')}</p>}
        {drafts.length === 0
          ? <p className="empty-state">{bi('No saved drafts yet. Start an intake to create one.', 'এখনও কোনো খসড়া নেই। আবেদন শুরু করলে খসড়া তৈরি হবে।')}</p>
          : <ul className="plain-list draft-list">{drafts.map((row) => <li key={row.id}>
            <div className="draft-row-copy"><code>{row.id}</code><span>{row.status === 'QUEUED' ? bi('Waiting to send', 'পাঠানোর অপেক্ষায়') : row.status === 'CONFLICT' ? bi('Needs review', 'যাচাই দরকার') : bi('Draft saved', 'খসড়া সংরক্ষিত')}</span></div>
            <button type="button" className="secondary-button" onClick={() => openLocal(row.id)}>{row.status === 'CONFLICT' ? bi('Review conflict', 'অমিল যাচাই') : row.status === 'QUEUED' ? bi('Check queued application', 'অপেক্ষমাণ আবেদন যাচাই') : bi('Open saved draft', 'সংরক্ষিত খসড়া খুলুন')}</button>
          </li>)}</ul>}
      </aside>

      <section className="card intake-workspace" aria-labelledby="form-title">
        <div className="intake-heading">
          <div><h2 id="form-title">{bi('Assisted intake', 'সহায়তায় আবেদন')}</h2><p className="muted">{bi('Choose what you need to do.', 'আপনি কী করতে চান তা বেছে নিন।')}</p></div>
          <div className="intake-choices" role="group" aria-label={bi('Choose an intake task', 'আবেদনের কাজ বেছে নিন')}>
            <button type="button" className={intakeTask === 'NEW' ? 'task-choice' : 'task-choice secondary-button'} aria-pressed={intakeTask === 'NEW'} onClick={() => setIntakeTask('NEW')} disabled={mode === 'REVISION'}>{bi('Start a new application', 'নতুন আবেদন শুরু করুন')}</button>
            <button type="button" className={intakeTask === 'CORRECTION' ? 'task-choice' : 'task-choice secondary-button'} aria-pressed={intakeTask === 'CORRECTION'} onClick={() => setIntakeTask('CORRECTION')}>{bi('Correct an application', 'আবেদন সংশোধন করুন')}</button>
          </div>
          {mode === 'REVISION' && <p className="muted">{bi('Save or queue this correction before starting another application.', 'নতুন আবেদন শুরুর আগে এই সংশোধন সংরক্ষণ বা পাঠান।')}</p>}
        </div>

        {conflict && <section className="assisted-conflict safety-card" aria-labelledby="conflict-title">
          <h3 id="conflict-title">{bi('Review the two versions', 'দুটি সংস্করণ যাচাই করুন')}</h3>
          <p>{bi('The server changed while this draft was being edited. Neither version was replaced. A staff member must choose and give a reason.', 'এই খসড়া সম্পাদনার সময় সার্ভারের তথ্য বদলেছে। কোনো সংস্করণ মুছে যায়নি। একজন কর্মীকে কারণসহ একটি সংস্করণ বেছে নিতে হবে।')}</p>
          <div className="conflict-versions">
            <div><h4>{bi('Server version', 'সার্ভারের সংস্করণ')} {num(conflict.serverVersion)}</h4><p><strong>{bi('Original words:', 'মূল বক্তব্য:')}</strong> {conflict.server.originalStatement}</p><p><strong>{bi('Bangla translation:', 'বাংলা অনুবাদ:')}</strong> {conflict.server.translatedStatement}</p></div>
            <div><h4>{bi('Saved device version', 'ডিভাইসে সংরক্ষিত সংস্করণ')}</h4><p><strong>{bi('Original words:', 'মূল বক্তব্য:')}</strong> {conflict.local.originalStatement}</p><p><strong>{bi('Bangla translation:', 'বাংলা অনুবাদ:')}</strong> {conflict.local.translatedStatement}</p></div>
          </div>
          <label htmlFor="resolution-reason">{bi('Why are you choosing this version?', 'এই সংস্করণ বেছে নেওয়ার কারণ')}</label>
          <textarea id="resolution-reason" name="resolutionReason" autoComplete="off" value={resolutionReason} onChange={(event) => setResolutionReason(event.target.value)} minLength="10" maxLength="500" required />
          <div className="choice-row"><button type="button" onClick={() => resolve('SERVER')} disabled={resolutionReason.trim().length < 10}>{bi('Keep server version', 'সার্ভারের সংস্করণ রাখুন')}</button><button type="button" className="secondary-button" onClick={() => resolve('LOCAL')} disabled={resolutionReason.trim().length < 10}>{bi('Save device version as a new correction', 'ডিভাইসের সংস্করণ নতুন সংশোধন হিসেবে রাখুন')}</button></div>
        </section>}

        {intakeTask === 'CORRECTION' && mode === 'CREATE' && <div className="correction-lookup">
          <h3>{bi('Find the application to correct', 'সংশোধনের জন্য আবেদনটি খুঁজুন')}</h3>
          <p className="muted">{bi('Enter the Application ID. You can correct your own pending assisted application within the demo window.', 'আবেদন নম্বর দিন। ডেমোর নির্ধারিত সময়ে নিজের জমা দেওয়া অপেক্ষমাণ আবেদন সংশোধন করা যাবে।')}</p>
          <form onSubmit={openRevision} className="form-stack correction-form">
            <label htmlFor="assisted-id">{bi('Application ID', 'আবেদন নম্বর')}</label>
            <input id="assisted-id" name="applicationId" autoComplete="off" value={applicationId} onChange={(event) => setApplicationId(event.target.value)} required />
            <button type="submit">{bi('Load application to correct', 'সংশোধনের জন্য আবেদন খুলুন')}</button>
          </form>
        </div>}

        {(intakeTask === 'NEW' || mode === 'REVISION') && <>
          <div className="form-intro">
            <h3>{mode === 'CREATE' ? bi('Record the applicant’s words and translation', 'আবেদনকারীর বক্তব্য ও অনুবাদ লিখুন') : <>{bi('Correct', 'সংশোধন করুন')} {applicationId} · {bi('version', 'সংস্করণ')} {num(baseVersion)}</>}</h3>
            {mode === 'REVISION' && <p className="muted">{bi('Only the statements and read-back confirmations can be corrected here.', 'এখানে শুধু বক্তব্য ও পড়ে শোনানোর পর নিশ্চিতকরণ সংশোধন করা যাবে।')}</p>}
          </div>
          {mode === 'CREATE' && <button type="button" className="secondary-button example-button" onClick={loadExample}>{bi('Fill with fictional Nuching example', 'কাল্পনিক নুচিং উদাহরণ বসান')}</button>}
          <form onSubmit={queue} className="form-stack intake-form">
            {mode === 'CREATE' && <fieldset className="intake-step form-stack">
              <legend>{bi('1. People and language', '১. ব্যক্তি ও ভাষা')}</legend>
              <label htmlFor="applicant-name">{bi('Applicant / original speaker name', 'আবেদনকারী / মূল বক্তার নাম')}</label><input id="applicant-name" name="applicantName" autoComplete="off" value={form.applicantName} onChange={(event) => change('applicantName', event.target.value)} minLength="2" maxLength="120" required />
              <p className="muted">{bi('UDC helper:', 'ইউডিসি সহায়তাকারী:')} <strong>{session.user.displayName}</strong>. {bi('The translator and typist may be different people.', 'অনুবাদক ও টাইপিস্ট ভিন্ন ব্যক্তি হতে পারেন।')}</p>
              <label htmlFor="translator-name">{bi('Translator', 'অনুবাদক')}</label><input id="translator-name" name="translatorName" autoComplete="off" value={form.translatorName} onChange={(event) => change('translatorName', event.target.value)} minLength="2" maxLength="120" required />
              <label htmlFor="typist-name">{bi('Person typing this form', 'যিনি এই ফর্ম টাইপ করছেন')}</label><input id="typist-name" name="typistName" autoComplete="off" value={form.typistName} onChange={(event) => change('typistName', event.target.value)} minLength="2" maxLength="120" required />
              <p className="muted">{bi('The applicant speaks; the translator explains in Bangla; the typist enters the form. These roles are saved separately.', 'আবেদনকারী বলেন; অনুবাদক বাংলায় বোঝান; টাইপিস্ট ফর্ম লেখেন। এই পরিচয়গুলো আলাদাভাবে সংরক্ষিত হয়।')}</p>
              <label htmlFor="helper-phone">{bi('UDC helper phone (optional; not applicant contact)', 'ইউডিসি সহায়তাকারীর ফোন (ঐচ্ছিক; আবেদনকারীর যোগাযোগ নয়)')}</label><input id="helper-phone" name="helperPhone" type="tel" autoComplete="off" value={form.helperPhone} onChange={(event) => change('helperPhone', event.target.value)} />
              <label htmlFor="original-language">{bi('Language the applicant spoke', 'আবেদনকারী যে ভাষায় বলেছেন')}</label><input id="original-language" name="originalLanguage" autoComplete="off" value={form.originalLanguage} onChange={(event) => change('originalLanguage', event.target.value)} minLength="2" maxLength="60" required />
              <label htmlFor="case-type">{bi('Matter type', 'মামলার ধরন')}</label><select id="case-type" name="caseType" autoComplete="off" value={form.caseType} onChange={(event) => change('caseType', event.target.value)}>{Object.keys(checklist).map((type) => <option key={type} value={type}>{say(type)}</option>)}</select>
              <p>{bi('Possible documents to discuss (not an eligibility decision):', 'যে নথি নিয়ে কথা বলতে পারেন (এটি যোগ্যতার সিদ্ধান্ত নয়):')} {checklist[form.caseType].map(item).join(' · ')}.</p>
            </fieldset>}
            <fieldset className="intake-step form-stack">
              <legend>{mode === 'CREATE' ? bi('2. Original words and Bangla translation', '২. মূল বক্তব্য ও বাংলা অনুবাদ') : bi('1. Original words and Bangla translation', '১. মূল বক্তব্য ও বাংলা অনুবাদ')}</legend>
              <label htmlFor="original-statement">{bi('Original words, as spoken (do not translate here)', 'মূল বক্তব্য (যেভাবে বলা হয়েছে; এখানে অনুবাদ করবেন না)')} <span>({form.originalLanguage})</span></label><textarea id="original-statement" name="originalStatement" autoComplete="off" value={form.originalStatement} onChange={(event) => change('originalStatement', event.target.value)} minLength="5" maxLength="4000" required />
              <label htmlFor="translated-statement">{bi('Bangla translation typed by the operator', 'অপারেটরের টাইপ করা বাংলা অনুবাদ')}</label><textarea id="translated-statement" name="translatedStatement" autoComplete="off" value={form.translatedStatement} onChange={(event) => change('translatedStatement', event.target.value)} minLength="5" maxLength="4000" required />
              <label className="checkbox-label" htmlFor="original-confirmed"><input id="original-confirmed" name="originalConfirmed" type="checkbox" checked={form.originalConfirmed} onChange={(event) => change('originalConfirmed', event.target.checked)} />{bi('Applicant confirmed the original words after they were read back', 'পড়ে শোনানোর পর আবেদনকারী মূল বক্তব্য নিশ্চিত করেছেন')}</label>
              <label className="checkbox-label" htmlFor="translation-confirmed"><input id="translation-confirmed" name="translationConfirmed" type="checkbox" checked={form.translationConfirmed} onChange={(event) => change('translationConfirmed', event.target.checked)} />{bi('Applicant confirmed the Bangla translation after it was read back', 'পড়ে শোনানোর পর আবেদনকারী বাংলা অনুবাদ নিশ্চিত করেছেন')}</label>
            </fieldset>
            {mode === 'CREATE' && <fieldset className="intake-step form-stack">
              <legend>{bi('3. Consent and safe contact', '৩. সম্মতি ও নিরাপদ যোগাযোগ')}</legend>
              <label htmlFor="consent-attestation">{bi('What was said to obtain oral consent?', 'মৌখিক সম্মতি নিতে কী বলা হয়েছিল?')}</label><textarea id="consent-attestation" name="consentAttestation" autoComplete="off" value={form.consentAttestation} onChange={(event) => change('consentAttestation', event.target.value)} minLength="10" maxLength="500" required />
              <label htmlFor="contact-channel">{bi('How is it safe to contact the applicant?', 'আবেদনকারীর সঙ্গে যোগাযোগের নিরাপদ উপায়')}</label><select id="contact-channel" name="contactChannel" autoComplete="off" value={form.contactChannel} onChange={(event) => change('contactChannel', event.target.value)}><option value="IN_PERSON">{bi('In person; do not use helper phone', 'সরাসরি; সহায়তাকারীর ফোন ব্যবহার করবেন না')}</option><option value="PHONE">{bi("Applicant's own safe phone", 'আবেদনকারীর নিজের নিরাপদ ফোন')}</option></select>
              {form.contactChannel === 'PHONE' && <><label htmlFor="applicant-phone">{bi("Applicant's own safe phone", 'আবেদনকারীর নিজের নিরাপদ ফোন')}</label><input id="applicant-phone" name="applicantPhone" type="tel" autoComplete="off" value={form.contactValue} onChange={(event) => change('contactValue', event.target.value)} required /></>}
              <label htmlFor="safe-time">{bi('Safe time (optional)', 'নিরাপদ সময় (ঐচ্ছিক)')}</label><input id="safe-time" name="safeTime" autoComplete="off" value={form.safeTime} onChange={(event) => change('safeTime', event.target.value)} maxLength="100" />
            </fieldset>}
            <button type="submit">{mode === 'CREATE' ? online ? bi('Save and send application', 'আবেদন সংরক্ষণ করে পাঠান') : bi('Save application on this device', 'এই ডিভাইসে আবেদন সংরক্ষণ করুন') : online ? bi('Save and send correction', 'সংশোধন সংরক্ষণ করে পাঠান') : bi('Save correction on this device', 'এই ডিভাইসে সংশোধন সংরক্ষণ করুন')}</button>
          </form>
        </>}
      </section>
    </div>
  </section>
}
