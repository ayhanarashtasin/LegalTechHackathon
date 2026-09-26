/* global process */
import { expect, test } from '@playwright/test'
import { signIn } from './support.js'

test('Step 12: separate parties sign asynchronously, one offline packet syncs, and edited copy fails verification', async ({ page, request, browser, baseURL }) => {
  test.setTimeout(120000) // three browser sessions, identity checks, and a CLAO certification
  const actors = JSON.parse(process.env.E2E_ACTORS)
  const ids = {}
  const headersFor = async (role) => {
    const response = await request.post('/api/auth/login', { data: actors[role] })
    const session = await response.json()
    ids[role] = session.user.id
    return { authorization: `Bearer ${session.token}` }
  }
  const officer = await headersFor('DLAO_OFFICER')
  const mediator = await headersFor('MEDIATOR')
  const submitted = await request.post('/api/applications', { headers: officer, data: { applicantName: 'Fictional Step 12 e-sign applicant' } })
  expect(submitted.status()).toBe(201)
  const { applicationId } = await submitted.json()
  for (const [action, body] of [
    ['review', { reviewState: 'READY_FOR_DECISION', reason: 'A human DLAO officer reviewed this fictional matter.' }],
    ['accept', { reason: 'A human DLAO officer accepted this fictional matter.' }],
  ]) expect((await request.post(`/api/applications/${applicationId}/${action}`, { headers: officer, data: body })).ok()).toBeTruthy()
  expect((await request.post(`/api/applications/${applicationId}/mediation`, { headers: officer, data: {} })).ok()).toBeTruthy()
  expect((await request.post(`/api/applications/${applicationId}/mediation/mediator`, { headers: officer, data: { mediatorUserId: ids.MEDIATOR } })).ok()).toBeTruthy()
  const mediationPath = `/api/applications/${applicationId}/mediation`
  for (const [suffix, data] of [
    ['/safety-consent', {
      safeForApplicant: true, applicantAgreed: true, applicantAvailable: true, oppositePartyWilling: true,
      status: 'CONSENT_CONFIRMED', reason: 'The mediator checked safety privately and both fictional parties agreed to mediation.',
    }],
    ['/schedule', {
      mode: 'REMOTE', scheduledAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      inPersonFallback: 'Meet at the fictional district legal-aid office if remote access fails.',
      notices: ['PARTY_A', 'PARTY_B'].map((party) => ({ party, deliveryState: 'DELIVERED', reason: 'A human recorded delivery through an approved route.' })),
    }],
    ['/advance', {}],
    ['/documents/review', { reason: 'The mediator reviewed the fictional documents without making a legal finding.' }],
    ['/advance', {}],
    ['/attendance', { partyA: 'ATTENDED', partyB: 'ATTENDED', reason: 'Both fictional parties were recorded as present.' }],
    ['/advance', {}],
    ['/outcome', { outcome: 'AGREEMENT_REACHED', reason: 'The mediator recorded the fictional agreement.' }],
    ['/draft', { template: 'MAINTENANCE', notes: 'Fictional parties agreed on a monthly amount and review date.', identifiersRemoved: true }],
    ['/draft/review', { partyAUnderstands: true, partyAConsents: true, partyBUnderstands: true, partyBConsents: true, warningsReviewed: true, reason: 'Both fictional parties confirmed understanding and consent to the draft and the mediator reviewed its warnings.' }],
  ]) expect((await request.post(`${mediationPath}${suffix}`, { headers: mediator, data })).ok()).toBeTruthy()

  await signIn(page, 'MEDIATOR')
  await page.getByRole('link', { name: new RegExp(applicationId) }).click()
  await expect(page.getByRole('heading', { name: /Step 8 — Signatures/ })).toBeVisible()
  await page.getByRole('button', { name: 'Issue PARTY A code' }).click()
  const partyACode = await page.locator('code.signing-code').first().textContent()
  await page.getByRole('button', { name: 'Issue PARTY B code' }).click()
  await expect(page.locator('code.signing-code')).toHaveCount(2)
  const partyBCode = await page.locator('code.signing-code').last().textContent()
  expect(partyACode).not.toBe(partyBCode)
  const partyAContext = await browser.newContext({ baseURL })
  const partyBContext = await browser.newContext({ baseURL })
  const partyAPage = await partyAContext.newPage()
  await partyAPage.setViewportSize({ width: 360, height: 800 })
  const partyBPage = await partyBContext.newPage()
  await partyAPage.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const canvas = document.createElement('canvas')
      canvas.width = 160; canvas.height = 120
      const paint = canvas.getContext('2d')
      const timer = setInterval(() => { paint.fillStyle = '#173859'; paint.fillRect(0, 0, 160, 120); paint.fillStyle = '#fff'; paint.fillText(`Fictional identity ${Date.now()}`, 4, 60) }, 100)
      const stream = canvas.captureStream(10)
      stream.getVideoTracks()[0].addEventListener('ended', () => clearInterval(timer))
      return stream
    }
  })
  const approveIdentity = async (partyRole) => {
    await page.getByRole('button', { name: 'Refresh identity reviews' }).click()
    const card = page.getByRole('article').filter({ has: page.getByRole('heading', { name: new RegExp(partyRole) }) })
    await expect(card.getByRole('heading')).toContainText('Waiting for the mediator')
    await card.getByRole('checkbox').nth(0).check()
    await card.getByRole('checkbox').nth(1).check()
    await card.getByRole('checkbox').nth(2).check()
    await card.getByLabel('Review reason / witnessed details').fill('Fictional identity checked by the test mediator; the party consented at the test office without a helper signing.')
    await card.getByRole('button', { name: 'Save identity decision' }).click()
    await expect(card.getByRole('heading')).toContainText('Identity check approved')
  }
  const partyRequests = []
  for (const partyPage of [partyAPage, partyBPage]) partyPage.on('request', (outgoing) => {
    if (outgoing.url().endsWith('/mediation-signing/sign') && outgoing.method() === 'POST') partyRequests.push(JSON.parse(outgoing.postData()))
  })
  await partyAPage.goto('/mediation/sign')
  await partyAPage.getByLabel('Private signing code').fill(partyACode)
  await partyAPage.getByLabel('Local passphrase for encrypted offline copy').fill('FictionalPartyASecret!')
  await partyAPage.getByRole('button', { name: 'Open approved draft' }).click()
  await expect(partyAPage.getByRole('heading', { name: 'Verify your identity before signing' })).toBeVisible()
  await expect(partyAPage.getByRole('button', { name: 'Sign and sync' })).toHaveCount(0)
  await partyAPage.getByRole('checkbox', { name: /I consent to this private identity/ }).check()
  await partyAPage.getByRole('button', { name: 'Start identity check' }).click()
  await expect(partyAPage.getByText(/Say “This is me”/)).toBeVisible()
  await partyAPage.getByRole('button', { name: 'Record challenge video' }).click()
  await expect(partyAPage.getByRole('button', { name: 'Record again' })).toBeEnabled({ timeout: 15000 })
  await partyAPage.getByLabel('Upload ID').setInputFiles({ name: 'fictional-id.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0uoAAAAASUVORK5CYII=', 'base64') })
  await partyAPage.getByRole('button', { name: 'Submit for mediator review' }).click()
  await expect(partyAPage.getByRole('status')).toContainText('Waiting for the mediator')
  expect(await partyAPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy()
  await partyAPage.screenshot({ path: '.playwright-mcp/identity-mobile.png', fullPage: true })
  await approveIdentity('Party A')
  await partyAPage.getByRole('button', { name: 'Refresh identity status / continue' }).click()
  await expect(partyAPage.getByRole('heading', { name: /Approved draft.*Party A/i })).toBeVisible()
  await partyAPage.getByLabel('Optional signature image').setInputFiles({ name: 'fictional-signature.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0uoAAAAASUVORK5CYII=', 'base64') })
  await expect(partyAPage.getByRole('status').filter({ hasText: 'Signature image uploaded privately' })).toBeVisible()
  await partyAPage.getByRole('checkbox', { name: /I have read this exact draft/ }).check()
  await partyAPage.getByRole('button', { name: 'Sign and sync' }).click()
  await expect(partyAPage.getByRole('status').filter({ hasText: 'Your signature was synced and verified' })).toBeVisible()

  await partyBPage.goto('/mediation/sign')
  await partyBPage.getByLabel('Private signing code').fill(partyBCode)
  await partyBPage.getByLabel('Local passphrase for encrypted offline copy').fill('FictionalPartyBSecret!')
  await partyBPage.getByRole('button', { name: 'Open approved draft' }).click()
  await partyBPage.getByLabel('Verification method').selectOption('ASSISTED')
  await partyBPage.getByRole('checkbox', { name: /I consent to this private identity/ }).check()
  await partyBPage.getByRole('button', { name: 'Start identity check' }).click()
  await expect(partyBPage.getByText(/Bring your original identity document/)).toBeVisible()
  await approveIdentity('Party B')
  await partyBPage.getByRole('button', { name: 'Refresh identity status / continue' }).click()
  await expect(partyBPage.getByRole('heading', { name: /Approved draft.*Party B/i })).toBeVisible()
  const signatureRequests = []
  page.on('request', (outgoing) => {
    if (outgoing.url().endsWith('/signatures') && outgoing.method() === 'POST') signatureRequests.push(JSON.parse(outgoing.postData()))
  })
  await partyBContext.setOffline(true)
  await partyBPage.getByRole('checkbox', { name: /I have read this exact draft/ }).check()
  await partyBPage.getByRole('button', { name: 'Sign offline' }).click()
  await expect(partyBPage.getByRole('status').filter({ hasText: 'Encrypted signatures awaiting sync: 1' })).toBeVisible()
  const packets = await partyBPage.evaluate(() => new Promise((resolve, reject) => {
    const opened = indexedDB.open('dlas-offline-v1', 2)
    opened.onerror = () => reject(opened.error)
    opened.onsuccess = () => {
      const db = opened.result
      const request = db.transaction('signature-queue').objectStore('signature-queue').getAll()
      request.onsuccess = () => { resolve(request.result); db.close() }
      request.onerror = () => reject(request.error)
    }
  }))
  expect(packets).toHaveLength(1)
  expect(JSON.stringify(packets[0])).not.toContain('Fictional parties agreed')
  expect(packets[0]).not.toHaveProperty('privateKey')

  await partyBContext.setOffline(false)
  await expect(partyBPage.getByRole('status').filter({ hasText: 'Your signature was synced and verified' })).toBeVisible()
  await page.getByRole('button', { name: 'Refresh party signatures' }).click()
  await page.getByLabel(/Passphrase for DLAO\/Mediator Signature/).fill('FictionalSignSecret!')
  await page.getByRole('button', { name: 'Create mediator signature and sync' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'MEDIATOR signature was synced and verified' })).toBeVisible()
  await expect(page.getByRole('definition').filter({ hasText: 'PENDING CLAO CERTIFICATION' })).toBeVisible()
  expect(signatureRequests).toHaveLength(1)
  expect(partyRequests).toHaveLength(2)
  for (const signed of [...signatureRequests, ...partyRequests]) {
    expect(Object.keys(signed).sort()).toEqual([...['clientMutationId', 'clientSignedAt', 'documentHash', 'draftVersion', 'publicKeyJwk', 'signature', 'signerRole'], ...(signed.code ? ['code', 'partyConfirmed'] : [])].sort())
    expect(signed.publicKeyJwk).not.toHaveProperty('d')
  }
  await partyAContext.close()
  await partyBContext.close()

  const state = await (await request.get(mediationPath, { headers: mediator })).json()
  expect(state.mediation.stage).toBe('PENDING_CLAO_CERTIFICATION')
  expect(state.mediation.legalEffectState).toBe('LEGAL_EFFECT_REQUIRES_AUTHORISED_REVIEW')
  const serverVerification = await request.post(`${mediationPath}/verify`, { headers: mediator, data: {} })
  expect((await serverVerification.json()).allValid).toBeTruthy()

  await page.getByRole('link', { name: 'Open independent signature verifier' }).first().click()
  await page.getByRole('button', { name: 'Verify this document on this device' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'All three signatures match this document version.' })).toBeVisible()
  await page.getByRole('button', { name: 'Test a changed copy' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Verification failed or fewer than three signatures are present.' })).toBeVisible()
  expect((await (await request.post(`${mediationPath}/verify`, { headers: mediator, data: {} })).json()).allValid).toBeTruthy()

  // The CLAO sees the DLAO dashboard read-only, then reviews and signs the certification.
  await signIn(page, 'CLAO')
  await expect(page.getByRole('note').filter({ hasText: 'View only.' })).toBeVisible()
  for (const tab of ['Daily Queue & Cases', 'Hearing List', 'Mediation Cases', 'Lawyer Feedback & Reports', 'DLAO Calendar']) await expect(page.getByRole('button', { name: new RegExp(tab) })).toBeVisible()
  await expect(page.getByText('New application')).toHaveCount(0)
  await page.getByRole('button', { name: /^Certification/ }).click()
  await page.getByRole('link', { name: new RegExp(state.mediation.caseId) }).click()
  await expect(page.getByRole('heading', { name: 'Case record' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Start mediation' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Check signatures now' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'All three signatures match this settlement.' })).toBeVisible()
  await page.getByLabel('Verified legal basis').fill('Fictional authorised legal review with the Gazette, date and area reference recorded for this test.')
  await page.getByRole('button', { name: 'Record verified applicability' }).click()
  await page.getByLabel('Certification reason').fill('The CLAO reviewed the fictional signed settlement and certifies it.')
  const signButton = page.getByRole('button', { name: /Approve \/ Certify/ })
  await expect(signButton).toBeDisabled()
  await page.getByLabel('I read this settlement and I sign this certification myself.').check()
  await signButton.click()
  await expect(page.getByRole('status').filter({ hasText: 'Your signature was verified and the CLAO certification is recorded.' })).toBeVisible()
  await expect(page.getByRole('listitem').filter({ hasText: /^CLAO:/ })).toBeVisible()
  const certified = (await (await request.get(mediationPath, { headers: mediator })).json()).mediation
  expect(certified.stage).toBe('CERTIFIED_FINAL')
  expect(certified.signatures.map(({ signerRole }) => signerRole).sort()).toEqual(['CLAO', 'MEDIATOR', 'PARTY_A', 'PARTY_B'])
})
