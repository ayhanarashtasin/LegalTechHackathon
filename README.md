# LegalTechHackathon

Local MERN prototype of [Project.md](Project.md) with work through Step 14: one shared Application/Case record; provider workspaces; simulated voice intake at `/voice`; UDC-assisted/offline intake at `/assisted`; tracked referrals, lawyer work, related incidents, duplicate review, triage, and mediation/e-signature workflows. Groq AI is optional, server-side, and has manual/deterministic fallbacks. The 19 human Bangla prompt recordings are present, but live Bangla transcription and independent blind-user use still need validation. The prototype includes fictional demo data and six walkthroughs in [docs/demo-flows.md](docs/demo-flows.md); it is not the live 16699 service and is not publicly deployed. Do not use real beneficiary data.

## Local start

Requires Node.js 22.13+ (22.x), 24.x, or 26+ and MongoDB. This workspace is configured for a dedicated MongoDB Atlas development database in ignored `server/.env`; alternatively, copy [server/.env.example](server/.env.example) to `server/.env` and run local MongoDB with Docker Desktop. Never commit or share the environment file.

```powershell
npm install
npm run seed --workspace server
npm run dev:server
```

In another terminal:

```powershell
npm run dev:client
```

Open `http://127.0.0.1:5173`. The API health endpoint is `http://127.0.0.1:5000/health`; it succeeds only when MongoDB responds. `npm run seed --workspace server` idempotently creates fictional provider accounts and demo records for voice/assisted intake, referrals, lawyer work, related incidents, duplicate review, triage, and mediation. Generated passwords stay in ignored `server/.demo-credentials.json`; do not publish that file. For local Docker MongoDB, run `docker compose up -d` before seeding; the example configuration also uses port 5000.

In development, the API creates and synchronizes the fixed demo accounts before accepting logins, so scenario seeding is optional for sign-in. The login screen defaults work on fresh databases and after restarts: panel lawyers use `123`, other demo roles use `1234`, and the local admin uses `admin123` unless `ADMIN_PASSWORD` is configured. Scenario seeding writes those same development credentials to the ignored credential file. Production does not auto-create public-password demo accounts; production seeding retains private passwords or generates replacements for known development defaults.

Public development demo passwords cannot be changed through account settings; registered accounts retain normal password changes.

Run the checks (API and browser tests each use a temporary, isolated MongoDB database that is dropped afterwards):

```powershell
npm run lint
npm test
npm run build
npm run check:production-static
npx playwright install chromium  # first time only
npm run test:e2e
npx playwright test -c playwright.pwa.config.js  # after npm run build; production PWA/offline check
```

Speaking an answer needs `GROQ_API_KEY` in ignored `server/.env` (see [server/.env.example](server/.env.example)). Without it, or with `VOICE_AI=off`, the page keeps working by keyboard. The key stays on the server; each answer clip is transcribed and discarded. The browser records the whole call after the greeting notice and uploads it after submission for the owning DLAO officer. If upload fails, the page shows the saved Application ID and lets the caller retry the same recording while the page remains open and the 15-minute upload window remains valid. `npm run check:voice --workspace server` checks Bangla understanding, and takes an optional audio file to check transcription. The call runs like a phone IVR: 19 recorded Bangla clips in `client/public/audio/` ask the questions (script in [docs/voice-prompts.md](docs/voice-prompts.md)), choices and the safe number are answered on the keypad, spoken answers end with #, and * repeats a question. Browser tests never call the AI unless you opt in with `LIVE_VOICE_SAMPLE`.

The home page's Track card can also be used by voice (**Ask by Voice**): the caller says their number and PIN and hears the status. That spoken reply comes from a local Python text-to-speech service: run `npm run tts:setup` once (Python 3, FFmpeg, about 1 GB), then `npm run tts`, and set `TTS_URL=http://127.0.0.1:5055` in `server/.env`. Without it the same sentence is shown as text. Its model is licensed for non-commercial use only; see [docs/voice-prompts.md](docs/voice-prompts.md). The call can also run in English: it greets in the page's language and continues in the language of the caller's first answer; English lines are spoken by the browser's own voice, so they need no extra service.

## Vercel frontend and Render API

Use a Vercel Vite project with **Root Directory `client`**, build command `npm run build`, and output directory `dist`. Set `VITE_API_ORIGIN` to the Render service origin, for example `https://your-api.onrender.com` (no `/api` suffix). The committed `client/vercel.json` sends client-side routes to the app shell.

