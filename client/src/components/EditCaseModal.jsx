import { useState } from 'react'
import { api } from '../services/api.js'
import { Bi, bi } from './Bi.jsx'

export function EditCaseModal({ record, token, onClose, onUpdated }) {
  const [applicantName, setApplicantName] = useState(record?.applicantName || '')
  const [petitionerName, setPetitionerName] = useState(record?.petitioner?.name || record?.applicantName || '')
  const [petitionerPhone, setPetitionerPhone] = useState(record?.petitioner?.phone || record?.safeContactPhone || '')
  const [petitionerAddress, setPetitionerAddress] = useState(record?.petitioner?.address || '')
  const [petitionerNid, setPetitionerNid] = useState(record?.petitioner?.nid || '')

  const [respondentName, setRespondentName] = useState(record?.respondent?.name || '')
  const [respondentPhone, setRespondentPhone] = useState(record?.respondent?.phone || '')
  const [respondentAddress, setRespondentAddress] = useState(record?.respondent?.address || '')
  const [respondentRelationship, setRespondentRelationship] = useState(record?.respondent?.relationship || '')

  const [complaintSummary, setComplaintSummary] = useState(record?.complaintSummary || '')
  const incidentWhat = record?.incident?.what || ''
  const [incidentWhen, setIncidentWhen] = useState(record?.incident?.when || '')
  const [incidentWhere, setIncidentWhere] = useState(record?.incident?.where || '')
  const incidentWho = record?.incident?.who || ''

  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!reason.trim() || reason.trim().length < 5) {
      setError(bi('An officer reason of at least 5 characters is required.', 'সংশোধনের কারণ কমপক্ষে ৫ অক্ষরের হতে হবে।'))
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const body = {
        applicantName,
        petitioner: {
          name: petitionerName,
          phone: petitionerPhone,
          address: petitionerAddress,
          nid: petitionerNid,
        },
        respondent: {
          name: respondentName,
          phone: respondentPhone,
          address: respondentAddress,
          relationship: respondentRelationship,
        },
        complaintSummary,
        incident: {
          what: incidentWhat,
          when: incidentWhen,
          where: incidentWhere,
          who: incidentWho,
        },
        safeContactPhone: petitionerPhone,
        reason: reason.trim(),
      }
      await api(`/api/applications/${record.applicationId}/case-info`, {
        token,
        method: 'PUT',
        body,
      })
      onUpdated(bi('Case information successfully updated and audit trail recorded.', 'মামলার তথ্য সফলভাবে হালনাগাদ ও অডিট ট্রেইলে সংরক্ষিত হয়েছে।'))
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-case-modal-title"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '1rem',
      }}
    >
      <div
        style={{
          backgroundColor: '#FFFFFF',
          borderRadius: '8px',
          maxWidth: '750px',
          width: '100%',
          maxHeight: '90vh',
          overflowY: 'auto',
          padding: '1.75rem',
          boxShadow: '0 8px 30px rgba(0, 0, 0, 0.12)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
          <div>
            <span className="eyebrow" style={{ textTransform: 'uppercase', letterSpacing: '0.05em', color: '#666', fontSize: '0.75rem' }}>
              {record.applicationId}
            </span>
            <h2 id="edit-case-modal-title" style={{ margin: '0.2rem 0 0 0', fontSize: '1.25rem' }}>
              <Bi en="Edit Case Information (DLAO Authority)" bn="মামলার তথ্য সংশোধন (ডিএলএও এখতিয়ার)" />
            </h2>
          </div>
          <button
            type="button"
            className="secondary-button"
            style={{ minHeight: '36px', padding: '0.35rem 0.75rem', fontSize: '0.85rem' }}
            onClick={onClose}
          >
            ✕ {bi('Close', 'বন্ধ করুন')}
          </button>
        </div>

        <p className="muted" style={{ fontSize: '0.85rem', marginBottom: '1.25rem' }}>
          <Bi
            en="All modifications are tracked in the permanent audit trail with your timestamp and mandatory reason. Human authority is preserved."
            bn="সকল সংশোধন স্থায়ী অডিট ট্রেইলে আপনার নাম ও যৌক্তিকতাসহ নথিভুক্ত থাকবে। কোনো তথ্য মোছা হবে না।"
          />
        </p>

        {error && <p role="alert" className="error" style={{ marginBottom: '1rem' }}>{error}</p>}

        <form onSubmit={handleSubmit} className="form-stack">
          {/* Section 1: Petitioner / Complainant */}
          <fieldset style={{ border: '1px solid #EAEAEA', borderRadius: '6px', padding: '1rem', margin: '0 0 1rem' }}>
            <legend style={{ fontWeight: 600, padding: '0 0.5rem', color: '#111' }}>
              <Bi en="Petitioner / Complainant (বাদী)" bn="বাদীর বিবরণ (বাদী)" />
            </legend>

            <div className="form-grid-2col">
              <div>
                <label htmlFor="petitioner-name"><Bi en="Petitioner Full Name" bn="বাদীর পূর্ণ নাম" /></label>
                <input
                  id="petitioner-name"
                  value={petitionerName}
                  onChange={(e) => {
                    setPetitionerName(e.target.value)
                    setApplicantName(e.target.value)
                  }}
                  required
                />
              </div>
              <div>
                <label htmlFor="petitioner-phone"><Bi en="Phone Number (Safe Contact)" bn="মোবাইল নম্বর (নিরাপদ)" /></label>
                <input
                  id="petitioner-phone"
                  value={petitionerPhone}
                  onChange={(e) => setPetitionerPhone(e.target.value)}
                />
              </div>
            </div>

            <div className="form-grid-split" style={{ marginTop: '0.85rem' }}>
              <div>
                <label htmlFor="petitioner-address"><Bi en="Address / Village / Thana" bn="ঠিকানা / গ্রাম / থানা" /></label>
                <input
                  id="petitioner-address"
                  value={petitionerAddress}
                  onChange={(e) => setPetitionerAddress(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="petitioner-nid"><Bi en="NID (Optional)" bn="জাতীয় পরিচয়পত্র নম্বর" /></label>
                <input
                  id="petitioner-nid"
                  value={petitionerNid}
                  onChange={(e) => setPetitionerNid(e.target.value)}
                />
              </div>
            </div>
          </fieldset>

          {/* Section 2: Respondent */}
          <fieldset style={{ border: '1px solid #EAEAEA', borderRadius: '6px', padding: '1rem', margin: '0 0 1rem' }}>
            <legend style={{ fontWeight: 600, padding: '0 0.5rem', color: '#111' }}>
              <Bi en="Respondent / Opposing Party (বিবাদী)" bn="বিবাদীর বিবরণ (বিবাদী)" />
            </legend>

            <div className="form-grid-2col">
              <div>
                <label htmlFor="respondent-name"><Bi en="Respondent Full Name" bn="বিবাদীর পূর্ণ নাম" /></label>
                <input
                  id="respondent-name"
                  value={respondentName}
                  onChange={(e) => setRespondentName(e.target.value)}
                  placeholder={bi('e.g. Md. Rafiqul Islam', 'যেমনঃ মোঃ রফিকুল ইসলাম')}
                />
              </div>
              <div>
                <label htmlFor="respondent-phone"><Bi en="Phone Number" bn="বিবাদীর মোবাইল নম্বর" /></label>
                <input
                  id="respondent-phone"
                  value={respondentPhone}
                  onChange={(e) => setRespondentPhone(e.target.value)}
                  placeholder="01XXXXXXXXX"
                />
              </div>
            </div>

            <div className="form-grid-split" style={{ marginTop: '0.85rem' }}>
              <div>
                <label htmlFor="respondent-address"><Bi en="Address / Location" bn="বিবাদীর ঠিকানা" /></label>
                <input
                  id="respondent-address"
                  value={respondentAddress}
                  onChange={(e) => setRespondentAddress(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="respondent-rel"><Bi en="Relationship with Petitioner" bn="বাদীর সাথে সম্পর্ক" /></label>
                <input
                  id="respondent-rel"
                  value={respondentRelationship}
                  onChange={(e) => setRespondentRelationship(e.target.value)}
                  placeholder={bi('e.g. Husband, Landlord, Employer', 'যেমনঃ স্বামী, বাড়িওয়ালা, নিয়োগকারী')}
                />
              </div>
            </div>
          </fieldset>

          {/* Section 3: Complaint & Incident Details */}
          <fieldset style={{ border: '1px solid #EAEAEA', borderRadius: '6px', padding: '1rem', margin: '0 0 1rem' }}>
            <legend style={{ fontWeight: 600, padding: '0 0.5rem', color: '#111' }}>
              <Bi en="Complaint Summary & Incident Details" bn="অভিযোগ ও ঘটনার বিবরণ" />
            </legend>

            <div>
              <label htmlFor="complaint-summary"><Bi en="Complaint / Dispute Summary" bn="অভিযোগের সারসংক্ষেপ" /></label>
              <textarea
                id="complaint-summary"
                value={complaintSummary}
                onChange={(e) => setComplaintSummary(e.target.value)}
                rows={3}
              />
            </div>

            <div className="form-grid-2col" style={{ marginTop: '0.85rem' }}>
              <div>
                <label htmlFor="incident-when"><Bi en="When occurred" bn="কখন সংঘটিত হয়েছে" /></label>
                <input id="incident-when" value={incidentWhen} onChange={(e) => setIncidentWhen(e.target.value)} />
              </div>
              <div>
                <label htmlFor="incident-where"><Bi en="Where occurred" bn="ঘটনাস্থল / জেলা" /></label>
                <input id="incident-where" value={incidentWhere} onChange={(e) => setIncidentWhere(e.target.value)} />
              </div>
            </div>
          </fieldset>

          {/* Mandatory Officer Reason */}
          <div style={{ background: '#FAF9F6', padding: '1rem', borderRadius: '6px', border: '1px solid #E3E2DC' }}>
            <label htmlFor="edit-reason" style={{ color: '#111' }}>
              <strong><Bi en="Officer Reason for Editing Case Information (Mandatory)" bn="তথ্য সংশোধনের যৌক্তিক কারণ (বাধ্যতামূলক)" /></strong>
            </label>
            <textarea
              id="edit-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={bi('State why these case particulars were updated (e.g. verified NID submitted, party address updated)...', 'তথ্য সংশোধনের কারণ উল্লেখ করুন (যেমনঃ জাতীয় পরিচয়পত্র অনুযায়ী নাম ও ঠিকানা সংশোধন)...')}
              minLength={5}
              maxLength={1000}
              required
              rows={2}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.25rem' }}>
            <button
              type="button"
              className="secondary-button"
              onClick={onClose}
              disabled={submitting}
            >
              <Bi en="Cancel" bn="বাতিল" />
            </button>
            <button
              type="submit"
              disabled={submitting}
            >
              {submitting ? bi('Saving…', 'সংরক্ষণ হচ্ছে…') : bi('Save Changes & Record Audit', 'তথ্য সংশোধন ও অডিটে সংরক্ষণ')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
