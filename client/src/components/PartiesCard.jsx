import { useState } from 'react'
import { api } from '../services/api.js'
import { Bi, bi, num, when, say } from './Bi.jsx'

const partyFields = {
  petitioner: [['name', 'Name', 'নাম', 120], ['phone', 'Phone (Number)', 'মোবাইল নম্বর', 20], ['address', 'Address', 'ঠিকানা', 300], ['nid', 'NID', 'এনআইডি', 17]],
  respondent: [['name', 'Name', 'নাম', 120], ['phone', 'Phone (Number)', 'মোবাইল নম্বর', 20], ['address', 'Address', 'ঠিকানা', 300], ['relationship', 'Relationship', 'সম্পর্ক', 120]],
}

// The DLAO officer edits both parties in place; a reason is required and the change is kept in the audit history.
function PartiesEditForm({ applicationId, token, petitioner, respondent, onSaved, onCancel }) {
  const [values, setValues] = useState(() => ({
    petitioner: Object.fromEntries(partyFields.petitioner.map(([key]) => [key, petitioner[key] ?? ''])),
    respondent: Object.fromEntries(partyFields.respondent.map(([key]) => [key, respondent[key] ?? ''])),
  }))
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const change = (party, key, value) => setValues((current) => ({ ...current, [party]: { ...current[party], [key]: value } }))

  async function save(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      await api(`/api/applications/${applicationId}/case-info`, { token, method: 'PUT', body: { ...values, reason: reason.trim() } })
      onSaved()
    } catch (failure) { setError(failure.message) } finally { setSaving(false) }
  }

  return <form onSubmit={save} className="form-stack" aria-labelledby="parties-edit-title" style={{ marginTop: '1rem', padding: '1rem', border: '1px solid #EAEAEA', borderRadius: '6px', backgroundColor: '#FFFFFF' }}>
    <h3 id="parties-edit-title" style={{ margin: 0, fontSize: '1rem' }}><Bi en="Edit parties" bn="পক্ষের তথ্য সংশোধন" /></h3>
    {error && <p role="alert" className="error">{error}</p>}
    <div className="parties-grid">
      {[['petitioner', 'Petitioner / Complainant (বাদী)', 'বাদী (আবেদনকারী)'], ['respondent', 'Respondent / Opposing Party (বিবাদী)', 'বিবাদী (প্রতিপক্ষ)']].map(([party, en, bn]) => <fieldset key={party} className="form-stack">
        <legend><Bi en={en} bn={bn} /></legend>
        {partyFields[party].map(([key, label, labelBn, max]) => <div key={key} className="form-stack">
          <label htmlFor={`edit-${party}-${key}`}>{bi(label, labelBn)}</label>
          <input id={`edit-${party}-${key}`} value={values[party][key]} onChange={(event) => change(party, key, event.target.value)} maxLength={max}
            type={key === 'phone' ? 'tel' : 'text'} inputMode={key === 'nid' ? 'numeric' : undefined} autoComplete="off" required={key === 'name'} minLength={key === 'name' ? 2 : undefined} />
        </div>)}
      </fieldset>)}
    </div>
    <label htmlFor="parties-edit-reason"><Bi en="Reason for the change" bn="সংশোধনের কারণ" /></label>
    <input id="parties-edit-reason" value={reason} onChange={(event) => setReason(event.target.value)} minLength="5" maxLength="500" required />
    <div className="choice-row">
      <button type="submit" disabled={saving}>{saving ? bi('Saving…', 'সংরক্ষণ হচ্ছে…') : bi('Save parties', 'সংরক্ষণ করুন')}</button>
      <button type="button" className="secondary-button" onClick={onCancel}>{bi('Cancel', 'বাতিল')}</button>
    </div>
  </form>
}

