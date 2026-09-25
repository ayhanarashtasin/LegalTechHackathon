# GOAL.md - Step-by-Step Implementation Contract for the Integrated DLAS Prototype

**Project:** Integrated Digital Legal Aid System (DLAS) - ADLASB Grand Finale, "Five Doors, One Record"  
**Primary source of truth:** `Project.md`  
**Purpose of this file:** Tell Codex, Claude Code, Gemini CLI, or another coding agent exactly **how to implement the already-defined project from scratch, one controlled step at a time, without hallucinating requirements or jumping ahead.**  
**Implementation style:** Incremental, testable, demo-first, privacy-aware, accessibility-aware, human-controlled.  
**Current implementation baseline:** MERN stack only - MongoDB + Express.js + React.js + Node.js - using plain JavaScript/JSX (no TypeScript) and a clear MVC architecture. PWA/offline capabilities and AI integrations are added only in the later approved steps.

---

# 0. ABSOLUTE OPERATING RULES FOR ANY CODING AI

These rules override convenience and speed.

1. **Before doing any work, read `Project.md` completely. Then read this `Goal.md` completely.**
2. `Project.md` defines **WHAT the system is and what is legally/service-wise mandatory**.
3. `Goal.md` defines **HOW to implement it and in what order**.
4. Never invent a project requirement that is absent from `Project.md` or this file.
5. Never silently remove, weaken, or replace a requirement because it is difficult to implement.
6. Never treat the 23 mandatory requirements as optional.
7. Build **one integrated system**, not separate apps for each persona or technical challenge.
8. All channels and provider roles must update/reference the same authoritative Application/Case record.
9. Do not create a Case ID before the application is accepted by an authorised human workflow.
10. Do not let AI make final eligibility, rejection, legal priority, jurisdiction, consequential referral, lawyer reassignment, mediation outcome, CLAO certification, or case-closure decisions.
11. Never expose hidden chain-of-thought. Store/display only concise reasons, evidence references, uncertainty, recommendation, and human-review state.
12. Never use real beneficiary records, NID numbers, real intimate evidence, live payments, or claim live 16699 connectivity.
13. The website-based 16699 experience is a **clearly labelled simulation of the telecom layer**. The internal workflow must be real.
14. Never claim "tamper-proof". Use "integrity-verifiable", "integrity check", or "tamper-evident under stated assumptions".
15. Never auto-reject, auto-merge, or call a citizen fraudulent because of duplicate detection.
16. Never convert representative-reported or AI-inferred information into applicant-confirmed information without an explicit confirmation action.
17. Do not overwrite provenance/history when a citizen corrects a fact.
18. Do not expose secrets in source code, commits, screenshots, logs, client bundles, or chat output.
19. Never ask the user to paste an API key, password, private key, or database password into chat. Ask the user to place it in the specified local environment file and reply only **"done"**.
20. Do not read back or print secret values. Check only whether the environment variable exists.
21. Do not start the next implementation step without the user's explicit approval.
22. Do not say a step is complete unless its exit checks actually pass.
23. If a requirement is legally or administratively unresolved in `Project.md`, implement it behind an explicit **human review / pending legal verification** state instead of guessing.
24. If an implementation choice conflicts with `Project.md`, stop and report the conflict.
25. Do not edit `Project.md` unless the user explicitly asks to change the project truth.
26. Do not silently rewrite this `Goal.md`. If implementation reality requires a change, explain the proposed change and obtain approval first.
27. Use sample/demo data only. All demo records must be clearly fictional.
28. External integrations that are unavailable must have a clearly labelled simulator, but state changes, tasks, audit logs, permissions, and record linkage must genuinely work.

---

# 1. THE REQUIRED STEP-BY-STEP AGENT LOOP

The coding agent must operate using this exact loop for **every step**.

## 1.1 At the start of a step

1. State: `Starting Step N - <name>`.
2. Re-read the relevant sections of `Project.md` and `Goal.md`.
3. Inspect the current repository and existing implementation.
4. Do not destroy working code to make the current step easier.
5. State whether the step requires any external credential.
6. If no external credential is required, start implementation immediately.
7. If a credential is required and missing, **STOP before the credential-dependent work**, tell the user exactly which environment variable is required, where to put it, and why.
8. Never request a secret earlier than the first step that genuinely needs it.

## 1.2 During a step

1. Implement only the current step plus tiny prerequisite fixes necessary for that step.
2. Keep architecture compatible with all later requirements.
3. Add tests while implementing, not at the end of the whole project.
4. Use explicit validated schemas/data shapes for state transitions and AI outputs. Use plain JavaScript/JSX only; do not introduce TypeScript.
5. Add audit events for consequential actions introduced in that step.
6. Add accessible labels and keyboard behavior for new UI.
7. Add failure states, not only happy paths.
8. Never fake a passing test.
9. Never mark a requirement as implemented merely because a UI placeholder exists.

## 1.3 At the end of a step

Run the applicable checks, preferably through one project command such as:

```bash
npm run lint
npm test
npm run build
```

Run targeted E2E tests when the step has user-facing workflow changes.

Then report:

```text
STEP N COMPLETE

Implemented:
- ...

Tests/checks:
- ... PASS/FAIL

Files/modules changed:
- ...

Project requirements covered:
- A?/B?/T?/G?

Known limitations still intentionally pending:
- ...

Credential needed for NEXT step:
- None
OR
- OPENAI_API_KEY (do not paste it here; put it in ...)

Proceed to Step N+1?
```

**STOP after asking. Do not continue until the user explicitly says to proceed.**

---

# 2. CREDENTIAL GATE - VERY IMPORTANT

> **Spoken status decision (user instruction, 2026-09-25):** For the nonvisual Application/Case status route (A5 Malek), the reply is spoken by **BanglaTTS 0.0.3** (a wrapper around Silero `v3_indic`) running as a local Python service beside the Node API. The user heard sample output and approved the voice. This narrows the 2026-09-23 "no text-to-speech" rule: it is the only synthesized speech in the product, and the 16699 intake prompts stay human recordings. It is also the only exception to the JavaScript-only stack, limited to that service. The reply is built from the verified record by fixed templates, never by a language model; it speaks only the permitted status, stage, hearing date, and applicant-facing next step (never a name, the legal matter, the lawyer, or the office), and the lookup still requires the Application/Case ID and its lookup code. Numbers and dates are spoken as Bangla words. The Silero model is licensed CC BY-NC-SA 4.0, so this is for the demo only; a production deployment needs a licensed or different voice. If the service is off, the same sentence is shown as text.
>
> **Approach decision (user instruction, 2026-09-23):** Google denied API access to this account for every project tried, so the live speech-to-speech design is replaced by an **IVR-style pipeline on Groq's free tier**: pre-recorded human Bangla prompts play the approved questions, the caller answers by voice or keypad, **Whisper Large v3** transcribes the answer, and **GPT-OSS 120B** extracts structured answers through the same validated tool boundary. There is no text-to-speech: prompts are recorded by people, and the read-back replays the caller's own recording. This is turn-by-turn, not real-time barge-in. `GEMINI_*` is replaced by `GROQ_API_KEY`, `GROQ_STT_MODEL`, `GROQ_TEXT_MODEL`. Every other rule stands: key server-side only, strict schema validation, server validation before any write, safe fallback, human authority.
>
> **Superseded provider decision (2026-09-22):** the live AI provider is **Google Gemini (Gemini Developer API)**, not OpenAI. The user supplied `GEMINI_API_KEY` for Step 5 and chose `gemini-3.8-live` for voice (verified available to the key). Wherever this file says OpenAI, `OPENAI_API_KEY`, GPT, or OpenAI Realtime, read: the approved provider, `GEMINI_API_KEY`, Gemini, and the Gemini Live API. Every other rule is unchanged: key server-side only, short-lived browser credentials, model names in environment configuration, strict tool validation, safe fallback, and human authority.

