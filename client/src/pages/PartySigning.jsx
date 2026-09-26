import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Bi, Term, bi, when } from '../components/Bi.jsx'
import { api } from '../services/api.js'
import { PartyIdentityVerification, SignatureImageUpload } from '../components/IdentityVerification.jsx'
import { createSignaturePacket, settlementHash } from '../utils/settlementCrypto.js'
import {
  listSignaturePackets, loadDraft, loadSignaturePacket, removeDraft, removeSignaturePacket,
  resumeOfflineDrafts, saveDraft, saveSignaturePacket,
} from '../utils/offlineDrafts.js'

const hex = (bytes) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
const ownerFor = async (code) => `party-signing:${hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code))))}`
const snapshotId = (ownerId) => `approved-draft:${ownerId}`

export default function PartySigning() {
  const [code, setCode] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [invitation, setInvitation] = useState(null)
  const [identity, setIdentity] = useState(null)
  const [pending, setPending] = useState([])
  const [confirmed, setConfirmed] = useState(false)
  const [online, setOnline] = useState(navigator.onLine)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  const refreshPending = useCallback(async (ownerId) => setPending(await listSignaturePackets(ownerId)), [])

  const syncPending = useCallback(async () => {
    if (!navigator.onLine || code.trim().length !== 43 || passphrase.length < 8) return
    const ownerId = await ownerFor(code.trim())
    const rows = await listSignaturePackets(ownerId)
    if (!rows.length) return
    setBusy(true)
    setError('')
    try {
      for (const row of rows) {
        const saved = await loadSignaturePacket(row.id, ownerId, passphrase)
        await api('/api/mediation-signing/sign', { method: 'POST', body: saved })
        await removeSignaturePacket(row.id, ownerId)
      }
      await removeDraft(snapshotId(ownerId))
      setInvitation(null)
      setIdentity(null)
      setConfirmed(false)
      setCode('')
      setPassphrase('')
      setNotice(bi('Your signature was synced and verified on the approved draft.', 'অনুমোদিত খসড়ায় আপনার স্বাক্ষর সফলভাবে যুক্ত ও যাচাই হয়েছে।'))
      await refreshPending(ownerId)
    } catch (failure) { setError(failure.message) }
    finally { setBusy(false) }
  }, [code, passphrase, refreshPending])

  useEffect(() => {
    const disconnected = () => setOnline(false)
    const connected = () => { setOnline(true); syncPending() }
    window.addEventListener('offline', disconnected)
    window.addEventListener('online', connected)
    return () => { window.removeEventListener('offline', disconnected); window.removeEventListener('online', connected) }
  }, [syncPending])

  async function openDraft(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const trimmed = code.trim()
      const ownerId = await ownerFor(trimmed)
      await refreshPending(ownerId)
      let result
      if (navigator.onLine) {
        const state = await api('/api/mediation-signing/verification/state', { method: 'POST', body: { code: trimmed } })
        if (state.verification?.status !== 'VERIFIED') {
          setIdentity(state)
          setInvitation(null)
          return
        }
        result = await api('/api/mediation-signing/open', { method: 'POST', body: { code: trimmed } })
        if (await settlementHash(result.draft) !== result.documentHash) throw new Error(bi('The document hash does not match. Do not sign.', 'নথির নিরাপত্তা কোড (হ্যাশ) মিলছে না। স্বাক্ষর করবেন না।'))
        resumeOfflineDrafts()
        await saveDraft({ id: snapshotId(ownerId), ownerId, status: 'PARTY_SIGNING', value: result, passphrase })
        setNotice(bi('The approved draft is encrypted on this device for offline signing.', 'অফলাইনে স্বাক্ষরের সুবিধার্থে অনুমোদিত খসড়াটি এই ডিভাইসে সুরক্ষিতভাবে সংরক্ষণ করা হয়েছে।'))
      } else {
        result = (await loadDraft(snapshotId(ownerId), ownerId, passphrase)).value
        if (!result.identityVerificationId) throw new Error(bi('Connect to complete your identity check before signing.', 'স্বাক্ষরের আগে অনলাইনে পরিচয় যাচাই সম্পন্ন করুন।'))
        if (await settlementHash(result.draft) !== result.documentHash) throw new Error(bi('The saved document hash does not match. Do not sign.', 'সংরক্ষিত নথির নিরাপত্তা কোড (হ্যাশ) মিলছে না। স্বাক্ষর করবেন না।'))
        if (new Date(result.expiresAt) <= new Date()) throw new Error(bi('The signing code has expired. Ask the mediator for a new one.', 'স্বাক্ষরের কোডের মেয়াদ শেষ হয়ে গেছে। মধ্যস্থতাকারীর কাছ থেকে নতুন কোড সংগ্রহ করুন।'))
      }
      resumeOfflineDrafts()
      setInvitation(result)
      setIdentity(null)
      setConfirmed(false)
    } catch (failure) { setError(failure.message) }
    finally { setBusy(false) }
  }

  async function sign() {
    if (!invitation || !confirmed || passphrase.length < 8 || pending.length) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const trimmed = code.trim()
      const ownerId = await ownerFor(trimmed)
      if (new Date(invitation.expiresAt) <= new Date()) throw new Error(bi('The signing code has expired. Ask the mediator for a new one.', 'স্বাক্ষরের কোডের মেয়াদ শেষ হয়ে গেছে। মধ্যস্থতাকারীর কাছ থেকে নতুন কোড সংগ্রহ করুন।'))
      if (await settlementHash(invitation.draft) !== invitation.documentHash) throw new Error(bi('The document changed. Do not sign.', 'খসড়া নথিতে পরিবর্তন ঘটেছে। স্বাক্ষর করবেন না।'))
      const signature = await createSignaturePacket(invitation.draft, invitation.signerRole)
      const packet = { code: trimmed, ...signature, partyConfirmed: true }
      await saveSignaturePacket({ id: signature.clientMutationId, ownerId, value: packet, passphrase })
      await refreshPending(ownerId)
      setNotice(bi('Your signature is encrypted on this device. Sync it when connected.', 'আপনার স্বাক্ষরটি এই ডিভাইসে সুরক্ষিতভাবে সংরক্ষণ করা হয়েছে। ইন্টারনেট সংযোগ পেলে সার্ভারে জমা দিন।'))
      if (navigator.onLine) await syncPending()
    } catch (failure) { setError(failure.message) }
    finally { setBusy(false) }
  }

  async function clearLocal() {
    if (!window.confirm(bi('Delete this device’s saved draft and pending signature?', 'এই ডিভাইসে সংরক্ষিত খসড়া ও অপেক্ষমাণ স্বাক্ষর মুছে ফেলতে চান?'))) return
    const ownerId = await ownerFor(code.trim())
    for (const row of await listSignaturePackets(ownerId)) await removeSignaturePacket(row.id, ownerId)
    await removeDraft(snapshotId(ownerId))
    setPending([])
    setInvitation(null)
    setConfirmed(false)
    setCode('')
    setPassphrase('')
    setNotice(bi('Local signing data deleted.', 'এই ডিভাইসে সংরক্ষিত স্বাক্ষরের তথ্য মুছে ফেলা হয়েছে।'))
  }

  return <section className="call-page" aria-labelledby="party-signing-title">
    <Link to="/"><Bi en="← Home" bn="← প্রধান পাতায় ফিরুন" /></Link>
    <h1 id="party-signing-title"><Bi en="Sign a mediation draft" bn="মধ্যস্থতার খসড়ায় স্বাক্ষর করুন" /></h1>
    <p className="safety-note"><Bi en="Enter the private code the mediator gave you. Read the complete approved draft before signing. The code grants access to this draft; it does not prove your identity, capacity, consent, or legal effect." bn="মধ্যস্থতাকারীর দেওয়া গোপন কোড লিখুন। স্বাক্ষরের আগে সম্পূর্ণ অনুমোদিত খসড়া পড়ুন। কোডটি এই খসড়া দেখার সুযোগ দেয়; এটি পরিচয়, সক্ষমতা, সম্মতি বা আইনি কার্যকারিতা প্রমাণ করে না।" /></p>
    <form className="form-stack" onSubmit={openDraft}>
      <label htmlFor="party-signing-code"><Bi en="Private signing code" bn="স্বাক্ষরের গোপন কোড" /></label>
      <input id="party-signing-code" type="password" value={code} onChange={(event) => { setCode(event.target.value); setInvitation(null); setIdentity(null); setPending([]) }} minLength={43} maxLength={43} autoComplete="off" required />
      <label htmlFor="party-signing-passphrase"><Bi en="Local passphrase for encrypted offline copy" bn="অফলাইনে সুরক্ষিত রাখার পাসফ্রেজ" /></label>
      <input id="party-signing-passphrase" type="password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} minLength={8} autoComplete="off" required />
      <button type="submit" disabled={busy}><Bi en={online ? 'Open approved draft' : 'Open saved draft offline'} bn={online ? 'অনুমোদিত খসড়া দেখুন' : 'অফলাইনে সংরক্ষিত খসড়া দেখুন'} /></button>
    </form>
    {error && <p role="alert" className="error">{error}</p>}
    {notice && <p role="status" className="success">{notice}</p>}
    {identity && <PartyIdentityVerification key={code.trim()} code={code.trim()} initial={identity} onApproved={() => openDraft({ preventDefault() {} })} />}
    {invitation && <section aria-labelledby="approved-draft-title" className="form-stack">
      {online && <SignatureImageUpload code={code.trim()} onBusy={setBusy} />}
      <h2 id="approved-draft-title"><Bi en="Approved draft" bn="অনুমোদিত খসড়া" /> · <Term code={invitation.signerRole} /> · v{invitation.draft.version}</h2>
      <p><Bi en="Code expires" bn="কোডের মেয়াদ উত্তীর্ণের সময়" />: {when(invitation.expiresAt)}</p>
      <p><Bi en="Document SHA-256" bn="নথির নিরাপত্তা কোড (SHA-256)" />: <code>{invitation.documentHash}</code></p>
      <ol className="plain-list">{invitation.draft.sections.map((section) => <li key={section.key}><strong>{section.label}</strong><p>{section.text}</p>{section.aiFilled && <p className="muted"><Bi en="AI-assisted wording; check carefully." bn="এআই-এর সহায়তায় প্রস্তুতকৃত বিবরণ; সতর্কতার সাথে যাচাই করুন।" /></p>}</li>)}</ol>
      <label className="checkbox-label"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><Bi en={`I have read this exact draft and agree to sign as ${invitation.signerRole.replaceAll('_', ' ')}.`} bn={`আমি সম্পূর্ণ খসড়াটি পড়েছি এবং ${invitation.signerRole === 'PARTY_A' ? 'প্রথম পক্ষ (পক্ষ ক)' : 'দ্বিতীয় পক্ষ (পক্ষ খ)'} হিসেবে স্বাক্ষর প্রদানে সম্মত।`} /></label>
      <button type="button" disabled={busy || !confirmed || pending.length > 0} onClick={sign}><Bi en={online ? 'Sign and sync' : 'Sign offline'} bn={online ? 'স্বাক্ষর প্রদান ও জমা দিন' : 'অফলাইনে স্বাক্ষর সংরক্ষণ করুন'} /></button>
    </section>}
    {pending.length > 0 && <section aria-label={bi('Pending signatures', 'অপেক্ষমাণ স্বাক্ষর')}><p role="status"><Bi en={`Encrypted signatures awaiting sync: ${pending.length}`} bn={`জমা দেওয়ার অপেক্ষায় থাকা সুরক্ষিত স্বাক্ষর: ${pending.length}`} /></p><button type="button" disabled={busy || !online || passphrase.length < 8} onClick={syncPending}><Bi en="Sync now" bn="এখন জমা দিন (সিঙ্ক)" /></button></section>}
    {(invitation || pending.length > 0) && <button type="button" className="secondary-button" disabled={busy} onClick={clearLocal}><Bi en="Delete local signing data" bn="এই ডিভাইসে সংরক্ষিত স্বাক্ষরের তথ্য মুছুন" /></button>}
  </section>
}
