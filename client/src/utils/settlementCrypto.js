const encoder = new TextEncoder()
const base64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
const fromBase64url = (value) => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4)), (character) => character.charCodeAt(0))
const hex = (bytes) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')

export function canonicalSettlement(draft, sections = draft.sections) {
  const sorted = [...sections].sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0).map(({ key, label, text, aiFilled }) => ({
    key, label, text: String(text).replaceAll('\r\n', '\n').trim(), aiFilled: Boolean(aiFilled),
  }))
  return JSON.stringify({ draftId: String(draft.id), version: Number(draft.version), template: draft.template, ...(draft.templateRevision ? { templateRevision: draft.templateRevision } : {}), sections: sorted })
}

export async function settlementHash(draft, sections = draft.sections) {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(canonicalSettlement(draft, sections)))))
}

async function ephemeralSigningKey() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const publicKeyJwk = await crypto.subtle.exportKey('jwk', pair.publicKey)
  const privateBytes = await crypto.subtle.exportKey('pkcs8', pair.privateKey)
  const privateKey = await crypto.subtle.importKey('pkcs8', privateBytes, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  new Uint8Array(privateBytes).fill(0)
  return { publicKeyJwk, privateKey }
}

export async function createSignaturePacket(draft, signerRole) {
  // The extractable keypair exists only in the helper's scope; sign with a non-extractable key.
  const { publicKeyJwk, privateKey } = await ephemeralSigningKey()
  const canonical = encoder.encode(canonicalSettlement(draft))
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, canonical)
  return {
    signerRole, draftVersion: draft.version, documentHash: await settlementHash(draft), publicKeyJwk,
    signature: base64url(signature), clientMutationId: crypto.randomUUID(), clientSignedAt: new Date().toISOString(),
  }
}

export async function verifySettlement(draft, signatures, sections = draft.sections) {
  const documentHash = await settlementHash(draft, sections)
  const results = await Promise.all(signatures.map(async (record) => {
    const hashMatches = record.documentHash === documentHash && record.draftVersion === draft.version
    try {
      const key = await crypto.subtle.importKey('jwk', record.publicKeyJwk, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify'])
      const cryptographicallyValid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, fromBase64url(record.signature), encoder.encode(canonicalSettlement(draft, sections)))
      return { signerRole: record.signerRole, receivedAt: record.receivedAt, hashMatches, cryptographicallyValid, valid: hashMatches && cryptographicallyValid }
    } catch {
      return { signerRole: record.signerRole, receivedAt: record.receivedAt, hashMatches, cryptographicallyValid: false, valid: false }
    }
  }))
  // Party A, Party B and the mediator must all be present; a CLAO certification signature, when present, must verify too.
  const required = results.filter(({ signerRole }) => signerRole !== 'CLAO')
  return { documentHash, signatures: results, allValid: required.length === 3 && results.every(({ valid }) => valid) }
}
