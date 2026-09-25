import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import CitizenCaseTracker from './CitizenCaseTracker.jsx'

test('CitizenCaseTracker renders search box, label, and demo chips for unauthenticated parcel tracking', () => {
  const html = renderToStaticMarkup(<CitizenCaseTracker />)
  expect(html).toContain('Track Application &amp; Case Progress')
  expect(html).toContain('APP-2026-000039')
  expect(html).toContain('CASE-2026-000015')
  expect(html).toContain('Track Case')
})