## 2.1 Step 1 does NOT need a GPT/OpenAI API key

Do not ask for an OpenAI API key in Step 1.

Steps that build repository structure, database models, local authentication, shared record logic, audit, standard UI, offline framework, deterministic rules, cryptographic demo utilities, and normal tests can be developed without a GPT key.

## 2.2 When OpenAI credentials are first required

The first mandatory credential gate is **Step 5 - Live OpenAI AI/Voice Integration**.

Before Step 5, the system must already work in deterministic/mock mode so that the project is not blocked by an external API.

At Step 5, check only whether `OPENAI_API_KEY` exists in the server environment.

If it does not exist, say approximately:

```text
Step 5 needs an OpenAI API key for the live GPT/voice integration.
Do not paste the key into chat.

Please add it to:
server/.env

OPENAI_API_KEY=your_key_here

Then reply: done
```

The agent must also ensure:

```text
server/.env
.env
.env.local
```

are excluded from Git.

## 2.3 What "full access to GPT" means for this project

A ChatGPT subscription and OpenAI API usage are separate products/billing systems. Having ChatGPT access does **not** by itself supply an API key or API credits.

For live GPT features in this prototype, the user needs an OpenAI API Platform account with:
- an API key;
- API billing/credits as required by the account;
- access to the selected model(s) subject to the account's availability/rate limits.

No GPT/API credential is needed for Steps 1-4.

## 2.4 OpenAI model selection at Step 5

Do **not** hard-code a model name in advance. Model availability can change and API access may differ by account.

Immediately before Step 5:
1. check the current official OpenAI API documentation;
2. identify the appropriate current text/reasoning model for structured legal-aid assistance;
3. identify the appropriate current Realtime/voice model for the web-based 16699 prototype;
4. tell the user the proposed model names and why;
5. ask for approval if there is a meaningful cost/capability tradeoff;
6. store the chosen names only in environment configuration, for example:

```env
OPENAI_TEXT_MODEL=<approved-current-model>
OPENAI_REALTIME_MODEL=<approved-current-realtime-model>
```

Never silently downgrade or switch providers/models.

## 2.5 Browser security for voice

Never place the permanent OpenAI API key in React/browser code.

Use the current official secure browser/realtime pattern at implementation time, such as a short-lived/ephemeral client credential if supported, or a server-mediated connection.

The permanent API key must remain server-side.

## 2.6 Other credentials

Do not request credentials until needed.

| Credential | Earliest possible step | Mandatory? | Rule |
|---|---:|---|---|
| OpenAI API key | Step 5 | Yes for live AI; no for mock mode | Server-side only |
| MongoDB Atlas URI | Step 15 deployment | No during local development | Use local MongoDB/Docker first |
| Hosting credentials | Step 15 | Only for actual deployment | Ask only when deploying |
| Object-storage credential | Only if later approved | Not required by default | Do not add a vendor without need |
| SMS/USSD/telecom credential | Not required | No | These routes may remain clearly labelled simulations |
| Real 16699 credential/API | Not required | No | Never claim access we do not have |

---

# 3. IMPLEMENTATION BASELINE

> **LOCKED TECHNOLOGY DECISION:** This project uses the MERN stack only: **MongoDB + Express.js + React.js + Node.js**. All application code must be **plain JavaScript/JSX**. **TypeScript is prohibited.** The backend must follow the **MVC architecture** described below. Do not change this stack unless the user explicitly changes `Goal.md`.

Use this stack unless the user explicitly changes it.

## 3.1 Repository

Use a straightforward MERN repository in plain JavaScript. Do not create TypeScript files, `tsconfig` files, TypeScript build steps, or TypeScript-only packages. Use npm unless the existing repository already has a working npm-compatible setup that should be preserved.

Required architecture: **MVC**. React is the user-facing View layer. The Express backend must use explicit Models, Controllers, Routes, Middleware, Services, Validators, and Utilities. Business/legal workflow rules belong in reusable services, not directly in routes. Controllers should coordinate HTTP requests/responses and call services.

Target structure:

```text
/
├── Project.md
├── Goal.md
├── IMPLEMENTATION_STATUS.md
├── README.md
├── package.json             # optional root scripts using npm/concurrently
├── docker-compose.yml
├── .gitignore
├── .env.example
│
├── client/                  # React + Vite + JavaScript
│   ├── package.json
│   └── src/
│       ├── components/
│       ├── pages/
│       ├── layouts/
│       ├── hooks/
│       ├── context/
│       ├── services/        # API client functions only
│       ├── utils/
│       ├── assets/
│       ├── App.jsx
│       └── main.jsx
│
├── server/                  # Node.js + Express.js + JavaScript
│   ├── package.json
│   ├── .env.example
│   └── src/
│       ├── config/
│       ├── models/          # Mongoose models
│       ├── controllers/     # HTTP request/response coordination
│       ├── routes/          # endpoint definitions
│       ├── middleware/      # auth, RBAC, validation, errors
│       ├── services/        # domain workflows, audit, AI, integrations
│       ├── validators/      # Joi/express-validator schemas
│       ├── utils/
│       ├── seeds/
│       ├── app.js
│       └── server.js
│
├── docs/
│   ├── architecture.md
│   ├── permissions.md
│   ├── threat-model.md
│   ├── demo-flows.md
│   └── legal-assumptions.md
│
└── tests/
    └── e2e/
```

Do not create separate applications for each persona. The MVC modules must still operate on the same authoritative Application/Case workflow.

## 3.2 Frontend

Baseline:
- React.js
- Vite
- plain JavaScript / JSX only
- React Router
- TanStack Query or an equivalent server-state library if useful
- accessible component primitives
- Tailwind CSS or a similarly lightweight styling approach
- PWA/service worker in later step
- IndexedDB in offline step

Important UI properties:
- Bangla-first capability where required
- keyboard accessible
- screen-reader labels
- no essential visual-only interaction
- responsive on older/small Android-style viewports
- light/low-bandwidth mode

## 3.3 Backend

Baseline:
- Node.js
- Express.js
- plain JavaScript only
- Mongoose with MongoDB
- Joi, express-validator, or an equivalent JavaScript runtime validation library
- MVC architecture
- `models/` contain Mongoose data models
- `controllers/` coordinate HTTP request/response work
- `routes/` define endpoints and middleware order
- `services/` contain reusable business/legal workflow logic, audit logic, AI orchestration, and external integrations
- `middleware/` contains authentication, RBAC, validation, rate limiting, and error handling
- `validators/` contains request/body/query validation schemas
- structured error responses
- append-oriented audit logging service
- server-side RBAC

## 3.4 Database

Use MongoDB locally first through Docker Compose or an existing local MongoDB installation.

No cloud database credential should be required during early development.

"One record" does **not** mean everything must be stored in one giant MongoDB document. It means one authoritative case/application graph and one source of truth. Related collections may exist, but every object must be linked to the authoritative `applicationId` and, after acceptance, `caseId` where applicable.

## 3.5 MVC contract

The backend must consistently follow this request flow:

