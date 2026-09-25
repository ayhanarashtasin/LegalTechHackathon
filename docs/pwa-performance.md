# T10 PWA and low-bandwidth check

## What the modes do

The app can be installed from a production build. Its service worker precaches the HTML shell, manifest, icons, and entry JavaScript/CSS. It caches same-origin `/assets/` files when opened, including provider-page chunks. Public voice intake and UDC assisted intake stay in the entry bundle so their screens can open after the shell has been cached. Provider pages download when visited; a provider page that has never been opened may be unavailable offline, and its live case data always needs the API.

On a first visit, the browser's Save-Data preference, 2G connection hint, or reduced-data preference selects light mode. The user can switch modes in the header; that explicit choice is retained. Both modes render the same text questions and use the same initial shell. During a Bangla voice call, light mode skips recorded question audio and the audio-file availability probes. A notice on the voice screen explains that Normal mode restores recorded prompts. Light mode does not make the initial shell smaller than Normal mode.

## Reproducible browser measurement

Run `npm run build`, then `npx playwright test -c playwright.pwa.config.js`. The test uses a cold Chromium context for each mode with the service worker blocked for the load measurement, 150 ms network latency, 50,000 bytes/s download and upload, 4× CPU slowdown, and a 390×844 viewport. It opens the public shell, times navigation and a mode toggle, enters the Bangla voice screen with a fake microphone, and counts `/audio/` requests made when starting a call. A separate browser context checks installability, static-only cache entries, and an offline shell reload. Another confirms that Save-Data chooses light mode on first visit while a later manual choice persists.

| Mode | Cold shell load | Shell transfer | Mode toggle | Call start | Call-start audio requests |
| --- | ---: | ---: | ---: | ---: | ---: |
| Normal | 3,195 ms | 131,885 bytes | 139 ms | 468 ms | 13 |
| Light | 3,150 ms | 131,885 bytes | 125 ms | 304 ms | 0 |

These are one local run, not a field-device benchmark or a guaranteed latency improvement. The call-start measure ends when the call card appears; it does not include the full recorded prompt. Vite's initial JavaScript asset is about 418 KB uncompressed after provider-page splitting, down from about 620 KB before that change. The route chunks load on demand for both modes. Repeat the check on target low-RAM Android devices and real unstable networks before deployment.

## Privacy and shared devices

The service worker handles only same-origin shell/static assets. It skips `/api/`, `/health`, non-GET requests, other origins, and voice audio, so it does not put case responses or recordings in the static cache. Offline application drafts and party signing snapshots/signature packets are stored in IndexedDB with AES-GCM encryption under a user-entered local passphrase; ciphertext integrity is checked before use. A party must open the approved draft online once before signing offline. Successful signing sync deletes that party's encrypted snapshot and packet; the public signing page also offers a local delete action. Session tokens and newly entered passwords stay in memory; the app removes legacy localStorage credential keys left by older builds. Signing out clears both local stores and the in-memory session, and warns if local clearing fails. The passphrase must remain private; a compromised device, weak passphrase, or an unlocked signed-in tab can still expose data. On a shared device, users should finish sync, delete local signing data, sign out where applicable, and close the tab. Browser storage loss can also destroy unsynced drafts or signatures.

See [permissions.md](permissions.md) and [threat-model.md](threat-model.md) for the access and residual-risk details.
