/* global navigator, caches, URL, localStorage, sessionStorage, performance, console */
import { expect, test } from '@playwright/test'

test('built PWA installs a static-only worker, loads the shell offline, and measures light mode on a throttled connection', async ({ page, request, browser, baseURL }) => {
  await page.addInitScript(() => {
    localStorage.setItem('dlas_token', 'old-demo-token')
    localStorage.setItem('dlas_registered_login_id', 'old-demo-id')
    localStorage.setItem('dlas_registered_login_pwd', 'old-demo-password')
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'One record, every handover.' })).toBeVisible()
  expect(await page.evaluate(() => ['dlas_token', 'dlas_registered_login_id', 'dlas_registered_login_pwd'].map((key) => localStorage.getItem(key)))).toEqual([null, null, null])
  const manifest = await (await request.get('/manifest.webmanifest')).json()
  expect(manifest.display).toBe('standalone')
  expect(manifest.icons.map(({ sizes }) => sizes)).toEqual(['192x192', '512x512'])
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
  const installability = await (await page.context().newCDPSession(page)).send('Page.getInstallabilityErrors')
  expect(installability.installabilityErrors).toEqual([])
  const cached = await page.evaluate(async () => (await Promise.all((await caches.keys()).map(async (name) => (await (await caches.open(name)).keys()).map((item) => new URL(item.url).pathname)))).flat())
  expect(cached.some((path) => path.startsWith('/assets/'))).toBeTruthy()
  expect(cached.some((path) => path.startsWith('/api/'))).toBeFalsy()

  await page.context().setOffline(true)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'One record, every handover.' })).toBeVisible()
  await page.getByRole('button', { name: 'Light mode' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-light-mode', 'on')
  await page.context().setOffline(false)

  const samples = []
  for (const light of [false, true]) {
    const cold = await browser.newContext({
      baseURL, serviceWorkers: 'block', viewport: { width: 390, height: 844 }, permissions: ['microphone'],
    })
    await cold.addInitScript((value) => localStorage.setItem('dlas-light-mode', value ? '1' : '0'), light)
    const coldPage = await cold.newPage()
    const cdp = await cold.newCDPSession(coldPage)
    await cdp.send('Network.enable')
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 50000, uploadThroughput: 50000 })
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
    await coldPage.goto('/')
    await expect(coldPage.getByRole('heading', { name: 'One record, every handover.' })).toBeVisible()
    await expect(coldPage.locator('html')).toHaveAttribute('data-light-mode', light ? 'on' : 'off')
    const loadMs = await coldPage.evaluate(() => performance.getEntriesByType('navigation')[0].duration)
    const shellBytes = await coldPage.evaluate(() => performance.getEntriesByType('navigation')[0].transferSize
      + performance.getEntriesByType('resource').reduce((total, item) => total + item.transferSize, 0))
    const start = Date.now()
    await coldPage.getByRole('button', { name: light ? 'Normal mode' : 'Light mode' }).click()
    await expect(coldPage.locator('html')).toHaveAttribute('data-light-mode', light ? 'off' : 'on')
    const toggleMs = Date.now() - start
    await coldPage.getByRole('button', { name: light ? 'Light mode' : 'Normal mode' }).click()
    await expect(coldPage.locator('html')).toHaveAttribute('data-light-mode', light ? 'on' : 'off')
    await coldPage.getByRole('link', { name: 'Start a voice intake' }).click()
    await coldPage.locator('.lang-switch button[lang="bn"]').click()
    const audioRequests = []
    coldPage.on('request', (request) => {
      if (new URL(request.url()).pathname.startsWith('/audio/')) audioRequests.push(request)
    })
    const callStart = Date.now()
    await coldPage.locator('.call-button').click()
    await expect(coldPage.locator('.call-card')).toBeVisible()
    const callMs = Date.now() - callStart
    if (light) await expect(coldPage.getByText(/শুনছি/)).toBeVisible()
    else await expect.poll(() => audioRequests.length).toBeGreaterThanOrEqual(12)
    samples.push({ mode: light ? 'Light' : 'Normal', loadMs: Math.round(loadMs), shellBytes, toggleMs, callMs, audioRequests: audioRequests.length })
    if (light) {
      await coldPage.getByRole('button', { name: 'সাধারণ মোড' }).click()
      await expect.poll(() => audioRequests.length).toBeGreaterThan(0)
    }
    await cold.close()
  }
  expect(samples[0].audioRequests).toBeGreaterThanOrEqual(12)
  expect(samples[1].audioRequests).toBe(0)
  for (const sample of samples) console.log(`${sample.mode} mode at 150 ms / 50 KB/s, 4x CPU, 390x844: cold shell ${sample.loadMs} ms / ${sample.shellBytes} bytes, mode toggle ${sample.toggleMs} ms, call start ${sample.callMs} ms / ${sample.audioRequests} audio requests.`)

  const adaptive = await browser.newContext({ baseURL, serviceWorkers: 'block' })
  await adaptive.addInitScript(() => {
    if (!sessionStorage.getItem('pwa-adaptive-initialized')) {
      localStorage.removeItem('dlas-light-mode')
      sessionStorage.setItem('pwa-adaptive-initialized', '1')
    }
    Object.defineProperty(navigator, 'connection', { configurable: true, value: { saveData: true, effectiveType: '4g' } })
  })
  const adaptivePage = await adaptive.newPage()
  await adaptivePage.goto('/')
  await expect(adaptivePage.locator('html')).toHaveAttribute('data-light-mode', 'on')
  await adaptivePage.getByRole('button', { name: 'Normal mode' }).click()
  await expect(adaptivePage.locator('html')).toHaveAttribute('data-light-mode', 'off')
  await adaptivePage.reload()
  await expect(adaptivePage.locator('html')).toHaveAttribute('data-light-mode', 'off')
  await adaptivePage.getByRole('button', { name: 'Sign up', exact: true }).click()
  await adaptivePage.getByLabel('Email ID / Phone').fill('fictional@example.test')
  await adaptivePage.getByLabel('Password', { exact: true }).fill('fictional-password')
  await adaptivePage.getByRole('dialog').getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(adaptivePage.getByLabel('Email ID / Phone')).toHaveValue('fictional@example.test')
  await expect(adaptivePage.getByLabel('Password', { exact: true })).toHaveValue('fictional-password')
  expect(await adaptivePage.evaluate(() => ['dlas_token', 'dlas_registered_login_id', 'dlas_registered_login_pwd'].map((key) => localStorage.getItem(key)))).toEqual([null, null, null])
  await adaptive.close()
})
