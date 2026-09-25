import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import CitizenCaseTracker from './CitizenCaseTracker.jsx'

test('CitizenCaseTracker asks for an ID and the private tracking code, with no sample-case shortcuts', () => {
  const html = renderToStaticMarkup(<CitizenCaseTracker />)
  expect(html).toContain('Track Application &amp; Case Progress')
  expect(html).toContain('aria-label="Application ID or Case ID"')
  expect(html).toContain('aria-label="Tracking code you received when you applied"')
  expect(html).toContain('Track Case')
  expect(html).not.toContain('case-tracker-chip')
})

test('CitizenCaseTracker offers asking by voice, with the voice code loaded only when it is used', () => {
  const html = renderToStaticMarkup(<CitizenCaseTracker />)
  expect(html).toContain('Ask by Voice')
  expect(html).not.toContain('Listening')
})
