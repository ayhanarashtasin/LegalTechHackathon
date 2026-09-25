import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router'
import Dashboard from './pages/Dashboard.jsx'
import CitizenDashboard from './pages/CitizenDashboard.jsx'
import AdminDashboard from './pages/AdminDashboard.jsx'
import RecordPage from './pages/RecordPage.jsx'
import VoiceAccess from './pages/VoiceAccess.jsx'
import AssistedIntake from './pages/AssistedIntake.jsx'
import ReferralPage from './pages/ReferralPage.jsx'
import LawyerCasePage from './pages/LawyerCasePage.jsx'
import IncidentGroupPage from './pages/IncidentGroupPage.jsx'
import MediationPage from './pages/MediationPage.jsx'
import MediationVerifier from './pages/MediationVerifier.jsx'
import AuthModal from './components/AuthModal.jsx'
import CitizenProfileModal from './components/CitizenProfileModal.jsx'
import CitizenCaseTracker from './components/CitizenCaseTracker.jsx'
import { api } from './services/api.js'
import { clearOfflineDrafts, resumeOfflineDrafts } from './utils/offlineDrafts.js'
import { bi, setLang, useLang } from './components/Bi.jsx'

function LandingHero() {
  return (
    <section className="login-panel landing-hero-panel" aria-labelledby="welcome-title">
      <div className="landing-hero-body">
        <h1 id="welcome-title">{bi('One record, every handover.', 'একটি রেকর্ড, প্রতিটি হস্তান্তরে।')}</h1>
        <p className="citizen-door">
          {bi('Need voice support?', 'ফোনে সাহায্য দরকার?')}{' '}
          <Link to="/voice">{bi('Start a voice intake', 'ভয়েসে আবেদন শুরু করুন')}</Link>
        </p>

        <CitizenCaseTracker />
      </div>
    </section>
  )
}