export function PartiesCard({ record, application, token, officer, onUpdated }) {
  const targetRecord = record || application || {}
  const [showVerificationForm, setShowVerificationForm] = useState(false)
  const [showNoticeForm, setShowNoticeForm] = useState(false)
  const [showEditForm, setShowEditForm] = useState(false)

  // Verification state
  const prevVerify = targetRecord.preMediationVerification || {}
  const [petitionerVerified, setPetitionerVerified] = useState(Boolean(prevVerify.petitionerVerified))
  const [petitionerNotes, setPetitionerNotes] = useState(prevVerify.petitionerNotes || '')
  const [respondentVerified, setRespondentVerified] = useState(Boolean(prevVerify.respondentVerified))
  const [respondentNotes, setRespondentNotes] = useState(prevVerify.respondentNotes || '')
  const [verifyStatus, setVerifyStatus] = useState(prevVerify.status || 'IN_PROGRESS')
  const [verifyReason, setVerifyReason] = useState('')
  const [savingVerify, setSavingVerify] = useState(false)

  // Notice state
  const [noticeRecipient, setNoticeRecipient] = useState('RESPONDENT')
  const [memoNo, setMemoNo] = useState('')
  const [deliveryMethod, setDeliveryMethod] = useState('PROCESS_SERVER')
  const [noticeNotes, setNoticeNotes] = useState('')
  const [savingNotice, setSavingNotice] = useState(false)

  const [error, setError] = useState('')
  const [localNotice, setLocalNotice] = useState('')

  const petitioner = targetRecord.petitioner || {
    name: targetRecord.applicantName,
    phone: targetRecord.safeContactPhone,
    address: '',
    nid: '',
  }

  const respondent = targetRecord.respondent || {
    name: '',
    phone: '',
    address: '',
    relationship: '',
  }

  const notices = targetRecord.notices || []

  async function handleSaveVerification(e) {
    e.preventDefault()
    setSavingVerify(true)
    setError('')
    try {
      await api(`/api/applications/${targetRecord.applicationId}/pre-mediation-verify`, {
        token,
        method: 'POST',
        body: {
          petitionerVerified,
          petitionerNotes,
          respondentVerified,
          respondentNotes,
          status: verifyStatus,
          reason: verifyReason || 'Pre-mediation call verification recorded.',
        },
      })
      setLocalNotice(bi('Pre-mediation call verification recorded.', 'মধ্যস্থতাপূর্ব টেলিফোন যাচাইকরণ সংরক্ষিত হয়েছে।'))
      setShowVerificationForm(false)
      if (onUpdated) onUpdated()
    } catch (err) {
      setError(err.message)
    } finally {
      setSavingVerify(false)
    }
  }

  async function handleSendNotice(e) {
    e.preventDefault()
    setSavingNotice(true)
    setError('')
    try {
      await api(`/api/applications/${targetRecord.applicationId}/notices`, {
        token,
        method: 'POST',
        body: {
          recipient: noticeRecipient,
          memoNo: memoNo.trim() || `DLAC-NOT-${Date.now().toString().slice(-5)}`,
          deliveryMethod,
          status: 'SENT',
          notes: noticeNotes.trim(),
        },
      })
      setLocalNotice(bi(`Notice dispatched to ${noticeRecipient}.`, `${noticeRecipient === 'RESPONDENT' ? 'বিবাদী' : 'বাদী'}-কে নোটিশ প্রেরণ নথিভুক্ত হয়েছে।`))
      setShowNoticeForm(false)
      setMemoNo('')
      setNoticeNotes('')
      if (onUpdated) onUpdated()
    } catch (err) {
      setError(err.message)
    } finally {
      setSavingNotice(false)
    }
  }

  return (
    <section className="card parties-card" aria-labelledby="parties-card-title" style={{ marginTop: '1.25rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div>
          <h2 id="parties-card-title" style={{ margin: 0, fontSize: '1.2rem' }}>
            <Bi en="Parties Details: Complainant & Respondent (বাদী ও বিবাদী বিবরণ)" bn="বাদী ও বিবাদীর বিস্তারিত বিবরণ" />
          </h2>
          <p className="muted" style={{ margin: '0.2rem 0 0 0', fontSize: '0.85rem' }}>
            <Bi
              en="Verify parties' phone numbers and contact details before issuing mediation summons."
              bn="মধ্যস্থতা বা শুনানিতে ডাকার পূর্বে উভয় পক্ষের ফোন নম্বর ও যোগাযোগের তথ্য যাচাই করুন।"
            />
          </p>
        </div>

        {officer && (
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="secondary-button"
              style={{ fontSize: '0.82rem', padding: '0.35rem 0.75rem' }}
              aria-expanded={showEditForm}
              onClick={() => { setShowEditForm(!showEditForm); setShowVerificationForm(false); setShowNoticeForm(false) }}
            >
              {showEditForm ? bi('Close editing', 'সংশোধন বন্ধ') : bi('Edit parties', 'পক্ষের তথ্য সংশোধন')}
            </button>
            <button
              type="button"
              className="secondary-button"
              style={{ fontSize: '0.82rem', padding: '0.35rem 0.75rem' }}
              onClick={() => { setShowVerificationForm(!showVerificationForm); setShowNoticeForm(false); setShowEditForm(false) }}
            >
              {showVerificationForm ? bi('Hide Verification', 'যাচাই ফর্ম বন্ধ') : bi('Call Verification', 'ফোন যাচাইকরণ')}
            </button>
            <button
              type="button"
              className="secondary-button"
              style={{ fontSize: '0.82rem', padding: '0.35rem 0.75rem' }}
              onClick={() => { setShowNoticeForm(!showNoticeForm); setShowVerificationForm(false); setShowEditForm(false) }}
            >
              {showNoticeForm ? bi('Hide Notice', 'নোটিশ ফর্ম বন্ধ') : bi('Send Notice (নোটিশ প্রেরণ)', 'নোটিশ প্রেরণ')}
            </button>
          </div>
        )}
      </div>

      {localNotice && <p role="status" className="success" style={{ marginBottom: '1rem' }}>{localNotice}</p>}
      {error && <p role="alert" className="error" style={{ marginBottom: '1rem' }}>{error}</p>}

      {/* Grid of Petitioner & Respondent */}
      <div className="parties-grid">
        {/* Complainant / Petitioner */}
        <div style={{ border: '1px solid #EAEAEA', borderRadius: '6px', padding: '1rem', backgroundColor: '#FAFAFA' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <strong style={{ fontSize: '1rem', color: '#1f6c9f' }}>
              <Bi en="Petitioner / Complainant (বাদী)" bn="বাদী (আবেদনকারী)" />
            </strong>
            <span
              style={{
                fontSize: '0.75rem',
                fontWeight: 600,
                padding: '0.15rem 0.5rem',
                borderRadius: '9999px',
                backgroundColor: prevVerify.petitionerVerified ? '#EDF3EC' : '#FBF3DB',
                color: prevVerify.petitionerVerified ? '#346538' : '#956400',
              }}
            >
              {prevVerify.petitionerVerified ? bi('Phone Verified', 'ফোন যাচাই সম্পন্ন') : bi('Verification Pending', 'ফোন যাচাই অপেক্ষমাণ')}
            </span>
          </div>

          <dl className="details compact" style={{ margin: 0 }}>
            <div><dt><Bi en="Name" bn="নাম" /></dt><dd><strong>{petitioner.name || targetRecord.applicantName || bi('Not recorded', 'নথিভুক্ত নেই')}</strong></dd></div>
            <div><dt><Bi en="Phone (Number)" bn="মোবাইল নম্বর" /></dt><dd>{petitioner.phone || targetRecord.safeContactPhone || <span className="muted">{bi('Not provided', 'দেওয়া হয়নি')}</span>}</dd></div>
            <div><dt><Bi en="Address" bn="ঠিকানা" /></dt><dd>{petitioner.address || <span className="muted">{bi('Not specified', 'উল্লেখ নেই')}</span>}</dd></div>
            {petitioner.nid && <div><dt><Bi en="NID" bn="এনআইডি" /></dt><dd>{petitioner.nid}</dd></div>}
            {prevVerify.petitionerNotes && (
              <div><dt><Bi en="Call Notes" bn="ফোনের বিবরণ" /></dt><dd style={{ fontStyle: 'italic' }}>{prevVerify.petitionerNotes}</dd></div>
            )}
          </dl>
        </div>

        {/* Respondent */}
        <div style={{ border: '1px solid #EAEAEA', borderRadius: '6px', padding: '1rem', backgroundColor: '#FAFAFA' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <strong style={{ fontSize: '1rem', color: '#9f2f2d' }}>
              <Bi en="Respondent / Opposing Party (বিবাদী)" bn="বিবাদী (প্রতিপক্ষ)" />
            </strong>
            <span
              style={{
                fontSize: '0.75rem',
                fontWeight: 600,
                padding: '0.15rem 0.5rem',
                borderRadius: '9999px',
                backgroundColor: prevVerify.respondentVerified ? '#EDF3EC' : '#FBF3DB',
                color: prevVerify.respondentVerified ? '#346538' : '#956400',
              }}
            >
              {prevVerify.respondentVerified ? bi('Phone Verified', 'ফোন যাচাই সম্পন্ন') : bi('Verification Pending', 'ফোন যাচাই অপেক্ষমাণ')}
            </span>
          </div>

          <dl className="details compact" style={{ margin: 0 }}>
            <div><dt><Bi en="Name" bn="নাম" /></dt><dd>{respondent.name ? <strong>{respondent.name}</strong>
              : targetRecord.respondentFromCaseFile ? <><strong>{targetRecord.respondentFromCaseFile}</strong> <small className="muted">({bi('from the case file, not verified', 'মামলার বিবরণ থেকে, যাচাই হয়নি')})</small></>
                : <span className="muted" style={{ fontStyle: 'italic' }}>{bi('Not entered yet', 'এখনো যোগ করা হয়নি')}</span>}</dd></div>
            <div><dt><Bi en="Phone (Number)" bn="মোবাইল নম্বর" /></dt><dd>{respondent.phone || <span className="muted">{bi('Not recorded', 'নথিভুক্ত নেই')}</span>}</dd></div>
            <div><dt><Bi en="Address" bn="ঠিকানা" /></dt><dd>{respondent.address || <span className="muted">{bi('Not specified', 'উল্লেখ নেই')}</span>}</dd></div>
            <div><dt><Bi en="Relationship" bn="সম্পর্ক" /></dt><dd>{respondent.relationship || <span className="muted">{bi('Not specified', 'উল্লেখ নেই')}</span>}</dd></div>
            {prevVerify.respondentNotes && (
              <div><dt><Bi en="Call Notes" bn="ফোনের বিবরণ" /></dt><dd style={{ fontStyle: 'italic' }}>{prevVerify.respondentNotes}</dd></div>
            )}
          </dl>
        </div>
      </div>

      {officer && showEditForm && <PartiesEditForm
        applicationId={targetRecord.applicationId}
        token={token}
        petitioner={{ ...petitioner, name: petitioner.name || targetRecord.applicantName || '', phone: petitioner.phone || targetRecord.safeContactPhone || '' }}
        respondent={{ ...respondent, name: respondent.name || targetRecord.respondentFromCaseFile || '' }}
        onCancel={() => setShowEditForm(false)}
        onSaved={() => { setShowEditForm(false); setLocalNotice(bi('Party details saved. The change is recorded in the case history.', 'পক্ষের তথ্য সংরক্ষিত হয়েছে। পরিবর্তনটি মামলার ইতিহাসে নথিভুক্ত।')); onUpdated?.() }}
      />}

      {/* Pre-Mediation Call Verification Form */}
      {showVerificationForm && (
        <form onSubmit={handleSaveVerification} className="form-stack" style={{ marginTop: '1.25rem', padding: '1.25rem', backgroundColor: '#FCFCFA', border: '1px solid #D4D4D0', borderRadius: '6px' }}>
          <h3 style={{ margin: 0, fontSize: '1.05rem', color: '#111' }}>
            <Bi en="Pre-Mediation Call Verification ('call verify information করে mediation-এ ডাকবে')" bn="মধ্যস্থতাপূর্ব টেলিফোন যাচাইকরণ ('কল ভেরিফাই ইনফরমেশন করে মধ্যস্থতায় ডাকবে')" />
          </h3>
          <p className="muted" style={{ fontSize: '0.85rem', margin: '0.2rem 0 0.75rem' }}>
            <Bi
              en="Verify that both parties have valid contact numbers and confirm willingness/availability prior to dispatching mediation summons."
              bn="উভয় পক্ষের সাথে ফোনে কথা বলে উপস্থিতির নিশ্চয়তা ও যোগাযোগের সত্যতা যাচাই করুন।"
            />
          </p>

          <div className="form-grid-2col">
            <div style={{ padding: '0.75rem', border: '1px solid #EAEAEA', borderRadius: '4px', backgroundColor: '#FFF' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600 }}>
                <input
                  type="checkbox"
                  checked={petitionerVerified}
                  onChange={(e) => setPetitionerVerified(e.target.checked)}
                />
                <Bi en="Petitioner (বাদী) Call Verified" bn="বাদীর সাথে ফোনে কথা বলে যাচাই সম্পন্ন" />
              </label>
              <textarea
                value={petitionerNotes}
                onChange={(e) => setPetitionerNotes(e.target.value)}
                placeholder={bi('Petitioner call notes (e.g. agreed to attend on assigned date)...', 'বাদীর সাথে কথা বলার বিবরণ (যেমনঃ তারিখে উপস্থিতিতে সম্মতি জ্ঞাপন)...')}
                rows={2}
                style={{ marginTop: '0.5rem' }}
              />
            </div>

            <div style={{ padding: '0.75rem', border: '1px solid #EAEAEA', borderRadius: '4px', backgroundColor: '#FFF' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600 }}>
                <input
                  type="checkbox"
                  checked={respondentVerified}
                  onChange={(e) => setRespondentVerified(e.target.checked)}
                />
                <Bi en="Respondent (বিবাদী) Call Verified" bn="বিবাদীর সাথে ফোনে কথা বলে যাচাই সম্পন্ন" />
              </label>
              <textarea
                value={respondentNotes}
                onChange={(e) => setRespondentNotes(e.target.value)}
                placeholder={bi('Respondent call notes (e.g. respondent acknowledged notice and agreed)...', 'বিবাদীর সাথে কথা বলার বিবরণ (যেমনঃ বিবাদী নোটিশ প্রাপ্তি ও উপস্থিতিতে সম্মত)...')}
                rows={2}
                style={{ marginTop: '0.5rem' }}
              />
            </div>
          </div>

          <div className="form-grid-split" style={{ marginTop: '0.75rem' }}>
            <div>
              <label htmlFor="verify-status"><Bi en="Verification Status" bn="যাচাইকরণের সার্বিক অবস্থা" /></label>
              <select id="verify-status" value={verifyStatus} onChange={(e) => setVerifyStatus(e.target.value)}>
                <option value="IN_PROGRESS">{bi('In Progress (চলমান)', 'চলমান')}</option>
                <option value="VERIFIED">{bi('Verified (উভয় পক্ষ যাচাইকৃত)', 'উভয় পক্ষ যাচাইকৃত')}</option>
                <option value="UNREACHABLE">{bi('Unreachable / Failed (যোগাযোগে ব্যর্থ)', 'যোগাযোগে ব্যর্থ')}</option>
              </select>
            </div>
            <div>
              <label htmlFor="verify-reason"><Bi en="Officer Verification Note" bn="কর্মকর্তার মন্তব্য" /></label>
              <input
                id="verify-reason"
                value={verifyReason}
                onChange={(e) => setVerifyReason(e.target.value)}
                placeholder={bi('e.g. Both parties contacted, ready to summon to mediation', 'যেমনঃ উভয় পক্ষের সাথে ফোনে যোগাযোগ সম্পন্ন, মধ্যস্থতায় ডাকার প্রস্তুতি গ্রহণ')}
              />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.75rem' }}>
            <button type="button" className="secondary-button" onClick={() => setShowVerificationForm(false)}>
              <Bi en="Cancel" bn="বাতিল" />
            </button>
            <button type="submit" disabled={savingVerify}>
              {savingVerify ? bi('Saving…', 'সংরক্ষণ হচ্ছে…') : bi('Save Call Verification', 'ফোন যাচাই সংরক্ষণ করুন')}
            </button>
          </div>
        </form>
      )}

      {/* Notice Sent Tracker & Dispatch Form */}
      {showNoticeForm && (
        <form onSubmit={handleSendNotice} className="form-stack" style={{ marginTop: '1.25rem', padding: '1.25rem', backgroundColor: '#FCFCFA', border: '1px solid #D4D4D0', borderRadius: '6px' }}>
          <h3 style={{ margin: 0, fontSize: '1.05rem', color: '#111' }}>
            <Bi en="Dispatch Formal Notice ('notice sent')" bn="আনুষ্ঠানিক নোটিশ প্রেরণ ('নোটিশ সেন্ট')" />
          </h3>
          <p className="muted" style={{ fontSize: '0.85rem', margin: '0.2rem 0 0.75rem' }}>
            <Bi
              en="Record mediation notice or hearing summons dispatched to petitioner or respondent with tracking details."
              bn="বাদী বা বিবাদীর বরাবরে প্রেরিত মধ্যস্থতার নোটিশ বা শুনানীর সমন স্মারক নম্বরসহ নথিভুক্ত করুন।"
            />
          </p>

          <div className="form-grid-3col">
            <div>
              <label htmlFor="notice-recipient"><Bi en="Recipient Party" bn="প্রাপক পক্ষ" /></label>
              <select id="notice-recipient" value={noticeRecipient} onChange={(e) => setNoticeRecipient(e.target.value)}>
                <option value="RESPONDENT">{bi('Respondent (বিবাদী)', 'বিবাদী')}</option>
                <option value="PETITIONER">{bi('Petitioner (বাদী)', 'বাদী')}</option>
              </select>
            </div>
            <div>
              <label htmlFor="notice-memo"><Bi en="Dispatch Memo No (স্মারক নং)" bn="স্মারক নম্বর" /></label>
              <input
                id="notice-memo"
                value={memoNo}
                onChange={(e) => setMemoNo(e.target.value)}
                placeholder="DLAC-DHK-2026-..."
              />
            </div>
            <div>
              <label htmlFor="notice-delivery"><Bi en="Delivery Method" bn="প্রেরণের মাধ্যম" /></label>
              <select id="notice-delivery" value={deliveryMethod} onChange={(e) => setDeliveryMethod(e.target.value)}>
                <option value="PROCESS_SERVER">{bi('Process Server (জারিকারক)', 'জারিকারক')}</option>
                <option value="REGISTERED_POST">{bi('Registered Post (রেজিস্ট্রি ডাক)', 'রেজিস্ট্রি ডাক')}</option>
                <option value="IN_PERSON">{bi('In Person (সরাসরি সমন জারি)', 'সরাসরি সমন জারি')}</option>
                <option value="PHONE_CALL">{bi('Phone Call Notification', 'টেলিফোনে নোটিশ')}</option>
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="notice-notes"><Bi en="Notice Details / Remarks" bn="নোটিশের বিবরণ / মন্তব্য" /></label>
            <input
              id="notice-notes"
              value={noticeNotes}
              onChange={(e) => setNoticeNotes(e.target.value)}
              placeholder={bi('e.g. Summons to attend mediation session on Sunday 11:00 AM...', 'যেমনঃ আগামী রবিবার সকাল ১১টায় মধ্যস্থতা বৈঠকে উপস্থিতির নোটিশ প্রেরিত...')}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem' }}>
            <button type="button" className="secondary-button" onClick={() => setShowNoticeForm(false)}>
              <Bi en="Cancel" bn="বাতিল" />
            </button>
            <button type="submit" disabled={savingNotice}>
              {savingNotice ? bi('Recording…', 'সংরক্ষণ হচ্ছে…') : bi('Record Notice Sent', 'নোটিশ প্রেরণ নথিভুক্ত করুন')}
            </button>
          </div>
        </form>
      )}

      {/* Dispatched Notices History Table */}
      {notices.length > 0 && (
        <div style={{ marginTop: '1.25rem', borderTop: '1px solid #EAEAEA', paddingTop: '1rem' }}>
          <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.95rem', color: '#333' }}>
            <Bi en="Notice Dispatch History (প্রেরিত নোটিশের তালিকা)" bn="প্রেরিত নোটিশের ইতিহাস" /> ({num(notices.length)})
          </h4>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: '0.85rem', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #DDD', textAlign: 'left' }}>
                  <th style={{ padding: '0.4rem 0.5rem' }}><Bi en="Recipient" bn="প্রাপক" /></th>
                  <th style={{ padding: '0.4rem 0.5rem' }}><Bi en="Memo No" bn="স্মারক নং" /></th>
                  <th style={{ padding: '0.4rem 0.5rem' }}><Bi en="Delivery Method" bn="মাধ্যম" /></th>
                  <th style={{ padding: '0.4rem 0.5rem' }}><Bi en="Date" bn="তারিখ" /></th>
                  <th style={{ padding: '0.4rem 0.5rem' }}><Bi en="Status" bn="স্থিতি" /></th>
                  <th style={{ padding: '0.4rem 0.5rem' }}><Bi en="Notes" bn="মন্তব্য" /></th>
                </tr>
              </thead>
              <tbody>
                {notices.map((n, idx) => (
                  <tr key={n.memoNo || idx} style={{ borderBottom: '1px solid #F0F0F0' }}>
                    <td style={{ padding: '0.4rem 0.5rem', fontWeight: 600 }}>{n.recipient === 'RESPONDENT' ? bi('Respondent (বিবাদী)', 'বিবাদী') : bi('Petitioner (বাদী)', 'বাদী')}</td>
                    <td style={{ padding: '0.4rem 0.5rem' }}><code>{n.memoNo}</code></td>
                    <td style={{ padding: '0.4rem 0.5rem' }}>{say(n.deliveryMethod)}</td>
                    <td style={{ padding: '0.4rem 0.5rem' }}>{n.dispatchDate ? when(n.dispatchDate) : when(n.createdAt)}</td>
                    <td style={{ padding: '0.4rem 0.5rem' }}>
                      <span style={{ backgroundColor: '#EDF3EC', color: '#346538', padding: '0.1rem 0.4rem', borderRadius: '3px', fontSize: '0.75rem', fontWeight: 600 }}>
                        {say(n.status)}
                      </span>
                    </td>
                    <td style={{ padding: '0.4rem 0.5rem', color: '#555' }}>{n.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  )
}

export default PartiesCard