```text
React View
   ↓ HTTP
Express Route
   ↓
Middleware / Validator
   ↓
Controller
   ↓
Domain Service
   ↓
Mongoose Model(s)
   ↓
Domain Service
   ↓
Controller
   ↓
JSON Response
   ↓
React View
```

Rules:
- **Model:** Mongoose schemas/models and model-level data invariants. Models must not contain Express request/response objects.
- **View:** React pages/components. Views must not contain server secrets or be trusted for authorization.
- **Controller:** Parse already-validated request data, call the correct service, and return an HTTP response. Keep controllers thin.
- **Route:** Map URL + method to middleware/validator/controller. Do not put business logic in route files.
- **Service:** Hold reusable legal-aid workflow logic, cross-model operations, audit creation, AI orchestration, external integrations, and transaction-like coordination.
- **Middleware:** Authentication, RBAC, validation hooks, rate limiting, upload controls, and centralized error handling.
- **Validator:** Validate all external input before it reaches domain logic.

For example, application submission should follow:

```text
POST /api/applications
→ validateApplicationInput
→ optionalAuth / channelContext
→ applicationController.submit
→ applicationService.submitApplication
→ Application / CaseFact / ConsentRecord / Task / AuditEvent models
→ response
```

Do not allow a controller or React component to bypass the domain service for consequential workflow changes merely because direct database access is easier.

## 3.6 Testing

Baseline tools may include:
- Vitest for React/unit tests
- Supertest for Express API tests
- React Testing Library for component behavior
- Playwright for end-to-end journeys
- axe accessibility checks where practical
- Lighthouse/manual throttling checks for PWA/light mode

Create root npm scripts eventually equivalent to:

```bash
npm run lint
npm test
npm run build
```

There is **no TypeScript typecheck step** anywhere in this project. JavaScript quality is checked through ESLint, tests, runtime validation, and builds.

---

# 4. CORE DOMAIN MODEL TO IMPLEMENT

These are conceptual entities. Exact Mongo schema organization may vary, but do not lose the concepts.

## 4.1 Identity / actors

- `User`
- `Person`
- `RoleAssignment`
- `Representation`
- `ConsentRecord`

Provider/system roles should support at least:

```text
DLAO_OFFICER
MEDIATOR
HELPLINE_AGENT
UDC_OPERATOR
PANEL_LAWYER
RECEIVING_DLAO
CASE_SUPPORT
CLAO                  # legal certification role; not an extra mandatory Part B scenario
SYSTEM
```

Citizen-side actor types may include:

```text
APPLICANT
REPRESENTATIVE
HELPER
TRANSLATOR
```

## 4.2 Core record

- `Application`
- `Case`
- `CaseFact` / provenance-bearing structured facts
- `SafeContactProfile`
- `Task`
- `AuditEvent`

## 4.3 Documents

- `Document`
- `DocumentVersion`
- `DocumentAccessRule`
- `DocumentAnalysis`

## 4.4 Service workflow

- `Referral`
- `Mediation`
- `MediationSession`
- `SettlementDraft`
- `SignatureRecord`
- `LawyerAssignment`
- `LawyerUpdate`
- `PaymentStatusRecord` for demo stage-based reconciliation

## 4.5 Cross-case / quality

- `RelatedIncidentGroup`
- `DuplicateCandidate`
- `DuplicateReview`
- `TriageAssessment`

## 4.6 Voice / channel

- `VoiceSession`
- `TranscriptSegment` only where retention is permitted
- `ContactAttempt`
- `ChannelInteraction`

## 4.7 Offline / integrity

- `SyncMutation`
- `SyncConflict`
- `IntegrityRecord`

---

# 5. NON-NEGOTIABLE STATE RULES

## 5.1 Application ID

Generate a stable unique Application ID only when the application is actually submitted.

Example format is allowed:

```text
APP-2026-000001
```

Use a concurrency-safe mechanism and a unique database index.

## 5.2 Case ID

Do not create a Case ID until an authorised human acceptance action occurs.

Example format:

```text
CASE-2026-000001
```

## 5.3 Provenance

Important facts must include source context. A useful shape is conceptually:

```js
{
  field: "complaint.summary",
  value: "...",
  sourceType: "REPRESENTATIVE_REPORTED",
  sourcePersonId: "...",
  captureMethod: "VOICE_AI",
  translatedByPersonId: null,
  aiInferred: false,
  callerConfirmed: true,
  applicantConfirmed: false,
  createdAt: "...",
  supersedesFactId: null
}
```

Never overwrite a provenance-bearing fact without preserving the previous fact/history.

## 5.4 Human decision record

Every consequential human decision should record:
- decision type
- authorised actor
- previous state
- new state
- reason
- timestamp
- evidence/reference where applicable

## 5.5 Audit

Audit is append-oriented. Do not silently edit old audit events.

Consider chaining audit event hashes for integrity demonstration, but label this only as **integrity-verifiable / tamper-evident under stated assumptions**.

---

# 6. SERVER-SIDE PERMISSION PRINCIPLE

Hiding a button in React is not access control.

Every sensitive API must enforce permissions on the server.

Examples:

### HELPLINE_AGENT
May:
- search an application/case by permitted identifier
- read permitted general status/next step
- create assisted intake
- add channel/contact records

Must not automatically:
- view Nabila's restricted sensitive evidence
- make final eligibility decision
- change final jurisdiction
- close cases

### UDC_OPERATOR
May:
- assist with intake
- upload permitted documents
- see checklist/progress needed for submission

Must not retain unrestricted post-submission access.

### PANEL_LAWYER
May:
- view assigned-case material allowed for that lawyer
- accept/decline assignment
- view hearing/deadlines
- submit required updates

Must not:
- browse unassigned cases
- certify mediation settlement

### CASE_SUPPORT
May:
- search structured records
- manage routine tasks/reports

Sensitive evidence remains separately restricted.

### DLAO_OFFICER / authorised authority
May perform human review actions according to project workflow, but the system must still respect legal-role boundaries and audit every consequential decision.

### CLAO
Use specifically for certification where legally applicable. Do not imply that every DLAO staff user is a CLAO.

Maintain a readable role-permission matrix in `docs/permissions.md`.

---

# 7. OPENAI INTEGRATION DESIGN - ONLY FROM STEP 5 ONWARD

## 7.1 Provider adapter

Never scatter OpenAI calls throughout the application.

Create a server-side provider layer such as:

```text
server/src/services/ai/
├── client.js
├── modelConfig.js
├── outputValidation.js
├── intake/
├── documents/
├── settlement/
├── triage/
└── safety/
```

All model names come from environment configuration.

## 7.2 AI output validation

Every AI response used by business logic must be validated against a strict schema.

If schema validation fails:
- do not guess
- do not partially apply unknown fields
- mark the AI result failed/uncertain
- allow retry or human review

## 7.3 AI must never directly mutate unrestricted database state

Use tool/function boundaries such as:

```text
recordIntakeFact()
setSafeContactProposal()
requestHumanReview()
createDocumentBriefing()
createTriageRecommendation()
createSettlementDraft()
```

The server validates role, schema, application/case scope, and allowed state transition before saving.

## 7.4 AI provenance

Generated/inferred content must always carry `AI_INFERRED` or equivalent metadata.

Do not store an AI summary as if it were the applicant's verbatim statement.

---

# 8. 16699 WEB VOICE ACCESS - REQUIRED DESIGN

The external telephone network is simulated. The internal voice intake must be functional after Step 5.

