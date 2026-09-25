# Legal and policy verification queue

No unresolved point below is treated as an implemented rule. The law team must confirm the relevant source, date, place, and authorised role before a consequential transition is enabled.

- Representative initiation, authority, scope, and applicant confirmation (Moyuri/Ripon).
- Minimum identity evidence at intake and later verification stages.
- Lawful basis and retention for live voice processing, audio, transcript, and structured facts. Since 2026-09-23 every simulated 16699 call is recorded after a spoken notice with no opt-out (user decision); the law team must confirm this basis before any real use.
- Safe wording and disclosure when an unverified person answers.
- Sensitive evidence roles, urgency criteria, and referral/jurisdiction authority.
- Assisted translation, consent, helper phone ownership, and correction/withdrawal.
- Remote mediation, approved settlement templates, signature formalities, section 21G/21g commencement by area/date, and CLAO certification.

- Temporary lawyer assignment hold, reassignment, payment reconciliation, and due process.
- Retention/deletion periods and urgent handoff deadlines.

T7 now has versioned fictional maintenance, property, and labour references for demonstration in `docs/settlement-templates.md`. Their wording is **not legally approved**. Human review and party attestations in the prototype do not approve the references for real cases; the law team must approve the actual wording and formalities before deployment.

Step 2 consent and applicant-correction endpoints record an officer's attestation; they do not verify legal identity or representative authority. Representation remains `PENDING`. No live voice/audio or outbound contact is enabled from these records until the relevant consent, identity, and safety rules are approved and implemented.

Step 8 runs these behind labelled placeholders, not verified rules: demo urgency rules (an urgent fact, an AI danger flag, or restricted evidence on file) only recommend urgency, and the officer's priority is final; only the uploading officer holds a restricted-evidence grant; referral access lasts while the referral is open and covers only its named responsible actor; the sender sets the acknowledgement deadline; the return threshold is fixed at two; and an owning-office DLAO officer records the routing decision. The law team must confirm each of these, including who may view sensitive evidence and who holds routing authority (Project.md questions 10–12 and 19).
For the T2 demo, the receiving office's reasoned `RETURN` is the refusal of that transfer and counts toward the rejected/returned threshold. A later return requires a fresh human decision; a prior decision does not resolve it.

Step 9's two-missed-update threshold, DLAO reviewer route, temporary new-assignment hold, reassignment flow, and payment reconciliation are demo safeguards only. They do not establish misconduct, cancel active cases, recover money, or remove a panel lawyer. The authorised body and due-process requirements remain pending legal/administrative verification; the interface keeps the authority notice visible.

Step 10's fuzzy-name formula, attribute weights, and suggestion threshold are prototype heuristics only. Similarity scores are not probabilities, identity evidence, or grounds for rejection; a trained human must review each suggestion and records stay separate.

Step 11's category is a structured staff-entered suggestion, not applicant-confirmed fact. Process flags, urgency suggestions, and the separate referral-history routing prompt are review prompts only; no triage component establishes legal eligibility, priority, jurisdiction, or a final outcome. An open routing escalation remains a request for an authorised human decision under approved policy, regardless of the urgency signal. The DLAO's reasoned triage assessment does not silently update the separate priority or routing state.

Step 12 keeps legal effect separate from electronic-signature verification. The official 2026 amendment says sections 21খ/21গ and the schedule take effect for a government-notified date and area; section 21গ describes a party- and mediator-signed agreement certified by the CLAO. The prototype does not determine Gazette commencement, territorial applicability, identity, capacity, consent, or enforceability. Its default is `LEGAL_EFFECT_REQUIRES_AUTHORISED_REVIEW`; an authorised CLAO must record the basis and separately certify, while the UI still avoids claiming a court decree. This manual record is an attestation, not independent legal verification. Source: [Legal Aid Services (Amendment) Act, 2026, official Bangladesh Laws](https://bdlaws.minlaw.gov.bd/act-print-1674.html).

These questions come from `Project.md` section 19. Until verified, later workflows must show pending human/legal review rather than invent a legal conclusion.
