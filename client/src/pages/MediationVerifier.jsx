import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { api } from '../services/api.js'
import { verifySettlement } from '../utils/settlementCrypto.js'
import { Bi, Term, bi, num, when } from '../components/Bi.jsx'

const valid = (ok) => ok ? bi('valid', 'সঠিক') : bi('FAILED', 'মেলেনি')

export default function MediationVerifier({ session }) {
  const { applicationId } = useParams()
  const [mediation, setMediation] = useState(null)
  const [error, setError] = useState('')
  const [deviceResult, setDeviceResult] = useState(null)
  const [serverResult, setServerResult] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    api(`/api/applications/${applicationId}/mediation`, { token: session.token, signal: controller.signal })
      .then(({ mediation: result }) => setMediation(result)).catch((failure) => { if (failure.name !== 'AbortError') setError(failure.message) })
    return () => controller.abort()
  }, [applicationId, session.token])

  async function verifyCurrent() {
    if (!mediation?.draft) return
    setBusy(true)
    setError('')
    try { setDeviceResult(await verifySettlement(mediation.draft, mediation.signatures)) }
    catch (failure) { setError(failure.message) }
    finally { setBusy(false) }
  }

  async function testChangedCopy() {
    if (!mediation?.draft) return
    const sections = mediation.draft.sections.map((section, index) => index ? section : { ...section, text: `${section.text} [changed copy]` })
    setBusy(true)
    setError('')
    try { setDeviceResult(await verifySettlement(mediation.draft, mediation.signatures, sections)) }
    catch (failure) { setError(failure.message) }
    finally { setBusy(false) }
  }

  async function verifyServer() {
    setBusy(true)
    setError('')
    try { setServerResult(await api(`/api/applications/${applicationId}/mediation/verify`, { token: session.token, method: 'POST', body: {} })) }
    catch (failure) { setError(failure.message) }
    finally { setBusy(false) }
  }

  return <section aria-labelledby="verification-title">
    <Link to={`/applications/${applicationId}`}>← <Bi en="Mediation record" bn="মধ্যস্থতার রেকর্ড ও বিবরণী" /></Link>
    <p className="eyebrow"><Bi en="Integrity check" bn="নথির বিশুদ্ধতা যাচাই" /> · {applicationId}</p>
    <h1 id="verification-title"><Bi en="Signature verifier" bn="ডিজিটাল স্বাক্ষর যাচাইকরণ" /></h1>
    <p className="safety-note"><strong><Bi en="A valid signature does not prove identity, capacity, consent or legal effect." bn="স্বাক্ষরটি যাচাইয়ে মিললেও তাতে পরিচয়, সিদ্ধান্ত নেওয়ার সক্ষমতা, সম্মতি বা আইনি কার্যকারিতা প্রমাণ হয় না।" /></strong></p>
    {error && <p role="alert" className="error">{error}</p>}
    {!mediation && !error && <p role="status">{bi('Loading…', 'লোড হচ্ছে…')}</p>}
    {mediation && !mediation.draft && <p><Bi en="No settlement draft on this case." bn="এই আবেদনে কোনো মীমাংসার খসড়া প্রস্তুত নেই।" /></p>}
    {mediation?.draft && <section className="card" aria-labelledby="document-title">
      <h2 id="document-title">{mediation.caseId} · <Bi en="draft" bn="খসড়া" /> v{num(mediation.draft.version)}</h2>
      <p className="muted"><Term code={mediation.draft.template} /> · <Term code={mediation.legalEffectState} /></p>
      <dl className="details compact">{mediation.draft.sections.map((section) => <div key={section.key}><dt>{section.label}</dt><dd>{section.text}{section.aiFilled ? ` · ${bi('AI', 'এআই')}` : ''}</dd></div>)}</dl>
      <ol className="plain-list">{mediation.signatures.map((signature) => <li key={signature.signerRole}><span><strong><Term code={signature.signerRole} /></strong> · {when(signature.receivedAt)}</span></li>)}</ol>
      <div className="choice-row"><button type="button" disabled={busy} onClick={verifyCurrent}><Bi en="Verify this document on this device" bn="বর্তমান ডিভাইসে যাচাই করুন" /></button><button type="button" className="secondary-button" disabled={busy || mediation.signatures.length === 0} onClick={testChangedCopy}><Bi en="Test a changed copy" bn="পরিবর্তিত কপি দিয়ে পরীক্ষা করুন" /></button><button type="button" className="secondary-button" disabled={busy} onClick={verifyServer}><Bi en="Verify on server" bn="কেন্দ্রীয় সার্ভারে যাচাই করুন" /></button></div>
      {deviceResult && <section role="status" aria-live="polite"><h3><Bi en="Browser check" bn="ব্রাউজারে যাচাইয়ের ফলাফল" /></h3><p className={deviceResult.allValid ? 'success' : 'error'}>{deviceResult.allValid ? bi('All three signatures match this document version.', 'তিনটি স্বাক্ষরই নথির এই অনুমোদিত সংস্করণের সাথে সম্পূর্ণ মিলেছে।') : bi('Verification failed or fewer than three signatures are present.', 'যাচাইকরণ ব্যর্থ হয়েছে অথবা তিনটি স্বাক্ষরের সবগুলো সম্পন্ন হয়নি।')}</p><p className="muted">SHA-256: <code>{deviceResult.documentHash}</code></p><ul>{deviceResult.signatures.map((signature) => <li key={signature.signerRole}><Term code={signature.signerRole} />: {valid(signature.valid)} · <Bi en="hash" bn="নিরাপত্তা কোড (হ্যাশ)" /> {valid(signature.hashMatches)} · <Bi en="signature" bn="ডিজিটাল স্বাক্ষর" /> {valid(signature.cryptographicallyValid)}</li>)}</ul></section>}
      {serverResult && <section role="status" aria-live="polite"><h3><Bi en="Server check" bn="সার্ভারে যাচাইয়ের ফলাফল" /></h3><p className={serverResult.allValid ? 'success' : 'error'}>{serverResult.allValid ? bi('All three stored signatures verify.', 'সার্ভারে সংরক্ষিত তিনটি স্বাক্ষরই সফলভাবে যাচাই হয়েছে।') : bi('Verification failed or fewer than three signatures are present.', 'যাচাইকরণ ব্যর্থ হয়েছে অথবা তিনটি স্বাক্ষরের সবগুলো সম্পন্ন হয়নি।')}</p><ul>{serverResult.signatures.map((signature) => <li key={signature.signerRole}><Term code={signature.signerRole} />: {valid(signature.valid)}</li>)}</ul></section>}
    </section>}
  </section>
}
