import { expect, test } from '@playwright/test'
import { signOut } from './support.js'

test('all auto-filled demo login choices work without running the scenario seed', async ({ page, request }) => {
  test.setTimeout(120000)
  const choices = [['Citizen', null], ['Officer', 'dlao'], ['Officer', 'lawyer'], ['Officer', 'mediator'], ['Officer', 'helpline'], ['Officer', 'udc'], ['Officer', 'receiving_dlao'], ['Officer', 'case_support'], ['Officer', 'clao'], ['Admin', null]]
  await page.goto('/')
  await page.getByRole('button', { name: 'English', exact: true }).click()
  for (const [tab, role] of choices) {
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.getByRole('tab', { name: tab, exact: true }).click()
    if (role) await page.getByRole('combobox').selectOption(role)
    const loginResponse = page.waitForResponse((response) => response.url().endsWith('/api/auth/login') && response.request().method() === 'POST')
    await page.getByRole('button', { name: `Sign In as ${tab}`, exact: true }).click()
    expect((await loginResponse).status(), `${tab} ${role || ''} demo login`).toBe(200)
    await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible()
    await expect(page.getByRole('dialog')).toBeHidden()
    await page.reload()
    await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible()
    const links = await page.locator('a[href^="/"]').evaluateAll((links) => [...new Set(links.map((link) => link.getAttribute('href')))])
    for (const link of links) expect((await request.get(link)).ok(), link).toBeTruthy()
    await signOut(page)
  }
})
