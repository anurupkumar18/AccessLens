# 0076 — Local dev (localhost:5173) end-to-end debugging session

## Goal

Get the extension's local Vite dev host (`http://localhost:5173`, real Google
Chrome, no unpacked extension install) working end to end against the deployed
AWS stacks, ahead of a live demo, and record everything found so the next
debugging session does not re-derive it.

## What was actually wrong

1. **The running dev server had silently died.** A `npx vite` process on port
   5173 (started outside any tracked launch config, in a terminal this session
   could not see) exited between two checks with no error surfaced anywhere the
   user was looking. `.claude/launch.json` only had a `vite preview --port 4310`
   entry, nothing for the actual dev server, so nobody could see its logs or
   know it had died.
2. **`.env.local` never got the AI/chat/course-media/orb endpoints**, even
   though `AccessLensLiveSession`, `AccessLensCourseMedia`, and
   `AccessLensOrbExplain` are all deployed and CORS-open (`allowOrigins: ['*']`
   in `infra/lib/live-session-stack.ts`). Only `VITE_ACCESSLENS_WS_URL`,
   `VITE_ACCESSLENS_API_URL`, and `VITE_GOOGLE_CLIENT_ID` were ever set, so the
   panel showed "AI screen analysis is not configured" (expected — see below)
   but also silently disabled Ask-this-class, study chat, and course-media
   defaults that *are* live.
3. **`vite.config.ts`'s `/ai` proxy target was stale**, still pointing at
   `https://5skua1vus7...` — the AI API URL from the T-49 incident recovery,
   itself superseded since. Confirmed unused (nothing in the tree references a
   relative `/ai` path), so this was dead but wrong config, not a live bug.

## Changed files

- `.claude/launch.json` — added an `accesslens-dev` entry (`npx vite --port
  5173 --strictPort`) so the dev server is a tracked, log-visible process
  instead of an invisible background one.
- `.env.local` — pulled current endpoint values straight from
  `aws cloudformation describe-stacks` for `AccessLensLiveSession` (AiApiUrl,
  StudyChatUrl), `AccessLensCourseMedia` (CourseMediaUrl), and
  `AccessLensOrbExplain` (OrbExplainUrl), and added them alongside the
  existing three vars. `AccessLensAuthoring`'s `ApiUrl` and `GoogleClientId`
  were already current.
- `vite.config.ts` — corrected the `/ai` proxy target to the current
  `AiApiUrl`. Confirmed via the served module's `import.meta.env` (read over
  the network response, not assumed) that the restarted dev server actually
  picked up the new values.
- Added `packages/access-packs/bio-cell-demo/deck-preview.html` — a small
  static page (no build step) that shows the five reviewed slide PNGs
  full-bleed with click/arrow-key navigation, so a single shared tab can
  stand in for a real multi-slide presentation deck during local rehearsal,
  instead of sharing one static image. Verified it actually advances
  slide-to-slide in a real browser.
- `docs/CONTEXT_RELAY.md` — opened T-52, appended RL-097.

## Validation evidence

All done live against the deployed AWS stacks, not mocked:

- `client.create()` / `client.join()` against
  `wss://ktlrnmxq0f.execute-api.us-east-1.amazonaws.com/demo` from two separate
  browser tabs: instructor capability and student capability both issued, both
  carrying a working IVS `streamToken`.
- An `asset.changed` event sent from the instructor-role client arrived at the
  student-role client's `subscribe` callback, schema-valid, in under 2 seconds.
- `defaultAiClient.ask(...)` against the live `AiApiUrl`: an in-scope question
  ("What does the mitochondrion do?") returned `status: "answered"` with a
  correct citation (`cell-slide-03` / Mitochondrion); an off-topic question
  ("What is the capital of France?") returned `status: "declined", reason:
  "no-reviewed-material"` — the Bedrock guardrail is live and working both
  ways.
- `defaultAiClient.transcribeUrl(...)` returned a validly signed
  `wss://transcribestreaming.us-east-1.amazonaws.com` grant.
- `make pack-check` (fingerprint validation + contract conformance + review
  sheet + 70 unittest cases): clean.
- `npm run test` (vitest, full repo): 1078 passed, 1 pre-existing unrelated
  failure — `services/ingest/src/ingest.test.ts` needs the `soffice`
  (LibreOffice) binary installed locally for PPTX→PDF conversion; not related
  to the live-session/demo path.
- Live on the user's actual Chrome (not simulated): screen-share picker,
  session start, join code generation, student join, "unmatched" on a
  non-reviewed tab (Discord), then a real recognized-slide sync
  ("Now on The Animal Cell.") once a reviewed slide image was shared.

## Blocker

There is no implementation blocker. The remaining risk is process, not code:
see T-52 (no automation keeps local dev config in sync with a redeployed
stack's rotated endpoint URLs).

## Boundary

Nothing here touches AWS infrastructure, deployed stacks, or the extension's
production behavior — this is purely local `.env.local` / `vite.config.ts` /
`.claude/launch.json` configuration plus a static demo-only HTML helper. No
credential, student data, or capability logic changed.

## Owner

Claude, at Anurup Kumar's direction (live pairing session, screenshots and
real-Chrome feedback throughout).

## Next action

- If any of `AccessLensLiveSession`, `AccessLensCourseMedia`, or
  `AccessLensOrbExplain` redeploy and their endpoint URLs rotate again (as
  happened once already per T-49), `.env.local` and `vite.config.ts`'s `/ai`
  proxy will go stale the same way — there is no automation syncing local dev
  config the way the post-deploy extension build auto-injects `ApiUrl`/
  `GoogleClientId` (RL-092/RL-094). See new thread T-52 in
  `docs/CONTEXT_RELAY.md`.
- Install `soffice` (LibreOffice) locally if the PPTX-upload authoring path
  needs to be demoed or tested from this machine; otherwise that one test
  failure can be ignored for the live-session demo.
