import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { expect, test } from 'vitest'
import App from './App.jsx'

test('landing page offers clean sign in, sign up, and voice intake doors', () => {
  const html = renderToStaticMarkup(<MemoryRouter><App /></MemoryRouter>)
  expect(html).not.toContain('Sign in with a fictional provider account')
  expect(html).not.toContain('server/.demo-credentials.json')
  expect(html).not.toContain('Prototype · fictional data')
  expect(html).toContain('Sign in')
  expect(html).toContain('Sign up')
  expect(html).toContain('Need voice support?')
  expect(html).toContain('One record, every handover.')
  expect(html).toContain('href="#main"')
})

test('restores session from sessionStorage on reload without signing out', () => {
  const fakeSession = {
    token: 'test-token',
    user: {
      id: 'usr-1',
      displayName: 'Fatima Rahman',
      username: 'fatima',
      assignments: [{ role: 'CITIZEN' }],
    },
  }
  const originalStorage = globalThis.sessionStorage
  globalThis.sessionStorage = {
    getItem: (key) => (key === 'dlas_session' ? JSON.stringify(fakeSession) : null),
    setItem: () => {},
    removeItem: () => {},
  }
  try {
    const html = renderToStaticMarkup(<MemoryRouter><App /></MemoryRouter>)
    expect(html).not.toContain('One record, every handover.')
    expect(html).toContain('Account menu')
    expect(html).toContain('account-circle-initial">F<')
    expect(html).toContain('Citizen portal')
  } finally {
    if (originalStorage) {
      globalThis.sessionStorage = originalStorage
    } else {
      delete globalThis.sessionStorage
    }
  }
})
