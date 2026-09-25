import { HttpError } from '../utils/httpError.js'

const windowMs = 10 * 60 * 1000
const maxBuckets = 4096

// ponytail: bounded per-process IP buckets; use shared storage before scaling.
// Each limited route keeps its own buckets, so a caller's voice answers never use up the intake limit.
export function limitPublic(max) {
  const recent = new Map()
  return (request, _response, next) => {
    const now = Date.now()
    const hits = (recent.get(request.ip) || []).filter((time) => now - time < windowMs)
    if (hits.length >= max) throw new HttpError(429, 'RATE_LIMITED', 'Too many requests. Please try again later.')
    if (!recent.has(request.ip) && recent.size >= maxBuckets) {
      for (const [ip, times] of recent) if (now - times.at(-1) >= windowMs) recent.delete(ip)
      if (recent.size >= maxBuckets) recent.delete(recent.keys().next().value)
    }
    recent.delete(request.ip)
    recent.set(request.ip, [...hits, now])
    next()
  }
}

// The typed and spoken status lookups check the same ID and code, so they share one budget: a second route must not
// double how many codes a caller can guess.
export const limitStatusLookup = limitPublic(20)
