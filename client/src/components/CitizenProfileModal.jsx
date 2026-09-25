import { useState, useEffect } from 'react'
import { api } from '../services/api.js'
import { bi } from './Bi.jsx'

const DISTRICTS = [
  'Dhaka', 'Chattogram', 'Rajshahi', 'Khulna', 'Barishal', 'Sylhet', 'Rangpur', 'Mymensingh',
  'Jhenaidah', 'Cumilla', 'Bogura', 'Gazipur', 'Narayanganj', 'Tangail', 'Faridpur', 'Cox\'s Bazar'
]

function formatTime12(time24) {
  if (!time24 || !time24.includes(':')) return ''
  const [hStr, mStr] = time24.split(':')
  let h = parseInt(hStr, 10)
  const m = (mStr || '00').slice(0, 2).padStart(2, '0')
  if (isNaN(h)) return ''
  const ampm = h >= 12 ? 'PM' : 'AM'
  h = h % 12
  if (h === 0) h = 12
  return `${h.toString().padStart(2, '0')}:${m} ${ampm}`
}

function parseTimeTo24(str) {
  if (!str) return ''
  const trimmed = str.trim()
  const m24 = trimmed.match(/^(\d{1,2}):(\d{2})$/)
  if (m24) {
    return `${m24[1].padStart(2, '0')}:${m24[2]}`
  }
  const m12 = trimmed.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i)
  if (m12) {
    let h = parseInt(m12[1], 10)
    const m = m12[2] ? m12[2].padStart(2, '0') : '00'
    const ampm = m12[3].toUpperCase()
    if (ampm === 'PM' && h < 12) h += 12
    if (ampm === 'AM' && h === 12) h = 0
    return `${h.toString().padStart(2, '0')}:${m}`
  }
  return ''
}

function parseTimeRange(rangeStr) {
  if (!rangeStr) return { start: '', end: '' }
  const clean = rangeStr.replace(/^(from|until)\s+/i, '')
  const parts = clean.split(/\s*[-–—to]+\s*/i)
  if (parts.length >= 2) {
    return {
      start: parseTimeTo24(parts[0]),
      end: parseTimeTo24(parts[1]),
    }
  }
  if (/^from\s+/i.test(rangeStr)) {
    return { start: parseTimeTo24(clean), end: '' }
  }
  if (/^until\s+/i.test(rangeStr)) {
    return { start: '', end: parseTimeTo24(clean) }
  }
  return { start: parseTimeTo24(clean), end: '' }
}

// Crisp minimalist SVG icons
const UserIcon = () => (
  <svg className="form-field-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
)

const MailIcon = () => (
  <svg className="form-field-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
    <rect width="20" height="16" x="2" y="4" rx="2" />
    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
  </svg>
)

const PhoneIcon = () => (
  <svg className="form-field-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
  </svg>
)

const IdCardIcon = () => (
  <svg className="form-field-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
    <rect width="20" height="14" x="2" y="5" rx="2" />
    <line x1="2" x2="22" y1="10" y2="10" />
    <line x1="6" x2="10" y1="15" y2="15" />
    <line x1="14" x2="18" y1="15" y2="15" />
  </svg>
)

const MapPinIcon = () => (
  <svg className="form-field-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
    <circle cx="12" cy="10" r="3" />
  </svg>
)

const ClockIcon = () => (
  <svg className="form-field-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
)

const ShieldIcon = () => (
  <svg className="form-field-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
)

const BriefcaseIcon = () => (
  <svg className="form-field-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
    <rect width="20" height="14" x="2" y="7" rx="2" />
    <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
  </svg>
)

const PencilIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
  </svg>
)

const LockIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
    <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
)