## 8.1 Public UI

Provide a clearly labelled action such as:

```text
Call 16699 - Voice Access Prototype
```

The screen must clearly state that this is the competition prototype/simulation and **not the live national telecom connection**.

## 8.2 Voice states

Use explicit states, for example:

```text
IDLE
REQUESTING_MIC
EXPLAINING_CONSENT
LISTENING
AI_SPEAKING
PROCESSING
READBACK
AWAITING_CONFIRMATION
HUMAN_HANDOFF
MINIMAL_DATA_FALLBACK
COMPLETED
FAILED_SAFE
```

## 8.3 Consent/data choices

Do not combine all voice data into one yes/no box.

The application must conceptually distinguish:

1. permission/lawful basis to use live voice processing;
2. permission/lawful basis to store raw audio;
3. permission/lawful basis to retain transcript;
4. retention of necessary structured intake facts.

Exact legal wording remains subject to law-team approval.

### If stored-audio permission is denied

Do not automatically deny the service.

If legally permitted:
- continue live voice interaction;
- do not persist raw audio;
- retain only permitted information;
- clearly record the consent choice.

### If the person refuses live voice processing or the voice route cannot safely continue

Switch to **Minimal-Data Intake / Human Callback**, not "anonymous" intake if identifying/contact data is collected.

Collect only what is necessary for follow-up, for example:
- safe callback number/contact
- safe time
- district
- urgent/not urgent request indicator

## 8.4 Controlled intake

The assistant must:
- speak simple Bangla
- ask one question at a time
- determine self vs representative
- capture representation status without assuming authority
- allow natural complaint narration
- ask only approved clarification questions
- capture safe contact
- detect uncertainty/sensitivity for human handoff
- read back a concise summary
- allow correction
- create the Application only after the final submission action

## 8.5 Moyuri/Ripon rule

When Ripon speaks:

```text
source = RIPON
sourceType = REPRESENTATIVE_REPORTED
callerConfirmed = true/false
moyuriConfirmed = false/pending
```

Never save Ripon's claim as `MOYURI_SAID`.

## 8.6 Unsafe contact failure

If an unknown/unsafe person answers a later simulated contact attempt:
- reveal no legal-aid relationship
- reveal no complaint category
- reveal no case/application details
- use only approved neutral wording
- record non-disclosure and failed-safe outcome
- create safer follow-up task where appropriate

---

# 9. STEP-BY-STEP IMPLEMENTATION PLAN

Do the steps in this order unless the user explicitly approves a change.

---

## STEP 1 - Repository Foundation and Local Development Baseline

### Objective
Create a clean, runnable project foundation. Do not implement AI yet.

### Credentials required
**NONE. Do not ask for an OpenAI key.**

### Implement

1. Inspect the repository. Preserve existing useful work if any.
2. Create/confirm the plain-JavaScript MERN folder structure from Section 3.
3. Create the `client/` React + Vite application in JavaScript/JSX. Select the JavaScript template, not the TypeScript template.
4. Create the `server/` Node.js + Express.js application in JavaScript.
5. Create the MVC backend folders: `models`, `controllers`, `routes`, `middleware`, `services`, `validators`, `utils`, `config`, and `seeds`.
6. Configure ESLint/formatting for JavaScript and React. Do not add TypeScript or `tsconfig`.
7. Add basic test runners.
8. Add Docker Compose for local MongoDB.
9. Add health endpoints:
    - API `/health`
    - client health/home screen
10. Add `.env.example` with **names only / safe placeholders**, never secrets.
11. Add secure `.gitignore` entries.
12. Create `IMPLEMENTATION_STATUS.md` with all A1-A5, B1-B7, T1-T11, G1-G10 initially marked not implemented.
13. Create the `docs/` files as structured placeholders based on `Project.md`, without inventing missing legal answers.
14. Add npm scripts so the project can install, run, test, lint, and build.
15. Add a root development command (for example using `concurrently`) only if useful; otherwise document running client and server separately.
16. Write README local-start instructions, including the MVC folder explanation.

### Minimum local commands
Aim for a workflow similar to:

```bash
npm install
cd client && npm install
cd ../server && npm install
cd ..
docker compose up -d
npm run dev
npm test
npm run build
```

### Exit checks
- web starts
- API starts
- API health returns success
- MongoDB connection works locally
- lint passes
- tests pass
- build passes
- no secret committed

### Stop gate
Report Step 1 completion and say explicitly:

```text
No GPT/OpenAI credential was needed for Step 1.
Proceed to Step 2?
```

STOP.

---

## STEP 2 - Core Data Model, Authentication, RBAC, IDs, and Audit

### Objective
Create the secure shared-record foundation that every later feature will use.

### Credentials required
**NONE** if local MongoDB is running.

### Implement

1. Core Mongoose schemas/entities from Section 4.
2. Concurrency-safe Application ID generator.
3. Concurrency-safe Case ID generator.
4. Case ID creation only through authorised acceptance service.
5. Demo authentication.
6. Server-side RBAC middleware.
7. Seed fictional provider accounts for the mandatory roles.
8. Consent records.
9. Representation records.
10. Provenance-bearing facts.
11. Safe Contact Profile.
12. Task model.
13. Contact attempt model.
14. Append-oriented Audit Event service.
15. Version/change history for important record updates.
16. Basic integrity-hash support for audit demonstration if practical.
17. API tests for forbidden-role access.
18. API tests proving Application ID and Case ID lifecycle rules.

### Critical tests
- helpline role cannot read restricted evidence
- panel lawyer cannot browse unassigned cases
- UDC operator loses/has bounded post-submission permissions
- Case ID cannot be generated by ordinary intake submission
- applicant correction preserves original provenance
- role denial occurs server-side even if a client manually calls the endpoint

### Exit checks
All tests pass; shared record foundation is usable by later steps.

### Stop gate
Report and ask: `Proceed to Step 3?`

STOP.

---

## STEP 3 - Shared Application/Case Workflow and Provider Shells

### Objective
Implement the ordinary non-AI case-management backbone before advanced features.

### Credentials required
**NONE.**

### Implement

1. Entry/application creation workflow.
2. Verification/review workflow.
3. Authorised application acceptance -> Case ID creation.
4. Case timeline/history.
5. Task/owner/next-action system.
6. Search by Application ID / Case ID.
7. Role-specific dashboard shells for:
   - DLAO Officer
   - Mediator
   - Helpline role
   - UDC Operator
   - Panel Lawyer
   - Receiving DLAO
   - Case Support
   - CLAO certification view where relevant later
8. Shared navigation to the **same** authoritative record.
9. Basic document metadata/version infrastructure.
10. Contact history.
11. Manual human override action + reason.
12. Seed a simple fictional application and case.

### Critical proof
A helpline-created application must become visible to the DLAO through the same `applicationId`, not through copied data.

### Exit checks
- workflow state transitions are validated
- audit timeline reflects changes
- roles see appropriate shell views
- no parallel duplicate record is created

### Stop gate
Ask: `Proceed to Step 4?`

STOP.

---

## STEP 4 - Moyuri + Ripon + 16699 Voice Prototype in Deterministic/Mock Mode

> Changed by user decision (2026-09-23; see `Project.md` Section 7.5): every call is recorded after a spoken greeting notice, with no consent questions (items 13, and the refusal test) and no caller-initiated human-callback button. Immediate danger still switches to the minimal-data human callback (item 12). The disclosure (item 2) is kept as a short on-screen badge.

