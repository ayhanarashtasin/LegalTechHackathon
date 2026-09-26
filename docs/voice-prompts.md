# Bangla voice prompts (16699 call)

The 16699 prototype runs like a phone IVR line. A recorded clip asks each question; after the beep the caller answers by voice (then pauses or presses **#**) or on the keypad, and presses **\*** to hear a question again. A spoken number (a phone number or an NID) is read back digit by digit and must be confirmed. The beep and key tones are generated in the browser; only the clips below are audio files.

All 38 clips live in `client/public/audio/` (48 kbps mono MP3, 24 kHz). The 26 question and message clips and the 10 digit clips were supplied on 2026-09-24 and checked with Whisper against this script; `wrongKey` and `noInput` are from 2026-09-23. The digit clips were trimmed to about 60 ms of silence before and 120 ms after each word, so a number reads back smoothly. If a clip is re-recorded, keep the key order: key **1** is always the first choice listed in `client/src/utils/voiceScript.js`.

## The call (project decision 2026-09-24)

1. `greeting`, then `service`: **1** complaint, **2** information or advice.
2. **Advice:** `adviceIntro` → `adviceTopic` → `contactValue` → `safeTime` → `readback` → `adviceDone`. The request waits in the helpline workspace; the helpline officer calls back, then either closes it (information given) or records the applicant, which turns the same record into a complaint for DLAO review.
3. **Complaint:** `callerRole` → `callerName` → (representative only: `relationship` → `applicantName`) → `district` → `nidKnown` → (`nid` if known; `nidUnknown` plays if not, and the call continues) → `problem` → `urgent` (`safetyAlert` plays after "yes", and the call continues) → `contactChannel` → (`contactValue` for phone; `trustedPerson` → `trustedPhone` for a trusted person; nothing more for UDC) → `safeTime` → `readback` → `submitted`, the application number's digits, `pin`, the PIN's digits, `submittedEnd`. **\*** plays the ending again.

The NID is checked for format only (10, 13, or 17 digits); nothing checks it against any identity register, and the audit trail records only that one was given. SMS and voicemail are never used for a 16699 contact.

## How to re-record

1. Record in a quiet room, one clip per row, reading the **Bangla** column naturally and unhurried. Say "হ্যাশ" and "স্টার" as words.
2. Save each clip as MP3 with the exact file name in the first column (names are case-sensitive).
3. Keep clips mono and small (about 32–48 kbps) so the page stays usable on slow connections.
4. A missing file is not an error: that question simply shows on screen without audio. Without all ten digit clips and `numberConfirm`, numbers are keypad-only.
5. The greeting carries the call-recording notice, a legal statement: have the law team approve its wording.
6. Say the quoted words exactly as written: they are the words callers will copy. A caller may also say the key number ("এক", "দুই", "তিন").

## Clips (38)

| File | Bangla |
| --- | --- |
| `greeting.mp3` | বাংলাদেশ আইনগত সহায়তা অধিদপ্তরে আপনাকে স্বাগতম। সেবার মান ও আপনার আবেদনের জন্য এই কলটি রেকর্ড করা হচ্ছে। জীবন বা নিরাপত্তা এখনই ঝুঁকিতে থাকলে এখনই ৯৯৯-এ ফোন করুন। কোনো প্রশ্ন আবার শুনতে স্টার চাপুন। |
| `service.mp3` | আপনি কি আইনগত কোনো অভিযোগ জানাতে চান, নাকি আইনগত তথ্য ও পরামর্শ নিতে চান? অভিযোগ জানাতে "অভিযোগ" বলুন বা ১ চাপুন; তথ্য বা পরামর্শ নিতে "পরামর্শ" বলুন বা ২ চাপুন। |
| `adviceIntro.mp3` | আপনার প্রশ্নটি একজন লিগ্যাল এইড কর্মকর্তার কাছে পাঠানো হবে। তিনি আপনাকে ফোন করে প্রয়োজনীয় আইনগত তথ্য ও পরামর্শ দেবেন। |
| `adviceTopic.mp3` | আপনি কোন বিষয়ে আইনগত তথ্য বা পরামর্শ চান, নিজের ভাষায় বলুন। বলা শেষ হলে একটু থামুন বা হ্যাশ চাপুন। |
| `adviceDone.mp3` | ধন্যবাদ। আপনার প্রশ্নটি গ্রহণ করা হয়েছে। একজন লিগ্যাল এইড কর্মকর্তা নিরাপদ সময়ে আপনাকে ফোন করবেন। |
| `callerRole.mp3` | আপনি কি নিজের জন্য অভিযোগ করছেন, নাকি অন্য কারও প্রতিনিধি হিসেবে যোগাযোগ করছেন? নিজের জন্য হলে "নিজের জন্য" বলুন বা ১ চাপুন; প্রতিনিধি হিসেবে হলে "প্রতিনিধি" বলুন বা ২ চাপুন। |
| `callerName.mp3` | আপনার পূর্ণ নাম বলুন। বলা শেষ হলে একটু থামুন বা হ্যাশ চাপুন। |
| `relationship.mp3` | যাঁর পক্ষে যোগাযোগ করছেন, তিনি আপনার কী হন বলুন। বলা শেষ হলে একটু থামুন বা হ্যাশ চাপুন। |
| `applicantName.mp3` | যাঁর পক্ষে যোগাযোগ করছেন, সেই ভুক্তভোগীর পূর্ণ নাম বলুন। বলা শেষ হলে একটু থামুন বা হ্যাশ চাপুন। |
| `district.mp3` | আপনার জেলার নাম বলুন। অন্য কারও পক্ষে যোগাযোগ করলে ভুক্তভোগীর জেলার নাম বলুন। বলা শেষ হলে একটু থামুন বা হ্যাশ চাপুন। |
| `nidKnown.mp3` | আপনার জাতীয় পরিচয়পত্র বা NID নম্বর কি জানা আছে? অন্য কারও পক্ষে যোগাযোগ করলে ভুক্তভোগীর NID নম্বরের কথা বলছি। জানা থাকলে "হ্যাঁ" বলুন বা ১ চাপুন; জানা না থাকলে "না" বলুন বা ২ চাপুন। |
| `nid.mp3` | আপনার NID নম্বরটি বলুন বা কিপ্যাডে চাপুন। শেষে একটু থামুন বা হ্যাশ চাপুন। |
| `nidUnknown.mp3` | অনুগ্রহ করে নিকটস্থ ইউডিসি অফিসে যোগাযোগ করুন। সেখানে আপনার পরিচয় যাচাই ও পরবর্তী প্রক্রিয়ায় সহায়তা করা হবে। এখন আপনার অভিযোগটি নেওয়া হচ্ছে। |
| `problem.mp3` | আপনার অভিযোগের বিষয়টি সংক্ষেপে নিজের ভাষায় বলুন: কী ঘটেছে, কখন, কোথায় এবং কারা জড়িত। যতটুকু বলতে স্বস্তি বোধ করেন, ততটুকুই বলুন। বলা শেষ হলে একটু থামুন বা হ্যাশ চাপুন। |
| `urgent.mp3` | আপনি বা যাঁর পক্ষে যোগাযোগ করছেন, তিনি কি বর্তমানে কোনো হুমকি, সহিংসতা বা নিরাপত্তাজনিত ঝুঁকির মধ্যে আছেন? থাকলে "হ্যাঁ" বলুন বা ১ চাপুন; না থাকলে "না" বলুন বা ২ চাপুন। |
| `safetyAlert.mp3` | আপনার নিরাপত্তাকে আমরা সবার আগে গুরুত্ব দিচ্ছি। আপনার অভিযোগটি জরুরি হিসেবে কর্মকর্তার কাছে পাঠানো হবে। জীবন এখনই ঝুঁকিতে থাকলে এখনই ৯৯৯-এ ফোন করুন। |
| `contactChannel.mp3` | আপনার সঙ্গে কোন মাধ্যমে যোগাযোগ করা নিরাপদ ও সুবিধাজনক? নিরাপদ নম্বরে ফোনে হলে "ফোন" বলুন বা ১ চাপুন; নিকটস্থ ইউডিসি অফিসের মাধ্যমে হলে "ইউডিসি" বলুন বা ২ চাপুন; বিশ্বস্ত কোনো ব্যক্তির মাধ্যমে হলে "ব্যক্তি" বলুন বা ৩ চাপুন। আমরা কোনো এসএমএস বা ভয়েসমেইল পাঠাব না। |
| `contactValue.mp3` | যে নম্বরে ফোন করা নিরাপদ, সেটি বলুন বা কিপ্যাডে চাপুন। শেষে একটু থামুন বা হ্যাশ চাপুন। |
| `trustedPerson.mp3` | যাঁর মাধ্যমে যোগাযোগ করব, তাঁর নাম এবং তিনি আপনার কী হন বলুন। বলা শেষ হলে একটু থামুন বা হ্যাশ চাপুন। |
| `trustedPhone.mp3` | তাঁর ফোন নম্বরটি বলুন বা কিপ্যাডে চাপুন। শেষে একটু থামুন বা হ্যাশ চাপুন। |
| `safeTime.mp3` | কোন সময়ে আপনার সঙ্গে যোগাযোগ করা নিরাপদ, বলুন। যেমন, বিকেল তিনটা থেকে পাঁচটা। বলা শেষ হলে একটু থামুন বা হ্যাশ চাপুন। |
| `readback.mp3` | আপনার দেওয়া তথ্যগুলো স্ক্রিনে দেখে নিন। সব ঠিক থাকলে "জমা দিন" বলুন বা ১ চাপুন। |
| `submitted.mp3` | আপনার অভিযোগটি সফলভাবে গ্রহণ করা হয়েছে। আপনার আবেদন নম্বর হলো— |
| `pin.mp3` | আপনার গোপন পিন হলো— |
| `submittedEnd.mp3` | এই আবেদন নম্বর ও পিন দিয়ে পরে ১৬৬৯৯-এ ফোন করে আপনার অভিযোগের অগ্রগতি জানতে পারবেন। পিনটি কাউকে জানাবেন না। আবার শুনতে স্টার চাপুন। ধন্যবাদ। |
| `numberConfirm.mp3` | আপনি এই নম্বরটি বলেছেন। ঠিক হলে "হ্যাঁ" বলুন বা ১ চাপুন; ভুল হলে "না" বলুন বা ২ চাপুন। (Plays right after the digits.) |
| `digit0.mp3` … `digit9.mp3` | শূন্য · এক · দুই · তিন · চার · পাঁচ · ছয় · সাত · আট · নয় — one word per file. |
| `wrongKey.mp3` | এই বোতামটি এখানে কাজ করে না। প্রশ্নটি আবার শুনুন। |
| `noInput.mp3` | কোনো উত্তর শুনতে পাইনি। প্রশ্নটি আবার শুনুন। (No key for 12 s, # with no speech, or speech not understood; twice at most on silence.) |
| `numberWrong.mp3` *(optional, not yet recorded)* | নম্বরটি পুরো পাওয়া যায়নি। প্রতিটি অঙ্ক আলাদা করে আবার বলুন, বা কিপ্যাডে চাপুন। (A number arrived with the wrong length, e.g. an NID that is not 10, 13, or 17 digits. The screen shows the digits received and the rule; until this clip exists, `noInput` plays.) |

A spoken number is read back only with light mode off, because that is when the clips play (in either site language; 16699 is a Bangla line); otherwise it stays keypad-only. The page turns Whisper's digit words into digits itself (including by-ear spellings such as "শুন্ন", "পাচ", "নই", and "ডাবল জিরো"), because the extraction model was seen dropping digits. A typed number is taken 4 seconds after the last key, or at once with #; a Bangla keyboard layout's ০–৯ keys work like 0–9.

Pressing any key while a clip plays cuts it short (type-ahead). A spoken answer also ends by itself once the caller has spoken and then stayed quiet for 2.5 seconds (4 seconds for the complaint or advice question and for a number, which people say in groups; 1.5 seconds for a yes/no or choice), so a blind caller never has to find the # key; the short low tone that follows means the system stopped listening. This is a loudness check in the browser only, so no audio goes anywhere new; in a room that never goes quiet, # still ends the answer. A spoken answer that runs past 20 seconds (3 minutes for the complaint or advice question) is sent automatically.

## Also useful

Record one extra clip of a fictional caller answering, for testing Bangla transcription end to end:

- `npm run check:voice --workspace server -- path/to/sample.webm` transcribes it and shows what the AI extracted.
- `LIVE_VOICE_SAMPLE=path/to/sample.wav npm run test:e2e` runs the opt-in browser test that speaks that clip into the page.

## Spoken status on the Track card (synthesized, project decision 2026-09-25)

The home page's **Track Application & Case Progress** card has **Ask by Voice / বলে জানুন** for a caller who cannot read (A5 Malek). Unlike the 16699 call, its sentences are **not recorded**: the local BanglaTTS service speaks them, and each is also shown as text. The wording lives in `server/src/services/spokenStatus.js`; the browser can only name one of these prompts, never send its own text. The same prompts and status sentences also exist in English (added 2026-09-26): the call greets in the page's language, Whisper detects the language of the caller's first answer, and the call continues in Bangla, or in English when at least two English words were heard. English lines are spoken by the browser (Web Speech API), since BanglaTTS speaks only Bangla.

1. `welcome` — বলুন, আপনি কী জানতে চান? The caller answers in their own words. Status words (অবস্থা by consonant outline, খবর, আপডেট, শুনানি, …) are matched in the browser; only when none match does the model (`openai/gpt-oss-120b`) say whether it is a status request. Anything short of its clear yes plays `confirmStatus`; "no" ends with `onlyStatus`.
2. `askNumber`, then `confirmNumber` — the number is read back as digit words and confirmed with yes/no. A number said in the first sentence after "নম্বর" is read back without asking again.
3. `privateCheck` — before the PIN is said and the status heard aloud: "are you somewhere no one else can hear?" It is asked as a positive question, since in Bangla "না, কেউ নেই" (no, nobody is here) to "nobody can hear, right?" would read as a no. Only a clear yes goes on; "no", or no clear answer after three tries, plays `notPrivate` and ends the call without a word about the case. The phone may be shared: Malek's number is a shop's.
4. `askPin` — never read back or shown. `pinAgain` plays when six digits were not heard; `notFound` when the ID and PIN do not match.
5. The status sentence (below), then the call ends. `tryHelpline` ends it after three failed tries or a locked ID; `unavailable` when the lookup fails.

The number and PIN can also be **typed** during the call: focusing the box stops listening for that turn. Each turn's transcript is shown as **আপনি বললেন: …**, except the PIN's.

The status sentence comes from fixed templates over the verified record and says only the stage, hearing date (as Bangla words, Dhaka calendar, never a past date), and an officer's next step if it is written in Bangla. It never says a name, the legal matter, the lawyer, or the office, since the phone may be shared.

**Whisper hints.** Short replies are misheard without context: unprimed, a lone "হ্যাঁ" came back as "হাই" or "হ্যাদ", "না" as "ন", and one "শূন্য" of six was dropped. Yes/no turns are primed with `হ্যাঁ। না। জি। ঠিক আছে।` and number/PIN turns with the Bangla digit words; silence and noise did not turn into a hinted word. English digit words written in Bangla script (ওয়ান, টু, থ্রি, …) count as digits by exact spelling. The model is never used for numbers: from a broken transcript it guessed a wrong PIN rather than admit a missing digit, and rewriting transcripts into "correct" Bangla changed or deleted words.

**Running it.** `npm run tts:setup` once (about 1 GB: CPU PyTorch, BanglaTTS, a 56 MB model downloaded on first start), then `npm run tts` (port 5055) and `TTS_URL=http://127.0.0.1:5055` in `server/.env`. Without it the same sentences appear as text only. `npm run check:voice-status --workspace server` speaks the seeded Malek case and saves the MP3. The Silero model under BanglaTTS is licensed CC BY-NC-SA 4.0: demo use only.
