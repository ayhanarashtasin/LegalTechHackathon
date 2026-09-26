import { expect } from '@playwright/test'

export const testDatabase = /^dlas_e2e_[a-f0-9]{12}$/
export const roleNames = {
  DLAO_OFFICER: 'DLAO officer', CASE_SUPPORT: 'Case support', HELPLINE_AGENT: 'Helpline agent',
  UDC_OPERATOR: 'UDC operator', PANEL_LAWYER: 'Panel lawyer', MEDIATOR: 'Mediator',
  RECEIVING_DLAO: 'Receiving DLAO', CLAO: 'CLAO',
}

// Case sections and "add" forms start folded; open one by its summary text before using what is inside.
export async function expand(scope, name) {
  const summary = scope.locator('summary').filter({ hasText: name }).first()
  if (!await summary.evaluate((node) => node.parentElement.open)) await summary.click()
}

export async function signIn(page, role) {
  const actor = JSON.parse(process.env.E2E_ACTORS)[role]
  await page.goto('/')
  await page.getByRole('button', { name: 'English', exact: true }).click()
  // The session survives navigation, so switching to another role signs the previous user out first.
  const signInButton = page.getByRole('button', { name: 'Sign in', exact: true })
  const accountMenu = page.getByRole('button', { name: 'Account menu' })
  await expect(signInButton.or(accountMenu)).toBeVisible()
  if (await accountMenu.isVisible()) await signOut(page)
  await signInButton.click()
  await page.getByRole('tab', { name: 'Officer' }).click()
  await page.getByLabel('Officer ID').fill(actor.username)
  await page.getByLabel('Password', { exact: true }).fill(actor.password)
  await page.getByRole('button', { name: 'Sign In as Officer' }).click()
  await expect(page.getByRole('heading', { name: `${roleNames[role]} workspace` })).toBeVisible()
}

export async function signOut(page) {
  await page.getByRole('button', { name: 'Account menu' }).click()
  await page.getByRole('menuitem', { name: 'Sign out' }).click()
}
