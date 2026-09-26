import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router'
import VoiceAccess from './pages/VoiceAccess.jsx'
import AssistedIntake from './pages/AssistedIntake.jsx'
import AuthModal from './components/AuthModal.jsx'
import CitizenProfileModal from './components/CitizenProfileModal.jsx'
import CitizenCaseTracker from './components/CitizenCaseTracker.jsx'
import { api } from './services/api.js'
import { clearOfflineDrafts, resumeOfflineDrafts } from './utils/offlineDrafts.js'
import { bi, setLang, useLang } from './components/Bi.jsx'

// Provider pages are fetched on demand; the public and assisted offline paths stay in the app shell.
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'))
const CitizenDashboard = lazy(() => import('./pages/CitizenDashboard.jsx'))
const AdminDashboard = lazy(() => import('./pages/AdminDashboard.jsx'))
const RecordPage = lazy(() => import('./pages/RecordPage.jsx'))
const ReferralPage = lazy(() => import('./pages/ReferralPage.jsx'))
const LawyerCasePage = lazy(() => import('./pages/LawyerCasePage.jsx'))
const IncidentGroupPage = lazy(() => import('./pages/IncidentGroupPage.jsx'))
const MediationPage = lazy(() => import('./pages/MediationPage.jsx'))
const CaseRedirect = lazy(() => import('./pages/MediationPage.jsx').then((module) => ({ default: module.CaseRedirect })))
const MediationVerifier = lazy(() => import('./pages/MediationVerifier.jsx'))
const PartySigning = lazy(() => import('./pages/PartySigning.jsx'))

