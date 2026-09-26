import { expect, test } from '@playwright/test'

test('Step 13: API security headers, login throttling, and route focus are enforced', async ({ page }) => {
  const health = await page.request.get('http://127.0.0.1:5001/health')
  expect(health.headers()['x-content-type-options']).toBe('nosniff')
  expect(health.headers()['x-frame-options']).toBe('DENY')
  expect(health.headers()['content-security-policy']).toContain("default-src 'none'")

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await page.request.post('/api/auth/login', { data: { username: 'step13.throttle', password: 'not-the-password' } })
    expect(response.status()).toBe(401)
  }
  const limited = await page.request.post('/api/auth/login', { data: { username: 'step13.throttle', password: 'not-the-password' } })
  expect(limited.status()).toBe(429)
  expect((await limited.json()).error.code).toBe('LOGIN_RATE_LIMITED')
  expect(limited.headers()['cache-control']).toBe('no-store')

  await page.goto('/')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.getByRole('tab', { name: 'Officer' }).click()
  await page.getByLabel('Officer ID').fill('step13.accessibility')
  await page.getByLabel('Password', { exact: true }).fill('not-the-password')
  await page.getByRole('button', { name: 'Sign In as Officer' }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await page.getByRole('button', { name: 'Close' }).click()
  // The header switch turns the whole app into one language and remembers the choice.
  await page.getByRole('button', { name: 'বাংলা', exact: true }).click()
  await expect(page.getByRole('button', { name: 'বাংলা', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('heading', { name: 'একটি রেকর্ড, প্রতিটি হস্তান্তরে।' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'সাইন ইন', exact: true })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('lang', 'bn')
  await page.getByRole('link', { name: 'টেলিফোনে সহায়তা কল শুরু করুন' }).click()
  await expect(page).toHaveURL(/\/voice$/)
  await expect(page.locator('#main')).toBeFocused()
  await expect(page.locator('.call-page')).toHaveAttribute('lang', 'bn')
  await page.reload()
  await expect(page.getByRole('button', { name: 'কল করুন' })).toBeVisible()
  await page.getByRole('button', { name: 'English', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Call', exact: true })).toBeVisible()
  await expect(page.locator('.call-page')).toHaveAttribute('lang', 'en')
  await page.setViewportSize({ width: 320, height: 800 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
})
