import { bi } from '../components/Bi.jsx'
const DATABASE = 'dlas-offline-v1'
const STORE = 'drafts'
const SIGNATURE_STORE = 'signature-queue'
const encoder = new TextEncoder()
const decoder = new TextDecoder()
let signedOut = false
let sessionEpoch = 0

function open() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 2)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'id' })
      if (!request.result.objectStoreNames.contains(SIGNATURE_STORE)) request.result.createObjectStore(SIGNATURE_STORE, { keyPath: 'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function operation(mode, callback, storeName = STORE) {
  const db = await open()
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, mode)
      const request = callback(transaction.objectStore(storeName))
      transaction.oncomplete = () => resolve(request?.result)
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
  } finally { db.close() }
}

const hex = (bytes) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
const bytes = (value) => Uint8Array.from(value.match(/.{2}/g), (item) => parseInt(item, 16))

async function key(passphrase, salt) {
  const source = await crypto.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' }, source,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

export async function saveDraft({ id, ownerId, status, value, passphrase }) {
  if (signedOut) throw new Error(bi('Sign in again before saving a local draft.', 'খসড়া রাখার আগে আবার সাইন ইন করুন।'))
  const startedIn = sessionEpoch
  if (passphrase.length < 8) throw new Error(bi('Use a local draft passphrase of at least 8 characters.', 'কমপক্ষে ৮ অক্ষরের পাসফ্রেজ দিন।'))
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(passphrase, salt), encoder.encode(JSON.stringify(value))))
  const hash = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', cipher)))
  if (signedOut || startedIn !== sessionEpoch) throw new Error(bi('Sign in again before saving a local draft.', 'খসড়া রাখার আগে আবার সাইন ইন করুন।'))
  await operation('readwrite', (store) => {
    if (signedOut || startedIn !== sessionEpoch) throw new Error(bi('Sign in again before saving a local draft.', 'খসড়া রাখার আগে আবার সাইন ইন করুন।'))
    return store.put({ id, ownerId, status, salt: hex(salt), iv: hex(iv), cipher: hex(cipher), hash, updatedAt: new Date().toISOString() })
  })
  return { id, hash }
}

export async function loadDraft(id, ownerId, passphrase) {
  const row = await operation('readonly', (store) => store.get(id))
  if (!row || row.ownerId !== ownerId) throw new Error(bi('Draft not found for this account.', 'এই অ্যাকাউন্টে খসড়াটি পাওয়া যায়নি।'))
  const cipher = bytes(row.cipher)
  const hash = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', cipher)))
  if (hash !== row.hash) throw new Error(bi('Local draft integrity check failed. Do not sync this draft.', 'এই ডিভাইসে রাখা খসড়ার তথ্য বদলে গেছে। এটি সার্ভারে পাঠাবেন না।'))
  try {
    const clear = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(row.iv) }, await key(passphrase, bytes(row.salt)), cipher)
    return { status: row.status, value: JSON.parse(decoder.decode(clear)), hashValid: true }
  } catch { throw new Error(bi('Draft passphrase is incorrect or the encrypted draft is damaged.', 'পাসফ্রেজ ভুল, বা খসড়াটি নষ্ট হয়েছে।')) }
}

export async function listDrafts(ownerId) {
  const rows = await operation('readonly', (store) => store.getAll())
  return rows.filter((row) => row.ownerId === ownerId).map(({ id, status, updatedAt }) => ({ id, status, updatedAt }))
}

export async function saveSignaturePacket({ id, ownerId, value, passphrase }) {
  if (signedOut) throw new Error(bi('Sign in again before saving a local signature.', 'স্বাক্ষর রাখার আগে আবার সাইন ইন করুন।'))
  const startedIn = sessionEpoch
  if (passphrase.length < 8) throw new Error(bi('Use a local passphrase of at least 8 characters to protect the offline signature packet.', 'অফলাইন স্বাক্ষর সুরক্ষায় কমপক্ষে ৮ অক্ষরের পাসফ্রেজ দিন।'))
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(passphrase, salt), encoder.encode(JSON.stringify(value))))
  const hash = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', cipher)))
  if (signedOut || startedIn !== sessionEpoch) throw new Error(bi('Sign in again before saving a local signature.', 'স্বাক্ষর রাখার আগে আবার সাইন ইন করুন।'))
  await operation('readwrite', (store) => {
    if (signedOut || startedIn !== sessionEpoch) throw new Error(bi('Sign in again before saving a local signature.', 'স্বাক্ষর রাখার আগে আবার সাইন ইন করুন।'))
    return store.put({ id, ownerId, salt: hex(salt), iv: hex(iv), cipher: hex(cipher), hash, updatedAt: new Date().toISOString() })
  }, SIGNATURE_STORE)
}

export async function listSignaturePackets(ownerId) {
  const rows = await operation('readonly', (store) => store.getAll(), SIGNATURE_STORE)
  return rows.filter((row) => row.ownerId === ownerId).map(({ id, updatedAt }) => ({ id, updatedAt }))
}

export async function loadSignaturePacket(id, ownerId, passphrase) {
  const row = await operation('readonly', (store) => store.get(id), SIGNATURE_STORE)
  if (!row || row.ownerId !== ownerId) throw new Error(bi('Offline signature not found for this account.', 'এই অ্যাকাউন্টে অফলাইন স্বাক্ষরটি পাওয়া যায়নি।'))
  const cipher = bytes(row.cipher)
  if (hex(new Uint8Array(await crypto.subtle.digest('SHA-256', cipher))) !== row.hash) throw new Error(bi('Offline signature integrity check failed. Do not sync it.', 'এই ডিভাইসে রাখা স্বাক্ষরের তথ্য বদলে গেছে। এটি সার্ভারে পাঠাবেন না।'))
  try {
    const clear = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(row.iv) }, await key(passphrase, bytes(row.salt)), cipher)
    return JSON.parse(decoder.decode(clear))
  } catch { throw new Error(bi('Signing passphrase is incorrect or the queued signature is damaged.', 'পাসফ্রেজ ভুল, অথবা এই ডিভাইসে রাখা স্বাক্ষরটি নষ্ট হয়েছে।')) }
}

export async function removeSignaturePacket(id, ownerId) {
  const row = await operation('readonly', (store) => store.get(id), SIGNATURE_STORE)
  if (row?.ownerId === ownerId) await operation('readwrite', (store) => store.delete(id), SIGNATURE_STORE)
}

export const removeDraft = (id) => operation('readwrite', (store) => store.delete(id))

export function resumeOfflineDrafts() { signedOut = false }

export async function clearOfflineDrafts() {
  signedOut = true
  sessionEpoch += 1
  await Promise.all([
    operation('readwrite', (store) => store.clear()),
    operation('readwrite', (store) => store.clear(), SIGNATURE_STORE),
  ])
}
