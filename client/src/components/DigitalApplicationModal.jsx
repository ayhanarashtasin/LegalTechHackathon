import { useState, useRef } from 'react'
import { bi, say } from './Bi.jsx'
import { processImageFile } from '../utils/imageProcess.js'

// The applicant's own choice; each example helps her find the right one. The server decides what each category flags.
const CASE_CATEGORIES = [
  ['FAMILY_DOMESTIC', 'Spousal abuse, dowry, separation', 'স্বামীর নির্যাতন, যৌতুক, বিচ্ছেদ'],
  ['ONLINE_HARASSMENT', 'Threats, blackmail or private images shared online', 'অনলাইনে হুমকি, ব্ল্যাকমেইল বা ব্যক্তিগত ছবি ছড়ানো'],
  ['MAINTENANCE', 'Maintenance for a wife or children', 'স্ত্রী বা সন্তানের ভরণপোষণ দাবি'],
  ['MARRIAGE_DIVORCE', 'Divorce, dower (denmohor)', 'তালাক, দেনমোহর'],
  ['INHERITANCE', 'Dividing property after a death', 'মৃত্যুর পর সম্পত্তি বণ্টন'],
  ['LAND_PROPERTY', 'Boundary, tenancy, illegal possession', 'সীমানা, ভাড়াটিয়া, অবৈধ দখল'],
  ['LABOUR_WAGE', 'Unpaid wages, workplace injury', 'বকেয়া মজুরি, কর্মস্থলে দুর্ঘটনা'],
  ['CRIMINAL_AID', 'Accused of a crime and needing a lawyer', 'মামলায় অভিযুক্ত, আইনজীবী প্রয়োজন'],
  ['CHILD_CUSTODY', 'Who the children live with', 'সন্তান কার কাছে থাকবে'],
  ['FINANCIAL_FRAUD', 'Microfinance, loan harassment, fraud', 'ক্ষুদ্রঋণ, ঋণের হয়রানি, প্রতারণা'],
  ['ADVICE_ONLY', 'Only guidance, no case', 'শুধু পরামর্শ, মামলা নয়'],
  ['OTHER', 'None of these', 'এগুলোর কোনোটি নয়'],
]

const DISTRICTS = [
  'Dhaka', 'Chattogram', 'Rajshahi', 'Khulna', 'Barishal', 'Sylhet', 'Rangpur', 'Mymensingh',
  'Jhenaidah', 'Cumilla', 'Bogura', 'Gazipur', 'Narayanganj', 'Tangail', 'Faridpur', 'Cox\'s Bazar',
  'Barguna', 'Patuakhali', 'Barisal', 'Bhola', 'Jhalokati', 'Pirojpur', 'Bandarban', 'Brahmanbaria',
  'Chandpur', 'Feni', 'Khagrachhari', 'Lakshmipur', 'Noakhali', 'Rangamati', 'Bagerhat', 'Chuadanga',
  'Jashore', 'Kushtia', 'Magura', 'Meherpur', 'Narail', 'Satkhira', 'Jamalpur', 'Netrokona', 'Sherpur',
  'Joypurhat', 'Naogaon', 'Natore', 'Chapai Nawabganj', 'Pabna', 'Sirajganj', 'Dinajpur', 'Gaibandha',
  'Kurigram', 'Lalmonirhat', 'Nilphamari', 'Panchagarh', 'Thakurgaon', 'Habiganj', 'Moulvibazar',
  'Sunamganj', 'Gopalganj', 'Kishoreganj', 'Madaripur', 'Manikganj', 'Munshiganj', 'Narsingdi', 'Rajbari', 'Shariatpur'
]

// Crisp minimalist SVG icons
const CameraIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
    <circle cx="12" cy="13" r="3" />
  </svg>
)

const TrashIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 6h18m-2 0v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6m3 0V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
  </svg>
)

const CheckIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="20 6 9 17 4 12" />
  </svg>
)