> Changed again by user decision (2026-09-24; see `Project.md` Section 7.5): the call now opens with complaint vs information/advice, collects an optional NID, and a reported danger continues the full intake with an urgent safety alert and 999 advice instead of switching to the minimal-data callback (item 12 now applies only to the advice path, which is a helpline callback).

### Objective
Build the entire safe intake workflow before connecting a live GPT voice model.

### Credentials required
**NONE.**

### Implement

1. Public `Call 16699 - Voice Access Prototype` page.
2. Clear simulation disclosure.
3. Browser microphone-permission UI shell.
4. Deterministic scripted/mock conversational engine.
5. Self vs representative path.
6. Ripon -> Moyuri provenance flow.
7. Identity incomplete state.
8. Representation pending state.
9. Safe Contact Profile capture.
10. Read-back/confirmation UI.
11. Correction before submit.
12. Minimal-data/human-callback fallback.
13. Separate consent choices for live processing / stored audio / transcript where appropriate as a UI/data model; use placeholder wording clearly marked for law-team approval.
14. Application ID creation after submission.
15. DLAO review task creation.
16. Unsafe-person-answering simulation.
17. Neutral non-disclosure outcome.
18. Audit entries for all key actions.
19. Ripon nonvisual accessibility path using keyboard/screen-reader-friendly controls.

### Required E2E tests
- Ripon completes the intake without visual-only dependency.
- Ripon's facts remain representative-reported.
- Moyuri confirmation remains pending.
- Unsafe person -> no sensitive disclosure.
- Final submit -> one Application ID -> visible in DLAO queue.
- Stored-audio refusal does not automatically deny service.
- Voice-route refusal -> minimal-data/human callback state.

### Exit gate
The full workflow must be demonstrable **without GPT**.

### Stop gate
At the end report:

```text
Step 4 is complete in mock/deterministic mode.
Step 5 is the first step that needs OPENAI_API_KEY for live GPT/voice.
Proceed to Step 5?
```

STOP.

---

## STEP 5 - Live OpenAI GPT + Realtime Voice Integration

> Provider and approach changed by user decision (see Section 2): implemented as a Groq IVR-style pipeline (recorded Bangla prompts + Whisper transcription + structured extraction), not live speech-to-speech.

### Objective
Replace the deterministic AI portions of Step 4 with a controlled live OpenAI integration while preserving the exact same domain workflow and guardrails.

### Credentials required
**OPENAI_API_KEY**.

### Before implementation

1. Verify the current official OpenAI docs.
2. Check presence of `OPENAI_API_KEY` without printing it.
3. If missing, stop and ask the user to put it in `server/.env` and reply `done`.
4. Confirm API model access with a minimal server-side test.
5. Do not expose the permanent key to the browser.

### Implement

1. Server-side OpenAI client/adapter.
2. Environment-configured text and realtime model names.
3. Secure realtime session/bootstrap mechanism using current official guidance.
4. Real-time Bangla voice interaction.
5. Controlled system prompt based on `Project.md`.
6. Strict structured tool/function calls.
7. Server validation before any write.
8. Transcript retention only according to consent/state.
9. Optional raw-audio recording only when permitted; no raw-audio persistence if denied.
10. Read-back and correction before final submission.
11. Human handoff action.
12. Timeouts/retry/error state.
13. API usage errors must fall back safely to mock/manual/human route rather than lose the intake.
14. Audit whether an interaction was AI-assisted, without storing hidden reasoning.

### Voice assistant hard guardrails

The model must never:
- determine legal eligibility
- reject a caller
- claim a lawyer has committed misconduct
- make final jurisdiction decision
- invent missing NID/document values
- convert representative report into applicant-confirmed statement
- reveal sensitive information to an unverified caller

### Required tests
- tool arguments schema validation
- model failure -> safe fallback
- user interruption/correction
- representative provenance
- recording denied -> no audio object saved
- applicant confirmation remains separate
- prompt injection cannot grant a role or bypass server permissions

### Exit checks
Live voice works; mock mode still works when API is disabled.

### Stop gate
Ask: `Proceed to Step 6?`

STOP.

---

## STEP 6 - DLAO Daily Operations + Case Support + Helpline Status Lookup

### Objective
Make the shared record operational for provider staff.

### Credentials required
**NONE beyond already-configured local services.**

### Implement

1. DLAO daily queue:
   - new
   - incomplete
   - urgent recommendations
   - pending
   - overdue
   - referral waiting
   - lawyer-update overdue
2. Explain why each item is flagged.
3. Human override with reason.
4. Searchable history.
5. Ageing/reminder indicators.
6. Case-support search/reconstruction.
7. Routine reporting from existing structured data.
8. Helpline Application/Case lookup with permitted status/next step.
9. Contact log.
10. No duplicate helpline note system.

### Covers
B1, B3, B7 plus G1, G5, G7, G10.

### Required demo
Override one recommendation and show the audit event.

### Stop gate
Ask: `Proceed to Step 7?`

STOP.

---

## STEP 7 - Nuching + UDC + Offline-First + Low-Bandwidth PWA + Document Agent

### Objective
Implement assisted intake, translation provenance, weak-network survival, T9, T10, and T6.

### Credentials required
- No new credential for PWA/offline.
- Existing OpenAI key from Step 5 is used for live document analysis. If unavailable, preserve deterministic/mock analysis mode.

### Implement UDC/Nuching

1. Assisted-intake mode.
2. Free-service notice.
3. Applicant/helper/translator/typist identities separated.
4. Nuching's original statement vs translated/typed text separated.
5. Consent/confirmation state.
6. Do not silently make UDC operator phone the permanent applicant number.
7. Limited UDC post-submission access.
8. Case-type checklist.

### Implement T9 offline sync

1. IndexedDB local draft/mutation queue.
2. Temporary UUID for offline-created records.
3. `clientMutationId` / idempotency key.
4. Reconnect sync.
5. Server deduplication/idempotency.
6. Version numbers for conflict detection.
7. Conflict review UI showing both versions.
8. Integrity record/hash verification.
9. Audit of offline create/sync/conflict/resolve actions.

### Implement T10 PWA

1. Installable PWA.
2. App-shell/static caching.
3. Do **not** indiscriminately cache sensitive API responses.
4. Offline draft storage policy.
5. Local encryption where used for sensitive offline draft fields.
6. Purge synced drafts appropriately.
7. Shared-device/logout cleanup.
8. Normal mode.
9. Light/low-bandwidth mode.
10. Throttled-network measurements.

### Implement T6 document agent

1. Upload 5-6 fictional sample documents.
2. Maintain document/version metadata.
3. AI briefing with source references.
4. Case-type checklist comparison.
5. Deliberately missing item.
6. Deliberately unreadable/uncertain item.
7. Never guess unreadable content.
8. Officer verification/approval state.

### Acceptance test
- Create 3 records offline.
- Reconnect.
- Exactly one server record per mutation.
- Simulate one version conflict.
- Human resolves conflict.
- Run integrity verification.
- Network loss halfway through Nuching intake does not erase work.

### Stop gate
Ask: `Proceed to Step 8?`

STOP.

---

## STEP 8 - Nabila + Sensitive Evidence + Referral + Jurisdiction Ping-Pong

### Objective
Implement urgent/sensitive referral workflow and T2.

### Credentials required
**NONE new.**

### Implement

