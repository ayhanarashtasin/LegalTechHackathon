import { useState } from 'react'
import { bi } from './Bi.jsx'

const OFFICER_ROLES = [
  { label: 'DLAO', id: 'demo.officer' },
  { label: 'Mediator', id: 'demo.mediator' },
  { label: 'Helpline Agent', id: 'demo.helpline' },
  { label: 'UDC Operator', id: 'demo.udc' },
  { label: 'Panel Lawyer', id: 'demo.lawyer' },
  { label: 'Receiving DLAO', id: 'demo.receiving' },
  { label: 'Case Support', id: 'demo.support' },
  { label: 'CLAO', id: 'demo.clao' },
]

export default function AuthModal({
  isOpen,
  mode = 'signin', // 'signin' | 'signup'
  initialTab = 'citizen', // 'citizen' | 'officer' | 'admin'
  onClose,
  onLogin,
  onRegister,
  onSwitchMode,
}) {
  const [activeTab, setActiveTab] = useState(initialTab)

  // Officer tab state
  const [selectedOfficerId, setSelectedOfficerId] = useState(OFFICER_ROLES[0].id)
  const [officerUsername, setOfficerUsername] = useState(OFFICER_ROLES[0].id)
  const [officerPassword, setOfficerPassword] = useState('1234')

  // Keep a new registration's sign-in details, defaulting to demo.citizen / 1234
  const [citizenLoginId, setCitizenLoginId] = useState('demo.citizen')
  const [citizenLoginPassword, setCitizenLoginPassword] = useState('1234')

  // Citizen sign-up state
  const [regName, setRegName] = useState('')
  const [regIdentifier, setRegIdentifier] = useState('')
  const [regPassword, setRegPassword] = useState('')
  const [regNid, setRegNid] = useState('')

  // Admin tab state (auto-filled with admin.com / admin123)
  const [adminUsername, setAdminUsername] = useState('admin.com')
  const [adminPassword, setAdminPassword] = useState('admin123')

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (!isOpen) return null

  function handleOfficerSelect(e) {
    const roleId = e.target.value
    setSelectedOfficerId(roleId)
    setOfficerUsername(roleId)
    setOfficerPassword('1234')
  }

  async function handleOfficerSubmit(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await onLogin(officerUsername, officerPassword)
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function handleAdminSubmit(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await onLogin(adminUsername, adminPassword)
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function handleCitizenLoginSubmit(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await onLogin(citizenLoginId, citizenLoginPassword)
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function handleCitizenSignUpSubmit(e) {
    e.preventDefault()
    setError('')
    if (!regName.trim()) {
      setError(bi('Name is required.', 'নাম আবশ্যক।'))
      return
    }
    if (!regIdentifier.trim()) {
      setError(bi('Email ID / Phone is required.', 'ইমেইল আইডি / ফোন আবশ্যক।'))
      return
    }
    if (!regPassword || regPassword.length < 3) {
      setError(bi('Password must be at least 3 characters.', 'পাসওয়ার্ড কমপক্ষে ৩ অক্ষরের হতে হবে।'))
      return
    }

    const cleanIdentifier = regIdentifier.trim()
    const cleanPassword = regPassword
    setCitizenLoginId(cleanIdentifier)
    setCitizenLoginPassword(cleanPassword)

    setBusy(true)
    try {
      await onRegister(regName.trim(), cleanIdentifier, cleanPassword, regNid.trim())
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  function handleSwitchToSignIn() {
    const savedId = regIdentifier.trim() || citizenLoginId
    const savedPwd = regPassword || citizenLoginPassword
    if (savedId) setCitizenLoginId(savedId)
    if (savedPwd) setCitizenLoginPassword(savedPwd)
    if (onSwitchMode) onSwitchMode('signin')
  }

  return (
    <div className="auth-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="auth-modal-title">
      <div className="auth-modal-backdrop" onClick={onClose} />
      <div className="auth-modal-card">
        <div className="auth-modal-header">
          <div>
            <span className="auth-modal-sub">{bi('Government Legal Aid Services', 'সরকারি আইনি সহায়তা সেবা')}</span>
            <h2 id="auth-modal-title" className="auth-modal-heading">
              {mode === 'signup'
                ? bi('Citizen Registration', 'নাগরিক নিবন্ধন')
                : activeTab === 'citizen'
                  ? bi('Citizen Sign In', 'নাগরিক সাইন ইন')
                  : activeTab === 'officer'
                    ? bi('Officer Sign In', 'কর্মকর্তা সাইন ইন')
                    : bi('Admin Sign In', 'অ্যাডমিন সাইন ইন')}
            </h2>
          </div>
          <button type="button" className="auth-modal-close" onClick={onClose} aria-label={bi('Close', 'বন্ধ')}>
            &times;
          </button>
        </div>

        {/* Tab Selection ONLY shown for Sign In */}
        {mode === 'signin' && (
          <div className="auth-tab-bar" role="tablist" aria-label="Sign in mode">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'citizen'}
              className={`auth-tab-btn ${activeTab === 'citizen' ? 'active' : ''}`}
              onClick={() => { setActiveTab('citizen'); setError('') }}
            >
              {bi('Citizen', 'নাগরিক')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'officer'}
              className={`auth-tab-btn ${activeTab === 'officer' ? 'active' : ''}`}
              onClick={() => { setActiveTab('officer'); setError('') }}
            >
              {bi('Officer', 'কর্মকর্তা')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'admin'}
              className={`auth-tab-btn ${activeTab === 'admin' ? 'active' : ''}`}
              onClick={() => { setActiveTab('admin'); setError('') }}
            >
              {bi('Admin', 'অ্যাডমিন')}
            </button>
          </div>
        )}

        {error && <div className="auth-alert error" role="alert">{error}</div>}

        <div className="auth-tab-content">
          {/* SIGN UP MODE (CITIZEN REGISTRATION) */}
          {mode === 'signup' && (
            <form onSubmit={handleCitizenSignUpSubmit} className="auth-form-stack">
              <div>
                <label htmlFor="reg-name">{bi('Name', 'নাম')}</label>
                <input
                  id="reg-name"
                  type="text"
                  required
                  placeholder={bi('Enter your full name', 'আপনার পূর্ণ নাম লিখুন')}
                  value={regName}
                  onChange={(e) => setRegName(e.target.value)}
                />
              </div>

              <div>
                <label htmlFor="reg-identifier">{bi('Email ID / Phone', 'ইমেইল আইডি / ফোন')}</label>
                <input
                  id="reg-identifier"
                  type="text"
                  required
                  placeholder={bi('e.g. name@example.com or 01700000000', 'যেমন: name@example.com অথবা ০১৭০০০০০০০০')}
                  value={regIdentifier}
                  onChange={(e) => setRegIdentifier(e.target.value)}
                />
              </div>

              <div>
                <label htmlFor="reg-password">{bi('Password', 'পাসওয়ার্ড')}</label>
                <input
                  id="reg-password"
                  type="password"
                  required
                  placeholder="••••••••"
                  value={regPassword}
                  onChange={(e) => setRegPassword(e.target.value)}
                />
              </div>

              <div>
                <label htmlFor="reg-nid">{bi('NID (Optional)', 'এনআইডি (ঐচ্ছিক)')}</label>
                <input
                  id="reg-nid"
                  type="text"
                  placeholder={bi('National identity card number', 'জাতীয় পরিচয়পত্র নম্বর')}
                  value={regNid}
                  onChange={(e) => setRegNid(e.target.value)}
                />
              </div>

              <div className="auth-action-row">
                <button type="submit" className="primary-action-btn" disabled={busy}>
                  {busy ? bi('Creating account…', 'অ্যাকাউন্ট তৈরি হচ্ছে…') : bi('Sign up', 'নিবন্ধন করুন')}
                </button>
              </div>

              <div className="auth-toggle-link-row">
                <span>{bi('Already have an account?', 'আগে থেকেই অ্যাকাউন্ট আছে?')}</span>{' '}
                <button
                  type="button"
                  className="link-btn"
                  onClick={handleSwitchToSignIn}
                >
                  {bi('Sign in', 'সাইন ইন করুন')}
                </button>
              </div>
            </form>
          )}

          {/* SIGN IN MODE: CITIZEN TAB */}
          {mode === 'signin' && activeTab === 'citizen' && (
            <form onSubmit={handleCitizenLoginSubmit} className="auth-form-stack">
              <div>
                <label htmlFor="citizen-login-id">{bi('Email ID / Phone', 'ইমেইল আইডি / ফোন')}</label>
                <input
                  id="citizen-login-id"
                  type="text"
                  required
                  placeholder={bi('Enter email or phone', 'ইমেইল বা ফোন নম্বর দিন')}
                  value={citizenLoginId}
                  onChange={(e) => setCitizenLoginId(e.target.value)}
                />
              </div>

              <div>
                <label htmlFor="citizen-login-pwd">{bi('Password', 'পাসওয়ার্ড')}</label>
                <input
                  id="citizen-login-pwd"
                  type="password"
                  required
                  placeholder="••••••••"
                  value={citizenLoginPassword}
                  onChange={(e) => setCitizenLoginPassword(e.target.value)}
                />
                <p className="auth-hint">
                  {bi('Auto-filled with demo credentials (demo.citizen / 1234).', 'ডেমো তথ্য স্বয়ংক্রিয় পূরণ হয়েছে (demo.citizen / 1234)।')}
                  {' '}&bull;{' '}
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => {
                      setCitizenLoginId('demo.citizen')
                      setCitizenLoginPassword('1234')
                    }}
                  >
                    {bi('Reset to demo', 'ডেমো তথ্য')}
                  </button>
                </p>
              </div>

              <div className="auth-action-row">
                <button type="submit" className="primary-action-btn" disabled={busy}>
                  {busy ? bi('Signing in…', 'সাইন ইন হচ্ছে…') : bi('Sign In as Citizen', 'নাগরিক হিসেবে সাইন ইন')}
                </button>
              </div>

              <div className="auth-toggle-link-row">
                <span>{bi('Do not have an account?', 'অ্যাকাউন্ট নেই?')}</span>{' '}
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => onSwitchMode && onSwitchMode('signup')}
                >
                  {bi('Sign up', 'নিবন্ধন করুন')}
                </button>
              </div>
            </form>
          )}

          {/* SIGN IN MODE: OFFICER TAB */}
          {mode === 'signin' && activeTab === 'officer' && (
            <form onSubmit={handleOfficerSubmit} className="auth-form-stack">
              <div>
                <label htmlFor="officer-role-select">{bi('Choose Officer Role', 'কর্মকর্তার ভূমিকা নির্বাচন করুন')}</label>
                <select
                  id="officer-role-select"
                  className="auth-select"
                  value={selectedOfficerId}
                  onChange={handleOfficerSelect}
                >
                  {OFFICER_ROLES.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="officer-id">{bi('Officer ID', 'কর্মকর্তা আইডি')}</label>
                <input
                  id="officer-id"
                  type="text"
                  required
                  value={officerUsername}
                  onChange={(e) => setOfficerUsername(e.target.value)}
                />
              </div>

              <div>
                <label htmlFor="officer-password">{bi('Password', 'পাসওয়ার্ড')}</label>
                <input
                  id="officer-password"
                  type="password"
                  required
                  value={officerPassword}
                  onChange={(e) => setOfficerPassword(e.target.value)}
                />
                <p className="auth-hint">
                  {bi('Auto-filled with demo credentials (password: 1234).', 'ডেমো তথ্য স্বয়ংক্রিয় পূরণ হয়েছে (পাসওয়ার্ড: 1234)।')}
                </p>
              </div>

              <div className="auth-action-row">
                <button type="submit" className="primary-action-btn" disabled={busy}>
                  {busy ? bi('Signing in…', 'সাইন ইন হচ্ছে…') : bi('Sign In as Officer', 'কর্মকর্তা হিসেবে সাইন ইন')}
                </button>
              </div>
            </form>
          )}

          {/* SIGN IN MODE: ADMIN TAB */}
          {mode === 'signin' && activeTab === 'admin' && (
            <form onSubmit={handleAdminSubmit} className="auth-form-stack">
              <p className="auth-hint" style={{ marginTop: 0 }}>
                {bi('Central System Administration and Infrastructure Oversight.', 'কেন্দ্রীয় সিস্টেম প্রশাসন ও অবকাঠামো তদারকি।')}
              </p>

              <div>
                <label htmlFor="admin-id">{bi('Administrator ID', 'প্রশাসক আইডি')}</label>
                <input
                  id="admin-id"
                  type="text"
                  required
                  value={adminUsername}
                  onChange={(e) => setAdminUsername(e.target.value)}
                />
              </div>

              <div>
                <label htmlFor="admin-password">{bi('Password', 'পাসওয়ার্ড')}</label>
                <input
                  id="admin-password"
                  type="password"
                  required
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                />
                <p className="auth-hint">
                  {bi('Auto-filled with admin credentials (admin.com / admin123).', 'অ্যাডমিন তথ্য স্বয়ংক্রিয় পূরণ হয়েছে (admin.com / admin123)।')}
                </p>
              </div>

              <div className="auth-action-row">
                <button type="submit" className="primary-action-btn" disabled={busy}>
                  {busy ? bi('Signing in…', 'সাইন ইন হচ্ছে…') : bi('Sign In as Admin', 'অ্যাডমিন হিসেবে সাইন ইন')}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