Create a Render Node web service from this repository with build command `npm ci --include=dev && npm run build` (`NODE_ENV=production` makes npm skip devDependencies such as Vite) and start command `npm run start --workspace server`. Set `NODE_ENV=production`, `MONGODB_URI` and `MONGODB_DB` for a dedicated persistent demo database, and `CLIENT_ORIGIN` to the exact Vercel origin, for example `https://your-site.vercel.app`. Render supplies `PORT`; leave `HOST` unset. Check `/health` after deployment. Keep all secrets in Render's environment settings, never in Vercel's `VITE_` variables or Git.

For fictional staff accounts, run `npm run seed --workspace server` once from a trusted local machine with ignored `server/.env` pointed at that demo database. Save the generated passwords from ignored `server/.demo-credentials.json` privately; the deployed site will not reveal them. Then set `STAFF_LOGIN_ENABLED=true` on Render. Leave it `false` if only the public voice simulation should be accessible. This is demo authentication, not a government identity system; use fictional data only. Optional Groq variables in [server/.env.example](server/.env.example) enable live AI, while the manual/keyboard path remains available without them. Render free instances can sleep, delaying the first API request and pausing the in-process referral deadline timer; a continuously running service is needed for reliable timed workflows.

Document briefing also uses the server-side Groq key when available; `DOCUMENT_AI=off` selects the deterministic cited inventory used by tests. Step 7 document uploads accept fictional `.txt` only, not scans or production evidence. The PWA caches static files but never API responses. Offline drafts require a local passphrase, are purged after successful sync or logout, and should not be left on a shared device. Both modes show prompts on-screen; light mode omits prompt audio and its availability probes. Provider pages load on demand for both modes. The throttled measurements, cache policy, and shared-device limits are in [docs/pwa-performance.md](docs/pwa-performance.md).

The API checks referral acknowledgement deadlines every minute (`REFERRAL_SWEEP_MS`; browser tests use 1 second). This is a timer inside the running server process, so run a single API instance. Step 8 restricted evidence is a harmless synthetic placeholder. Never upload real intimate or abusive images.

The root npm workspace installs both applications. Run `docker compose down` to stop the database without deleting its named volume.

## Structure

### Party identity verification before mediation signing

Issue separate party codes from the mediator's Signatures section. At `/mediation/sign`, each party consents and chooses a short camera recording with an ID document, an in-person visit, or an assisted office-device check. The assigned mediator reviews each party separately and records approval, a retake, or a manual check. Approval is required on the server before opening the signing draft and accepting a new party signature. Replaced codes, changed drafts, expired approvals and revoked approvals cannot authorise a new signature. Approved parties can still sign offline and sync later; evidence is never stored in the offline cache.

Videos are checked with `ffprobe` (3–12 seconds, maximum 4 MB); ID uploads accept PNG/JPEG/PDF (2 MB), and optional supporting signature images accept PNG/JPEG (2 MB). Evidence is encrypted with AES-256-GCM in separate private MongoDB records, access is audited, and MongoDB TTL indexes remove expired evidence. The other party and unrelated officers have no evidence access. In-person/assisted approval requires the mediator to compare the original ID and person, witness consent, and record the venue/helper details. The party signs on the office device themselves. A helper cannot create a party signature using an officer session.

Before production use, configure `IDENTITY_EVIDENCE_KEY` (private 64-character hexadecimal key), an authorised `IDENTITY_EVIDENCE_RETENTION_DAYS` (1–365), HTTPS, and an installed, maintained `ffprobe` binary (`FFPROBE_PATH` optionally selects it). Local development creates an ignored persistent encryption key and defaults to 30-day evidence retention. Keep that key private and backed up with the encrypted database; losing it makes earlier evidence unreadable. Database backups require their own authorised deletion schedule. Use fictional evidence in this prototype. Human video review is not certified liveness, biometric identification, or government ID verification. Signature images support the existing cryptographic record; this workflow does not digitise witnessed paper signatures or determine cross-border legal validity.

- `client/`: React views in JavaScript/JSX, built with Vite. Its home screen checks the local API.
- `server/src/routes/`: Express endpoint mapping.
- `server/src/controllers/`: HTTP response coordination.
- `server/src/services/`: domain rules and database coordination.
- `server/src/models/`: Mongoose schemas for the shared record and later workflows.
- `server/src/middleware/`, `validators/`, `utils/`, `seeds/`: authentication, input checks, ID generation, and fictional account seeding.
- `docs/`: architecture, permissions, legal-review, failure, and demonstration notes.

All later channels and roles must use the same authoritative Application/Case record. An Application ID is created on submission; a Case ID follows only authorised human acceptance. See [docs/permissions.md](docs/permissions.md) for the current API access matrix and [Goal.md](Goal.md) for the approved implementation order. Steps 1–4 need no credential. Steps 5 and 7 reuse `GROQ_API_KEY`: by user decision the AI provider is Groq, after Google denied API access (see [Goal.md](Goal.md) Section 2).