1. Nabila fictional case.
2. Urgency recommendation with concise reasons/evidence.
3. Human final priority.
4. Sensitive-evidence classification.
5. Restricted evidence permission separate from ordinary case permission.
6. Access log for sensitive evidence.
7. Do not use real intimate/abusive imagery; use harmless synthetic placeholder evidence.
8. Referral package containing:
   - reason
   - relevant history
   - permitted documents
   - sending office
   - receiving office
   - responsible actor
   - expected action
   - deadline
9. Receiving DLAO acknowledge / accept / return with reason.
10. Non-acknowledgement overdue escalation.
11. T2 repeated transfer/return counter.
12. After threshold, escalate to authorised human routing decision.
13. Do not let system make final legal jurisdiction decision.

### Acceptance tests
- receiving office cannot see restricted evidence unless authorised
- non-acknowledgement generates follow-up
- after two returned/rejected transfers, escalation appears
- human decision determines route

### Stop gate
Ask: `Proceed to Step 9?`

STOP.

---

## STEP 9 - Malek + Panel Lawyer Worklist + T1 Accountability Loop

### Objective
Implement long-running-case status and immediate citizen protection from repeated lawyer inactivity without automated misconduct findings.

### Credentials required
**NONE new.**

### Implement

1. Malek fictional seven-month case.
2. Accessible/nonvisual status route.
3. Hearing date and next step.
4. Failed contact attempts.
5. Panel lawyer assignment/worklist.
6. Accept/decline assignment.
7. Required update schedule.
8. Progress updates.
9. Overdue reminders.
10. Lawyer-change request.
11. DLAO human review and reassignment workflow.
12. Stage-based payment-status/reconciliation UI.
13. Repeated-inactivity pattern alert.

### Temporary assignment hold rule

After two consecutive mandatory update misses:
- create affected-case protection/review tasks;
- automatically set `newAssignmentHold = true` for future assignments;
- do not cancel existing cases;
- do not label misconduct;
- do not automatically recover payment;
- do not remove the lawyer from panel;
- route to configured authorised reviewer/body;
- clearly label legal/administrative authority as subject to verified policy where unresolved.

### Acceptance test
- lawyer misses two updates
- new assignment attempt is blocked by temporary hold
- existing case remains active
- human reviewer can lift/continue hold
- reassignment is separate human action
- pattern alert does not say "guilty" or "misconduct established"

### Stop gate
Ask: `Proceed to Step 10?`

STOP.

---

## STEP 10 - Related Incidents + Shared Evidence + Duplicate Review

### Objective
Implement T3 and T4 without merging people/cases incorrectly.

### Credentials required
**NONE.**

### Implement T3

1. Three separate fictional factory-fire claims.
2. Related Incident Group.
3. Common evidence stored once/reference-linked.
4. Group view.
5. Separate case instructions/outcomes/confidentiality.

### Implement T4

Use a deterministic fuzzy-match engine so the demo does not depend on AI availability.

Possible evidence dimensions:
- normalized name similarity
- phone similarity/exact match
- date of birth
- district/address components
- other approved demo attributes

Return:
- confidence/score
- matching attributes
- differing attributes
- human-review status

Same-office case-support staff may view a redacted candidate ranking to route a concern to an officer. Only DLAO officers may see field-level comparison values or record a review decision; the ranking is not calibrated confidence.

Use 10-15 fictional records including:
- genuine duplicate candidates
- at least two similar-but-different traps

### Guardrail
Never auto-merge, auto-reject, or label fraud.

### Stop gate
Ask: `Proceed to Step 11?`

STOP.

---

## STEP 11 - Multi-Agent Triage Pipeline (T8)

### Objective
Implement at least three specialised components and visibly surface disagreement.

### Credentials required
Use existing OpenAI configuration. No new key.

### Required components
At minimum:

1. **Case Categoriser**
   - proposes category
   - concise reasons/evidence refs

2. **Process / Compliance / Safety Checker**
   - missing information
   - process flags
   - safe-contact/sensitive handling flags

3. **Urgency / Routing Recommender**
   - proposes urgency and/or routing for human review
   - reasons/evidence refs

4. **Orchestrator** (recommended)
   - combines structured outputs
   - does not invent hidden reasoning
   - explicitly surfaces disagreement

### Output shape
Each component should expose fields like:

```text
recommendation
reasons[]
evidenceRefs[]
uncertainty
requiresHumanReview
```

Do not store chain-of-thought.

### Acceptance test
Run at least five fictional cases and force at least one meaningful disagreement between components. The DLAO officer must see the conflict and make the final decision.

### Stop gate
Ask: `Proceed to Step 12?`

STOP.

---

## STEP 12 - Mediation Workflow + Settlement Drafting + Offline E-Signature

### Objective
Implement B2, T7, T11, and the current legal-status safeguards.

### Credentials required
Use existing OpenAI configuration for drafting. No new key.

### Implement mediation

State progression:

```text
REGISTRATION
-> SCHEDULING_NOTICES
-> DOCUMENT_REVIEW
-> ATTENDANCE
-> MEDIATION
-> DRAFT_OUTCOME
-> SIGNATURES
-> PENDING_CLAO_CERTIFICATION (where applicable)
-> CERTIFIED_FINAL (where legally applicable)
```

Support:
- in-person
- remote
- hybrid
- clear in-person fallback

### T7 settlement drafting

1. Approved fictional templates/examples.
2. Maintenance scenario.
3. Property scenario.
4. Labour scenario.
5. AI fills only allowed draft sections.
6. AI-filled/inferred text visibly marked.
7. Inconsistency warning.
8. Human mediator review required.
9. Party understanding/consent state.

### Legal-state rule
Electronic signing alone does not create decree status.

Where section 21G/21g is legally applicable:
- parties sign;
- mediator signs;
- CLAO certifies;
- then the system may display the statutory final/enforceable/decree/final-order status consistent with verified law.

If applicability is not verified:
- use `LEGAL_EFFECT_REQUIRES_AUTHORISED_REVIEW`;
- do not automatically show "court decree".

Database registration is recordkeeping/audit, not independently claimed as the legal act that creates decree status.

### T11 cryptographic demo

Use browser/server cryptographic primitives suitable for a prototype, such as WebCrypto with a modern signature algorithm, to demonstrate:
- document canonicalization/hash
- asynchronous signatures
- one signer offline
- later sync
- public-key/signature verification
- changed document -> verification failure
- independent verification screen

Private signing material must not be logged or sent unnecessarily.

Clearly state:
`Cryptographic validity does not by itself prove legal identity, capacity, informed consent, or enforceability.`

### Acceptance tests
- two parties sign at different times
- one signs offline
- later sync succeeds
- unchanged document verifies
- changed document fails
- status does not jump to final before required human/legal certification

### Stop gate
Ask: `Proceed to Step 13?`

STOP.

---

## STEP 13 - Cross-Cutting Privacy, Safety, Accessibility, and Failure Hardening

### Objective
Make the Golden Thread enforceable across the whole application rather than only in individual demos.

### Credentials required
**NONE new.**

### Implement/review

1. G1 one-record continuity.
2. G2 provenance/representation display.
3. G3 safe-contact enforcement on every contact action.
4. G4 accessibility/nonvisual equivalents.
5. G5 human override/control.
6. G6 document completeness/version/uncertainty.
7. G7 owner/status/next action/deadline.
8. G8 retry/offline/conflict resilience.
9. G9 role-based privacy.
10. G10 end-to-end audit.
11. Keyboard navigation.
12. Screen-reader labels.
13. Focus management.
14. Error announcement.
15. Zoom/reflow checks.
16. Bangla text rendering.
17. Neutral notification wording.
18. No sensitive data in notification previews.
19. Rate limiting/basic abuse prevention.
20. Security headers.
21. Input/schema validation.
22. File-type/size validation.
23. Prompt-injection resistance through server authority boundaries.
24. Ensure AI cannot alter role/permission fields.
25. Ensure audit entries exist for all consequential state changes.

