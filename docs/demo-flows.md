# Six integrated jury flows

All examples are fictional. Start the API and client, then run `npm run seed --workspace server`. Demo usernames/passwords stay in the ignored `server/.demo-credentials.json`; do not paste or display that file in a recording. Each flow uses one Application and, only after human acceptance, its linked Case. The web voice page simulates the 16699 channel. This prototype does not place calls, send notices/SMS/email, move money, or connect to government systems.

For faster deadline demonstrations, start the API with `REFERRAL_SWEEP_MS=1000`; this only accelerates the demo timer. Use a fresh fictional Application if a flow's existing seeded state has already been changed.

## Flow 1 — Safe voice-intake simulation (A2 still pending)

1. Open `/voice`; note the simulation badge and select **কল করুন** (Call). The greeting announces that the call is recorded, and the recording indicator stays on until submission.
2. After the greeting, press **১** for a complaint (**২** is information/advice: the question, a safe number and time, then a helpline callback). Press **২** again: contacting as a representative.
3. For spoken questions, speak after the beep and press **#** (or choose **লিখে উত্তর দিন** to type). Give fictional Ripon as caller and brother, fictional Moyuri as the victim, and the district; press **২** for "NID not known" (the UDC advice plays and the call continues), then give the fictional account. Press **২** for no current safety risk (**১** plays the 999 advice, flags the complaint as an urgent safety alert, and the intake continues). Press **\*** at any point to hear a question again. The automated test covers this by keyboard only, not as a verified blind-user or screen-reader journey.
4. Choose a safe contact route on the keypad (phone, UDC, or a trusted person); for a phone route, dial the fictional number and press **#**. Do not promote the representative's contact to the applicant.
5. At read-back, correct a field, then press **১** to submit. The call reads out the Application ID and the 6-digit status PIN; there is no Case ID yet.
6. Sign in as the DLAO officer, search the exact Application ID, and inspect representation, pending applicant confirmation, incomplete identity, facts/provenance, and the review task.
7. Select **Simulate call: unknown person answers**. Confirm that the neutral script reveals no identity, application ID, complaint, or legal-aid detail; inspect the failed contact entry and safer follow-up task.

Failure/recovery: if voice understanding is off/unavailable, continue the same draft with keyboard controls; **কল শেষ করুন** (End call) discards an unsubmitted call. All 38 recorded prompts are present. Do not present this as Ripon's completed blind-user call flow until a blind user validates a meaningful task without a sighted helper. Applicant confirmation/correction has API support but no UI yet, and applicant withdrawal is not implemented; keep Moyuri's status pending and do not demonstrate these as complete.

Automated evidence: `tests/e2e/step4.spec.js`, `tests/e2e/step5.spec.js`; API provenance and call-recording checks in `server/src/step2.test.js`. On the officer record page, **Call recording** plays the stored call.

## Flow 2 — Assisted, low-bandwidth and offline intake

1. Sign in as the UDC operator and open **Assisted intake and offline drafts**.
2. Read the free-service notice, enter a local passphrase, and select **Load fictional Nuching example**.
3. Check applicant/helper/translator/typist roles, Marma original versus Bangla translation, confirmation states, consent, document checklist, and safe contact. The helper's phone must not become applicant contact.
4. In browser network controls, go offline. Change the fictional original statement and select **Queue encrypted application**. Retry/queue the sample drafts with the same temporary and mutation IDs.
5. Reconnect. Confirm each queued Application syncs once and the encrypted local queue clears. A repeated retry must not create another Application.
6. Queue an offline correction, let an officer make a newer server change, then reconnect. Compare server/local versions, enter a human reason, and choose which version becomes a new revision.
7. As the DLAO officer, search the Application ID. Inspect provenance and upload the six fictional text samples. Generate the provisional document briefing; inspect cited lines, missing checklist items, and the unreadable deed. Approve accuracy only after human review.
8. Toggle **Light mode** and verify the static shell remains usable offline. Sign out and confirm local drafts are cleared.

Automated evidence: `tests/e2e/step7.spec.js`; API idempotency/conflict checks in `server/src/step2.test.js`. The UI supports fictional `.txt` files only, not scanned PDFs/OCR.

## Flow 3 — DLAO daily operations

1. Sign in as the DLAO officer. Inspect the shared queue, flag reasons, age/status, owner, and next action.
2. Open the seeded fictional triage-disagreement Application. Run triage; compare component recommendations/evidence and record a reasoned human disposition. The AI/rules review does not set priority or route.
3. Open the seeded **Fictional factory fire — separate claims** group. Compare its separate Case records and open the shared evidence reference; confirm no copy or merge was created.
4. Search a seeded similar-but-different duplicate pair. Inspect the matching/differing attributes, record a reason, and mark the people different. Confirm both Applications remain separate.
5. Open case-support reconstruction and check the event sequence and audit integrity status.

Failure/recovery: conflicting triage signals remain visible for human resolution; duplicate suggestions never auto-merge or auto-reject. Automated evidence: `tests/e2e/step6.spec.js`, `tests/e2e/step10.spec.js`, `tests/e2e/step11.spec.js`; corresponding API checks in `server/src/step2.test.js`, `server/src/step10.test.js`, and `server/src/step11.test.js`.