export default function CitizenProfileModal({ isOpen, session, onClose, onProfileUpdated }) {
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [isEditing, setIsEditing] = useState(false)
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  // Form fields
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [nid, setNid] = useState('')
  const [district, setDistrict] = useState('')
  const [safeTimeWindow, setSafeTimeWindow] = useState('')
  const [safeStartTime, setSafeStartTime] = useState('')
  const [safeEndTime, setSafeEndTime] = useState('')
  const [saving, setSaving] = useState(false)

  // Password change state
  const [showPasswordSection, setShowPasswordSection] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [changingPassword, setChangingPassword] = useState(false)
  const [passwordMsg, setPasswordMsg] = useState('')
  const [passwordError, setPasswordError] = useState('')

  useEffect(() => {
    if (!isOpen || !session?.token) return
    const controller = new AbortController()

    api('/api/citizen/profile', { token: session.token, signal: controller.signal })
      .then((data) => {
        if (data.profile) {
          setProfile(data.profile)
          setFullName(data.profile.displayName || session.user.displayName || '')
          setEmail(data.profile.username || session.user.username || '')
          setPhone(data.profile.phone || '')
          setNid(data.profile.nid || '')
          setDistrict(data.profile.district || '')
          const rawTime = data.profile.safeTimeWindow || ''
          setSafeTimeWindow(rawTime)
          const parsed = parseTimeRange(rawTime)
          setSafeStartTime(parsed.start)
          setSafeEndTime(parsed.end)
        }
        setLoading(false)
      })
      .catch((err) => {
        if (err.name !== 'AbortError') {
          setError(err.message)
          setLoading(false)
        }
      })

    return () => controller.abort()
  }, [isOpen, session])

  if (!isOpen) return null

  const isVerified = profile?.identityStatus === 'VERIFIED'
  const userDisplayName = profile?.displayName || session?.user?.displayName || session?.user?.username || 'User'
  const userIdentifier = profile?.username || session?.user?.username || ''
  const mattersCount = profile?.cases?.length ?? 0
  const identityStatusText = profile?.identityStatus || 'INCOMPLETE'

  function handleStartEdit() {
    setShowPasswordSection(false)
    setIsEditing(true)
    setError('')
    setSuccessMsg('')
    setPasswordMsg('')
    setPasswordError('')
  }

  function handleCancelEdit() {
    setFullName(profile?.displayName || session.user.displayName || '')
    setEmail(profile?.username || session.user.username || '')
    setPhone(profile?.phone || '')
    setNid(profile?.nid || '')
    setDistrict(profile?.district || '')
    const rawTime = profile?.safeTimeWindow || ''
    setSafeTimeWindow(rawTime)
    const parsed = parseTimeRange(rawTime)
    setSafeStartTime(parsed.start)
    setSafeEndTime(parsed.end)
    setIsEditing(false)
    setError('')
  }

  function handleTimeChange(start, end) {
    setSafeStartTime(start)
    setSafeEndTime(end)
    if (start && end) {
      setSafeTimeWindow(`${formatTime12(start)} – ${formatTime12(end)}`)
    } else if (start) {
      setSafeTimeWindow(`From ${formatTime12(start)}`)
    } else if (end) {
      setSafeTimeWindow(`Until ${formatTime12(end)}`)
    } else {
      setSafeTimeWindow('')
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!fullName.trim()) return

    setSaving(true)
    setError('')
    setSuccessMsg('')
    try {
      const res = await api('/api/citizen/profile', {
        method: 'PUT',
        token: session.token,
        body: {
          displayName: fullName.trim(),
          email: email.trim(),
          phone: phone.trim(),
          nid: nid.trim(),
          district: district.trim(),
          safeTimeWindow: safeTimeWindow.trim(),
        },
      })
      if (res.profile) {
        setProfile(res.profile)
        if (onProfileUpdated) onProfileUpdated(res.profile)
      }
      setSuccessMsg(bi('Profile updated successfully.', 'প্রোফাইল সফলভাবে সংরক্ষিত হয়েছে।'))
      setIsEditing(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handlePasswordChange(e) {
    e.preventDefault()
    setPasswordError('')
    setPasswordMsg('')

    if (newPassword.length < 3) {
      setPasswordError(bi('New password must be at least 3 characters.', 'নতুন পাসওয়ার্ড ন্যূনতম ৩ অক্ষরের হতে হবে।'))
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordError(bi('New passwords do not match.', 'প্রদত্ত নতুন পাসওয়ার্ড দুটি মিলছে না।'))
      return
    }

    setChangingPassword(true)
    try {
      const res = await api('/api/auth/change-password', {
        method: 'PUT',
        token: session.token,
        body: { currentPassword, newPassword },
      })
      setPasswordMsg(res.message || bi('Password changed successfully.', 'পাসওয়ার্ড সফলভাবে পরিবর্তন করা হয়েছে।'))
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setShowPasswordSection(false)
    } catch (err) {
      setPasswordError(err.message)
    } finally {
      setChangingPassword(false)
    }
  }

  return (
    <div className="auth-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="profile-modal-user-name">
      <div className="auth-modal-backdrop" onClick={onClose} />
      <div className="auth-modal-card modern-profile-form-card">
        {/* Top Header Row matching Image 1 */}
        <div className="profile-form-header">
          <div className="profile-form-user-meta">
            <div className="profile-form-avatar-circle" aria-hidden="true">
              <UserIcon />
            </div>
            <div className="profile-form-user-info">
              <h2 id="profile-modal-user-name" className="profile-form-name">
                {userDisplayName}
              </h2>
              <span className="profile-form-email">
                {userIdentifier}
              </span>
            </div>
          </div>

          <div className="profile-form-top-actions">
            {!isEditing ? (
              !showPasswordSection && (
                <button
                  type="button"
                  className="profile-form-edit-outline-btn"
                  onClick={handleStartEdit}
                >
                  <PencilIcon />
                  <span>{bi('Edit Profile', 'প্রোফাইল সম্পাদনা করুন')}</span>
                </button>
              )
            ) : (
              <div className="profile-edit-btn-group">
                <button
                  type="button"
                  className="profile-form-cancel-btn"
                  onClick={handleCancelEdit}
                  disabled={saving}
                >
                  {bi('Cancel', 'বাতিল')}
                </button>
                <button
                  type="submit"
                  form="profile-form-element"
                  className="profile-form-save-btn"
                  disabled={saving || !fullName.trim()}
                >
                  {saving ? bi('Saving…', 'সংরক্ষণ হচ্ছে…') : bi('Save Changes', 'পরিবর্তন সংরক্ষণ করুন')}
                </button>
              </div>
            )}

            <button
              type="button"
              className="auth-modal-close"
              onClick={onClose}
              aria-label={bi('Close', 'বন্ধ করুন')}
            >
              &times;
            </button>
          </div>
        </div>

        {error && (
          <div className="auth-alert error" role="alert" style={{ margin: '1rem 0 0.5rem 0' }}>
            {error}
          </div>
        )}

        {successMsg && (
          <div className="auth-alert success" role="status" style={{ margin: '1rem 0 0.5rem 0' }}>
            <strong>{bi('Update: ', 'আপডেট: ')}</strong>{successMsg}
          </div>
        )}

        {loading ? (
          <div className="loading-state-box" style={{ margin: '2rem 0' }}>
            <p>{bi('Loading profile details…', 'নাগরিক প্রোফাইলের তথ্য লোড হচ্ছে…')}</p>
          </div>
        ) : (
          /* Form Grid Layout matching Image 1 exactly */
          <form id="profile-form-element" onSubmit={handleSubmit} className="profile-form-body">
            <div className="profile-form-grid">
              {/* Row 1: Full Name */}
              <div className="profile-field-group">
                <div className="profile-label-row">
                  <label htmlFor="pf-full-name">{bi('Full Name', 'পূর্ণ নাম')}</label>
                  {isVerified && (
                    <span className="profile-locked-tag">
                      <LockIcon /> {bi('Verified (DLAO locked)', 'ডিএলএও কর্তৃক যাচাইকৃত ও সুরক্ষিত')}
                    </span>
                  )}
                </div>
                <div className="profile-input-wrapper">
                  <UserIcon />
                  <input
                    id="pf-full-name"
                    type="text"
                    required
                    readOnly={!isEditing || isVerified}
                    disabled={isEditing && isVerified}
                    className={`profile-field-input ${(!isEditing || isVerified) ? 'is-readonly' : ''}`}
                    placeholder={bi('Full Name', 'পূর্ণ নাম')}
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                  />
                </div>
              </div>

              {/* Row 1: Email Address / Account */}
              <div className="profile-field-group">
                <label htmlFor="pf-account">{bi('Email Address / Account', 'ইমেইল ঠিকানা বা ব্যবহারকারী অ্যাকাউন্ট')}</label>
                <div className="profile-input-wrapper">
                  <MailIcon />
                  <input
                    id="pf-account"
                    type="text"
                    required
                    readOnly={!isEditing}
                    className={`profile-field-input ${!isEditing ? 'is-readonly' : ''}`}
                    placeholder={bi('Email or Phone', 'ইমেইল বা ফোন')}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
              </div>

              {/* Row 2: Phone / Contact No */}
              <div className="profile-field-group">
                <label htmlFor="pf-phone">{bi('Phone / Contact No', 'মোবাইল / যোগাযোগের নম্বর')}</label>
                <div className="profile-input-wrapper">
                  <PhoneIcon />
                  <input
                    id="pf-phone"
                    type="tel"
                    readOnly={!isEditing}
                    className={`profile-field-input ${!isEditing ? 'is-readonly' : ''}`}
                    placeholder={bi('Enter contact phone', 'ফোন নম্বর লিখুন')}
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </div>
              </div>

              {/* Row 2: National ID (NID) */}
              <div className="profile-field-group">
                <div className="profile-label-row">
                  <label htmlFor="pf-nid">{bi('National ID (NID)', 'জাতীয় পরিচয়পত্র নম্বর (এনআইডি)')}</label>
                  {isVerified && (
                    <span className="profile-locked-tag">
                      <LockIcon /> {bi('Verified (DLAO locked)', 'যাচাইকৃত (লক করা)')}
                    </span>
                  )}
                </div>
                <div className="profile-input-wrapper">
                  <IdCardIcon />
                  <input
                    id="pf-nid"
                    type="text"
                    readOnly={!isEditing || isVerified}
                    disabled={isEditing && isVerified}
                    className={`profile-field-input ${(!isEditing || isVerified) ? 'is-readonly' : ''}`}
                    placeholder={bi('Enter NID number', 'এনআইডি নম্বর লিখুন')}
                    value={nid}
                    onChange={(e) => setNid(e.target.value)}
                  />
                </div>
              </div>

              {/* Row 3: Home District */}
              <div className="profile-field-group">
                <label htmlFor="pf-district">{bi('Home District', 'স্থায়ী / নিজ জেলা')}</label>
                <div className="profile-input-wrapper">
                  <MapPinIcon />
                  <input
                    id="pf-district"
                    type="text"
                    list="district-datalist"
                    readOnly={!isEditing}
                    className={`profile-field-input ${!isEditing ? 'is-readonly' : ''}`}
                    placeholder={bi('Enter home district', 'নিজ জেলা লিখুন')}
                    value={district}
                    onChange={(e) => setDistrict(e.target.value)}
                  />
                  <datalist id="district-datalist">
                    {DISTRICTS.map((d) => (
                      <option key={d} value={d} />
                    ))}
                  </datalist>
                </div>
              </div>

              {/* Row 3: Safe Contact Time Window (Clock Selection) */}
              <div className="profile-field-group">
                <label htmlFor="pf-timewindow">{bi('Safe Contact Time Window', 'নিরাপদ যোগাযোগের উপযুক্ত সময়সূচি')}</label>
                {!isEditing ? (
                  <div className="profile-input-wrapper">
                    <ClockIcon />
                    <input
                      id="pf-timewindow"
                      type="text"
                      readOnly
                      className="profile-field-input is-readonly"
                      value={safeTimeWindow || bi('Not specified', 'নির্দিষ্ট কোনো সময় উল্লেখ নেই')}
                    />
                  </div>
                ) : (
                  <div className="profile-time-picker-row">
                    <div className="profile-time-clock-box">
                      <span className="profile-time-clock-label">{bi('Start Time', 'শুরুর সময়')}</span>
                      <div className="profile-input-wrapper">
                        <ClockIcon />
                        <input
                          id="pf-time-start"
                          type="time"
                          className="profile-field-input profile-time-input"
                          value={safeStartTime}
                          onChange={(e) => handleTimeChange(e.target.value, safeEndTime)}
                        />
                      </div>
                    </div>
                    <span className="profile-time-separator">{bi('to', 'হতে')}</span>
                    <div className="profile-time-clock-box">
                      <span className="profile-time-clock-label">{bi('End Time', 'শেষের সময়')}</span>
                      <div className="profile-input-wrapper">
                        <ClockIcon />
                        <input
                          id="pf-time-end"
                          type="time"
                          className="profile-field-input profile-time-input"
                          value={safeEndTime}
                          onChange={(e) => handleTimeChange(safeStartTime, e.target.value)}
                        />
                      </div>
                    </div>
                    {(safeStartTime || safeEndTime) && (
                      <button
                        type="button"
                        className="profile-time-clear-btn"
                        title={bi('Clear time window', 'সময়সূচি বাতিল করুন')}
                        aria-label={bi('Clear time window', 'সময়সূচি বাতিল করুন')}
                        onClick={() => handleTimeChange('', '')}
                      >
                        &times;
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Row 4: Identity Verification Status (strictly DLAO only) */}
              <div className="profile-field-group">
                <div className="profile-label-row">
                  <label htmlFor="pf-identity-status">{bi('Identity Verification Status', 'জাতীয় পরিচয় যাচাইয়ের স্থিতি')}</label>
                  <span className="profile-readonly-note">
                    {bi('DLAO officer verified only', 'কেবলমাত্র দায়িত্বপ্রাপ্ত কর্মকর্তা কর্তৃক যাচাইযোগ্য')}
                  </span>
                </div>
                <div className="profile-input-wrapper">
                  <ShieldIcon />
                  <input
                    id="pf-identity-status"
                    type="text"
                    readOnly
                    className="profile-field-input is-readonly"
                    value={identityStatusText}
                  />
                </div>
              </div>

              {/* Row 4: Total Matters Filed */}
              <div className="profile-field-group">
                <label htmlFor="pf-matters">{bi('Total Matters Filed', 'দায়েরকৃত মোট আইনি সহায়তা আবেদন')}</label>
                <div className="profile-input-wrapper">
                  <BriefcaseIcon />
                  <input
                    id="pf-matters"
                    type="text"
                    readOnly
                    className="profile-field-input is-readonly"
                    value={mattersCount}
                  />
                </div>
              </div>
            </div>
          </form>
        )}

        {/* Change Password Section - Only available when NOT editing profile */}
        {!isEditing && (
          <div className="profile-password-section">
            <div className="profile-password-header">
              <button
                type="button"
                className="profile-toggle-password-btn"
                onClick={() => {
                  setShowPasswordSection((prev) => !prev)
                  setPasswordError('')
                  setPasswordMsg('')
                }}
              >
                <span>{showPasswordSection ? bi('Close Password Change', 'পাসওয়ার্ড পরিবর্তন ফর্ম বন্ধ করুন') : bi('Change Password', 'পাসওয়ার্ড পরিবর্তন করুন')}</span>
              </button>
            </div>

            {passwordMsg && (
              <div className="auth-alert success" role="status" style={{ margin: '0.75rem 0' }}>
                <strong>{bi('Success: ', 'সফল: ')}</strong>{passwordMsg}
              </div>
            )}

            {passwordError && (
              <div className="auth-alert error" role="alert" style={{ margin: '0.75rem 0' }}>
                {passwordError}
              </div>
            )}

            {showPasswordSection && (
              <form onSubmit={handlePasswordChange} className="profile-password-form">
                <div className="profile-password-fields-grid">
                  <div className="profile-field-group">
                    <label htmlFor="current-pw">{bi('Current Password', 'বর্তমান পাসওয়ার্ড')}</label>
                    <input
                      id="current-pw"
                      type="password"
                      required
                      className="profile-field-input"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                    />
                  </div>

                  <div className="profile-field-group">
                    <label htmlFor="new-pw">{bi('New Password', 'নতুন পাসওয়ার্ড')}</label>
                    <input
                      id="new-pw"
                      type="password"
                      required
                      minLength={3}
                      className="profile-field-input"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                    />
                  </div>

                  <div className="profile-field-group">
                    <label htmlFor="confirm-pw">{bi('Confirm New Password', 'নতুন পাসওয়ার্ড নিশ্চিত করুন')}</label>
                    <input
                      id="confirm-pw"
                      type="password"
                      required
                      minLength={3}
                      className="profile-field-input"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                    />
                  </div>
                </div>

                <div className="profile-password-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      setShowPasswordSection(false)
                      setPasswordError('')
                      setPasswordMsg('')
                    }}
                    disabled={changingPassword}
                    style={{ marginRight: '0.75rem' }}
                  >
                    {bi('Cancel', 'বাতিল')}
                  </button>
                  <button
                    type="submit"
                    className="primary-action-btn"
                    disabled={changingPassword || !currentPassword || !newPassword}
                  >
                    {changingPassword ? bi('Updating…', 'পাসওয়ার্ড আপডেট হচ্ছে…') : bi('Update Password', 'পাসওয়ার্ড আপডেট করুন')}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
