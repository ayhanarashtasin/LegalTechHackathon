import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { expect, test } from 'vitest'
import AssistedIntake, { applyMarmaTranscript } from './AssistedIntake.jsx'

const session = { token: 'test-token', user: { id: '000000000000000000000001', displayName: 'Test UDC' } }

test('applyMarmaTranscript fills an empty box and clears confirmation', () => {
  const next = applyMarmaTranscript({ originalStatement: '', originalConfirmed: true }, '  Marma draft text  ')
  expect(next.originalStatement).toBe('Marma draft text')
  expect(next.originalConfirmed).toBe(false)
})

test('applyMarmaTranscript appends without losing typed words', () => {
  const next = applyMarmaTranscript({ originalStatement: 'Typed Marma words', originalConfirmed: true }, 'Voice draft')
  expect(next.originalStatement).toBe('Typed Marma words\nVoice draft')
  expect(next.originalConfirmed).toBe(false)
})

test('applyMarmaTranscript ignores empty transcripts', () => {
  const form = { originalStatement: 'Kept', originalConfirmed: false }
  expect(applyMarmaTranscript(form, '   ')).toBe(form)
})

test('AssistedIntake offers Marma voice fill with an accessible name', () => {
  const html = renderToStaticMarkup(<MemoryRouter><AssistedIntake session={session} /></MemoryRouter>)
  expect(html).toContain('original-statement')
  expect(html).toContain('Speak Marma instead of typing')
  expect(html).toContain('aria-describedby="marma-voice-help"')
})