export default function DigitalApplicationModal({
  isOpen,
  onClose,
  onSubmit,
  profile,
  session,
  isSubmitting,
  defaultIdentityDoc,
}) {
  const [applicantName, setApplicantName] = useState(
    () => profile?.displayName || session?.user?.displayName || ''
  )
  const [phone, setPhone] = useState(
    () => profile?.phone || session?.user?.phone || ''
  )
  const [district, setDistrict] = useState(() => {
    if (profile?.district && DISTRICTS.includes(profile.district)) return profile.district
    return 'Dhaka'
  })
  const [problem, setProblem] = useState('')
  const [category, setCategory] = useState('')
  const [urgent, setUrgent] = useState(false)

  // Identity document selection & conditional data
  const [identityDoc, setIdentityDoc] = useState(
    () => defaultIdentityDoc || (profile?.nid ? 'NID' : 'NID')
  )
  const [nidNumber, setNidNumber] = useState(() => profile?.nid || '')
  const [nidPhoto, setNidPhoto] = useState(null)
  const [birthCertNumber, setBirthCertNumber] = useState('')
  const [birthCertPhoto, setBirthCertPhoto] = useState(null)

  // Prottayonpotro (প্রত্যয়নপত্র) section - shown when identityDoc === 'NONE'
  const [prottayonIssuerType, setProttayonIssuerType] = useState('CHAIRMAN')
  const [prottayonIssuerName, setProttayonIssuerName] = useState('')
  const [prottayonMemoNumber, setProttayonMemoNumber] = useState('')
  const [prottayonIssueDate, setProttayonIssueDate] = useState('')
  const [prottayonPhoto, setProttayonPhoto] = useState(null)

  // Extra supporting documents
  const [extraDocuments, setExtraDocuments] = useState([])
  const [processingFile, setProcessingFile] = useState(false)
  const [formError, setFormError] = useState('')

  const nidFileInputRef = useRef(null)
  const birthCertFileInputRef = useRef(null)
  const prottayonFileInputRef = useRef(null)
  const extraFileInputRef = useRef(null)

  if (!isOpen) return null

  // Handle single file processing (NID, Birth Certificate, Prottayonpotro)
  async function handleSingleFile(e, setter) {
    const file = e.target.files?.[0]
    if (!file) return
    setProcessingFile(true)
    setFormError('')
    try {
      const processed = await processImageFile(file)
      setter(processed)
    } catch {
      setFormError(bi('Failed to process image. Please try another file.', 'ছবি প্রক্রিয়া করতে সমস্যা হয়েছে। অন্য কোনো ছবি দিয়ে চেষ্টা করুন।'))
    } finally {
      setProcessingFile(false)
      e.target.value = ''
    }
  }

  // Handle extra documents upload (multiple pictures)
  async function handleExtraFiles(e) {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    setProcessingFile(true)
    setFormError('')
    try {
      const processedList = []
      for (const file of files) {
        const processed = await processImageFile(file)
        if (processed) {
          processedList.push({
            id: crypto.randomUUID(),
            label: file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' '),
            filename: processed.filename,
            dataUrl: processed.dataUrl,
            size: processed.size,
          })
        }
      }
      setExtraDocuments((prev) => [...prev, ...processedList])
    } catch {
      setFormError(bi('Failed to process one or more images.', 'কিছু ছবি প্রক্রিয়া করতে সমস্যা হয়েছে।'))
    } finally {
      setProcessingFile(false)
      e.target.value = ''
    }
  }

  function removeExtraDoc(id) {
    setExtraDocuments((prev) => prev.filter((doc) => doc.id !== id))
  }

  function updateExtraDocLabel(id, label) {
    setExtraDocuments((prev) =>
      prev.map((doc) => (doc.id === id ? { ...doc, label } : doc))
    )
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!category) {
      setFormError(bi('Please choose the type of your legal matter.', 'দয়া করে আপনার আইনি বিষয়ের ধরন নির্বাচন করুন।'))
      return
    }
    if (!problem.trim()) {
      setFormError(bi('Please describe your legal matter or problem.', 'দয়া করে আপনার আইনি সমস্যা বা বিরোধের বিবরণ লিখুন।'))
      return
    }

    setFormError('')

    const hasProttayonInfo = Boolean(
      prottayonIssuerName.trim() ||
      prottayonMemoNumber.trim() ||
      prottayonIssueDate ||
      prottayonPhoto
    )

    const payload = {
      applicantName: applicantName.trim() || session?.user?.displayName || 'Citizen Applicant',
      problem: problem.trim(),
      category,
      district,
      contactPhone: phone.trim(),
      urgent,
      identityDocument: identityDoc,
      ...(identityDoc === 'NID' ? {
        nidNumber: nidNumber.trim(),
        nidPhoto: nidPhoto ? { filename: nidPhoto.filename, dataUrl: nidPhoto.dataUrl } : null,
      } : {}),
      ...(identityDoc === 'BIRTH_CERTIFICATE' ? {
        birthCertificateNumber: birthCertNumber.trim(),
        birthCertificatePhoto: birthCertPhoto ? { filename: birthCertPhoto.filename, dataUrl: birthCertPhoto.dataUrl } : null,
      } : {}),
      prottayonpotro: {
        status: (identityDoc === 'NONE' && hasProttayonInfo) ? 'YES' : 'NOT_AVAILABLE',
        ...(identityDoc === 'NONE' && hasProttayonInfo ? {
          issuerType: prottayonIssuerType,
          issuerName: prottayonIssuerName.trim(),
          memoNumber: prottayonMemoNumber.trim(),
          issueDate: prottayonIssueDate,
          photo: prottayonPhoto ? { filename: prottayonPhoto.filename, dataUrl: prottayonPhoto.dataUrl } : null,
        } : {}),
      },
      extraDocuments: extraDocuments.map((doc) => ({
        label: doc.label.trim() || 'Extra Supporting Evidence',
        filename: doc.filename,
        dataUrl: doc.dataUrl,
      })),
    }

    onSubmit(payload)
  }

  return (
    <div
      className="auth-modal-overlay digital-app-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="digital-app-modal-title"
    >
      <div className="auth-modal-backdrop" onClick={onClose} />

      <div className="auth-modal-card digital-app-modal-card">
        <form onSubmit={handleSubmit} className="digital-app-form-wrapper">
          {/* Static Top Header - zero scroll recalculation */}
          <div className="digital-app-modal-header">
            <div>
              <span className="auth-modal-sub">
                {bi('Government Legal Aid Services (LASA 2000)', 'আইনগত সহায়তা প্রদান কার্যক্রম (আইন ২০০০)')}
              </span>
              <h2 id="digital-app-modal-title" className="auth-modal-heading">
                {bi('Submit Digital Legal Aid Application', 'আইনি সহায়তার ডিজিটাল আবেদনপত্র')}
              </h2>
            </div>
            <button
              type="button"
              className="auth-modal-close"
              onClick={onClose}
              aria-label={bi('Close modal', 'বন্ধ করুন')}
            >
              &times;
            </button>
          </div>

          {formError && (
            <div className="auth-alert error digital-app-alert" role="alert">
              {formError}
            </div>
          )}

          {/* Smooth Single-Container Scrollable Body */}
          <div className="digital-app-form">
            {/* SECTION 1: APPLICANT & SAFE CONTACT */}
            <fieldset className="digital-app-section">
              <legend className="digital-app-section-title">
                <span className="section-number">1</span>
                {bi('Applicant & Safe Contact Details', 'আবেদনকারী ও জরুরি যোগাযোগের তথ্য')}
              </legend>

              <div className="digital-app-grid-2">
                <div className="form-field-group">
                  <label htmlFor="app-applicant-name" className="digital-app-label">
                    {bi('Applicant Name', 'আবেদনকারীর নাম')} <span className="req-star">*</span>
                  </label>
                  <input
                    id="app-applicant-name"
                    type="text"
                    required
                    className="digital-app-input"
                    placeholder={bi('e.g. Most. Rahima Begum', 'যেমন: মোছাঃ রহিমা বেগম')}
                    value={applicantName}
                    onChange={(e) => setApplicantName(e.target.value)}
                  />
                </div>

                <div className="form-field-group">
                  <label htmlFor="app-phone" className="digital-app-label">
                    {bi('Safe Contact Phone', 'জরুরি যোগাযোগের ফোন নম্বর')} <span className="req-star">*</span>
                  </label>
                  <input
                    id="app-phone"
                    type="tel"
                    required
                    className="digital-app-input"
                    placeholder="01700000000"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                  <span className="field-hint">
                    {bi('Confidential number reached only during 9 AM - 5 PM', 'গোপনীয় নম্বর যা শুধুমাত্র অফিস চলাকালীন ব্যবহৃত হবে')}
                  </span>
                </div>
              </div>

              <div className="form-field-group" style={{ marginTop: '0.85rem' }}>
                <label htmlFor="app-district" className="digital-app-label">
                  {bi('District Jurisdiction', 'আবেদনের আওতাধীন জেলা')} <span className="req-star">*</span>
                </label>
                <select
                  id="app-district"
                  className="digital-app-select"
                  value={district}
                  onChange={(e) => setDistrict(e.target.value)}
                >
                  {DISTRICTS.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>
            </fieldset>

            {/* SECTION 2: LEGAL MATTER / INCIDENT */}
            <fieldset className="digital-app-section">
              <legend className="digital-app-section-title">
                <span className="section-number">2</span>
                {bi('Describe Your Legal Matter / Incident', 'আপনার আইনি সমস্যা, বিরোধ বা ঘটনার বিবরণ')}
              </legend>

              <div className="form-field-group">
                <label htmlFor="app-category" className="digital-app-label">
                  {bi('Type of matter', 'বিষয়ের ধরন')} <span className="req-star">*</span>
                </label>
                <select
                  id="app-category"
                  required
                  className="digital-app-select"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  aria-describedby="app-category-hint"
                >
                  <option value="">{bi('Choose one', 'একটি নির্বাচন করুন')}</option>
                  {CASE_CATEGORIES.map(([code, en, bn]) => (
                    <option key={code} value={code}>{say(code)} ({bi(en, bn)})</option>
                  ))}
                </select>
                <p id="app-category-hint" className="field-hint" aria-live="polite">
                  {category === 'ADVICE_ONLY'
                    ? bi('No case will be opened. The 16699 helpline will call you back with guidance.', 'কোনো মামলা খোলা হবে না। ১৬৬৯৯ হেল্পলাইন থেকে আপনাকে ফোন করে পরামর্শ দেওয়া হবে।')
                    : bi('Not sure? Choose "Other" and an officer will decide.', 'নিশ্চিত না হলে "অন্যান্য" বেছে নিন, কর্মকর্তা ঠিক করে দেবেন।')}
                </p>
              </div>

              <div className="form-field-group">
                <label htmlFor="app-problem" className="digital-app-label">
                  {bi('Statement of Incident or Legal Dispute', 'ঘটনার সম্পূর্ণ বিবরণ')} <span className="req-star">*</span>
                </label>
                <textarea
                  id="app-problem"
                  rows="4"
                  required
                  className="digital-app-textarea"
                  placeholder={bi(
                    'Describe the dispute, family maintenance, land dispossession, labor wage non-payment, violence, or legal issue in detail.',
                    'পারিবারিক খোরপোষ, জমি বেদখল, বকেয়া মজুরি আদায়, নির্যাতন বা আইনি সংকটের বিস্তারিত ঘটনা এখানে লিখুন।'
                  )}
                  value={problem}
                  onChange={(e) => setProblem(e.target.value)}
                />
              </div>

              <label className="digital-app-checkbox-card" htmlFor="app-urgent">
                <input
                  id="app-urgent"
                  type="checkbox"
                  className="digital-app-checkbox"
                  checked={urgent}
                  onChange={(e) => setUrgent(e.target.checked)}
                />
                <div className="checkbox-text-block">
                  <strong>{bi('Immediate danger or urgent protection requested', 'তাৎক্ষণিক জীবনের ঝুঁকি বা জরুরি আইনি সুরক্ষার আবেদন')}</strong>
                  <p className="field-hint" style={{ margin: '0.15rem 0 0 0' }}>
                    {bi(
                      'Check if this involves active threats, imminent eviction, domestic violence, or emergency injunction.',
                      'মারধরের হুমকি, তাৎক্ষণিক উচ্ছেদ বা জরুরি নিরাপত্তা আদেশের প্রয়োজন হলে নির্বাচন করুন।'
                    )}
                  </p>
                </div>
              </label>
            </fieldset>

            {/* SECTION 3: IDENTITY DOCUMENT VERIFICATION */}
            <fieldset className="digital-app-section">
              <legend className="digital-app-section-title">
                <span className="section-number">3</span>
                {bi('Identity Document Available', 'সংযুক্ত পরিচয়পত্র / প্রমাণক')}
              </legend>

              <div className="digital-app-doc-tabs" role="radiogroup" aria-label={bi('Identity Document Type', 'পরিচয়পত্রের ধরন')}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={identityDoc === 'NID'}
                  className={`doc-tab-btn ${identityDoc === 'NID' ? 'active' : ''}`}
                  onClick={() => setIdentityDoc('NID')}
                >
                  {identityDoc === 'NID' && <CheckIcon />}
                  <span>{bi('National ID (NID)', 'জাতীয় পরিচয়পত্র (এনআইডি)')}</span>
                </button>

                <button
                  type="button"
                  role="radio"
                  aria-checked={identityDoc === 'BIRTH_CERTIFICATE'}
                  className={`doc-tab-btn ${identityDoc === 'BIRTH_CERTIFICATE' ? 'active' : ''}`}
                  onClick={() => setIdentityDoc('BIRTH_CERTIFICATE')}
                >
                  {identityDoc === 'BIRTH_CERTIFICATE' && <CheckIcon />}
                  <span>{bi('Birth Certificate', 'জন্ম নিবন্ধন সনদ')}</span>
                </button>

                <button
                  type="button"
                  role="radio"
                  aria-checked={identityDoc === 'NONE'}
                  className={`doc-tab-btn ${identityDoc === 'NONE' ? 'active' : ''}`}
                  onClick={() => setIdentityDoc('NONE')}
                >
                  {identityDoc === 'NONE' && <CheckIcon />}
                  <span>{bi('None / Not Available', 'কোনোটি নেই / সংযুক্ত নেই')}</span>
                </button>
              </div>

              {/* CONDITIONAL NID BOX */}
              {identityDoc === 'NID' && (
                <div className="conditional-box animated-fade-in">
                  <div className="form-field-group">
                    <label htmlFor="app-nid-number" className="digital-app-label">
                      {bi('National ID (NID) Number', 'জাতীয় পরিচয়পত্র নম্বর')}
                    </label>
                    <input
                      id="app-nid-number"
                      type="text"
                      inputMode="numeric"
                      className="digital-app-input"
                      placeholder={bi('e.g. 19901234567890123 or 10-digit Smart Card', 'যেমন: ১৯৯০১২৩৪৫৬৭৮৯০১২৩ বা ১০ ডিজিটের স্মার্ট কার্ড')}
                      value={nidNumber}
                      onChange={(e) => setNidNumber(e.target.value)}
                    />
                    <span className="field-hint">
                      {bi('Accepts 10-digit Smart NID, 13-digit, or 17-digit format', '১০, ১৩ অথবা ১৭ সংখ্যার এনআইডি নম্বর গ্রহণযোগ্য')}
                    </span>
                  </div>

                  <div className="file-upload-block" style={{ marginTop: '0.85rem' }}>
                    <label className="digital-app-label">
                      {bi('Picture of NID Card (Front / Back)', 'জাতীয় পরিচয়পত্রের ছবি / স্ক্যান কপি (ঐচ্ছিক)')}
                    </label>

                    <input
                      type="file"
                      ref={nidFileInputRef}
                      accept="image/*,.pdf"
                      style={{ display: 'none' }}
                      onChange={(e) => handleSingleFile(e, setNidPhoto)}
                    />

                    {nidPhoto ? (
                      <div className="file-preview-card">
                        {nidPhoto.dataUrl?.startsWith('data:image/') ? (
                          <img src={nidPhoto.dataUrl} alt={bi('NID Preview', 'এনআইডি প্রিভিউ')} className="file-thumbnail" />
                        ) : (
                          <div className="file-thumbnail-placeholder">PDF</div>
                        )}
                        <div className="file-info-text">
                          <span className="file-name">{nidPhoto.filename}</span>
                          <span className="file-size">{Math.round(nidPhoto.size / 1024)} KB · {bi('Ready to upload', 'সংযুক্ত প্রস্তুত')}</span>
                        </div>
                        <button
                          type="button"
                          className="file-remove-btn"
                          onClick={() => setNidPhoto(null)}
                          aria-label={bi('Remove NID photo', 'ছবি বাতিল করুন')}
                        >
                          <TrashIcon />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="upload-trigger-btn"
                        onClick={() => nidFileInputRef.current?.click()}
                      >
                        <CameraIcon />
                        <span>{bi('Take Photo or Upload NID Card', 'এনআইডির ছবি তুলুন বা আপলোড করুন')}</span>
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* CONDITIONAL BIRTH CERTIFICATE BOX */}
              {identityDoc === 'BIRTH_CERTIFICATE' && (
                <div className="conditional-box animated-fade-in">
                  <div className="form-field-group">
                    <label htmlFor="app-birth-cert-number" className="digital-app-label">
                      {bi('Birth Registration Certificate Number (BRN)', 'জন্ম নিবন্ধন সনদ নম্বর (১৭ সংখ্যা)')}
                    </label>
                    <input
                      id="app-birth-cert-number"
                      type="text"
                      inputMode="numeric"
                      className="digital-app-input"
                      placeholder={bi('e.g. 20011234567890123 (17 digits)', 'যেমন: ২০০১১২৩৪৫৬৭৮৯০১২৩ (১৭ ডিজিট)')}
                      value={birthCertNumber}
                      onChange={(e) => setBirthCertNumber(e.target.value)}
                    />
                    <span className="field-hint">
                      {bi('Official 17-digit birth registration number', 'সরকারি ১৭ সংখ্যার জন্ম নিবন্ধন নম্বর')}
                    </span>
                  </div>

                  <div className="file-upload-block" style={{ marginTop: '0.85rem' }}>
                    <label className="digital-app-label">
                      {bi('Picture of Birth Certificate', 'জন্ম নিবন্ধন সনদের ছবি (ঐচ্ছিক)')}
                    </label>

                    <input
                      type="file"
                      ref={birthCertFileInputRef}
                      accept="image/*,.pdf"
                      style={{ display: 'none' }}
                      onChange={(e) => handleSingleFile(e, setBirthCertPhoto)}
                    />

                    {birthCertPhoto ? (
                      <div className="file-preview-card">
                        {birthCertPhoto.dataUrl?.startsWith('data:image/') ? (
                          <img src={birthCertPhoto.dataUrl} alt={bi('Birth Certificate Preview', 'জন্ম নিবন্ধন প্রিভিউ')} className="file-thumbnail" />
                        ) : (
                          <div className="file-thumbnail-placeholder">PDF</div>
                        )}
                        <div className="file-info-text">
                          <span className="file-name">{birthCertPhoto.filename}</span>
                          <span className="file-size">{Math.round(birthCertPhoto.size / 1024)} KB · {bi('Ready to upload', 'সংযুক্ত প্রস্তুত')}</span>
                        </div>
                        <button
                          type="button"
                          className="file-remove-btn"
                          onClick={() => setBirthCertPhoto(null)}
                          aria-label={bi('Remove birth certificate photo', 'ছবি বাতিল করুন')}
                        >
                          <TrashIcon />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="upload-trigger-btn"
                        onClick={() => birthCertFileInputRef.current?.click()}
                      >
                        <CameraIcon />
                        <span>{bi('Take Photo or Upload Birth Certificate', 'জন্ম নিবন্ধনের ছবি তুলুন বা আপলোড করুন')}</span>
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* NONE NOTIFICATION */}
              {identityDoc === 'NONE' && (
                <div className="digital-app-info-card animated-fade-in">
                  <span className="info-badge">{bi('Legal Protection', 'আইনি নিশ্চয়তা')}</span>
                  <p>
                    {bi(
                      'No identity document required. Under the Legal Aid Services Act (LASA 2000), citizens without an immediate ID are fully entitled to receive legal consultation and aid.',
                      'কোনো পরিচয়পত্র বাধ্যতামূলক নয়। আইনগত সহায়তা প্রদান আইন, ২০০০ অনুযায়ী তাৎক্ষণিক পরিচয়পত্র না থাকলেও সরকারি আইনি পরামর্শ ও সহায়তা পাওয়ার পূর্ণ অধিকার নাগরিকের রয়েছে।'
                    )}
                  </p>
                </div>
              )}
            </fieldset>

            {/* SECTION 4: PROTTAYONPOTRO - ONLY SHOWN WHEN identityDoc === 'NONE' (NO APPLIED / NOT AVAILABLE TABS) */}
            {identityDoc === 'NONE' && (
              <fieldset className="digital-app-section animated-fade-in">
                <legend className="digital-app-section-title">
                  <span className="section-number">4</span>
                  {bi('Prottayonpotro / Local Authority Certificate', 'প্রত্যয়নপত্র (ইউপি চেয়ারম্যান / কাউন্সিলর সনদ)')}
                </legend>

                <p className="section-desc">
                  {bi(
                    'Attestation certificate from local Union Parishad Chairman, Ward Councilor, or Mayor verifying low income or residency (optional).',
                    'ইউনিয়ন পরিষদ চেয়ারম্যান, ওয়ার্ড কাউন্সিলর বা মেয়র কর্তৃক প্রদত্ত অসচ্ছলতা বা নাগরিকত্ব প্রত্যয়নপত্র থাকলে বিবরণ ও ছবি দিন (ঐচ্ছিক)।'
                  )}
                </p>

                <div className="conditional-box">
                  <div className="digital-app-grid-2">
                    <div className="form-field-group">
                      <label htmlFor="prottayon-issuer-type" className="digital-app-label">
                        {bi('Issuing Authority', 'প্রত্যয়নকারী কর্তৃপক্ষ')}
                      </label>
                      <select
                        id="prottayon-issuer-type"
                        className="digital-app-select"
                        value={prottayonIssuerType}
                        onChange={(e) => setProttayonIssuerType(e.target.value)}
                      >
                        <option value="CHAIRMAN">{bi('Union Parishad Chairman', 'ইউনিয়ন পরিষদ চেয়ারম্যান')}</option>
                        <option value="COUNCILOR">{bi('Ward Councilor (City Corp / Municipality)', 'ওয়ার্ড কাউন্সিলর (পৌরসভা / সিটি কর্পোরেশন)')}</option>
                        <option value="MAYOR">{bi('Pourashava / City Mayor', 'পৌরসভা / সিটি মেয়র')}</option>
                        <option value="GAZETTED_OFFICER">{bi('Gazetted Officer / Other', 'গেজেটেড কর্মকর্তা / অন্যান্য')}</option>
                      </select>
                    </div>

                    <div className="form-field-group">
                      <label htmlFor="prottayon-issuer-name" className="digital-app-label">
                        {bi('Office / Union / Ward Name', 'ইউনিয়ন পরিষদ / ওয়ার্ড / কার্যালয়ের নাম')}
                      </label>
                      <input
                        id="prottayon-issuer-name"
                        type="text"
                        className="digital-app-input"
                        placeholder={bi('e.g. Sreepur Union Parishad, Gazipur', 'যেমন: শ্রীপুর ইউনিয়ন পরিষদ, গাজীপুর')}
                        value={prottayonIssuerName}
                        onChange={(e) => setProttayonIssuerName(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="digital-app-grid-2" style={{ marginTop: '0.85rem' }}>
                    <div className="form-field-group">
                      <label htmlFor="prottayon-memo" className="digital-app-label">
                        {bi('Certificate / Memo No. (Optional)', 'স্মারক নম্বর / ক্রমিক (ঐচ্ছিক)')}
                      </label>
                      <input
                        id="prottayon-memo"
                        type="text"
                        className="digital-app-input"
                        placeholder="123/2026"
                        value={prottayonMemoNumber}
                        onChange={(e) => setProttayonMemoNumber(e.target.value)}
                      />
                    </div>

                    <div className="form-field-group">
                      <label htmlFor="prottayon-date" className="digital-app-label">
                        {bi('Date of Issuance (Optional)', 'সনদ প্রদানের তারিখ (ঐচ্ছিক)')}
                      </label>
                      <input
                        id="prottayon-date"
                        type="date"
                        className="digital-app-input"
                        value={prottayonIssueDate}
                        onChange={(e) => setProttayonIssueDate(e.target.value)}
                      />
                    </div>
                  </div>

                  {/* Prottayonpotro Photo Upload */}
                  <div className="file-upload-block" style={{ marginTop: '0.85rem' }}>
                    <label className="digital-app-label">
                      {bi('Picture of Prottayonpotro Document', 'প্রত্যয়নপত্রের ছবি / স্ক্যান কপি (ঐচ্ছিক)')}
                    </label>

                    <input
                      type="file"
                      ref={prottayonFileInputRef}
                      accept="image/*,.pdf"
                      style={{ display: 'none' }}
                      onChange={(e) => handleSingleFile(e, setProttayonPhoto)}
                    />

                    {prottayonPhoto ? (
                      <div className="file-preview-card">
                        {prottayonPhoto.dataUrl?.startsWith('data:image/') ? (
                          <img src={prottayonPhoto.dataUrl} alt={bi('Prottayonpotro Preview', 'প্রত্যয়নপত্র প্রিভিউ')} className="file-thumbnail" />
                        ) : (
                          <div className="file-thumbnail-placeholder">PDF</div>
                        )}
                        <div className="file-info-text">
                          <span className="file-name">{prottayonPhoto.filename}</span>
                          <span className="file-size">{Math.round(prottayonPhoto.size / 1024)} KB · {bi('Ready to upload', 'সংযুক্ত প্রস্তুত')}</span>
                        </div>
                        <button
                          type="button"
                          className="file-remove-btn"
                          onClick={() => setProttayonPhoto(null)}
                          aria-label={bi('Remove prottayonpotro photo', 'প্রত্যয়নপত্রের ছবি বাতিল করুন')}
                        >
                          <TrashIcon />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="upload-trigger-btn"
                        onClick={() => prottayonFileInputRef.current?.click()}
                      >
                        <CameraIcon />
                        <span>{bi('Take Photo or Upload Prottayonpotro', 'প্রত্যয়নপত্রের ছবি তুলুন বা আপলোড করুন')}</span>
                      </button>
                    )}
                  </div>
                </div>

                <div className="digital-app-info-card" style={{ marginTop: '0.65rem' }}>
                  <span className="info-badge">{bi('Guidance', 'সহায়ক নির্দেশনা')}</span>
                  <p>
                    {bi(
                      'If you do not have a Prottayonpotro right now, you may leave these optional fields blank. The DLAO office will review your matter and guide you during your consultation.',
                      'আপাতত প্রত্যয়নপত্র সংগ্রহে না থাকলেও কোনো অসুবিধা নেই, ঘরগুলো ফাঁকা রেখে আবেদন দাখিল করতে পারেন। জেলা লিগ্যাল এইড কর্মকর্তা আপনার সমস্যা পর্যালোচনা করে পরামর্শের সময় প্রয়োজনীয় নির্দেশনা দেবেন।'
                    )}
                  </p>
                </div>
              </fieldset>
            )}

            {/* SECTION 5 (or 4): EXTRA SUPPORTING DOCUMENTS PICTURE UPLOAD */}
            <fieldset className="digital-app-section">
              <legend className="digital-app-section-title">
                <span className="section-number">{identityDoc === 'NONE' ? '5' : '4'}</span>
                {bi('Extra Supporting Documents & Evidence Photos', 'অতিরিক্ত প্রমাণক ও সহায়ক নথিপত্রের ছবি')}
              </legend>

              <p className="section-desc">
                {bi(
                  'Upload photos of land deeds, contracts, police complaints, medical slips, receipts, or any other dispute evidence.',
                  'জমির দলিল, চুক্তিপত্র, পুলিশ জিডি/অভিযোগপত্র, চিকিৎসা সনদ বা বিরোধ সংশ্লিষ্ট প্রমাণাদির ছবি সংযুক্ত করতে পারেন।'
                )}
              </p>

              <input
                type="file"
                ref={extraFileInputRef}
                multiple
                accept="image/*,.pdf"
                style={{ display: 'none' }}
                onChange={handleExtraFiles}
              />

              <button
                type="button"
                className="upload-trigger-btn"
                onClick={() => extraFileInputRef.current?.click()}
                disabled={processingFile}
              >
                <CameraIcon />
                <span>
                  {processingFile
                    ? bi('Processing image…', 'ছবি প্রসেস হচ্ছে…')
                    : bi('Take Photo or Upload Supporting Documents', 'সহায়ক নথির ছবি তুলুন বা আপলোড করুন')}
                </span>
              </button>

              {extraDocuments.length > 0 && (
                <div className="extra-docs-grid animated-fade-in">
                  {extraDocuments.map((doc, idx) => (
                    <div key={doc.id} className="extra-doc-item">
                      {doc.dataUrl?.startsWith('data:image/') ? (
                        <img src={doc.dataUrl} alt={doc.label} className="extra-doc-thumb" />
                      ) : (
                        <div className="extra-doc-placeholder">DOC</div>
                      )}
                      <div className="extra-doc-details">
                        <div className="extra-doc-top">
                          <span className="extra-doc-num">#{idx + 1}</span>
                          <button
                            type="button"
                            className="file-remove-btn mini-btn"
                            onClick={() => removeExtraDoc(doc.id)}
                            aria-label={bi(`Remove ${doc.label}`, `${doc.label} মুছুন`)}
                          >
                            <TrashIcon />
                          </button>
                        </div>
                        <input
                          type="text"
                          className="extra-doc-label-input"
                          value={doc.label}
                          onChange={(e) => updateExtraDocLabel(doc.id, e.target.value)}
                          placeholder={bi('Document title / description', 'নথির শিরোনাম / বিবরণ')}
                        />
                        <span className="file-size">{Math.round(doc.size / 1024)} KB</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </fieldset>
          </div>

          {/* Static Action Footer - outside scroll container, zero jank */}
          <div className="digital-app-modal-footer">
            <button
              type="button"
              className="secondary-button modal-cancel-btn"
              onClick={onClose}
              disabled={isSubmitting || processingFile}
            >
              {bi('Cancel', 'বাতিল')}
            </button>
            <button
              type="submit"
              className="primary-action-btn modal-submit-btn"
              disabled={isSubmitting || processingFile || !problem.trim()}
            >
              {isSubmitting
                ? bi('Submitting Application…', 'আবেদন জমা হচ্ছে…')
                : bi('Submit Legal Aid Application', 'আবেদন দাখিল করুন')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