### Threat model document
Complete `docs/threat-model.md` with explicit assumptions for:
- shared devices
- stolen/unsafe phones
- malicious/untrusted caller
- UDC helper overreach
- weak/offline connectivity
- duplicate replay
- stale offline edits
- modified signed documents
- prompt injection
- leaked browser token

Do not claim perfect security.

### Stop gate
Ask: `Proceed to Step 14?`

STOP.

---

## STEP 14 - Full Demo Dataset + 23-Item Acceptance Matrix + Bad-Day Tests

### Objective
Prove every mandatory requirement is implemented, integrated, and testable.

### Credentials required
No new credential.

### Create/seed fictional data for

- Moyuri
- Ripon
- Nabila
- Nuching
- Malek
- Marzina lawyer-inactivity example if useful
- Rahim jurisdiction ping-pong example
- Salma/co-worker factory incident examples
- duplicate trap records
- five triage cases including disagreement
- 5-6 document-agent files including missing/unreadable item
- three settlement scenarios

### `IMPLEMENTATION_STATUS.md`
For every A1-A5, B1-B7, T1-T11 record:

```text
Implemented: YES/NO
Integrated: YES/NO
Testable: YES/NO
Route/page/API:
Demo seed:
Automated test:
Manual jury steps:
Known limitation:
```

Do not mark YES unless demonstrably true.

### Required Bad-Day E2E tests

1. Moyuri - unsafe person answers.
2. Ripon - completes meaningful task without sighted helper.
3. Nabila - receiving authority fails to acknowledge.
4. Nuching - network drops mid-submission.
5. Malek - lawyer misses two mandatory updates.
6. Similar-but-different duplicate trap remains separate.
7. Triage components disagree.
8. Document is unreadable.
9. Offline edit conflict.
10. Signed document changes after signing.
11. OpenAI unavailable during voice intake -> safe fallback.
12. Attempt to read restricted evidence with wrong role -> denied and audited if appropriate.

### Six integrated jury flows
Create `docs/demo-flows.md` containing exact click-by-click demonstrations for the six flows from `Project.md`.

### Stop gate
Ask: `Proceed to Step 15?`

STOP.

---

## STEP 15 - Production-Like Deployment and Public Prototype

### Objective
Deploy a stable public prototype without falsely claiming production-government integration.

### Credentials required
This is the step where deployment/database credentials may be needed.

The agent must first inspect what deployment accounts/tools the user has.

Do not choose a paid vendor without telling the user.

### Deployment requirements

1. HTTPS.
2. Public web URL.
3. API hosted securely.
4. MongoDB hosted persistently if public deployment needs it.
5. Secrets stored in host secret/environment settings.
6. No secrets committed.
7. CORS restricted to intended origins.
8. Production build works.
9. Health endpoint works.
10. Seed/reset method for demo data.
11. Clearly visible `Prototype / Demo` indicators where required.
12. No live 16699 claim.
13. No real legal beneficiary data.
14. Stable QR-ready URL.
15. Record external integrations as simulated vs live in `docs/architecture.md`.

### If deployment credentials are missing
Ask the user only for the necessary action, for example:

```text
Please connect/log in to your hosting account in the terminal, or provide the deployment environment yourself. Do not paste the password/token into chat.
```

### Stop gate
Ask: `Proceed to Step 16?`

STOP.

---

## STEP 16 - Final QA, Performance, Accessibility, Security, and Jury Readiness

### Objective
Freeze the prototype only after all mandatory tests pass.

### Credentials required
No new credential unless a deployed service needs existing access.

### Run

1. full lint
3. unit tests
4. integration/API tests
5. E2E tests
6. production build
7. public URL smoke test
8. accessibility checks
9. throttled-network PWA/light-mode tests
10. offline/reconnect tests
11. RBAC negative tests
12. voice mock/live fallback tests
13. OpenAI failure test
14. audit reconstruction test
15. document integrity test
16. signature integrity test
17. 23-item manual checklist
18. six-flow jury rehearsal

### Final report
Produce:
- exact coverage table
- test results
- public URL
- known limitations
- simulated external integrations
- environment variables required by deployment (names only)
- jury demo sequence
- rollback/reset instructions

Do not claim a requirement passed if it was not actually exercised.

STOP and wait for user instructions regarding paper, pitch deck, or final recording. Those are separate deliverables.

---

# 10. FEATURE-SPECIFIC IMPLEMENTATION RULES

## 10.1 Duplicate detection

- use multiple attributes
- show why a match was suggested
- human reviews side-by-side
- never use the word "fraud" as a conclusion
- never merge automatically

## 10.2 Related incidents

Common evidence may be referenced across cases, but case-specific:
- instructions
- private evidence
- outcomes
- permissions
must remain separate.

## 10.3 Document agent

Every material summary point should point to its source document/page/section where technically possible.

If text/image is unclear:

```text
UNCERTAIN / UNREADABLE - HUMAN VERIFICATION REQUIRED
```

Never reconstruct missing content from assumptions.

## 10.4 Settlement agent

Every output must visibly be:

```text
AI-ASSISTED DRAFT - HUMAN LEGAL REVIEW REQUIRED
```

Mark AI-inferred/filled sections and inconsistencies.

## 10.5 Triage agents

No hidden chain-of-thought in logs/UI.

Use concise structured reasons and evidence references only.

## 10.6 Offline sync

At minimum use:
- temporary UUID
- client mutation ID
- server idempotency check
- record version
- conflict detection
- human conflict resolution
- sync audit event

## 10.7 PWA caching

Prefer caching:
- static app shell
- public assets
- non-sensitive reference material where approved

Do not indiscriminately cache:
- sensitive evidence
- unrestricted case API responses
- raw voice recordings
- confidential legal notes

## 10.8 E-signature

Technical signature validity and legal enforceability are separate states in both code and UI.

---

# 11. DATA SAFETY RULES FOR THE PROTOTYPE

1. All sample persons are fictional.
2. No real NID numbers.
3. Do not generate realistic NID numbers that could accidentally belong to a person.
4. No real intimate/abusive images for Nabila.
5. No real beneficiary documents.
6. No live payments.
7. No real 16699 call.
8. Audio recording must be disabled unless the demo participant explicitly chooses it under the implemented consent flow.
9. Provide a "Reset Demo Data" function available only to authorised demo admin/setup path.
10. Seed scripts must be idempotent or safely resettable.

---

# 12. API AND SERVICE DESIGN PRINCIPLES

1. Thin routes, strong service layer.
2. Validate input at API boundary.
3. Authorise on server before reading or writing.
4. Use explicit workflow transition functions.
5. Use transactions where a multi-record transition must remain consistent and MongoDB supports the configured environment.
6. Use unique indexes for IDs/idempotency keys.
7. Never trust role fields supplied by the browser.
8. Never trust AI output without schema validation.
9. Never trust offline client timestamps as authoritative ordering without reconciliation logic.
10. Prefer idempotent commands for retryable operations.
11. Return stable error codes for UI failure handling.

Potential API command naming:

```text
POST /applications
POST /applications/:id/submit
POST /applications/:id/verify
POST /applications/:id/accept
POST /applications/:id/facts
POST /applications/:id/safe-contact
POST /applications/:id/contact-attempts
GET  /applications/:id/timeline

POST /cases/:id/referrals
POST /referrals/:id/acknowledge
POST /referrals/:id/return
POST /referrals/:id/escalate

POST /cases/:id/lawyer-change-requests
POST /lawyer-assignments/:id/updates
POST /lawyers/:id/assignment-hold-review

POST /cases/:id/triage
POST /cases/:id/document-analysis
POST /mediations/:id/settlement-drafts
POST /settlements/:id/sign
POST /settlements/:id/certify

POST /sync/batch
POST /sync/conflicts/:id/resolve
```

These paths are guidance, not a requirement to keep exact naming if a cleaner REST/domain design is implemented.

---

# 13. UI DESIGN PRINCIPLES

The interface is for legal-aid work, not a flashy startup demo.

Use:
- clear hierarchy
- large readable controls
- simple Bangla where citizen-facing
- status chips with text, not color alone
- visible owner / next action / deadline
- clear "AI suggestion" labels
- clear "Human decision" labels
- clear provenance chips
- safe-contact warning banner
- restricted-evidence lock state
- accessible error messages

Avoid:
- tiny text
- low-contrast decoration
- mandatory drag-and-drop
- visual-only OTP/CAPTCHA
- animation-heavy screens
- hidden critical actions
- showing 23 disconnected feature tiles as the main architecture

---

# 14. DEMO-FIRST RULE

Each mandatory feature must be accessible through a realistic user journey.

Do not create a hidden `/technical-challenges` page containing 11 isolated buttons just to claim coverage.

Technical features may have a developer/demo control panel for reproducibility, but the jury-facing evidence must connect naturally to the six integrated flows.

---

# 15. DEFINITION OF DONE FOR THE WHOLE PROJECT

The project is complete only when all of the following are true:

1. All A1-A5 are implemented, integrated, and testable.
2. All B1-B7 are implemented, integrated, and testable.
3. All T1-T11 are implemented, integrated, and testable.
4. G1-G10 are demonstrably enforced.
5. Application ID and Case ID lifecycle is correct.
6. Every provider works on the same authoritative record.
7. Moyuri/Ripon provenance is correct.
8. Unsafe contact test blocks disclosure.
9. Ripon has a nonvisual meaningful path.
10. Nabila evidence is role-restricted and referrals are tracked.
11. Nuching's assisted/offline flow survives network failure without duplication.
12. Malek can access status and lawyer inactivity triggers citizen protection.
13. T1 hold is not displayed as automatic misconduct punishment.
14. Duplicate detection never auto-merges/rejects.
15. Related cases link but remain independent.
16. Document agent cites sources and flags unreadable material.
17. Triage disagreement is visible.
18. AI never makes final consequential legal decisions.
19. PWA/light mode works under throttled network.
20. Offline conflicts are human-reviewable.
21. E-signature integrity can be independently verified.
22. Modified signed document fails verification.
23. Settlement does not become final merely because an e-signature exists.
24. CLAO certification state exists where applicable.
25. Area/date applicability uncertainty does not silently become "court decree".
26. Audit can reconstruct the important journey.
27. Public prototype has no exposed secret.
28. OpenAI failure has a safe fallback.
29. All tests/builds pass.
30. `IMPLEMENTATION_STATUS.md` contains no false YES entries.

---

# 16. HOW THE AGENT SHOULD SPEAK TO THE USER DURING IMPLEMENTATION

Keep progress updates simple and operational.

Good:

```text
Step 3 is complete.

What now works:
- Application submission
- Human acceptance -> Case ID
- Shared timeline
- Role dashboards

Checks:
- 24 tests passed
- build passed

No new credential is required for Step 4.
Proceed to Step 4?
```

At credential gate:

```text
Step 5 requires live OpenAI access.
Your permanent API key must stay server-side.
Please place OPENAI_API_KEY in server/.env and reply "done".
Do not paste the key here.
```

Bad:

```text
I will build everything now.
Send me all your passwords and API keys.
```

Bad:

```text
The system is complete.
```

when only UI placeholders exist.

---

# 17. IF SOMETHING GOES WRONG

## Dependency/API failure
- explain exact failure
- preserve current working state
- use documented mock/fallback if available
- do not silently replace vendor/model
- ask user before material architecture change

## Law/policy ambiguity
- do not make legal conclusion
- implement pending-human-review state
- add it to `docs/legal-assumptions.md`
- ask law team to verify later

## Test failure
- do not proceed to next step
- fix or clearly explain the blocker

## Existing repository conflicts with this plan
- preserve user work
- show conflict
- propose minimal migration
- do not erase code without approval

## Missing Docker/Mongo locally
- first detect whether a local MongoDB option exists
- if not, ask whether the user wants to install/use Docker or use MongoDB Atlas
- do not demand a cloud credential automatically

---

# 18. ANTI-HALLUCINATION PRE-FLIGHT CHECKLIST FOR EVERY SESSION

Before editing code, silently verify:

```text
[ ] Read Project.md
[ ] Read Goal.md
[ ] Know current step
[ ] Know which A/B/T/G items this step covers
[ ] Know whether credentials are genuinely needed
[ ] No secret will be exposed
[ ] No final legal decision delegated to AI
[ ] No separate parallel case record being created
[ ] Provenance will be preserved
[ ] Safe contact is considered
[ ] Failure path is implemented
[ ] Tests will be added/run
[ ] I will stop after this step and ask permission
```

If any item is false, fix it before proceeding.

---

# 19. CURRENT EXTERNAL-SERVICE TRUTH

As of this implementation plan:

- Real 16699 telecom access: **NOT AVAILABLE / NOT CLAIMED**.
- Website 16699 voice prototype: **TO BE IMPLEMENTED**.
- OpenAI API: **chosen implementation provider for live AI once Step 5 is authorised and an API key is configured**.
- ChatGPT subscription: **not a substitute for API billing/credentials**.
- SMS/USSD: **may be simulated unless later real integration is explicitly approved**.
- Government identity/API integration: **not available and must not be invented**.
- Real payment integration: **not used**.

---

# 20. CURRENT OFFICIAL OPENAI REFERENCES TO RE-CHECK AT STEP 5

These links are implementation references, not project requirements:

- OpenAI API models: https://platform.openai.com/docs/models
- OpenAI Platform/API documentation: https://platform.openai.com/docs
- OpenAI API billing is separate from ChatGPT billing: https://help.openai.com/en/articles/9039756

The coding agent must re-check current official OpenAI documentation immediately before live integration rather than relying solely on model names or client patterns written in this file.

---

# 21. FINAL INSTRUCTION TO CODEX / CLAUDE / GEMINI

When the user first gives you this repository and tells you to follow `Goal.md`:

1. Read `Project.md` in full.
2. Read `Goal.md` in full.
3. Inspect the repository.
4. **Implement Step 1 only.**
5. Do not ask for an OpenAI/GPT API key during Step 1.
6. Run Step 1 checks.
7. Report exactly what changed and what passed.
8. Tell the user whether Step 2 needs any credential.
9. Ask: **"Proceed to Step 2?"**
10. Stop.

Repeat this controlled pattern for every later step.

The goal is not to generate the most code in one run. The goal is to produce a **working, auditable, integrated, safe, legally cautious, jury-testable DLAS prototype without hallucinating requirements or silently skipping mandatory items.**
