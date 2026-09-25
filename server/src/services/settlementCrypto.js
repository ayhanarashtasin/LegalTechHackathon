import { createHash, createPublicKey, verify } from 'node:crypto'

export function canonicalSettlement(draft) {
  const sections = [...draft.sections].sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0).map(({ key, label, text, aiFilled }) => ({
    key, label, text: String(text).replaceAll('\r\n', '\n').trim(), aiFilled: Boolean(aiFilled),
  }))
  return JSON.stringify({ draftId: String(draft._id ?? draft.id), version: Number(draft.version), template: draft.template, ...(draft.templateRevision ? { templateRevision: draft.templateRevision } : {}), sections })
}

export function settlementHash(draft) {
  return createHash('sha256').update(canonicalSettlement(draft)).digest('hex')
}

export function verifySettlementSignature(draft, record) {
  const hash = settlementHash(draft)
  if (record.documentHash !== hash) return { valid: false, hashMatches: false, cryptographicallyValid: false }
  try {
    const key = createPublicKey({ key: record.publicKeyJwk, format: 'jwk' })
    const signature = Buffer.from(record.signature, 'base64url')
    const cryptographicallyValid = signature.length === 64 && verify('sha256', Buffer.from(canonicalSettlement(draft)), { key, dsaEncoding: 'ieee-p1363' }, signature)
    return { valid: cryptographicallyValid, hashMatches: true, cryptographicallyValid }
  } catch {
    return { valid: false, hashMatches: true, cryptographicallyValid: false }
  }
}
