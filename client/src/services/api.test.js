import { afterEach, expect, test, vi } from 'vitest'
import { setLang } from '../components/Bi.jsx'
import { api } from './api.js'

afterEach(() => {
  vi.unstubAllGlobals()
  setLang('en')
})

const answer = (response) => vi.stubGlobal('fetch', vi.fn(async () => response))

test('an empty body from the dev proxy (API down) becomes a readable error, not a JSON parse error', async () => {
  answer(new Response('', { status: 502 }))
  await expect(api('/api/voice/prompts', { method: 'POST', body: { key: 'welcome' } }))
    .rejects.toMatchObject({ status: 502, code: 'SERVER_UNAVAILABLE', message: 'The server is not responding. Please try again in a moment.' })
  setLang('bn')
  answer(new Response('<html>Bad Gateway</html>', { status: 504 }))
  await expect(api('/api/voice/prompts')).rejects.toThrow('সার্ভারের সাথে সংযোগ করা যাচ্ছে না।')
})

test('server errors keep their own code and message, and a stopped call still aborts', async () => {
  answer(Response.json({ error: { code: 'NOT_FOUND', message: 'No match.' } }, { status: 404 }))
  await expect(api('/api/voice/status')).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND', message: 'No match.' })
  answer({ status: 200, ok: true, json: () => Promise.reject(new DOMException('The call ended.', 'AbortError')) })
  await expect(api('/api/voice/prompts')).rejects.toMatchObject({ name: 'AbortError' })
})
