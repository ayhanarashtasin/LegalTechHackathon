# T7 fictional settlement references

The server catalog in `server/src/services/settlementTemplates.js` is the source of truth for the three `demo-1` references below. Each reference limits the fields the AI may fill. The prompt receives only the selected reference and anonymised mediator notes. The signed draft contains the completed fields and the template revision; the reference example is displayed separately.

| Reference | Allowed draft fields | Fictional example |
| --- | --- | --- |
| Maintenance | Arrangement; amount and interval; first due date; payment method; review date | Party A and Party B record the maintenance arrangement, the amount and interval, the first due date, the payment method, and a review date. |
| Property | Property description; proposed steps; responsible party for each step; completion date; follow-up date | Party A and Party B record the property in dispute, each proposed step, who will perform it, its completion date, and the follow-up date. |
| Labour | Work or wage issue; amount if recorded; payment schedule if recorded; due date; follow-up date | Party A and Party B record the work or wage issue, any amount agreed, the payment schedule, the due date, and the follow-up date. |

The examples are controlled **fictional demonstration references**, not approved legal clauses. Their wording, scope, language, required terms, and applicable formalities remain for the law team to approve before real use. The UI and draft API expose `LEGAL_APPROVAL_PENDING`; this status is not silently promoted by a mediator's review.

## Draft and review rules

1. A mediator must first record `AGREEMENT_REACHED` on the existing Case, choose one of the three references, and attest that direct identifiers were removed from the notes.
2. AI output is restricted to the reference's five named fields plus up to five proposed inconsistency warnings. Missing facts are written as missing, and those fields are not labelled AI-filled. If AI is unavailable, all fields require mediator completion.
3. The server independently warns when the review/follow-up date precedes the corresponding first due/completion/due date. It also flags missing facts. Date and missing-fact warnings are recomputed after an amendment; AI suggestions remain visible for human review, even if they refer to an earlier version.
4. The mediator sees the fictional reference, the generated sections, AI-filled labels, and all warnings. Changes are saved as a new draft version. If warnings remain, the mediator must explicitly acknowledge reviewing them with the parties before approving the draft.
5. Party A and Party B each have separate understanding and consent attestations. Only a mediator-approved draft proceeds to signatures. The resulting signatures do not by themselves establish legal effect; the separate legal applicability and CLAO certification workflow remains required where applicable.

The integration check in `server/src/step12.test.js` covers a maintenance draft with an AI warning, property and labour drafts with server-detected date warnings, a corrected property amendment, missing labour information, warning acknowledgement, party consent, and signature/certification gates. The reference catalog and deterministic warnings have a focused check in `server/src/services/settlementTemplates.test.js`.