## Flow 4 — Mediation and settlement

1. Sign in as the mediator and open one of the seeded maintenance, property, or labour mediation Applications.
2. Claim it if unassigned. Record an in-person, remote, or hybrid time, an in-person fallback where needed, and the human-recorded notice outcomes. The application does not send notices.
3. Advance through document review, attendance, mediation, and a human-recorded outcome.
4. Choose the matching structured settlement template. If using AI assistance, first attest that identifiers were removed; review every suggested field and inconsistency. If the provider is disabled, use the deterministic draft.
5. Edit as needed and record mediator review plus each party's separate understanding/consent. A refusal keeps the draft in human review.
6. Enter the local signing passphrase. Create Party A's signature online, Party B's signature offline, reconnect and sync, then create the mediator signature.
7. Open the independent verifier, check the unchanged copy, then test a changed copy. Confirm the changed copy fails while server verification of the original remains valid.
8. Stop at **legal effect requires authorised review** unless an authorised CLAO has verified commencement/area applicability and separately recorded certification. Do not call a signature or certificate a court decree.

Automated evidence: `tests/e2e/step12.spec.js` and `server/src/step12.test.js`. Legal applicability is manually attested, not independently verified; cryptographic signatures do not prove identity, capacity, informed consent, or enforceability.

## Flow 5 — Urgent referral and receiving office

1. Sign in as the DLAO officer and open the seeded fictional Nabila Application. Review urgency reasons and record the human priority decision.
2. Inspect restricted-evidence metadata. Office role alone must not expose the restricted item. Create a referral with relevant history, expected action, deadline, and a named receiving DLAO; share restricted evidence only with a recorded necessity reason.
3. Sign in as the receiving DLAO. Read the package and safe-contact rules. If not responsible or authorised, confirm the restricted item is not openable and the denial is audited.
4. Acknowledge and return with a reason. As the officer, review the return and decide the next route; after the second return, stop and record an authorised human routing decision.
5. Send a routed referral with a short demo deadline and leave it unacknowledged. Wait for the overdue follow-up task and audit event; do not treat the timer as deciding jurisdiction.

Automated evidence: `tests/e2e/step8.spec.js`; API denial/grant audit and escalation checks in `server/src/step2.test.js`.

## Flow 6 — Long-running case and lawyer accountability

1. Sign in as the DLAO officer and open the seeded fictional Malek Application. Confirm the hearing date, applicant-safe next action, and failed-contact history.
2. Offer the Case to a panel lawyer. As the lawyer, accept and inspect the assignment and required update schedule.
3. For a time-compressed test/demo, schedule two required updates a few seconds apart and let the local timer mark both missed. Inspect the overdue alert and temporary new-assignment hold.
4. Sign in as the DLAO officer. Review the hold and record a human continue/lift decision. Confirm there is no misconduct finding, automatic reassignment, or payment recovery.
5. As a helpline agent, enter the caller-provided ID/code, complete the human-verification attestation, select an allowed safe channel, and read only generic status/next action. Record a lawyer-change request only if the applicant asks.
6. To show the direct citizen route, submit a separate fictional Malek application from a citizen account. Have the DLAO accept it, offer an assignment, and wait for the lawyer to accept. As that citizen, use **Request Change**; the DLAO reviews it, then separately offers a replacement. The old lawyer remains assigned until the replacement accepts.
7. Record status-only payment events for two work stages, including any work by the prior lawyer after reassignment. Inspect each stage's current status and the full event history. The inactivity alert and payment review remain separate from the citizen's change request and do not establish misconduct or recovery.

Automated evidence: `tests/e2e/step9.spec.js` and `server/src/step9.test.js`. The update timer runs in one API process; no real notification, contact, payment, panel removal, or misconduct determination occurs.

## Required bad-day test map

| Scenario | Automated evidence |
| --- | --- |
| Unknown person answers Moyuri's safe-contact route | `tests/e2e/step4.spec.js` |
| Ripon completes intake by keyboard without a sighted helper | `tests/e2e/step4.spec.js` |
| Nabila referral is not acknowledged | `tests/e2e/step8.spec.js` |
| Nuching loses network during submission and syncs once | `tests/e2e/step7.spec.js` |
| Malek's lawyer misses two required updates | `tests/e2e/step9.spec.js` |
| Similar-but-different duplicate stays separate | `tests/e2e/step10.spec.js` |
| Triage components disagree | `tests/e2e/step11.spec.js` |
| Unreadable document is not guessed | `tests/e2e/step7.spec.js` |
| Offline edit conflict needs human resolution | `tests/e2e/step7.spec.js` |
| Changed signed settlement fails verification | `tests/e2e/step12.spec.js` |
| Voice-AI unavailable; keyboard fallback preserves draft | `tests/e2e/step5.spec.js` |
| Wrong role cannot open restricted evidence; denial is logged | `tests/e2e/step8.spec.js`, `server/src/step2.test.js` |
