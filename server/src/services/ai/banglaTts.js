// Adapter for the local BanglaTTS service (tts-service/app.py), which speaks case status to a caller who cannot read.
// It is sent only sentences the server built from fixed templates. Any failure returns null: the caller still gets the
// same sentence as text, so speech is never the only way to learn a status.
export const ttsEnabled = () => Boolean(process.env.TTS_URL) && process.env.VOICE_TTS !== 'off'

const prompts = new Map() // Fixed prompts are synthesized once per process; the prompt list bounds this cache.

export async function synthesizeSpeech(text, { reuse = false } = {}) {
  if (!ttsEnabled() || !text) return null
  if (reuse && prompts.has(text)) return prompts.get(text)
  try {
    const response = await fetch(new URL('/speak', process.env.TTS_URL), {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(15000),
    })
    if (!response.ok || response.headers.get('content-type') !== 'audio/mpeg') {
      console.error('Speech service rejected request:', response.status)
      return null
    }
    const audio = Buffer.from(await response.arrayBuffer())
    if (reuse) prompts.set(text, audio)
    return audio
  } catch (error) {
    console.error('Speech service request failed:', error.name)
    return null
  }
}
