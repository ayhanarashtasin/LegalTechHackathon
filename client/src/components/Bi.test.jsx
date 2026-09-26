import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, expect, test } from 'vitest'
import { Panel, bi, num, say, setLang, tr, when } from './Bi.jsx'

afterEach(() => setLang('en'))

test('one switch flips every helper between English and Bangla', () => {
  setLang('en')
  expect([bi('Tasks', 'কাজ'), say('ACCEPTED'), num(2026), say('SOME_NEW_CODE')]).toEqual(['Tasks', 'Accepted', '2026', 'Some new code'])
  expect(say('HEARING_TODAY')).toBe('Hearing today')
  expect(tr('Submitted; first human review has not been recorded.')).toBe('Submitted; first human review has not been recorded.')
  setLang('bn')
  expect([bi('Tasks', 'কাজ'), say('ACCEPTED'), num(2026)]).toEqual(['কাজ', 'গৃহীত', '২০২৬'])
  expect(say('HEARING_TODAY')).toBe('আজ শুনানি')
  expect(tr('A court hearing is listed for today; confirm attendance and the applicant-safe next step before travel.')).toBe('আজ শুনানি আছে; যাতায়াতের আগে উপস্থিতি ও আবেদনকারীর নিরাপদ পরবর্তী ধাপ নিশ্চিত করুন।')
  expect(when(null)).toBe('নির্ধারিত নয়')
  expect(tr('3 open tasks need a human next action.')).toBe('৩টি চলমান কাজে পরবর্তী পদক্ষেপ দরকার।')
  expect(tr('Reported by the applicant by voice. Identity is incomplete. Typed by a person.')).toBe('আবেদনকারী নিজে ফোনে জানিয়েছেন। পরিচয় অসম্পূর্ণ। Typed by a person.')
  expect(renderToStaticMarkup(<Panel id="t" en="Tasks" bn="কাজ" open>x</Panel>)).toContain('<details open=""><summary><h2 id="t">কাজ</h2>')
  expect(renderToStaticMarkup(<Panel id="t" en="Tasks" bn="কাজ">x</Panel>)).not.toContain('open')
})