function initialLightMode() {
  try {
    const saved = localStorage.getItem('dlas-light-mode')
    if (saved !== null) return saved === '1'
  } catch { /* Storage may be unavailable on a shared or restricted browser. */ }
  if (typeof navigator === 'undefined') return false
  const connection = navigator.connection
  return Boolean(connection?.saveData || ['slow-2g', '2g'].includes(connection?.effectiveType)
    || (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-data: reduce)').matches))
}

function initialSession() {
  try {
    const saved = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('dlas_session') : null
    if (saved) {
      const parsed = JSON.parse(saved)
      if (parsed?.token && parsed?.user) return parsed
    }
  } catch { /* Storage may be unavailable or malformed. */ }
  return null
}

function LandingHero() {
  return (
    <section className="login-panel landing-hero-panel" aria-labelledby="welcome-title">
      <div className="landing-hero-body">
        <h1 id="welcome-title">{bi('One record, every handover.', 'একটি রেকর্ড, প্রতিটি হস্তান্তরে।')}</h1>
        <p className="citizen-door">
          {bi('Need voice support?', 'টেলিফোনে আইনি সহায়তা প্রয়োজন?')}{' '}
          <Link to="/voice">{bi('Start a voice intake', 'টেলিফোনে সহায়তা কল শুরু করুন')}</Link>
        </p>
        <p className="citizen-door"><Link to="/mediation/sign">{bi('Sign a mediation draft with a private code', 'গোপন সিকিউরিটি কোড দিয়ে আপসনামায় স্বাক্ষর করুন')}</Link></p>

        <CitizenCaseTracker />
      </div>
    </section>
  )
}

export default function App() {
  const [session, setSession] = useState(initialSession)
  const [authModal, setAuthModal] = useState({ isOpen: false, mode: 'signin', tab: 'citizen' })
  const lang = useLang()
  const [lightMode, setLightMode] = useState(initialLightMode)
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
  const claoCaseView = session?.user?.assignments?.some(({ role }) => role === 'CLAO')
    && !session?.user?.assignments?.some(({ role }) => role === 'DLAO_OFFICER' || role === 'PANEL_LAWYER')

  useEffect(() => {
    document.documentElement.dataset.lightMode = lightMode ? 'on' : 'off'
    try { localStorage.setItem('dlas-light-mode', lightMode ? '1' : '0') } catch { /* Mode still works for this session. */ }
  }, [lightMode])

  useEffect(() => { document.documentElement.lang = lang }, [lang])

  useEffect(() => {
    // Remove credentials written by older builds before this shared-device safeguard.
    try {
      localStorage.removeItem('dlas_token')
      localStorage.removeItem('dlas_registered_login_id')
      localStorage.removeItem('dlas_registered_login_pwd')
    } catch { /* Storage may be unavailable. */ }
  }, [])

  useEffect(() => {
    if (!session?.token) return
    let active = true
    api('/api/auth/me', { token: session.token })
      .then((current) => {
        if (!active) return
        setSession((prev) => {
          if (!prev || prev.token !== session.token) return prev
          const updated = { token: session.token, user: current.user }
          try { sessionStorage.setItem('dlas_session', JSON.stringify(updated)) } catch { /* Storage may be unavailable. */ }
          return updated
        })
      })
      .catch((err) => {
        if (!active) return
        if (err.status === 401 || err.status === 403) {
          try { sessionStorage.removeItem('dlas_session') } catch { /* Storage may be unavailable. */ }
          setSession(null)
        }
      })
    return () => { active = false }
  }, [session?.token])

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
    const sessionData = { token: login.token, user: current.user }
    try { sessionStorage.setItem('dlas_session', JSON.stringify(sessionData)) } catch { /* Storage may be unavailable. */ }
    resumeOfflineDrafts()
    setSession(sessionData)
  }

  async function register(name, identifier, password, nid) {
    const reg = await api('/api/auth/register', {
      method: 'POST',
      body: { name, username: identifier, password, nid },
    })
    const current = await api('/api/auth/me', { token: reg.token })
    const sessionData = { token: reg.token, user: current.user }
    try { sessionStorage.setItem('dlas_session', JSON.stringify(sessionData)) } catch { /* Storage may be unavailable. */ }
    resumeOfflineDrafts()
    setSession(sessionData)
  }

  async function signOut() {
    const token = session?.token
    try {
      sessionStorage.removeItem('dlas_session')
      localStorage.removeItem('dlas_token')
      localStorage.removeItem('dlas_registered_login_id')
      localStorage.removeItem('dlas_registered_login_pwd')
    } catch { /* ignore storage error */ }
    try { await clearOfflineDrafts() } catch { window.alert(bi('Local drafts could not be cleared. Do not leave this browser on a shared device.', 'ডিভাইসে সংরক্ষিত খসড়া মোছা যায়নি। যৌথ বা পাবলিক ডিভাইসে এই ব্রাউজার উন্মুক্ত রাখবেন না।')) }
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
              ? bi('DLAS admin console home', 'ডিএলএএস কেন্দ্রীয় প্রশাসনিক কনসোল')
              : isCitizen
                ? bi('DLAS citizen portal home', 'ডিএলএএস নাগরিক আইনি সহায়তা পোর্টাল')
                : pathname === '/voice'
                  ? bi('DLAS voice intake home', 'ডিএলএএস ভয়েস ও টেলিফোন আইনি সহায়তা')
                  : bi('DLAS provider workspace home', 'ডিএলএএস কর্মকর্তা কর্মক্ষেত্র')
          }
        >
          DLAS <span>{isAdmin ? bi('Admin console', 'প্রশাসনিক কনসোল') : isCitizen ? bi('Citizen portal', 'নাগরিক পোর্টাল') : pathname === '/voice' ? bi('Voice intake', 'টেলিফোনে সহায়তা') : bi('Provider workspace', 'কর্মক্ষেত্র')}</span>
        </Link>
        <div className="header-center-section">
          <div className="lang-switch" role="group" aria-label="Language / ভাষা">
            <button type="button" lang="bn" aria-pressed={lang === 'bn'} onClick={() => setLang('bn')}>বাংলা</button>
            <button type="button" lang="en" aria-pressed={lang === 'en'} onClick={() => setLang('en')}>English</button>
          </div>
          <button type="button" className="quiet-button" onClick={toggleLight}>{lightMode ? bi('Normal mode', 'ডিফল্ট থিম') : bi('Light mode', 'লাইট মোড')}</button>
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
                    {session.user.userType ? session.user.userType.toUpperCase() : (session.user.assignments?.[0]?.role?.replace(/_/g, ' ') || 'CITIZEN')}
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
                  {bi('Profile', 'নাগরিক প্রোফাইল')}
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
                  {bi('Sign out', 'লগআউট / প্রস্থান')}
                </button>
              </div>
            )}
          </div>
        ) : pathname === '/voice' ? (
          // The 16699 call screen stays a plain phone call: no account buttons.
          <div className="header-right-spacer" aria-hidden="true" />
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
        <Suspense fallback={<p role="status">{bi('Loading page…', 'পৃষ্ঠা লোড হচ্ছে…')}</p>}>
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
          <Route path="/mediation/sign" element={<PartySigning />} />
          <Route path="/applications/:applicationId" element={session ? mediationOnly ? <MediationPage session={session} /> : <RecordPage session={session} /> : <Navigate to="/" replace />} />
          <Route path="/cases/:caseId" element={session ? claoCaseView ? <CaseRedirect session={session} /> : <LawyerCasePage session={session} /> : <Navigate to="/" replace />} />
          <Route path="/referrals/:referralId" element={session?.user.assignments.some(({ role }) => role === 'RECEIVING_DLAO') ? <ReferralPage session={session} /> : <Navigate to="/" replace />} />
          <Route path="/incidents/:groupId" element={session?.user.assignments.some(({ role }) => ['DLAO_OFFICER', 'CASE_SUPPORT'].includes(role)) ? <IncidentGroupPage session={session} /> : <Navigate to="/" replace />} />
          <Route path="/voice" element={<VoiceAccess session={session} lightMode={lightMode} />} />
          <Route path="/assisted" element={session?.user.assignments.some(({ role }) => role === 'UDC_OPERATOR') ? <AssistedIntake session={session} /> : <Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
      </main>

      <AuthModal
        key={authModal.isOpen ? 'auth-open' : 'auth-closed'}
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