export default function App() {
  const [session, setSession] = useState(null)
  const [authModal, setAuthModal] = useState({ isOpen: false, mode: 'signin', tab: 'citizen' })
  const lang = useLang()
  const [lightMode, setLightMode] = useState(() => typeof localStorage !== 'undefined' && localStorage.getItem('dlas-light-mode') === '1')
  const [installPrompt, setInstallPrompt] = useState(null)
  const [profileModalOpen, setProfileModalOpen] = useState(false)
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const accountMenuRef = useRef(null)
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const previousPath = useRef(pathname)

  const isAdmin = session?.user?.assignments?.some(({ role }) => role === 'ADMIN')
  const isCitizen = session?.user?.assignments?.some(({ role }) => role === 'CITIZEN')
  const mediationOnly = session?.user?.assignments?.some(({ role }) => role === 'MEDIATOR' || role === 'CLAO')
    && !session?.user?.assignments?.some(({ role }) => role === 'DLAO_OFFICER')

  useEffect(() => {
    document.documentElement.dataset.lightMode = lightMode ? 'on' : 'off'
    localStorage.setItem('dlas-light-mode', lightMode ? '1' : '0')
  }, [lightMode])

  useEffect(() => { document.documentElement.lang = lang }, [lang])

  useEffect(() => {
    if (previousPath.current !== pathname) document.getElementById('main')?.focus()
    previousPath.current = pathname
  }, [pathname])

  useEffect(() => {
    const ready = (event) => { event.preventDefault(); setInstallPrompt(event) }
    window.addEventListener('beforeinstallprompt', ready)
    return () => window.removeEventListener('beforeinstallprompt', ready)
  }, [])

  useEffect(() => {
    function handleClickOutside(event) {
      if (accountMenuRef.current && !accountMenuRef.current.contains(event.target)) {
        setAccountMenuOpen(false)
      }
    }
    if (accountMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [accountMenuOpen])

  async function signIn(username, password) {
    const login = await api('/api/auth/login', { method: 'POST', body: { username, password } })
    const current = await api('/api/auth/me', { token: login.token })
    try { localStorage.setItem('dlas_token', login.token) } catch { /* ignore storage error */ }
    resumeOfflineDrafts()
    setSession({ token: login.token, user: current.user })
  }

  async function register(name, identifier, password, nid) {
    const reg = await api('/api/auth/register', {
      method: 'POST',
      body: { name, username: identifier, password, nid },
    })
    try {
      localStorage.setItem('dlas_token', reg.token)
      localStorage.setItem('dlas_registered_login_id', identifier.trim())
      localStorage.setItem('dlas_registered_login_pwd', password)
    } catch {
      // localStorage unavailable
    }
    const current = await api('/api/auth/me', { token: reg.token })
    resumeOfflineDrafts()
    setSession({ token: reg.token, user: current.user })
  }

  async function signOut() {
    const token = session?.token
    try { localStorage.removeItem('dlas_token') } catch { /* ignore storage error */ }
    try { await clearOfflineDrafts() } catch { window.alert(bi('Local drafts could not be cleared. Do not leave this browser on a shared device.', 'এই ডিভাইসের খসড়া মোছা যায়নি। অন্যের সঙ্গে ব্যবহার করা ডিভাইসে এই পৃষ্ঠা খোলা রাখবেন না।')) }
    setSession(null)
    navigate('/')
    if (token) {
      try { await api('/api/auth/logout', { token, method: 'POST' }) } catch { /* Browser session is already cleared if network unavailable */ }
    }
  }

  function toggleLight() { setLightMode((value) => !value) }

  async function install() {
    await installPrompt.prompt()
    await installPrompt.userChoice
    setInstallPrompt(null)
  }

  return (
    <>
      <a className="skip-link" href="#main">{bi('Skip to main content', 'মূল অংশে যান')}</a>
      <header className="site-header">
        <Link
          className="brand"
          to="/"
          aria-label={
            isAdmin
              ? bi('DLAS admin console home', 'DLAS অ্যাডমিন কনসোল')
              : isCitizen
                ? bi('DLAS citizen portal home', 'DLAS নাগরিক পোর্টাল')
                : pathname === '/voice'
                  ? bi('DLAS voice intake home', 'DLAS-এ ফোনে আবেদনের শুরু')
                  : bi('DLAS provider workspace home', 'DLAS কর্মীদের কাজের শুরু')
          }
        >
          DLAS <span>{isAdmin ? bi('Admin console', 'অ্যাডমিন কনসোল') : isCitizen ? bi('Citizen portal', 'নাগরিক পোর্টাল') : pathname === '/voice' ? bi('Voice intake', 'ফোনে আবেদন') : bi('Provider workspace', 'কর্মক্ষেত্র')}</span>
        </Link>
        <div className="header-center-section">
          <div className="lang-switch" role="group" aria-label="Language / ভাষা">
            <button type="button" lang="bn" aria-pressed={lang === 'bn'} onClick={() => setLang('bn')}>বাংলা</button>
            <button type="button" lang="en" aria-pressed={lang === 'en'} onClick={() => setLang('en')}>English</button>
          </div>
          <button type="button" className="quiet-button" onClick={toggleLight}>{lightMode ? bi('Normal mode', 'সাধারণ মোড') : bi('Light mode', 'হালকা মোড')}</button>
          {installPrompt && <button type="button" className="quiet-button" onClick={install}>{bi('Install app', 'অ্যাপ ইনস্টল করুন')}</button>}
        </div>
        {session ? (
          <div className="account-circle-wrapper" ref={accountMenuRef}>
            <button
              type="button"
              className="account-circle-btn"
              aria-label={bi('Account menu', 'অ্যাকাউন্ট মেনু')}
              aria-haspopup="menu"
              aria-expanded={accountMenuOpen}
              onClick={() => setAccountMenuOpen((prev) => !prev)}
            >
              <span className="account-circle-initial">
                {(session.user.displayName || session.user.username || 'U')[0].toUpperCase()}
              </span>
            </button>

            {accountMenuOpen && (
              <div className="account-dropdown-card" role="menu">
                <div className="account-dropdown-user-row">
                  <span className="account-dropdown-name">{session.user.displayName || session.user.username}</span>
                  <span className="account-dropdown-role">
                    {session.user.assignments?.[0]?.role?.replace(/_/g, ' ') || 'Citizen'}
                  </span>
                </div>

                <div className="account-dropdown-divider" />

                <button
                  type="button"
                  className="account-dropdown-item"
                  role="menuitem"
                  onClick={() => {
                    setAccountMenuOpen(false)
                    setProfileModalOpen(false)
                    navigate('/')
                  }}
                >
                  {bi('Dashboard', 'ড্যাশবোর্ড')}
                </button>

                <button
                  type="button"
                  className="account-dropdown-item"
                  role="menuitem"
                  onClick={() => {
                    setAccountMenuOpen(false)
                    setProfileModalOpen(true)
                  }}
                >
                  {bi('Profile', 'প্রোফাইল')}
                </button>

                <div className="account-dropdown-divider" />

                <button
                  type="button"
                  className="account-dropdown-item account-dropdown-item-danger"
                  role="menuitem"
                  onClick={() => {
                    setAccountMenuOpen(false)
                    signOut()
                  }}
                >
                  {bi('Sign out', 'সাইন আউট')}
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="header-auth-actions">
            <button
              type="button"
              className="header-auth-btn header-signin-btn"
              onClick={() => setAuthModal({ isOpen: true, mode: 'signin', tab: 'citizen' })}
            >
              {bi('Sign in', 'সাইন ইন')}
            </button>
            <button
              type="button"
              className="header-auth-btn header-signup-btn"
              onClick={() => setAuthModal({ isOpen: true, mode: 'signup', tab: 'citizen' })}
            >
              {bi('Sign up', 'নিবন্ধন')}
            </button>
          </div>
        )}
      </header>
      <main id="main" className="app-main" tabIndex={-1}>
        <Routes>
          <Route
            path="/"
            element={
              session ? (
                isAdmin ? (
                  <AdminDashboard session={session} />
                ) : isCitizen ? (
                  <CitizenDashboard session={session} />
                ) : (
                  <Dashboard session={session} />
                )
              ) : (
                <LandingHero />
              )
            }
          />
          <Route path="/applications/:applicationId/mediation/verify" element={session ? <MediationVerifier session={session} /> : <Navigate to="/" replace />} />
          <Route path="/applications/:applicationId" element={session ? mediationOnly ? <MediationPage session={session} /> : <RecordPage session={session} /> : <Navigate to="/" replace />} />
          <Route path="/cases/:caseId" element={session ? <LawyerCasePage session={session} /> : <Navigate to="/" replace />} />
          <Route path="/referrals/:referralId" element={session?.user.assignments.some(({ role }) => role === 'RECEIVING_DLAO') ? <ReferralPage session={session} /> : <Navigate to="/" replace />} />
          <Route path="/incidents/:groupId" element={session?.user.assignments.some(({ role }) => role === 'DLAO_OFFICER') ? <IncidentGroupPage session={session} /> : <Navigate to="/" replace />} />
          <Route path="/voice" element={<VoiceAccess session={session} />} />
          <Route path="/assisted" element={session?.user.assignments.some(({ role }) => role === 'UDC_OPERATOR') ? <AssistedIntake session={session} /> : <Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      <AuthModal
        key={`${authModal.mode}-${authModal.tab}-${authModal.isOpen}`}
        isOpen={authModal.isOpen}
        mode={authModal.mode}
        initialTab={authModal.tab}
        onClose={() => setAuthModal((prev) => ({ ...prev, isOpen: false }))}
        onLogin={signIn}
        onRegister={register}
        onSwitchMode={(nextMode) => setAuthModal((prev) => ({ ...prev, mode: nextMode }))}
      />

      <CitizenProfileModal
        key={profileModalOpen ? 'open' : 'closed'}
        isOpen={profileModalOpen}
        session={session}
        onClose={() => setProfileModalOpen(false)}
      />
    </>
  )
}
