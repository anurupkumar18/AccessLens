# AccessLens context relay

**Purpose:** one file an incoming contributor — human or agent — reads to pick up
this project mid-flight, and appends to on the way out. It exists so that context
travels between sessions and between people, and so that nothing quietly falls
through the gap at the end of the hackathon.

**State as of:** `a881f11` (Part 5 pack merged), September 15, 2026.

This file is **append-mostly**. The tables are living state and get edited in
place; the relay log at the bottom is append-only. Never delete a log entry, and
never close a thread without putting evidence in the row.

`python3 scripts/relay_check.py` validates the structure of this file and runs
inside `make check`, so a malformed table or an unowned thread fails CI rather
than surviving to the demo.

---

## 1. If you are an agent starting a session, read this first

Read in this order. `AGENTS.md` is still the authority on how to work; this file
tells you where the work currently *is*.

1. `AGENTS.md` — working agreement, product invariants, source-of-truth order.
2. **This file** — current state, open threads, decisions already made.
3. `docs/PROJECT_CHARTER.md` — invariants A1–A11. Non-negotiable.
4. `docs/IMPLEMENTATION_PLAN.md` — phases and A-task IDs. Cite one in every change.
5. `docs/PARALLEL_WORKSTREAMS.md` — who owns which directories.
6. `memory/INDEX.md`, then the latest record in `memory/episodic/`.

Then verify the state yourself rather than trusting this file's prose:

```sh
make check                      # memory, pack validator, contract conformance, tests
npm ci && npm test              # Part 1's extension tests
git log --oneline -15 origin/accesslens-extension-ar-pivot
gh pr list --repo anurupkumar18/Mind-Machine --state open
python3 packages/access-packs/bio-cell-demo/tools/simulate_events.py --list
```

Three rules that save the most time here:

- **Do not re-litigate section 4.** Those decisions are made. If you think one is
  wrong, open a thread in section 3 rather than quietly building against it.
- **Do not treat section 5 as requirements.** Most of this repository's history
  is a different product.
- **Stay inside your part's directories** (`docs/PARALLEL_WORKSTREAMS.md`). If you
  need something from another part's territory, open a thread; do not edit it.

---

## 2. Where each part stands

The AccessLens integration has now been merged to `master`; subsequent feature
work is being made directly on `master` by explicit product-owner direction.

| Part | Owner | Branch | State | Proof |
| --- | --- | --- | --- | --- |
| 1. Foundation and contracts | Anurup Kumar | merged as `38542ad` | Shell split, per-type discriminated-union event contract, `RoleCapabilitySchema`, frozen `SessionClient` (create/join/send/subscribe/close), local-only preferences, `.env.example`, ajv + typecheck in `npm run check`. AL-010 reading controls, AL-040's non-live reviewed-pack Review route, AL-041's reviewed-bounds focus pointer, AL-042's disabled/no-network Bedrock gateway seam, AL-043's explicit private Review progress, AL-044's keyboard-equivalent Review formats, AL-045's disabled course-material-provider seam, AL-046's local camera consent lifecycle, AL-047's automated accessibility coverage for those three surfaces, AL-048's caption.appended payload, AL-049's caption instructor input/student display, AL-050's server-side caption shape validation, AL-051's honest session-end-on-unmount fix, and AL-052's high-contrast fix are IN REVIEW. AL-041 uses the existing optional event field without a transport/schema change; AL-042 cannot invoke a model; AL-043 is not assessment data; AL-044 retains no keyboard data; AL-045 cannot access Canvas or course content; AL-046 cannot recognise or relay camera content; AL-047 is test-only; AL-048 is a contract-only change; AL-049 wires it into the UI, unit-tested, real-device QA open. Closed T-02, T-03, T-04, T-16. T-21's additive lifecycle correction is in review. Anurup's signed T-29 response is recorded; T-29 still awaits the other four contributors. | `npm run check`; `dist/` loads unpacked; `docs/TEAM_ALIGNMENT_CHECK.md`; `memory/episodic/0065-caption-appended-payload.md` |
| 2. Instructor capture | Jacob | merged as `2e82db8` | A3 explicit capture, A4 matcher on Part 5's `dhash12` contract (byte-identical to the reviewed pack, thresholds read from `pack.matching`), A5 correction control with sticky anchor. Pack schema widened additively so the reviewed pack loads (T-05, closed). `BroadcastSessionClient` for same-machine testing. `scripts/build-pack.ts` drafts a pack from a `.pptx` with Sonnet 4.6 descriptions (A3 drafts, not reviewed). Brought Part 3's student experience in with it. | `make check`; `docs/PART2_HANDOFF.md`; `memory/episodic/0041-part2-instructor-capture.md` |
| 3. Student experience and AR | Prachi | merged as `7a199c0` | Student modes, direct Three.js/WebXR AR, semantic fallback, and local preferences are implemented. Follow-up adds a Dyslexic-friendly mode and hardens capture gesture handling for tab/window/screen sharing. | `npm run typecheck`; targeted Vitest checks; `docs/NEXT_STEPS.md` |
| 4. AWS live service | Omar Rizwan | `workstream/4-aws-live` | **Built and deployed.** 2026-09-16 (`integ/ui-api`, Jacob): one IVS Real-Time stage per session, publish/subscribe tokens beside the capabilities, `stream.started`/`stream.stopped` on the contract, stage deleted on close and by a DynamoDB-stream sweeper on TTL expiry; proven live by `scripts/probe-video.mjs`. `services/live-session/` (server-side rules, HMAC role capabilities, DynamoDB state with TTL enforced on read, WebSocket handler, redacted logging, real `SessionClient`) and `infra/` (CDK: WebSocket API, Lambda, two tables, log group, generated secret). Live endpoint `wss://ktlrnmxq0f.execute-api.us-east-1.amazonaws.com/demo`. 49 unit tests, including per-event validator parity with Part 5's Python reference. Closed T-15, T-19; T-22 now enforced server-side. | `make live-session-check`; `node services/live-session/scripts/integration-test.mjs <url>` — 12/12 against real AWS |
| 5. Content, camera, and demo QA | Kunj Rathod | merged as `a881f11`, `82a1ef6`, `1b5ff73` | Reviewed pack, AR model, six event scenarios, ten rejection fixtures, E2E fixture replay against Part 1's real client, content review sheet for A15, runbook-versus-pack checks, and the relay gate itself. Camera adapter still deliberately not started (T-10). | `make pack-check`; `make check` |
| 6. Authoring pipeline and visualization | Jacob / Codex (AL-056/057/058) | `workstream/6-authoring` / `codex/course-library-assistant` / `codex/student-course-experience` / `codex/class-library-deletion-jobs` | API spine live: upload → ingest → deck analyst → per-slide description + Polly audio → review → publish, proven end to end on AWS (job `9ec32fb5`, execution `SUCCEEDED`, pack `hnsw-explainer` v1/v2 on CloudFront, 8 assets, 27 regions, 27 audio files, student view renders it). Visualization stages (5–8) implemented and evaluated but not deployed; catalog admission gated on D6. AL-056 adds an approval-gated PDF class-assistant slice; AL-057 adds its separate signed-in student client, cited answers, and local-only task list; AL-058 makes profile deletion archive-first with durable purge status. The stacked corrections make invite redemption atomic, reject writes to archived classes, and complete metadata purges on retry; the feature flag stays off by default and does not authorize real course data. | `docs/DEPLOY.md` §5, `docs/VIZ_DECISIONS.md` D1–D10, `docs/VIZ_HANDOFF.md`, `docs/work/tickets/al-056-approval-gated-course-library-and-cited-class-assistant.md`, `docs/work/tickets/al-057-student-class-library-experience.md`, `docs/work/tickets/al-058-durable-class-library-deletion-jobs.md`, RL-060, RL-068, RL-069, RL-070, RL-071 |

**The largest risk moved again, and it is no longer Part 4.** Parts 1, 2, 3, and
5 are on the integration branch, and Part 4 now is too: the relay is built,
deployed, and verified against real AWS, so the thing that turns this from "one
browser profile, `BroadcastChannel`" into an actual multi-device demo exists.
**What has not happened is the two meeting.** Nothing in the extension points at
the deployed endpoint yet — `WebSocketSessionClient` is written and tested but
not wired in, and `VITE_ACCESSLENS_WS_URL` is still unset. That integration, and
a rehearsal across two real devices, is now the top risk (T-25). The other new risk is process, not code: three independent
ID collisions (two episodic `0040`/`0041` filenames, one `T-20` thread ID) were
found and fixed only because someone merging noticed — see T-17/T-18, still
open.

---

## 3. Open threads

Every loose end lives here. `scripts/relay_check.py` enforces that each row has a
valid status, that nothing is `CLOSED` or `ACCEPTED` without evidence, and that
`UNOWNED` is used honestly rather than a name being invented.

Status vocabulary: `UNOWNED`, `OPEN`, `IN PROGRESS`, `BLOCKED`, `CLOSED`,
`ACCEPTED` (a deliberate decision not to do it).

| ID | Thread | Owner | Blocks | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| T-01 | **Parts 3 and 4** have no owner. Part 2 was taken by Jacob in `0771bce`. Part 3 is on the critical path to the demo — it is the student experience and the required AR renderer — and Part 4 is the transport everything runs over. The contract freeze cannot complete without both. | UNOWNED | Everything downstream of the shell | UNOWNED | Ownership board in `docs/PARALLEL_WORKSTREAMS.md` |
| T-02 | `assetId` is `required` on every `LiveEvent`, so `source.unmatched` cannot be expressed. Violates charter A9 and breaks the runbook's 2:00–2:30 beat. | Part 1 | — | CLOSED | `c3ddc27` made `LiveEventSchema` a per-type discriminated union; `source.unmatched` is now structurally unable to name an asset |
| T-03 | `live-event.schema.json` omitted `regionId` and `pointer` that the Zod schema accepts, so Part 1's own fixture failed Part 1's own JSON Schema. | Part 1 | — | CLOSED | `c3ddc27` mirrors the Zod matrix in the JSON Schema, with ajv tests |
| T-04 | The event contract had no `arState`, but AR is a required renderer (A10, A12). | Part 1 + Part 3 | — | CLOSED | `c3ddc27` adds `arState {hotspotId, action}` to `region.changed`. Part 5 dropped the `camera` field it had wanted — it is derivable from the hotspot in the pack |
| T-05 | `access-pack.schema.json` now sets `additionalProperties: false` on the **asset** object too, which makes `arScene` illegal. AR is a required renderer and `SYSTEM_DESIGN.md` §6's own pack example contains `arScene`, so the pack cannot carry the scene the MVP requires. Also blocks `mediaUri`, `subtitle`, region `label`, and the four root blocks. | Part 1 | Part 3, Part 5 | CLOSED | PR #8 merged; `AccessPackSchema` and `access-pack.schema.json` both widened additively (`arScene`, `mediaUri`, `subtitle`, region `label`, `review`, `matching`, `arCameras`, `reservedReadingOrderIds`). `check_contract_conformance.py` on the integration branch reports all eight of these gaps CLOSED; only two documented, intentional gaps remain (caption payload, forbidden-assetId negative fixtures). |
| T-06 | `hotspotId` is scoped per asset (`cell-slide-03:mitochondrion`) because one region appears on several slides. Needs acknowledging in the shared contract, which cannot express it until T-05 lets the pack carry `arScene`. | Part 1 + Part 3 | Part 3 | BLOCKED | Blocked on T-05 |
| T-07 | CI does not run on the integration branch. `.github/workflows/check.yml` pushes only on `[main, master]`, and no check has run on PR #4 or #5 either. The branch the whole hackathon lives on is unwatched. Manually verified green at `0771bce` (RL-013), so the risk has not bitten yet — but that was a person choosing to look, which is not a process. PR #5 fixes the trigger. | UNOWNED | Everyone | UNOWNED | `gh pr checks 4` reports no checks; RL-013 |
| T-08 | `c3ddc27` wired `npm run check` into `make check`, but `.github/workflows/check.yml` still has no `setup-node` and no `npm ci`. `make check` therefore **fails** in CI: `sh: vitest: command not found`. Worse than before — the shared check is now broken rather than merely incomplete. | Part 5 | Everyone | CLOSED | PR #5 added `setup-node` + `npm ci`; PR #8's `node-version: "22"` pin fixed the follow-on jsdom/undici failure. Confirmed with an actual green CI run against the integration branch head after the merge: run `35039069067`, `conclusion: success`. |
| T-09 | A15: no external biology instructor or accessibility professional has reviewed the pack, so it must not be described as expert-reviewed or accessibility-audited. The Part 5 side is now unblocked — `review/content-review-sheet.html` draws every region on its slide beside the exact words a student gets, so there is something to review. **What remains needs a person: finding the two reviewers.** | Part 5 | Demo claims, charter A11 | OPEN | `packages/access-packs/bio-cell-demo/review/content-review-sheet.html` |
| T-10 | A17 camera adapter not started. Phase 6 by plan; must not delay or destabilise the screen-sharing demo. | Part 5 | Nothing | ACCEPTED | `docs/IMPLEMENTATION_PLAN.md` §3 Phase 6 |
| T-11 | End-to-end suite. First slice landed now that `SessionClient` is frozen: `tests/e2e/fixture-replay.test.ts` covers fixture replay, reconnect idempotence, and session close. The rest — failure paths through a real UI, axe, screen-reader, rehearsals — still needs the student renderers. | Part 5 | Demo readiness | IN PROGRESS | `tests/e2e/fixture-replay.test.ts`, 7 tests |
| T-12 | `codex/live-workspace-foundation` is 3 commits ahead and 64 behind, last touched 2026-08-28, from the superseded Evidence Engine product. Salvage or delete before the repo is handed over. | UNOWNED | Nothing | UNOWNED | `git log origin/codex/live-workspace-foundation` |
| T-13 | Nobody owns merging `accesslens-extension-ar-pivot` into `master`, and no moment is defined for it. The build rule forbids merging to `master` during the hackathon, so this must happen deliberately at the end. | UNOWNED | Final handover | UNOWNED | `docs/PARALLEL_WORKSTREAMS.md`, merge and branch rules |
| T-16 | `caption.appended` was base-only in the discriminated union, so a caption event could not carry a caption or name its asset. Stretch scope, so it blocked nothing, but the type existed in the enum without a payload. | Part 1 | Captions (stretch) | CLOSED | Closed 2026-09-16 in the conformance doc's suggested shape: `caption: {text, isFinal}` (text <= 500) plus optional `assetId`, in Zod, the JSON schema, the Python reference, and the relay, sharing the same `caption-*` rule names, with `fixtures/invalid/caption-with-audio-payload.json` and `fixtures/invalid/oversized-caption.json`; `check_contract_conformance.py` reports zero gaps; `docs/PART5_CONTRACT_CONFORMANCE.md` §3 marked Closed; the captions scenario validates end to end (`tests/e2e/fixture-replay.test.ts`, `KNOWN_REJECTED` empty); `memory/episodic/0065-caption-appended-payload.md`. UI wiring (AL-049: instructor input, student display) and server-side shape validation (AL-050) are also landed. |
| T-17 | Episodic record numbers collide across parallel branches. It has happened **twice in one afternoon** with only two active workstreams: Part 5's records were renumbered `0038→0040` and `0039→0041`. Proposal: allocate a hundred-block per part (Part 1 → `01xx`, Part 5 → `05xx`), which needs no tooling change. | UNOWNED | Nothing | UNOWNED | `0038-part1-hardening.md` and `0039-part1-contract-gaps.md` vs the twice-renamed Part 5 records |
| T-18 | `memory/INDEX.md` has a single "current handoff" pointer that `memory_check.py` requires to name the newest record, so every parallel branch conflicts on that one line. It has now bitten **five times**, and `19770f6` is a teammate hitting it independently and fixing it by hand. The proposal stands: make the pointer a list, one line per part, and have `memory_check.py` require each part's newest record rather than one global newest. | UNOWNED | Nothing | UNOWNED | `19770f6` plus four conflicts across PRs #4, #5, #7, and #9 |
| T-19 | Schema validation cannot detect a stale `packVersion`: Zod types it as any positive integer, so a mismatched version passes cleanly. `SYSTEM_DESIGN.md` §9 requires rendering to stop and refetch when the pack version differs, so someone must hold the session's expected version and compare. If the relay does not, every student renderer must, separately. | Part 4 | Part 3, Part 4 | CLOSED | The session records `packId` and `packVersion` at create time and every event is compared against them; a mismatch is refused as `pack-version-mismatch`. Part 3 does not need to hold the version itself |
| T-20 | Merging PR #5 resolved a `Makefile` conflict by taking the other side, silently dropping `relay-check` from `check` and removing `freeze-check` entirely. Both scripts stayed in the tree, so nothing looked broken — the relay gate simply stopped running. Restored, and `tests/relay/` now asserts the wiring. Worth a habit: after resolving a `Makefile` or workflow conflict, diff the target list, not just the file. | Part 5 | Everyone | CLOSED | Restored in PR #7; `WiredIntoTheBuild` in `tests/relay/test_relay_check.py` |
| T-23 | CDK was not bootstrapped in the hackathon AWS account, so no `cdk deploy` would have worked. | Part 5 | — | CLOSED | Bootstrapped 2026-09-15: `CDKToolkit` version 32, staging bucket `cdk-hnb659fds-assets-087328706621-us-east-1`. `deploy_preflight.py --aws` now reports it ready |
| T-24 | This file is itself a conflict magnet. Every part is asked to append a log entry and edit the same tables, so parallel branches collide in section 8 — PR #8 conflicts on exactly `CONTEXT_RELAY.md` and `memory/INDEX.md` and nothing else. Same structural problem as T-18, caused by the fix for it. Proposal: split the relay log into one file per entry under `docs/relay/NNN-*.md` (the pattern `memory/episodic/` already uses successfully) and have `relay_check.py` assemble and validate them, leaving only the tables shared. | Part 5 | Everyone appending | OPEN | PR #8's conflict set; this file's own growth; renumbered from a collision with T-21/T-22 during PR #9's merge, proving the point a third time |
| T-25 | **The relay is deployed and the extension does not use it.** `WebSocketSessionClient` implements Part 1's frozen interface and is tested, but nothing constructs it: the extension still runs on `BroadcastChannel`, which is one browser profile on one machine. `VITE_ACCESSLENS_WS_URL` is unset. Until someone swaps the transport at its construction site and rehearses across two real devices, "multi-device demo" is an untested claim — and the swap is the cheap part, while discovering a problem during the rehearsal is not. | Part 1 + Part 3 | The demo | IN PROGRESS | `apps/extension/src/shell/createDefaultClient.ts` swaps the transport when `VITE_ACCESSLENS_WS_URL` is set; verified with the real deployed endpoint from two real browser tabs (instructor `create()` succeeded, student `join()` correctly rejected a bogus code) and Part 4's own `integration-test.mjs` (12/12). What has *not* happened is the rehearsal across two real devices with real `getDisplayMedia()` permission -- no sandboxed tool can grant that. |
| T-26 | The deployed endpoint has no authorizer on `$connect`: anyone who can reach the URL can create a session, and the session id is the only secret. Acceptable for a reviewed demo pack with no student data, and stated in `services/live-session/README.md`, but it must not be described as secure, and it is not a shape to carry into anything holding real course content. | Part 4 | Claims made about the demo | ACCEPTED | Deliberate scope call for the hackathon; `services/live-session/README.md` "What is not built" |
| T-27 | `.github/workflows/check.yml` ran `npm ci` at the repo root only. `services/live-session` is its own package with its own lockfile (Part 4's `live-session-check` Makefile target says so explicitly), so CI has failed on every push since Part 4 merged (`0fba221` onward) with `Cannot find module '@aws-sdk/client-dynamodb'` -- the same shape of gap as T-08, in a new directory nobody updated the workflow for. | Part 1 | Everyone | CLOSED | Added `npm ci --prefix services/live-session` to the workflow; reproduced the failure locally first (`rm -rf services/live-session/node_modules && make check`), confirmed the fix the same way |
| T-28 | `StudentExperience.tsx` marked the view "stale" after 15 seconds with no new event -- a content-silence guess standing in for a connection check. An instructor explaining one region for more than 15 seconds (normal pacing) produced a false "Connection interrupted," which is exactly what the team hit live-testing the real extension against the real relay. | Part 1 + Part 3 + Part 4 | Trust in the demo's own status indicator | CLOSED | `WebSocketSessionClient.onConnectionChange` (real socket open/close, additive to the frozen interface) threaded through `liveRelayClient.ts` to `StudentExperience.tsx`, replacing the timer. `markLiveStateReconnected` added as the stale->live counterpart. +9 tests across the four files (`services/live-session` 52 total, extension 259 total) |
| T-29 | Two internal critiques of this project (a harsh criterion-by-criterion scorecard, and a proposed scope-narrowing revision responding to it) existed only on one person's machine, uncommitted, since 2026-09-15, and were never seen by any of the other four contributors. Nobody can be aligned on a decision they have never seen. Compounding it: the scorecard is now 24h stale against what's actually built, and needs updating with real external research before anyone acts on it. | All five parts | Tomorrow's in-person product-direction meeting | OPEN | `docs/TEAM_ALIGNMENT_CHECK.md` is now a non-blocking meeting agenda. Anurup has responded; Jacob, Kunj, Omar, and Prachi are invited to respond before or during the meeting. Scoped implementation against the current extension-first MVP may continue. AL-056's decision records an approval-ready synthetic/public-content implementation only; AL-057 adds only its student client; AL-058 adds only an archive-first durable purge implementation. None closes this thread or approves real course data. |
| T-30 | The agent-first delivery system is additive: ticket files, claims, immutable updates, generated context, and validation must not become a second mutable product or risk register. Its initial portfolio intentionally keeps current-MVP proof P0 and durable identity/content work deferred behind human decisions. | Part 1 | Agent handoffs and release evidence | OPEN | `docs/AGENT_OPERATING_CONTEXT.md`; `docs/work/`; `make work-board-check`; AL-090 is in review |
| T-33 | A malformed event received from the live relay was schema-dropped without any diagnostic, leaving the student marked `live` even though the next update was not trustworthy. Local QA now exposes only a payload-free invalid-event signal and freezes the last reviewed state as `stale`; the signal must not expose raw payloads or reset to live on socket recovery alone. | Part 1 | T-21 live-status trust and AL-004 false-live evidence | IN PROGRESS | `2d04fad`; `liveRelayClient.test.ts`; `StudentExperience.test.tsx`; `liveState.test.ts` |
| T-34 | Chrome capture may reject window or display sharing if `getDisplayMedia()` begins only after awaited session creation consumes the Start click's transient user activation. The controller now starts the explicit browser chooser first and has an order regression test; the physical Windows tab/window/display matrix is still required. AL-053 (integrated from `ui/blacksmith-revamp`) separately fixed a second window/display bug: the fingerprint matcher only ever recognized tab shares, since a window or screen frame's toolbar/menu bar/other windows pushed the whole-frame fingerprint past threshold. Both fixes are local-only; the physical Windows matrix is still required for either. | Part 2 + QA | AL-001 capture matrix and real-device demo proof | IN PROGRESS | `apps/extension/src/instructor/captureController.ts`; `captureController.test.ts`; `apps/extension/src/sources/screen/locate.ts` |
| T-39 | **Remote audio needs a second human reviewer.** Instructor live captions stream microphone audio to Amazon Transcribe (charter A2 exception, off by default, consent text at the control). The charter's human review gate requires a second reviewer for remote media before merge. | Omar Rizwan | Merging `integ/ui-api`'s authoring pipeline (`docs/INTEGRATION_SWOT_20260916.md` §2) | OPEN | `docs/work/decisions/2026-09-16-transcribe-live-captions.md`; `services/ai-gateway/README.md` |
| T-40 | **AI routes are built but not deployed.** `services/ai-gateway` (Bedrock Ask, Polly speech, Transcribe caption URLs) is in the CDK stack and passes its tests with fakes, but the hackathon credentials had expired, so nothing has been called against real AWS and `VITE_ACCESSLENS_AI_URL` is unset. | Omar Rizwan | Captions, Ask, Polly in the demo | CLOSED | Deployed 2026-09-16 (`AccessLensLiveSession.AiApiUrl`); `smoke-test.ts` all checks passed against the deployed routes (Ask answered with citation in 3.3 s, off-topic and injection declined, Polly mp3, Transcribe returned the spoken words); relay `integration-test.mjs` passed; deployed relay accepts text captions and rejects `caption-invalid` |
| T-41 | **Browser sign-in needs the OAuth client id.** D12 replaced the shared bearer token with Google ID tokens (API Gateway JWT authorizer); the API accepts the Google Cloud SDK's client as a second audience, so scripts and `make smoke` work with `gcloud auth print-identity-token`, but the panel's Sign in with Google button needs the deployment's own OAuth web client id, which only the Google Cloud account owner can create. | Jacob | Any instructor using the upload panel in a browser | OPEN | Create the client (origins `http://localhost:5173` + viewer URL; redirect `https://<extension-id>.chromiumapp.org/`), set `GOOGLE_CLIENT_ID`, `make deploy`, then sign in from the panel |
| T-46 | **Prepare media sends instructor-uploaded files to AWS.** An instructor's own `.png`/`.jpg`/`.pptx` pictures (downscaled JPEG) and `.mp3`/`.mp4` audio (16 kHz mono pcm, ~55 s per call) go to `services/media-access` to draft alt text and captions. Charter language that raw media stays on the source device was written for live capture; whether an explicit instructor upload is covered, amended like `docs/ORB_CHARTER_AMENDMENT.md`, or needs a different boundary is a team decision. Also: like every other Function URL here it has no auth, and this one accepts multi-MB bodies, so exposure is Bedrock and Transcribe spend. | Kunj Rathod | Claims about what leaves the device; deploying MediaAccess | OPEN | `services/media-access/src/handler.ts` stores and logs no content (asserted by `never logs media content`); `infra/lib/accessibility-services-stack.ts` `MediaAccess` spec; not deployed |
| T-47 | **Continuous deploy has never deployed.** Every Deploy run (after PR #14 and PR #19) stopped at "Check the deploy role is configured": `AWS_DEPLOY_ROLE_ARN` is unset, and only a repository admin can set it. The workflow also had three bugs that would have failed the first real run: it built only two of six Lambda bundles (accessibility stack synth fails), ran `cdk deploy` from the repo root where there is no `cdk.json`, and never passed the captions, recap, translate or media endpoints into the extension build. A fourth P1 is now corrected: the service loop must skip `services/api/`, which has no package lock and is bundled from the root workspace. A fifth P1 is corrected: the deploy role accepts GitHub's repository-ID OIDC subject template as well as its legacy form, both fixed to this repository. | Anurup Kumar | Every deploy; the live demo endpoints | OPEN | Runs `35153428621`, `35157214783`, `35168319104`; `codex/fix-deploy-service-loop`; `codex/fix-deploy-oidc-subject`; workflow fixes and the admin runbook in `docs/DEPLOYMENT.md` "One-time setup: GitHub deploy role" |
| T-48 | **Hosted shell at `/app/` is behind the deployed relay.** `AccessLensLiveSession` (deployed 2026-09-16 from `integ/ui-api`) now returns `streamToken` on every capability; the hosted shell built before that parses capabilities with the strict `RoleCapabilitySchema`, so its create/join reject until `bash infra/scripts/deploy.sh` republishes the shell from a tree that carries `f50ce29` or later. Rolling the relay back is the other way out. Shell redeployed 2026-09-16 from `lane/window-stream`. | Jacob | Live demo from the hosted shell | CLOSED | `bash infra/scripts/deploy.sh` from `lane/window-stream` → `/app/assets/index-Co7Ueiio.js` carries `streamToken`, "Stream this window", "Instructor's live slide video" and the relay URL; `AccessLensLiveSession` redeployed with no changes; probe-video shows publish/subscribe tokens and stage deleted on close |
| T-49 | **A deploy from another checkout overwrote `AccessLensLiveSession`.** At 22:55 UTC on 2026-09-16 the stack was deployed from a tree without `f50ce29` (the plain `Mind-Machine` checkout on `workstream/6-authoring`): the relay lost its pack resolver (every non-bundled pack got `pack-id-mismatch`, students saw no slide changes), the IVS stage lifecycle and sweeper, and the AI handler and API were deleted. Redeployed from `lane/window-stream`; the AI API came back under a new URL (`https://5skua1vus7.execute-api.us-east-1.amazonaws.com`), so the hosted shell and `.env.local` were updated. Rule: only the lane that owns the live-session code deploys that stack, and the CDK app should refuse to deploy it from a bundle without the resolver. | Jacob | Any live demo | OPEN | Stack events show `AiHandler`, `StageSweeper` and IVS policies `DELETE_COMPLETE` at 22:55; relay logs show `pack-id-mismatch` for `introduction-to-hnsw` 23:03–23:05; probe-video green after the redeploy |
| T-50 | **No warning when a student's network stalls silently.** If Wi-Fi drops without closing the socket, the student's pill stays "live" while nothing arrives (live bench R01/R02). Detecting it needs a relay-answered heartbeat, which means adding a message kind to the frozen `SessionMessageSchema` and redeploying the relay. T-28 removed the content-silence timer because it raised false alarms, so a timer is not the fix. | Omar Rizwan | A trustworthy "live" pill on flaky classroom Wi-Fi | OPEN | `docs/qa/live-bench-results.md` BUG-1; `services/live-session/src/client/webSocketSessionClient.ts` |
| T-51 | **Course materials publish generated alt text and captions with no instructor review.** Product decision by Kunj Rathod on 2026-09-16: professors upload and students see the result automatically. This departs from charter A3 (instructor review before publication) for uploaded course materials, and it stores uploads and derived files in S3 for 90 days, where the charter's raw-media rule was written for live capture. Decided 2026-09-17 by Anurup Kumar: ship as-is for the demo (option 1 of 3 considered). Do not claim blanket "nothing is ever invented" coverage when discussing this pathway; the existing disclosure ("generated automatically and can contain mistakes") is the accepted mitigation for now, not a placeholder for a future review gate. The charter-wording question is still open for the team meeting. | Kunj Rathod | Charter wording; demo claims about review | ACCEPTED | `services/course-media/src/descriptions.ts` header; `apps/extension/src/courseMedia/MaterialViewer.tsx` notice; RL-083; decision recorded 2026-09-17 in this session's episodic record |
| T-14 | `dist/` build output is committed and is not in `.gitignore`. Decide whether that is intentional (it makes the unpacked extension loadable without a build) or should be removed. | Part 1 | Nothing | OPEN | `git ls-files dist` |
| T-22 | Nothing stops a student from picking the instructor role. The shell's role switch is a plain toggle and `SessionClient.create` takes no credential, so anyone with the extension can start a session and broadcast events. **The relay half is now built:** every event type is instructor-only, roles come from an HMAC-signed capability the relay issues, and a student publishing is refused as `role-not-permitted-to-publish` — proven against the deployed endpoint. So a student cannot broadcast *through AWS*. What remains is client-side and still open: the shell toggle, and the fact that anyone who can reach the endpoint can still `create` a session, because there is no authorizer on `$connect` and the session id is the only secret. | Part 2 + Part 4 | Demo integrity | OPEN | `services/live-session/test/relay.test.ts` 'refuses a student publisher'; integration run. Shell side: `apps/extension/src/shell/App.tsx` role switch |
| T-21 | The event enum had no `capture.stopped`, so Part 2's Stop emitted `session.ended` and then reused the same session on the next Start. Students saw "session ended" for what was really stopped sharing. | Part 1 + Part 2 | Part 3 wording, Part 4 session lifecycle | IN PROGRESS | AL-003 adds base-only `capture.stopped`; controller, student state, relay lifecycle/latest-state, schemas, simulator, and parity tests pass locally. **The second shared-contract review is now done** (`docs/work/updates/AL-003-CHECKPOINT-20260916-0652.md`): stop-retains-session and restart-resumes-session are confirmed, base-only is confirmed against media/identity/preference but **not** enforced relay-side for asset/region (T-31). The existing endpoint was independently re-probed and still rejects `capture.stopped` as `event-type-not-allowlisted`. `2d04fad` separately prevents an invalid inbound lifecycle event from silently leaving a student marked live (T-33, closed). Deployed-relay update and T-31/T-32 remain before closure. |
| T-31 | `capture.stopped` is base-only in `LiveEventSchema` and `live-event.schema.json`, but neither `services/live-session/src/rules.ts` nor `reference_event_check.py` enforces that server-side. A `capture.stopped` carrying a real `assetId` and `regionId` is accepted and stored as the session's latest state, while the identical fields on `source.unmatched` are refused as `unmatched-event-names-content:*`. The media/identity/preference half is safe — `frameData`, `studentId`, and `preferences` all bounce off the `KNOWN_FIELDS` allowlist — so this is client-trust hardening, not a demo-blocking defect: the shipped controller's `Emittable` type cannot express it. But `rules.ts`'s own docstring states the principle it misses here, and charter A9 earned the guard for the sibling type. Fixing it is additive in two files plus a parity fixture. Same shape of gap AL-050 closed for `caption`'s field *contents* this session — this one is about `assetId`/`regionId` *pack membership* on `capture.stopped` specifically. | Part 4 + Part 5 | AL-003 deployment claim | OPEN | Verified by running `reference_event_check.check_event` directly; `docs/work/updates/AL-003-CHECKPOINT-20260916-0652.md` |
| T-32 | `Relay.resume()` and the `$connect` route that reaches it have **no test anywhere** — there is no `handler.test.ts`, and `relay.test.ts` never calls `resume`. This is not a dormant path: `WebSocketSessionClient` reconnects by presenting its stored capability as `$connect?sessionId=…&capability=…`, so every real network blip in the demo goes through untested code, and `resume` is also the only way a fresh connection can recover an **instructor** role. AL-004's bench does not cover it either — its "rejoining student" is a brand-new anonymous `join`, which is the other branch. AL-055 (integrated from `ui/blacksmith-revamp`) works around the specific symptom client-side — a reconnecting student now sends a fresh `join` rather than trusting `resume`'s catch-up, which the deployed relay posts during `$connect` before API Gateway can deliver it — but `resume` itself, and instructor-role reconnect recovery, remain untested. | Part 4 | Reconnect claims, AL-004 evidence | OPEN | `services/live-session/test/` has no handler test; `grep -rn '\.resume(' services/live-session/test` is empty; `webSocketSessionClient.ts` builds the capability query string |
| T-15 | `sequence` is `nonnegative()` in Zod and unconstrained in the JSON Schema, so 0 is legal. Part 5's simulator starts at 1. Pin the first sequence number before Part 4 builds ordering logic. | Part 1 + Part 4 | Part 4 | CLOSED | Pinned to 1 by the relay, matching Part 5's reference: `sequence: 0` is refused as `sequence-not-a-positive-integer` (`services/live-session/src/rules.ts`, asserted by the parity test). The shared Zod contract still permits 0, so a client can construct one — the relay is what refuses it |
| T-42 | Part 6 needs two additive fields on the Access Pack asset (`visualization`, `references[]`) and one on the region (`audioUri`), plus a new `ArtifactManifest` contract, in `apps/extension/src/shared/contracts.ts` and `packages/contracts/`. Part 1 owns those files. Additive and optional only; `arScene` untouched; `LiveEvent` unchanged. | Part 1 + Part 6 | Part 6 V0/R0 and everything downstream | OPEN | `docs/VISUALIZATION_SYSTEM.md` §5, §9.5, §4 |
| T-43 | Part 6 needs `apps/extension/src/shared/packMedia.ts` to resolve `mediaUri` and `audioUri` through a published-pack loader when a pack was published by the authoring pipeline, keeping the bundled path for checked-in packs. Part 3 owns that file. | Part 3 + Part 6 | Part 6 V6 | OPEN | `docs/VISUALIZATION_SYSTEM.md` §12 |
| T-44 | Part 6 needs `apps/extension/src/student/StudentExperience.tsx` to gain a Visualize tab and a "From your course materials" references list in Read mode. Part 3 owns that file. | Part 3 + Part 6 | Part 6 V9, R4 | OPEN | `docs/VISUALIZATION_SYSTEM.md` §12, §9.5 |
| T-45 | Part 6 needs an instructor authoring entry point in `apps/extension/src/shell/App.tsx` and `RoleNav.tsx`. Part 1 owns those files. | Part 1 + Part 6 | Part 6 V5 | OPEN | `docs/VISUALIZATION_SYSTEM.md` §11 |
| T-35 | Part 6 creates `infra/` because Part 4 (AWS live relay) is unowned. The CDK stack `AccessLensAuthoring` is the authoring plane only; the live relay is not built here. If Part 4 is claimed, the stack is shared and the split is negotiated here. | Part 6 | Part 4 | CLOSED | Resolved 2026-09-16: one CDK app (`infra/bin/accesslens.ts`) with two stacks, `AccessLensLiveSession` (Part 4) and `AccessLensAuthoring` (Part 6); `make deploy`/`make destroy` name the authoring stack only. |
| T-36 | Part 6's `references[].quote` cap (300 characters, charter-adjacent: a student is never shown more of a professor's textbook than a citation needs) is expressed as `maxLength` in `access-pack.schema.json`, a keyword Part 5's `check_contract_conformance.py` did not implement. Its unsupported-keyword guard did its job and stopped rather than passing quietly. The checker now implements `maxLength`, with mutation tests in `tests/access_pack/test_conformance_maxlength.py`. | Part 5 + Part 6 | Nothing | CLOSED | `packages/access-packs/bio-cell-demo/tools/check_contract_conformance.py`; `tests/access_pack/test_conformance_maxlength.py` (8 tests, mutation plus control); checker exit status unchanged from baseline |
| T-37 | `docs/VISUALIZATION_SYSTEM.md` calls the slide fingerprint `dhash-v1` throughout (§3, §5, §8 stage 1), but the shared module, Part 5's reviewed pack, and Part 2's matcher all use the identifier `dhash12`. Documents beat code on this project, but implementing the document here would change the algorithm id inside a pack that has already been reviewed and would break recognition for it, so Part 6's ingest reads `FINGERPRINT_ALGORITHM` from the shared module instead of hardcoding either spelling — which is what the spec actually asks for in substance ("the fingerprint comes from the shared screen-source module so packs and the matcher cannot drift"). The spec prose is what should change. | Part 5 + Part 6 | Nothing | OPEN | `apps/extension/src/sources/screen/fingerprint.ts` (`dhash12`); `packs/hnsw/pack.draft.json`; `docs/VISUALIZATION_SYSTEM.md` §3 |
| T-38 | Two branches each wrote a relay entry numbered RL-025: `workstream/6-authoring` (Part 6 claim, this branch) and `origin/accesslens-extension-ar-pivot` (cross-cutting, which continues through RL-028 and carries the IBM Plex interface rebuild, the Part 4 relay wiring, and T-28/T-29). Neither branch has a PR open. Whichever merges second must renumber, and `relay_check.py` will refuse a duplicate id. | Part 6 + cross-cutting | The merge of either branch into the other | CLOSED | Resolved 2026-09-16 by the master merge: Part 6 renumbered to RL-036/037 and T-31..T-38. |
| T-52 | **Local dev config (`.env.local`, `vite.config.ts`'s `/ai` proxy) has no automation and goes stale every time a stack redeploys and its endpoint URL rotates** — it already happened once (T-49: AI API URL moved to `5skua1vus7...`, `.env.local` was updated then, but `vite.config.ts`'s proxy target was not, and both drifted again to the current `nxhrvn0odk...` without anyone noticing until this session). The deployed extension build has its own auto-injection for `ApiUrl`/`GoogleClientId` post-deploy (RL-092/RL-094); local dev has nothing equivalent for `VITE_ACCESSLENS_AI_URL`, `VITE_ACCESSLENS_CHAT_URL`, `VITE_ACCESSLENS_COURSE_MEDIA_ENDPOINT`, or `VITE_ACCESSLENS_ORB_ENDPOINT`. Also, the dev server itself is easy to lose track of: it was found dead mid-session, started outside any tracked config, in a terminal nobody was watching. | UNOWNED | Anyone doing local rehearsal after a stack redeploy | UNOWNED | `memory/episodic/0076-local-dev-e2e-debugging.md`; `.claude/launch.json`'s new `accesslens-dev` entry now at least makes the dev server's own logs visible |

---

## 4. Decisions in force — do not re-litigate

Each of these was decided deliberately. If you disagree, open a thread in
section 3; do not silently build against it.

| Decision | Where it was made |
| --- | --- |
| AccessLens supersedes the Evidence Engine coding product entirely. | `memory/INDEX.md`, `memory/episodic/0036` |
| AR is a **required** student renderer in the MVP, not a stretch goal, and needs an equivalent non-immersive and screen-reader route. | Charter A10, plan A12 |
| Camera input is an advanced **source adapter**, not an output mode, and no student needs a camera. | `SYSTEM_DESIGN.md` §11 |
| Capture requires an explicit user gesture and the browser's own chooser. Not a limitation to work around; it is part of the product story. | Charter A1, `SYSTEM_DESIGN.md` §4 |
| Unknown content emits `source.unmatched`. Never an invented description. | Charter A9 |
| Student preferences stay local and never become a diagnosis, grade, attention, or mastery signal. | Charter A6, A7 |
| Production Canvas integration is deferred and gated on institutional approval. | `docs/CANVAS_INTEGRATION.md` |
| Five parts, fixed directory boundaries, small PRs into the integration branch, nothing straight to `master`. | `docs/PARALLEL_WORKSTREAMS.md` |
| The reviewed pack owns the matching thresholds, so recognition tuning is reviewed content rather than a constant compiled into Part 2. | `packages/access-packs/bio-cell-demo/pack.json`, `matching` block |
| Perceptual-hash ties resolve to 0 with a 0.75-of-255 epsilon. Any reimplementation of the matcher must keep this; without it, worst-case drift on a distorted capture is ~4x larger. | `docs/IMPLEMENTATION_PLAN.md` risk register |
| **Live video of one instructor-chosen tab or window may be streamed to the session's students** when the instructor turns it on, per session, from a click; the console names the surface ("Streaming a tab" / "Streaming a window") while it is on. A whole monitor is never streamed. The video travels over Amazon IVS Real-Time (one stage per session, deleted with the session); the relay carries only stage tokens and the two `stream.*` state events, never media. This is the reviewed, visibly consented exception charter A2 requires, decided by the team on 2026-09-16; it does not widen to audio, cameras, recording, or other surfaces. | Team decision 2026-09-16; `docs/prompts/window-stream-build.md`; `services/live-session/src/stage.ts` |
| **The student extension has no spoken mode.** Hear mode, the region player and the Polly `speak` client were removed on 2026-09-16; the student's own screen reader (VoiceOver, NVDA, JAWS, ChromeVox) reads the reviewed descriptions from Focus, Read and Dyslexic. `regions[].audioUri` stays in the pack schema for the authoring pipeline but nothing in the extension plays it. | RL-046 |

---

## 5. Superseded context — present in the repo, not a requirement

The repository is older than the product. Do not mine these for requirements.

- `memory/episodic/0001` through `0035` and `memory/semantic/*` describe the
  Evidence Engine coding-practice prototype. Preserve as history.
- `memory/long-term/public-data.md` — its caution about private inputs is still
  useful; the charter is the current data contract.
- Branches `codex/live-workspace-foundation`, `claude/product-vision-scope-2uxb6j`,
  `fix/ci-pnpm-corepack-order` predate the pivot (see T-12).
- `master` is four commits behind the integration branch and still describes the
  Evidence Engine direction in places.

---

## 6. Starting your part today, with what exists

Part 5 built the fixtures specifically so Parts 2, 3, and 4 do not have to wait for
each other. None of the below needs AWS, a capture device, or another part's code.

**Part 2 — instructor capture.** The matching policy is reviewed content in
`pack.json` under `matching`; `tools/imagehash.py` is a ~30-line standard-library
reference implementation of the fingerprint. Compare what your matcher emits
against `fixtures/happy-path.json`. `demo-assets/unapproved-photosynthesis.png` is
the slide that must produce `source.unmatched`.

**Part 3 — student renderers and AR.** Drive your renderers with

```sh
python3 packages/access-packs/bio-cell-demo/tools/simulate_events.py \
  --scenario happy-path --stream
```

`models/cell.glb` has ten stable node names; every region resolves to exactly one
hotspot with a `nodeName` and a `cameraTarget` into the pack's `arCameras`. Each
fixture carries an `expectations` list saying what a correct consumer does with it.
`arState {hotspotId, action}` is on `region.changed` as of `c3ddc27`, so T-04 is
closed — but mind **T-05**: the pack schema currently forbids `arScene`, which is
what binds a region to a model node. `tests/e2e/fixture-replay.test.ts` is a
worked example of driving `InMemorySessionClient` from a fixture; copy its setup.

**Part 4 — AWS relay.** `fixtures/*.json` are ordered payloads for fixture
WebSocket clients; `fixtures/invalid/` holds ten events with exactly one fault
each, and each names the rule it breaks in `expectedRule`.
`tools/reference_event_check.py` states those rules in the standard library until
the Zod contract covers them. Read T-02, T-03, and T-15 before writing validation.

---

## 7. How to append to this file

At the end of any session that changed the project's state, do three things:

1. Update your row in section 2.
2. Update section 3: add threads you opened, move threads you closed to `CLOSED`
   **with evidence in the row**, and correct any row that is now wrong.
3. Append one entry to section 8. Copy this template exactly — the checker parses
   the `### RL-` heading and the three bold fields.

```markdown
### RL-00N — YYYY-MM-DD — Part N — Your Name

**Landed:** what is now true that was not true before, with paths or commands.
**Threads touched:** T-0X opened, T-0Y closed, T-0Z still blocked.
**Next agent needs to know:** the thing that is not obvious from the diff.
```

Keep entries short. The diff records what changed; this records what a person
would otherwise have to rediscover. If you found something non-obvious — a bug
with a surprising root cause, a decision with a real trade-off — also write a
`memory/episodic/NNNN-*.md` record and update `memory/INDEX.md`, as `AGENTS.md`
requires, and link it from your entry.

---

## 8. Relay log

Append only. Newest last.

### RL-001 — 2026-09-15 — Part 1 — Anurup Kumar

**Landed:** Manifest V3 extension shell with Instructor and Student routes,
`packages/contracts/` JSON Schemas, Zod contracts and `InMemorySessionClient` in
`apps/extension/src/shared/contracts.ts`, a built `dist/` loadable unpacked.
Tasks A1 and A2. Merged as `df80b5d`.
**Threads touched:** T-14 opened (`dist/` committed).
**Next agent needs to know:** Zod is the runtime authority; the JSON Schema files
are the interchange artifact for future service validation. Both reject unknown
fields, which turned out to matter — see RL-002.

### RL-002 — 2026-09-15 — Part 5 — Kunj Rathod

**Landed:** `packages/access-packs/bio-cell-demo/` — five original reviewed
slides, twelve regions, an original CC0 `cell.glb` with ten named organelle nodes,
six ordered event scenarios, ten single-fault rejection fixtures, provenance, and
generators. 37 standard-library tests in `tests/access_pack/`, wired into
`make check` through a new `pack-check` target. Task A14 and the content and
simulator block of Part 5. PR #4.
**Threads touched:** T-02, T-03, T-04, T-05, T-06 opened against the Part 1
contract; T-09, T-10, T-11 recorded as Part 5's own remaining scope.
**Next agent needs to know:** two things. First, the perceptual hash: neighbouring
cells inside a flat region of a slide tie exactly, so a bare `>` resolves the tie
by floating-point summation order — two implementations of the same reduction
disagreed. Ties now resolve to 0 with an epsilon, which cut worst-case drift on a
distorted capture from 38 bits to 10. Do not remove that rule. Second, the pack
and every fixture are checked against Part 1's contracts by
`tools/check_contract_conformance.py`, which pins the known gaps and fails on any
new one, so the two contract bugs cannot be forgotten. Record:
`memory/episodic/0038-bio-cell-demo-access-pack.md`.

### RL-003 — 2026-09-15 — cross-cutting — Kunj Rathod

**Landed:** this file and `scripts/relay_check.py`, wired into `make check`.
**Threads touched:** T-01, T-07, T-08, T-12, T-13, T-15 opened — all previously
unrecorded, and four of them unowned.
**Next agent needs to know:** the unowned rows are the actual hackathon risk, not
the technical threads. Three of five parts have no owner, CI does not run on the
integration branch or on PR #4, and nobody owns the final merge to `master`. Those
need a person's name against them at the next standup, not more code.

### RL-004 — 2026-09-15 — Part 1 — Anurup Kumar

**Landed:** `c3ddc27`. `LiveEventSchema` rebuilt as a per-type discriminated
union, mirrored in `live-event.schema.json` with ajv tests; `access-pack.schema.json`
now validates the full asset and region shape; local-only student preferences;
`main.tsx` split into `src/shell/{App,RoleNav,ErrorBoundary}`; `make check` wired
to run `npm run check`.
**Threads touched:** T-02, T-03, T-04 closed. T-05 widened — the new asset-level
`additionalProperties: false` makes `arScene` illegal. T-08 addressed in the
Makefile but see RL-005.
**Next agent needs to know:** the event contract is a discriminated union now, so
adding a field means adding it to the right branch of the union *and* to the
matching `allOf`/`if`/`then` entry in the JSON Schema. Both are checked.

### RL-005 — 2026-09-15 — Part 5 — Kunj Rathod

**Landed:** merged `c3ddc27` into PR #4 and brought the fixtures into line with
the new contract. Four things left the wire — `arState` on `asset.changed`,
`arState.camera`, the `source.unmatched` diagnostics, and the `redelivery`
marker — because each was either derivable from the pack or a transport fact
rather than instructional state. Event-level gaps went from 9 to 2. The
conformance checker now implements `allOf`/`if`/`then`.
**Threads touched:** T-02, T-03, T-04 confirmed closed against the fixtures.
T-05 rewritten and escalated. T-08 taken and in progress. T-16, T-17, T-18
opened.
**Next agent needs to know:** two things. `make check` is currently broken in CI
— `c3ddc27` wired `npm run check` into it but the workflow installs no Node
dependencies, so it dies on `vitest: command not found`. PR #5 fixes that. And
the conformance checker's unsupported-keyword guard is the reason this pass
found anything: when the schema became an `allOf` matrix the check *stopped*
rather than reporting that everything still conformed. Keep that guard.

### RL-006 — 2026-09-15 — Part 1 — Anurup Kumar

**Landed:** `38542ad`. A verification pass found Part 1's own contract-freeze
list had three unmet items. Adds `RoleCapabilitySchema` (the session-token
contract A2 names) with a JSON Schema mirror, expands `SessionClient` to the
frozen `create/join/send/subscribe/close` shape so Part 4 has something stable
to build against, freezes the WebSocket and asset-base-URL names in
`.env.example`, wires local-only preferences into a real Reduce-motion control,
and adds a typecheck step to `npm run check`.
**Threads touched:** none closed. `AccessPackSchema` and `LiveEventSchema`
untouched, so T-05, T-06, and T-16 are unaffected.
**Next agent needs to know:** `SessionClient` is now async — `create` and `join`
return a `Promise<RoleCapability>`. Part 4 replaces `InMemorySessionClient`
behind that interface; Parts 2 and 3 should code against it and not import AWS.

### RL-007 — 2026-09-15 — Part 5 — Kunj Rathod

**Landed:** merged `38542ad` into both open PRs and reverified. Conformance is
unchanged at ten gaps — the new capability schema does not reach the pack.
`make check` is green end to end including the new typecheck, and `dist/`
rebuilds byte-identical to the committed output.
**Threads touched:** T-17 and T-18 strengthened; both recurred during this
merge, and each now carries a concrete proposal rather than just a complaint.
**Next agent needs to know:** T-17 and T-18 are not cosmetic any more. Two
workstreams produced four `memory/INDEX.md` conflicts and two episodic
renumberings in a single afternoon. With five parts active that becomes
constant friction on every merge, and it is the kind of friction that gets
"fixed" by someone skipping the memory record entirely.

### RL-008 — 2026-09-15 — Part 5 — Kunj Rathod

**Landed:** the first end-to-end slice, `tests/e2e/fixture-replay.test.ts`. It
replays the reviewed fixtures through Part 1's real `InMemorySessionClient` and
covers ordered delivery, reconnect redelivery as a provable no-op, `close()`
stopping delivery, and capability requests failing after close. It also
cross-checks every event against `check_contract_conformance.py`, so the Python
reimplementation of JSON Schema and the authoritative Zod schema cannot drift
apart unnoticed.
**Threads touched:** T-11 moved from BLOCKED to IN PROGRESS.
**Next agent needs to know:** if you are picking up Part 3, that file is a
worked example of driving the session client from a fixture — copy its setup
rather than inventing one. Also: proving a guard works needs a mutation that
actually flips a verdict. The first mutation tried here changed nothing
observable, and a weaker engineer would have read that as "the guard passes".

### RL-009 — 2026-09-15 — Part 5 — Kunj Rathod

**Landed:** `review/content-review-sheet.html` and its generator. Every region
drawn on its slide from the same normalized bounds a student renderer receives,
beside the exact words a student is given, plus the AR node and camera each maps
to, and all 24 student-facing sentences listed for reading straight through.
Guarded by a `--check` mode and two tests, both verified to fail.
**Threads touched:** T-09 — the Part 5 side is unblocked; what remains needs a
person.
**Next agent needs to know:** A15 was not stalled on effort, it was stalled on
there being nothing a domain expert could look at. That is fixed. Finding a
biology instructor and an accessibility professional is now the whole of the
remaining task, and it is the kind of thing that only happens if someone is
asked by name at a standup.

### RL-010 — 2026-09-15 — Part 2 — Jacob

**Landed:** `0771bce`. Took ownership of Part 2, instructor capture and
approved-screen recognition, in the ownership board.
**Threads touched:** T-01 — Part 2 is no longer unowned.
**Next agent needs to know:** no Part 2 code exists yet.

### RL-011 — 2026-09-15 — Part 5 — Kunj Rathod

**Landed:** `tests/access_pack/test_demo_runbook.py`, which checks the runbook's
prose against the pack it describes — every slide id, region, hotspot, AR node,
camera, file path, fallback scenario, and simulator flag it names must resolve,
and the measured numbers it states out loud are recomputed from the actual
fingerprints.
**Threads touched:** T-01 updated for Jacob; section 6's Part 2 guidance expanded
now that it has a reader.
**Next agent needs to know:** mutation testing found two of those tests were
theatre. The camera check used a regex with a literal space and the runbook
wraps, so it matched nothing and cameras were never checked at all; the
simulator-flag check filtered found flags down to a known-good list, so an
invented `--tempo` passed. Both looked like passing tests. If you write a guard
here, break it on purpose before you trust it — that is now the third time on
this project that a check which could not fail was found only by trying to make
it fail.

### RL-012 — 2026-09-15 — Part 5 — Kunj Rathod

**Landed:** AR camera framing validation in `validate_pack.py`. For every
hotspot, the node's angular radius plus its off-axis angle from the camera's aim
must fit inside half the field of view, and the camera must not be inside the
node it frames. All twelve pass; the tightest is the vacuole on `cell-slide-05`
at 15.6 of 17.5 degrees. Also cut the Python suite from 61s to 5.4s.
**Threads touched:** none.
**Next agent needs to know:** two things for Part 3. The pack's camera geometry
is now verified to actually frame what each hotspot names, so if your AR view
shows empty space the bug is in the renderer, not the content. And the vacuole
framing uses 89% of its half field of view — if you change `recycling-closeup`,
`make pack-check` will tell you when you have pushed the organelle out of shot.

### RL-013 — 2026-09-15 — Part 5 — Kunj Rathod

**Landed:** nothing. This entry records a verification, because the result is
worth knowing and nobody else can see it.

Because of T-07, no CI run has ever validated the integration branch or either
open PR. So `0771bce` was checked out clean into a worktree, `npm ci` run as CI
would, and the full `make check` executed: memory check, typecheck, 98 tests,
and the build all pass. The committed `dist/` rebuilds byte-identical, the
manifest is copied verbatim, the built `index.html` references assets that
exist, and `dist/manifest.json` is valid Manifest V3 with the narrow `storage`
and `sidePanel` permissions the system design calls for.

**Threads touched:** T-07 annotated with this evidence. No thread closed — a
manual check is not CI.
**Next agent needs to know:** the branch is sound as of `0771bce`, so if
something breaks later it broke after this point. But the only reason anyone
knows that is that someone went and looked. Until PR #5's workflow fix merges,
assume nothing on the integration branch has been verified unless a relay entry
says it was.

### RL-014 — 2026-09-15 — Part 5 — Kunj Rathod

**Landed:** PR #4 merged as `a881f11`, putting the reviewed pack, the simulator,
the validators, and the E2E replay on the integration branch. PR #6 opened for
the three minor points from the review, which arrived after the merge: a
docstring on `check_ar_framing`'s scalar field-of-view assumption, a trip-wire
failing any hotspot that uses more than 95% of its half field of view, and a
warning at the definition of `TIE_EPSILON` that symmetrising it would silently
change every fingerprint in the pack.

Also acted on the review of PR #5: `tests/relay/test_relay_check.py` now encodes
21 mutation cases, escaped pipes are honoured in table cells with an error that
names the cause, and an owned part's branch cell must be a branch path, a
`merged as <sha>` reference, or the exact words "not yet created".

**Threads touched:** none closed.
**Next agent needs to know:** the reviewer's sharpest point is worth repeating.
The relay checker's whole justification was that an unchecked guard drifts
silently, and it had shipped without a guard of its own — nine mutations run by
hand, none committed. If you add a check to this repository, commit the
mutations that prove it can fail, including a control asserting the good case
passes. Without that control, a checker that rejects everything satisfies every
other test you write.

### RL-015 — 2026-09-15 — Part 5 — Kunj Rathod

**Landed:** restored `relay-check` and `freeze-check` to the `Makefile` after
merging PR #5 dropped them, and added assertions so the loss cannot repeat
quietly. Rebuilt the relay mutation tests to address table rows by their first
cell rather than embedding whole rows as string literals, so ordinary edits to
this document no longer break tests that have nothing to do with the checker.
**Threads touched:** T-20 opened and closed in the same pass.
**Next agent needs to know:** the merge that dropped those targets is the exact
failure this document exists to catch, and it still took a person noticing.
`scripts/relay_check.py` and `tests/relay/` both survived the merge, so nothing
looked wrong — the gate had simply stopped being called. After you resolve a
conflict in `Makefile` or `.github/workflows/`, diff the list of targets and
triggers, not just the file.

### RL-016 — 2026-09-15 — Part 2 — Jacob

**Landed:** `workstream/2-instructor-capture`, PR #8. Instructor capture end to
end: `sources/screen/` (dhash12 fingerprint, matcher, sampler, display-media
host), `instructor/` (controller + panel), `shared/broadcastSessionClient.ts`,
`scripts/build-pack.ts` (pptx → PNG → Sonnet 4.6 drafts → `pack.draft.json`,
first output `packs/hnsw/`). Pack schema widened additively. Part 3 and the
relay docs merged in. CI workflow pinned to Node 22. Record:
`memory/episodic/0041-part2-instructor-capture.md`.
**Threads touched:** T-05 in progress (widening on #8), T-08 in progress (Node
22 pin on #8), T-15 annotated (controller starts at 1), T-21 and T-22 opened
(T-20 was already taken by Kunj's relay-gate thread; renumbered during merge).
**Next agent needs to know:** the fingerprint is Part 5's algorithm ported
verbatim, not a shim — if you change either side, `fingerprint.test.ts` compares
byte-for-byte against `bio-cell-demo/pack.json` and will tell you. Thresholds
are not constants in the extension; they come from `pack.matching`. The HNSW
pack is a draft under A3 and must not be shown as reviewed. Switching role in the
shell disposes the capture silently, which is fine for a demo and wrong for a
product.

### RL-017 — 2026-09-16 — cross-cutting — Anurup Kumar

**Landed:** merged PR #6, #7, and #8 onto `accesslens-extension-ar-pivot`
(`19770f6` fixed the stale `INDEX.md` pointer first, since it broke `make
check` on the integration branch tip itself). PR #8's merge had two real
conflicts -- both in this file and `memory/INDEX.md`, no application code --
resolved by keeping both sides and renumbering: `INDEX.md`'s single pointer
became the list T-18 already proposed, and Jacob's `T-20` (duplicate of
Kunj's) is now `T-22`. Verified with a fresh `npm install` and `make check`:
181 extension tests, 61 pack tests, 24 relay tests, all green; T-05 closed.
**Threads touched:** T-05 closed. T-08 still IN PROGRESS -- Node 22 is in the
merged workflow but not yet observed green in an actual CI run against this
tree. T-20 and T-22 disambiguated.
**Next agent needs to know:** three independent ID collisions were found in
this one merge (two episodic filenames, one thread ID) and none of them were
caught by anything automatic -- a person merging had to notice all three.
T-17 and T-18 are not theoretical anymore. If you pick up Part 4, `Broadcast
SessionClient` is the only working transport today; there is still no
`infra/` or deployed service, and `docs/aws-access-verification` (unmerged)
already knows two hard constraints worth reading before you design anything:
only `us.anthropic.claude-sonnet-4-6` is invokable on this AWS account, and
the write path for Lambda/DynamoDB/API Gateway/S3 is unverified.

### RL-018 — 2026-09-15 — Part 5 — Kunj Rathod

**Landed:** `scripts/deploy_preflight.py`, `make deploy-preflight`, and
`docs/DEPLOYMENT.md`. The AWS account was probed rather than assumed: every
create the planned stack needs succeeded and was cleaned up afterwards, so the
`SYSTEM_DESIGN.md` §7 architecture is deployable in this account.
**Threads touched:** T-23 opened.
**Next agent needs to know:** the account expires when the event does, and the
credentials expire sooner. Nothing deployed survives the demo, which makes the
recorded fallback load-bearing rather than a nicety. Also `npx cdk bootstrap`
has never been run here — that is T-23, it takes thirty seconds, and nothing
deploys until someone does it.

### RL-019 — 2026-09-15 — Part 5 — Kunj Rathod

**Landed:** ran `cdk bootstrap` against the hackathon account. `CDKToolkit` is
at version 32 with an S3 staging bucket and five IAM roles, so Part 4 can `cdk
deploy` without any setup of its own.
**Threads touched:** T-23 closed.
**Next agent needs to know:** it was bootstrapped with CDK's default
`AdministratorAccess` execution policy. That is normal for a throwaway event
account and wrong for anything that outlives it — scope it with
`--cloudformation-execution-policies` if this architecture is ever rebuilt
somewhere permanent.

### RL-020 — 2026-09-15 — Part 5 — Kunj Rathod

**Landed:** nothing new; synced all three open branches onto `19770f6`.
**Threads touched:** T-18 strengthened — that commit is a teammate hitting the
same conflict independently and fixing it by hand, which is the fifth
occurrence.
**Next agent needs to know:** T-18 is now costing other people time, not just
mine, and the commit message for `19770f6` cites the thread by name — so the
register is being read. That is the argument for spending ten minutes on the
fix rather than continuing to pay the toll.

### RL-021 — 2026-09-15 — Part 5 — Kunj Rathod

**Landed:** nothing. Opening a thread against this document.
**Threads touched:** T-24 opened (renumbered from a collision with T-21/T-22
found while merging this into the integration branch, RL-022).
**Next agent needs to know:** PR #8 conflicts on exactly two files —
`CONTEXT_RELAY.md` and `memory/INDEX.md` — and nothing else in 91 changed files.
Both are things I added or lean on heavily. The relay was built to stop context
being lost between parallel workstreams, and the way it asks for that (everyone
appends to one file) reproduces the very problem it documents in T-18. Worth
fixing before three more people start appending, not after.

### RL-022 — 2026-09-16 — cross-cutting — Anurup Kumar

**Landed:** merged PR #9 (`docs/deployment-readiness`) onto
`accesslens-extension-ar-pivot`. Same shape of conflict as PR #8: only
`docs/CONTEXT_RELAY.md` and `memory/INDEX.md`, no application code. This time
also found a filename collision (`memory/episodic/0042-deployment-readiness.md`
renamed to `0043-...`, since `0042` was already this session's merge record)
and two more thread-ID collisions in the table that auto-merged without a git
conflict at all: Kunj's `T-21` (CDK bootstrap) collided with Jacob's existing
`T-21` (`capture.stopped`), and Kunj's `T-22` (this file is a conflict magnet)
collided with Jacob's existing `T-22` (student-can-be-instructor). Both of
Kunj's are renumbered to `T-23`/`T-24` here and in RL-018/019/021 above.
Verified with `make check` after resolving: still green.
**Threads touched:** none closed. T-21/T-22 disambiguated a second time; T-23,
T-24 assigned.
**Next agent needs to know:** RL-021/T-24's point proved itself twice more in
the same merge it was written to describe — table rows collide silently
(no git conflict) even when the log entries do conflict. Read `T-24` before
adding a new thread ID by hand; check the table for the number, not just your
own memory of what you last used.

### RL-023 — 2026-09-16 — Part 2 — Jacob

**Landed:** three follow-ups from live testing with the HNSW pack in Google
Slides. `sources/screen/letterbox.ts` crops letterbox and pillarbox bars to
the 16:9 slide region before fingerprinting (measured: a 4:3 tab pushed
real slides into the ambiguity margin, a square tab matched the wrong slide;
after the crop they sit within 4 bits). The student shell resolves the pack
from the session's `packId`/`packVersion` instead of the instructor dropdown
in that tab. The join code box is labelled and styled as the first thing a
student does, and the header offers "Open in a full tab" when running as the
extension.
**Threads touched:** none opened or closed.
**Next agent needs to know:** BroadcastChannel is origin-scoped. A side panel
(`chrome-extension://`) and the Vite preview (`localhost`) cannot hear each
other, so test both roles in the same origin until Part 4's relay exists.

### RL-024 — 2026-09-16 — Part 4 — Omar Rizwan

**Landed:** Part 4, built and deployed. `services/live-session/` is the relay —
server-side validation, HMAC role capabilities, DynamoDB state with TTL enforced
on read, the WebSocket handler, redacted logging, and the real `SessionClient`.
`infra/` is the CDK stack. Verified against real AWS at
`wss://ktlrnmxq0f.execute-api.us-east-1.amazonaws.com/demo`: one instructor
drove two students through all 19 happy-path events in order, and five refusals
held, 12/12. 49 unit tests. `make live-session-check` added to `check`.
**Threads touched:** T-15, T-19 closed. T-22's relay half is built (the shell
half is still open). T-25 and T-26 opened. T-20, T-21, T-23, T-24 untouched.
**Next agent needs to know:** five things.

*The relay exists and nothing uses it (T-25).* This is the gap that matters now.
The extension is still on `BroadcastChannel`; swapping in
`WebSocketSessionClient` is a construction-site change plus
`VITE_ACCESSLENS_WS_URL`. Do it early enough to rehearse on two devices.

*The endpoint is disposable.* It lives in the Workshop Studio account, whose
credentials expire before the account itself is reclaimed. If it stops
answering, redeploy rather than debug.

*Deploy is two steps and the second ships stale code silently.* `npm run build`
in `services/live-session`, then `cdk deploy` in `infra`. The stack deploys a
prebuilt `dist/` because CDK's implicit bundling shells out to esbuild from the
repository root, where adding it would mean editing Part 1's `package.json`.

*Validator parity is enforced, not hoped for.* `reference_event_check.py` asked
for its rule names to be kept stable server-side; `test/rules.parity.test.ts`
runs both implementations over every reviewed fixture and fails on any
disagreement, order included.

*I collided with this file exactly as T-17 and T-22 predict.* I branched at
`1d1c72b` and wrote T-20/T-21/T-22 and RL-014/RL-015; by the time I merged, all
five ids were taken by other people's work. I renumbered mine and rewrote my
rows against the current file rather than resolving the conflict mechanically,
which is the only reason the register still means anything. The Makefile
conflict was the same story in miniature: my side had dropped `relay-check`,
`freeze-check`, and `deploy-preflight`, and taking either side wholesale would
have deleted someone's work. **If you are merging this file, read both sides.**

### RL-025 — 2026-09-16 — cross-cutting — Anurup Kumar

**Landed:** `apps/extension/src/shell/createDefaultClient.ts` and
`liveRelayClient.ts` -- the transport swap T-25 was waiting on. `App.tsx`'s
`defaultClient` now uses Part 4's real `WebSocketSessionClient` when
`VITE_ACCESSLENS_WS_URL` is set, falling back to `BroadcastChannel` then
in-memory as before. The wrapper validates every inbound event against
`LiveEventSchema` and every capability against `RoleCapabilitySchema` before
either reaches the rest of the app, since `webSocketSessionClient.ts`
deliberately types both as bare `Record<string, unknown>` to avoid importing
Part 1's schema package -- assigning it to `SessionClient` directly was
also a real `tsc` error, not just a style question.

Then launch-tested the whole stack: ran Part 4's own `integration-test.mjs`
against the live endpoint fresh (12/12, still green today), built the
extension with the live URL, and drove it from two real browser tabs. The
instructor tab's Start button produced "Sharing is required for live sync"
rather than "Could not open a session" -- which the source only distinguishes
when `client.create()` already succeeded against the real relay and it was
`getDisplayMedia()` that failed. The student tab joined a made-up code and
got a real "Could not join this session" from the live relay, not a canned
message. No sandboxed tool here can grant real screen-share permission, so
that is as far as this environment can verify the capture path.

The committed `dist/` was deliberately rebuilt *without* the live URL, so the
checked-in default stays network-free; a build with it set was tested but not
committed. `memory/episodic/0044-wire-live-relay-and-launch-test.md` has the
full evidence.

**Threads touched:** T-25 moved to IN PROGRESS (not CLOSED -- the wiring and
network path are verified; the real-device rehearsal is not, and nothing in
this environment can do that part).
**Next agent needs to know:** whoever does the real two-device rehearsal
needs `.env.local` with `VITE_ACCESSLENS_WS_URL` set to the live endpoint
(`.env.example` has the name; the value is in `services/live-session/README.md`
and this file's section 2) before running `npm run build`. Loading the
already-committed `dist/` will not reach the relay -- it was intentionally
built without that variable.

### RL-026 — 2026-09-16 — cross-cutting — Anurup Kumar

**Landed:** pushed the live-relay wiring (RL-025) and merged two more commits
that landed on the integration branch in the meantime (`c754bf3`,
`e72281a` -- a standalone `services/live-session/demo/index.html` page that
connects to the real relay without the extension at all, useful for a
two-device demo that doesn't depend on `getDisplayMedia()`). Pushing then
failed CI: `Cannot find module '@aws-sdk/client-dynamodb'` in
`live-session-check`, because `.github/workflows/check.yml` never got a
`services/live-session`-specific `npm ci` when Part 4 merged. Fixed (T-27)
and verified locally by reproducing the exact failure first.
**Threads touched:** T-27 opened and closed in the same pass.
**Next agent needs to know:** this is the second time a merge added a
sub-package with its own dependencies and the workflow silently didn't
follow (T-08 was the first, for `services/live-session` existing at all;
this was for CI actually installing into it). If a future part adds another
`package.json` anywhere other than the repo root, add its `npm ci` to
`.github/workflows/check.yml` in the same PR, not as a follow-up someone
else discovers via a red run.

### RL-027 — 2026-09-16 — cross-cutting — Anurup Kumar

**Landed:** the user's teammates were live-testing the real extension against
the real deployed relay and hit "Connection interrupted. Showing the last
reviewed state." with the pill reading "Stale," while the connection was
actually fine. Root cause: `StudentExperience.tsx` guessed staleness from
15 seconds of content silence, not from any actual connection signal. An
instructor spending more than 15 seconds on one region -- normal lecture
pacing -- was indistinguishable from a dropped socket to that timer.

Fixed properly rather than papering over it: `WebSocketSessionClient`
already tracked real socket open/close internally and exposed none of it;
added `onConnectionChange` (additive, not a change to the frozen five-method
interface), threaded it through `liveRelayClient.ts`, and had
`StudentExperience.tsx` drive `live`/`stale` from that instead of the timer.
`BroadcastChannel`/in-memory transports have no such method and so never go
falsely stale from a quiet instructor -- correct, since they have no real
disconnect concept to report. Added `markLiveStateReconnected` as the
stale -> live counterpart to the existing `markLiveStateStale`.
**Threads touched:** T-28 opened and closed in the same pass.
**Next agent needs to know:** this bug predates the live relay -- the same
false alarm would have fired against `BroadcastChannel` too, just with lower
stakes since that transport doesn't actually drop mid-demo. If you add
another timer-based guess standing in for a real signal anywhere in this
codebase, this is the second time in one day that pattern produced a false
alarm in front of an actual user (the first was T-08/T-27's CI gaps). Prefer
the real signal even when the guess is easier to write.

### RL-028 — 2026-09-16 — cross-cutting — Anurup Kumar

**Landed:** committed two documents that existed only on my machine since
2026-09-15 and were never seen by anyone else on this team --
`HACKATHON_CRITIQUE.md` (the original harsh scorecard, written when zero
code existed) and `docs/ACCESSLENS_MVP_REVISION.md` (a proposed
scope-narrowing response to it, cutting the extension/capture/required-AR
entirely, which nobody has decided on and which everyone kept building
against the *opposite* of). Added `docs/TEAM_ALIGNMENT_CHECK.md`: an updated,
re-scored version of the critique against what's actually built and deployed
today, plus external research (a real, free, ubiquitous competitor
-`PowerPoint Live Captions` - that the original critique didn't name; third-party
UDL effectiveness numbers to cite instead of inventing impact claims; a
correction on who the AR mode actually serves, since accessibility research
favors tactile models for blind users over screen-rendered AR), plus 14
questions every contributor needs to answer. Hard-stopped it in both
`AGENTS.md` and a new `CLAUDE.md` (Claude Code's auto-loaded entry point,
which did not exist before) so no session -- human-directed or not -- can
miss it.
**Threads touched:** T-29 opened, not closed -- it closes only once every
part listed in the new file's Responses section has actually answered.
**Next agent needs to know:** if you're reading this via `AGENTS.md`'s normal
read order and haven't seen the STOP section at its top, re-read from the
top -- it was inserted above the standard read-order list specifically so it
can't be skipped. Don't build more of the personalization/content-authoring
work discussed this session (T-29 question 14) until this thread closes;
it's real design but unbuilt, and the cheaper, higher-leverage fixes (one
real user interview, the two rehearsals, the `master`/integration divergence)
haven't happened yet either.

### RL-029 — 2026-09-15 — Part 1 — Anurup Kumar

**Landed:** Anurup's signed, complete response to the fourteen T-29 alignment
questions is now recorded in `docs/TEAM_ALIGNMENT_CHECK.md`. It keeps the
extension-first MVP as the working foundation, states the actual evidence gaps
without claiming them solved, and explicitly holds new authoring/
personalization work until the group decides together.
**Threads touched:** T-29 remains OPEN; only Anurup has responded. Jacob,
Kunj, Omar, and Prachi still need their own signed responses.
**Next agent needs to know:** this response is not permission to implement the
agent-first ticket system or any product feature. The mandatory gate closes
only after every listed contributor responds.

### RL-030 — 2026-09-15 — Part 1 — Anurup Kumar

**Landed:** at the user's direction, removed the T-29 implementation block
from `AGENTS.md`, `CLAUDE.md`, and `docs/TEAM_ALIGNMENT_CHECK.md`. The critique
and signed response remain intact as a non-blocking agenda for tomorrow's
in-person product-direction meeting.
**Threads touched:** T-29 remains OPEN as a discussion thread, but no longer
blocks scoped work on the current extension-first MVP.
**Next agent needs to know:** read the alignment document before changing
product direction, demo claims, privacy boundaries, or MVP scope; otherwise
continue current scoped work and bring unresolved direction questions to the
meeting.

### RL-031 — 2026-09-16 — Part 1 — Codex

**Landed:** agent-first delivery system for the current extension-first MVP:
`docs/AGENT_OPERATING_CONTEXT.md`, the live-meaning decision and demo contract,
canonical ticket files, claims, immutable updates, generated board/context tools,
and checker tests now live under `docs/work/`, `scripts/`, and `tests/work/`.
`make check` runs the delivery-board gate. The first workable P0 tickets are
AL-001 capture matrix, AL-003 stop-versus-end lifecycle, and AL-006 mentor kit;
durable identity/content tickets remain deferred or dependency-blocked.
**Threads touched:** T-29 stays OPEN and non-blocking; T-30 opened to keep the
new system additive and its human decision boundaries visible.
**Next agent needs to know:** run `make agent-context` after pulling, claim one
READY ticket with a claim and immutable update, and do not use T-29's open meeting
agenda to adopt the alternate MVP, change privacy rules, or overstate demo proof.

### RL-032 — 2026-09-16 — cross-cutting — Codex

**Landed:** local AL-003/T-21 implementation now distinguishes stopped capture from an
ended temporary session. The additive base-only `capture.stopped` event flows
through the extension contract, JSON Schema, pack reference validator and
simulator, instructor controller, student state, relay validator, and relay
latest-state behavior. Stop releases local capture and freezes the student's
last trusted reviewed state with an explicit non-live message; the same join
code may later receive `session.started`. Only `session.ended` closes delivery.
No raw screen/camera media, student preference, identity, or persistent field
was added.
**Threads touched:** T-21 is IN PROGRESS, not CLOSED: local checks are green,
but a second shared-contract review and an authorized relay deployment are still
required before calling this live-AWS behavior.
**Next agent needs to know:** review AL-003's contract delta and checkpoint,
then build and deploy `services/live-session` before running the updated
real-device capture matrix. `memory/episodic/0050-stop-versus-end-session-lifecycle.md`
has the precise behavior and verification record.


### RL-033 — 2026-09-16 — Part 2 — Jacob

**Landed:** pack-driven student rendering. Focus mode shows the followed
slide from the asset's `mediaUri` with `region.bounds` outlined, for any
pack; a pack without images gets the text alone. Slide images for both packs
are bundled through `shared/packMedia.ts` (one glob line per pack). The AR
tab is offered only when the pack carries an `arScene`, and a saved AR
preference falls back to Focus otherwise. `scripts/build-pack.ts` emits
`mediaUri`; the HNSW draft carries it.
**Threads touched:** none opened or closed.
**Next agent needs to know:** the AR renderer still loads a fixed cell model
rather than the pack's `modelUri`. Gating on `arScene` is enough while only
one pack has a scene; a second AR pack needs the renderer to read the scene
from the pack.

### RL-034 — 2026-09-16 — cross-cutting — Codex

**Landed:** the A14–A16 operator evidence packet in
`docs/DEMO_PROOF_SPRINT.md`, an explicit link from the demo runbook, and a
repeatable `services/live-session` 30-event quality bench. The packet provides
blank, privacy-safe records for the real-device capture matrix, two-student
relay latency/skew and reconnect bench, two rehearsals and a truthful replay
fallback, plus a consented formative-review script and claim audit. It does not
assert that any human-only run or reviewer session occurred.
**Threads touched:** T-09 and T-25 remain OPEN/IN PROGRESS. T-21 remains IN
REVIEW: local lifecycle checks pass, but the current machine has no AWS CLI or
configured credentials, so no deployment was attempted and independent
contract review is still required. The existing endpoint did pass 30/30 ordered
events to each anonymous bench client (139.3/186.2 ms same-process p50/p95
receive latency; 2.4/11.7 ms skew), but rejected `capture.stopped` as
`event-type-not-allowlisted`, proving it is stale for the lifecycle change.
**Next agent needs to know:** an authorized operator must review AL-003, build
and deploy the service, run `integration-test.mjs` and `quality-bench.mjs` on
that deployed endpoint, then complete the real-device and human-review tables.

### RL-035 — 2026-09-16 — Part 1 — Codex

**Landed:** T-33 fail-closed handling for relay payloads that do not validate
against `LiveEventSchema`. `wrapLiveRelayClient` keeps discarding malformed
events but now emits a payload-free optional hook; `StudentExperience` freezes
the last trusted reviewed state with an explicit non-live message. A protocol
failure cannot be turned back into `live` merely because the socket reconnects;
a later valid event clears it. No raw payload, student preference, identity, or
new transport field is retained.
**Threads touched:** T-33 opened and is IN PROGRESS. T-21 remains IN PROGRESS:
the extension fail-closed path is locally covered, but the deployed relay still
rejects `capture.stopped` and requires a human review plus authorized deployment.
**Next agent needs to know:** review `2d04fad`, deploy the reviewed relay when
authorized, and exercise a real resume-path reconnect plus malformed-event
rejection before treating the false-live row in the quality bench as proven.

### RL-036 — 2026-09-16 — Part 1 / unowned student surface — Codex

**Landed:** AL-010 local reading controls are ready for QA on
`codex/demo-proof-sprint-qa`: student-local font, text size, line spacing,
reading width, higher contrast, reduced motion, and requested-audio speed.
The preference schema is strict, rejects prohibited/unknown fields, supplies
safe defaults to older saved settings, and persists only through local extension
storage. Audio speed is applied only to an utterance created after the student
presses Play. `LiveEventSchema` rejects a preference-shaped field, and neither
the relay nor instructor receives these settings.
**Threads touched:** no existing risk thread; the Part 1 state row now points to
the AL-010 handoff. T-21/T-33 retain their independent deployment and physical
device evidence requirements.
**Next agent needs to know:** QA the unpacked extension's controls in a real
browser and verify settings survive an extension reload. This local code does
not prove a screen-reader, Windows, or multi-device live relay run.

### RL-037 — 2026-09-16 — Part 2 capture integration / QA — Codex

**Landed:** adopted the narrow upstream fix for Chrome's transient user-activation
ordering: the explicit browser capture request begins before any awaited
`SessionClient.create()` work. If session creation then fails, a granted stream is
immediately stopped. A focused controller test proves `requestStream` begins
before session creation, preserving the causal Start-click path required for tab,
window, and display choices.
**Threads touched:** T-34 opened. AL-010 is handed to QA; AL-001 is now active.
**Next agent needs to know:** this is source-order and unit-test evidence only.
Run the blank AL-001 matrix in `docs/DEMO_PROOF_SPRINT.md` on Windows/real Chrome
for denial, tab, window, display, source closure, correction, pause/stop/restart,
and terminal end before treating it as a verified capture fix.

### RL-038 — 2026-09-16 — Part 1 / student route — Codex

**Landed:** AL-040 adds an explicit Student **Review** surface beside the live
lesson. It derives concepts solely from the checked-in reviewed Access Pack,
labels itself non-live, provides Focus/Read/Hear and available-AR views, supports
self-paced previous/next navigation, and keeps concept bookmarks in local
extension storage. It reads no live session history and sends no bookmark,
preference, identity, raw media, Canvas data, or model request through the relay.
**Threads touched:** no new product-risk thread. T-09's human review requirement
is unchanged; this route is not an instructor-published record or an expert review
claim.
**Next agent needs to know:** use the unpacked extension to check Review navigation,
bookmark persistence after reload, AR fallback, and narrow-panel keyboard flow.
Canvas/RAG, Bedrock, publication, and retention remain separate approved work.

### RL-039 — 2026-09-16 — Part 1 / instructor-to-student focus — Codex

**Landed:** AL-041 completes the existing instructor region-indication control:
it now derives a normalized center pointer from the selected reviewed region,
sends it through the already-allowlisted optional `region.changed.pointer` field,
and Focus mode presents an explicit marker. This is a semantic reviewed-pack
coordinate, not browser cursor tracking or raw screen data. Events without a
pointer retain the previous renderer behavior.
**Threads touched:** no new product-risk thread. T-25's multi-device and
real-browser evidence requirements remain unchanged; this code does not claim
that a Windows or deployed-relay pointer run has occurred.
**Next agent needs to know:** QA AL-041 in the unpacked extension and then across
two devices. Read/Hear/AR must keep the same reviewed region meaning; do not add
raw cursor capture merely to make the marker move.

### RL-040 — 2026-09-16 — Part 1 / model boundary — Codex

**Landed:** AL-042 adds a strict disabled `BedrockAgentGateway` placeholder.
It validates reviewed identifier-only requests locally and then fails closed;
there is no SDK import, credential read, network client, prompt, model output,
Canvas/RAG request, or durable source-content store. The extension remains fully
functional without it.
**Threads touched:** T-29 remains OPEN. This does not approve model use,
authoring, course-content retrieval, retention, or a claim that Bedrock runs in
the demo.
**Next agent needs to know:** any enabled adapter requires a separate approved
service boundary and human policy decisions. Do not wire an environment variable
directly to an SDK call from the extension.

### RL-041 — 2026-09-16 — Part 1 / self-paced Review — Codex

**Landed:** AL-043 adds an explicit student-controlled “Mark explored” control
to the non-live Review route. Its bounded concept IDs are scoped to the reviewed
pack and local extension storage; the UI calls the count private and not a
grade. It does not infer activity from time/clicks/mode selection or send any
progress to an instructor, relay, or backend.
**Threads touched:** no new risk thread. T-09's formative-review requirement and
all device QA remain open; the marker is not evidence that a concept was learned.
**Next agent needs to know:** QA reload and keyboard behavior in the unpacked
extension. Preserve explicit marking only; do not turn the feature into passive
analytics, a streak, ranking, mastery, or instructor-visible metric.

### RL-042 — 2026-09-16 — Part 1 / Review accessibility — Codex

**Landed:** AL-044 makes Review format tabs keyboard-equivalent to the live
student route: ArrowLeft/ArrowRight/Home/End select the next reviewed format,
focus follows, and ARIA tab/tabpanel relationships are explicit. The available
set still excludes AR when the reviewed concept has no AR scene.
**Threads touched:** none. This is automated keyboard coverage, not a
screen-reader/accessibility-audit claim; T-09 and physical QA remain open.
**Next agent needs to know:** test the unpacked extension’s focus visibility,
narrow layout, and screen-reader announcement. Do not collect keystrokes or mode
usage to measure participation.

### RL-043 — 2026-09-16 — Part 1 / course-material boundary — Codex

**Landed:** AL-045 adds a strict disabled `CourseMaterialProvider` placeholder.
It accepts only content-free references for an allowed syllabus/module/slide
deck/reference-document set, rejects excluded course material, identity, raw
content, and credential-shaped inputs, then fails closed. No Canvas/LTI client,
course document, retention, retrieval index, RAG call, or model response exists.
**Threads touched:** T-29 remains OPEN. This is not institutional approval and
does not make a Canvas/RAG demo or product claim.
**Next agent needs to know:** an enabled provider belongs in a separately approved
backend with least privilege, retention/deletion, source grounding, and a second
human review; do not enable it via an extension environment variable.

### RL-044 — 2026-09-16 — Part 1 / camera consent foundation — Codex

**Landed:** AL-046 adds a visible instructor-only local camera control. It calls
`getUserMedia` only from the Start click, requests video without audio, reports
waiting/on/off/denied/browser-ended states, and stops tracks on Stop or unmount.
Its source host samples only on demand locally. No camera frame, preview, label,
gesture, identity, semantic event, or relay delivery was added.
**Threads touched:** T-10 remains ACCEPTED/deferred for the MVP. This stretch
foundation requires a second privacy/accessibility review and physical QA before
merge or any camera demo claim.
**Next agent needs to know:** test permission denial/revocation, device loss,
low light, occlusion, and manual reviewed-region fallback on a real shared device.
Do not add face/gesture/attention/emotion inference at this layer.

### RL-045 — 2026-09-16 — Part 1 / accessibility QA — Codex

**Landed:** AL-047. Added `axe-core` runs to `InstructorPanel.test.tsx`,
`CameraControl.test.tsx`, and `ReviewExperience.test.tsx` — the three surfaces
that had manual accessible-name checks but not the automated axe pass
`StudentExperience.test.tsx` already had. All three passed with zero violations
on the first run; no markup changed. Read `docs/ADVANCED_FEATURES.md` from
`origin/master` for reference only (per this file's own standing warning not to
merge that branch) and confirmed its P0/P1/P2 ordering already matches what is
built: Review route, bookmarks, and focus pointer are done; Canvas/RAG and
Bedrock are gated on institutional approval (P1); physical camera recognition
is gated on an approved scenario plus a second privacy/accessibility review
(P2). No AWS CLI or credentials exist in this environment, so AL-003's
deployment step remains untouched here.
**Threads touched:** none opened or closed. T-09's human accessibility review
is unaffected — this is machine-detectable coverage only.
**Next agent needs to know:** if you're picking up the "Next Steps" list from
today's `/goal` — Windows/multi-device capture testing, the AWS deploy, and any
camera recognition/Canvas/RAG/Bedrock/session-recording work all need a human
with real hardware, AWS credentials, or institutional sign-off that this
environment does not have. Keep building the reviewable, review-gated slices
(more accessibility coverage, bug fixes found by reading code, doc/kit prep)
rather than quietly enabling any of the gated integrations.

### RL-046 — 2026-09-16 — Part 1 / caption contract — Codex

**Landed:** AL-048. `caption.appended` was in the event-type enum since the
original discriminated-union rewrite but base-only, so a caption event could
never actually carry a caption -- the exact gap `docs/PART5_CONTRACT_CONFORMANCE.md`
§3 documented with a suggested shape when Part 5 first wrote the `captions`
fixture. Shipped exactly that shape: `caption.appended` now requires `assetId`
and `caption:{text (1-280 chars), isFinal}` in both `contracts.ts` and
`live-event.schema.json`. No relay code change was needed --
`services/live-session/src/rules.ts` and the Python reference validator's
`KNOWN_FIELDS` already allowlisted `caption` by name in anticipation of this
closing, which is exactly what their own comments said would happen. Also
fixed `check_contract_conformance.py`'s subset validator, which recognised
`maxLength` in `SUPPORTED_KEYWORDS` not at all until this pass (it would have
raised `NotImplementedError` the moment the new bound was added) and did not
enforce it once added -- added a mutation test proving the new check can
actually fail, per this file's own standing rule about guards that cannot go
red. `tests/e2e/fixture-replay.test.ts`'s `KNOWN_REJECTED` allowlist, which
named the two previously-rejected `captions` fixture events, is now empty.
**Threads touched:** T-16 closed.
**Next agent needs to know:** this is contract-only. Nothing in the product UI
reads or writes a caption yet -- the next slice is an instructor caption input
in `InstructorPanel` and a bounded, non-persistent caption/transcript display
in `StudentExperience`, gated behind `captionsEnabled` in
`apps/extension/src/shared/preferences.ts`, which has existed unused since
before this session. `docs/ADVANCED_FEATURES.md` (read from `origin/master`
for reference only, per this file's standing warning not to merge that
branch) lists "live captions and transcript" as a P0 item alongside this.

### RL-047 — 2026-09-16 — Part 1 / live captions UI — Codex

**Landed:** AL-049, wiring RL-046/AL-048's `caption.appended` payload into
the product. `captureController.sendCaption(text)` emits a bounded,
current-asset-scoped caption while sharing; `InstructorPanel` gets a caption
input alongside the existing correction/indication forms. Student side:
`liveState.ts` tracks a rolling `captions` window capped at
`MAX_RECENT_CAPTIONS` (5), carried through asset/region changes and cleared
on a fresh `session.started`; `StudentExperience` shows it as a `role="log"`
track, labelled as instructor speech rather than a reviewed description, when
the existing (previously unused since it was added) `captionsEnabled`
preference is on, with a toggle next to "Reduce motion".
**Threads touched:** none new; closes out the product side of what T-16
opened.
**Next agent needs to know:** 12 new unit tests cover this (5 controller, 3
liveState, 2 InstructorPanel, 2 StudentExperience), and the rebuilt `dist/`
was loaded in the browser preview to confirm the student toggle renders with
no console errors -- but the instructor-side form could not be exercised
end-to-end here because it needs a real `getDisplayMedia()` grant, the same
gap AL-001/AL-002 already carry. Fold caption-track screen-reader/device QA
into the existing `docs/DEMO_PROOF_SPRINT.md` matrix rather than opening a new
thread for it.

### RL-048 — 2026-09-16 — cross-cutting — Codex

**Landed:** claimed and verified AL-006 (formative reviewer kit), which had
sat unclaimed at READY. `docs/DEMO_PROOF_SPRINT.md` §AL-006 already had the
full kit -- consent script, the five acceptance-criteria questions, a blank
consented-feedback table, and a claim audit matching charter A11's
overclaiming list -- so nothing was missing; this pass verified it against
the ticket and the charter and moved it to IN_REVIEW with a checkpoint and
handoff, rather than leaving it invisible on the board.
**Threads touched:** T-09 unchanged -- still needs a real, consenting mentor,
which is a human step no session here can do.
**Next agent needs to know:** if someone runs this kit, fill in
`docs/DEMO_PROOF_SPRINT.md`'s reviewer table directly; AL-007 is the separate
decision about whether the feedback changes scope or claims.

### RL-049 — 2026-09-16 — Part 1 / security — Codex

**Landed:** AL-050. Dispatched a security-review subagent against this
session's full branch diff (per the `/goal` directive's "final privacy,
security, accessibility, and guardrail testing" item); it found one
MEDIUM/8 finding, independently verified: `services/live-session/src/rules.ts`
-- which the file's own docstring calls the only server-side gate a hostile
client cannot bypass -- checked `pointer` and `arState` shape/bounds but only
checked that `caption` was a *known field name*, never its shape. A client
speaking the relay's WebSocket protocol directly (not the vetted extension,
which does validate client-side) could have sent an oversized or malformed
`caption` and had it broadcast unbounded to every student. Fixed by mirroring
four new rules (`caption-not-an-object`, `caption-text-missing`,
`caption-text-too-long`, `caption-isfinal-not-boolean`) in
`reference_event_check.py` and `rules.ts`, same order; added negative fixture
`oversized-caption.json` and a `relay.test.ts` integration test proving the
actual publish path rejects it, not just the rule function.
**Threads touched:** none new; this is a hardening fix within T-16's scope,
found and closed before either AL-048 or AL-049 merged, let alone before any
real deployment carried a caption.
**Next agent needs to know:** the general lesson, recorded in
`memory/episodic/0067-server-side-caption-shape-validation.md`: when a new
field with a non-trivial (object) shape gets added to `KNOWN_FIELDS`, add its
shape check to `rules.ts`/`reference_event_check.py` in the *same* change,
not as a follow-up someone else has to find. The security-review subagent
also checked the camera consent lifecycle, the disabled Bedrock/course-
material gateways, and `preferences.ts` and found nothing else above the
reporting bar.

### RL-050 — 2026-09-16 — Part 1 / sharing bug — Codex

**Landed:** AL-051. RL-016 recorded, as a known limitation, "Switching role
in the shell disposes the capture silently, which is fine for a demo and
wrong for a product." It was actually a real bug: `InstructorPanel`'s unmount
cleanup called `controller.dispose()`, which stops local media but tells the
relay nothing, so a student's view kept showing the last live moment forever
with no signal the instructor left -- the disconnect-side analogue of T-28's
false-live bug. Confirmed real, not theoretical, because an existing
`App.test.tsx` test was passing *by relying on* that exact stale behavior;
fixing the bug broke that test's assertion, which is direct proof. Fixed by
calling `controller.endSession()` (emits `capture.stopped` then
`session.ended`) before `dispose()` whenever the panel unmounts with an open
session -- role switch or lesson-pack switch alike.
**Threads touched:** none new; this closes a documented-but-unfixed gap from
RL-016 rather than opening a fresh thread.
**Next agent needs to know:** the affected `App.test.tsx` test now uses two
separate `App` instances sharing one client rather than toggling role in a
single tab, which is also a more faithful stand-in for two real devices.
`memory/episodic/0068-end-session-on-instructor-panel-unmount.md` has the
full before/after.

### RL-051 — 2026-09-16 — Part 1 / accessibility — Codex

**Landed:** AL-052. Did what the jsdom-based unit suite structurally cannot:
loaded the real built `dist/` in the browser preview, injected `axe-core` via
CDN, and ran it with `color-contrast` enabled (unit tests disable that rule
since jsdom can't compute real layout/contrast). Found two real bugs in the
"Higher contrast" preference. In dark mode on Live lesson it produced
**1.11:1** contrast (`#f2f2f2` on `#fff`) -- worse than off. On Review it had
**zero effect** -- `.review-experience.high-contrast` had no matching CSS
rule at all. Root cause for both: `color`/`background` are inherited
properties resolved once where declared and passed down as computed pixel
values, not live `var()` references -- overriding the `--ink`/`--paper`
custom properties alone does nothing for a descendant that relies on
inheritance rather than its own `color: var(--ink)`. Fixed by combining both
surfaces under one rule that explicitly redeclares `color`/`background`, and
added `apps/extension/src/style.test.ts`, a static guard proven able to fail
via a real mutation (reverted the fix, confirmed both assertions failed with
the exact bug shape, restored it).
**Threads touched:** none new.
**Next agent needs to know:** worth remembering as a general lesson -- the
existing jsdom test suite deliberately disables `color-contrast` and cannot
compute real cascade, so this class of bug is invisible to it no matter how
much coverage is added there; a real-browser pass is the only way to catch
it. If you add another color-scheme-scoped CSS override
anywhere, redeclare `color`/`background` explicitly on that scope, not just
the custom properties -- `style.test.ts` only guards the two instances found
today. `memory/episodic/0069-fix-inert-and-inverted-high-contrast.md` has
the full diagnosis.

### RL-052 — 2026-09-16 — cross-cutting — Claude (integrated from `claude/accesslens-demo-proof-qa-31tqrj`)

**Landed:** the independent second review AL-003 was gated on, recorded in
`docs/work/updates/AL-003-CHECKPOINT-20260916-0652.md` and reflected in
`docs/DEMO_PROOF_SPRINT.md`. Of the four pre-deployment statements, stop-retains-
session and restart-resumes-session are confirmed with code and test citations;
base-only is confirmed against raw media, identity, and preferences but only
schema-deep for asset/region; the rebuild statement cannot be ticked by a review.
`make check` was reproduced green on `1524027` with identical counts (61/24/5/274/53),
and the previous session's critical finding was independently re-probed against the
existing endpoint — one disposable two-event session, closed immediately — which
still rejects `capture.stopped` as `event-type-not-allowlisted`. No code changed.
**Threads touched:** T-31 and T-32 opened. The reviewing session's own T-33 finding
(`liveRelayClient.ts:48` silently drops a non-conforming event) had, independently
and concurrently, already been fixed in this branch as `2d04fad`/RL-035 (this file's
existing T-33 row) before this record was integrated — renumbered here to avoid the
collision rather than opening a second T-33. T-21 stays IN PROGRESS with the review
box now ticked.
**Next agent needs to know:** the review does **not** clear AL-003 for deployment
on its own. T-31 composes with a fixed T-33 into the failure AL-003 exists to
prevent — this is the same cell AL-004's bench table still marks "Not measured",
now narrower since the silent-drop half is closed. T-32 matters because the
bench's reconnect check exercises `join`, while the shipped client reconnects
through the untested `resume`. Deployment was not attempted: that session's
container had no AWS CLI or authorized hackathon profile, same as this one.

### RL-053 — 2026-09-16 — cross-cutting — Codex

**Landed:** shifted from independent feature work to cross-branch integration
at the user's direction. Surveyed all 14 remote branches for unique commits
against this one. Most had zero (`workstream/2-instructor-capture`,
`workstream/3-student-ar`, `workstream/4-aws-live`, `docs/aws-access-verification`,
`fix/ci-pnpm-corepack-order`, `claude/product-vision-scope-2uxb6j` — already
fully absorbed). `integ/ui-api` (111 unique commits) and `workstream/6-authoring`
(94, an ancestor of the same line) are Jacob's "Part 6" authoring/RAG pipeline —
real AWS Bedrock calls, document ingest, retrieval. **Not merged**: this bypasses
the institutional-approval gate AL-042/AL-045 exist specifically to enforce, and
adopting it is a product/governance decision, not a technical merge. `ui/blacksmith-revamp`
(14 commits, today, Omar Rizwan) mixes real bug fixes with an independently-built
caption system (collided with this session's own AL-048/049/050), a live "AWS AI
gateway" (Bedrock + Polly, same governance concern), and a "Dyslexic" reading mode
also present on `master`'s one code commit (`231d1fb`) and throughout
`docs/ADVANCED_FEATURES.md` — a team-wide naming pattern that reads as the
medical-condition framing AGENTS.md explicitly rules out ("student-selected local
preferences," never a diagnosis label). **Not merged**; this needs a team decision,
not a unilateral one.

Integrated what was clean and safe: AL-003's independent review (RL-052, above)
and AL-053, Omar's window/screen slide-matching fix (`8fde5aa` from
`ui/blacksmith-revamp`) — a real, isolated bug fix with no AI-gateway or naming
entanglement. One real conflict (`InstructorPanel.test.tsx`, two independent new
tests at the same insertion point, kept both); everything else auto-merged.
Found and fixed a genuine flaky timeout in the integrated `locate.test.ts` under
`make check`'s full parallel load (reproduced failing twice, passing in isolation
every time) with an explicit 20s per-test timeout. Also drafted, then reverted
before pushing, a cherry-pick of master's `docs/DEMO_BRIEF.md`: it instructs a
live demo to click into a "Dyslexic" tab that does not exist on this branch,
which would have been a false operational claim the moment it landed.
**Threads touched:** T-34 updated with AL-053's fix.
**Next agent needs to know:** the Part 6 RAG pipeline and the AI-gateway/dyslexic
content are real, substantial, already-built work by teammates — this is not a
dismissal of it, it is a governance flag. Bring it to the team rather than merging
it unilaterally from either side. `94f0047` (`ui/blacksmith-revamp`) has valuable,
narrower reconnect/`close()`/font fixes worth a second, more careful look to see
if they can be separated from that commit's dyslexia-font CSS coupling.
`memory/episodic/0070-window-and-screen-share-matching.md` has the full survey.

### RL-054 — 2026-09-16 — Part 1 — Codex

**Landed:** AL-054. Followed up on RL-053's note about `94f0047`: its fonts/
CSP fixes were tangled with `ui/blacksmith-revamp`'s own UI restyle (different
CSS variable names), so instead of cherry-picking the commit, independently
verified and reimplemented the three underlying fixes directly against this
branch. `z.config({ jitless: true })` (new `zodConfig.ts`, imported first in
`main.tsx`) stops Zod's `eval` probe from tripping Manifest V3's default
extension CSP on every load. `body { font: inherit; }` defends against
Chrome's own extension-page default font overriding `:root`'s chosen one --
applied on documented Manifest V3 behavior since this project's `dist`
preview runs as a plain browser tab, not `chrome-extension://`, so it can't
reproduce the override to confirm live. Three `::before` decorative glyphs
(`.draft-note`, `.connection-pill` x3) got the CSS alt-text production
(`content: '...' / ''`) so a screen reader doesn't announce them redundantly
alongside the real status text that already says the same thing -- the step
checkmark didn't need this, it already sits under `aria-hidden="true"`.
**Threads touched:** none new.
**Next agent needs to know:** verify the body-font fix visually during the
next real unpacked-extension QA pass, since this environment cannot load the
extension at its real `chrome-extension://` origin.

### RL-055 — 2026-09-16 — cross-cutting — Codex

**Landed:** AL-055, closing out the `94f0047` evaluation flagged in RL-053/
RL-054. `services/live-session/src/client/webSocketSessionClient.ts` is
entirely independent of `ui/blacksmith-revamp`'s UI restyle, so extracted a
scoped diff (`git diff 94f0047~1 94f0047 -- <file> <its test>`) and applied
it with `git apply` — clean, no conflicts, since neither branch had touched
that file since diverging. Three fixes: reconnect sends a fresh `join`
instead of trusting the relay's `resume` catch-up (which the deployed relay
posts during `$connect`, before API Gateway can actually deliver it — it
never arrives); retry extended from an effective ~9s to two minutes, plus an
immediate retry on the browser's `online` event; `close()` now waits briefly
for in-flight events to be acknowledged, fixing a race where a close sent
alongside the final `session.ended` could reach the relay first and get
that event refused.
**Threads touched:** T-32 annotated — the specific symptom (student reconnect
losing catch-up) is worked around client-side, but `resume()` itself and
instructor-role reconnect recovery remain untested server-side.
**Next agent needs to know:** this closes the `ui/blacksmith-revamp`
evaluation. What's left on that branch (the AI gateway, its own independently-
built captions, the dyslexic mode, the full UI restyle) is a governance
decision for the team, not further extraction work — see RL-053.
Real-device reconnect testing against a deployed relay is still blocked on
AWS credentials this session doesn't have.

### RL-056 — 2026-09-16 — cross-cutting — Codex

**Landed:** `docs/INTEGRATION_SWOT_20260916.md` — the full cross-branch
integration writeup: a per-branch disposition table, the RAG/Bedrock
governance flag (§2) and the "Dyslexic" naming flag (§3) written up in
full rather than just noted in a relay entry, a SWOT of the project's
actual current state, and a prioritized next-actions list split by what's
genuinely unblocked versus what needs a human, hardware, or an institutional
decision. A snapshot, like `docs/TEAM_ALIGNMENT_CHECK.md` — informative, not
a source of truth over this file.
**Threads touched:** none new; synthesizes RL-052 through RL-055.
**Next agent needs to know:** read `docs/INTEGRATION_SWOT_20260916.md` §6 for
the actual priority order before picking up new work. The three P0 items
are all one team decision or one available person away, not more code.
### RL-057 — 2026-09-16 — Part 3 — Prachi

**Landed:** direct master-branch follow-up for the student experience. Added a
student-local Dyslexic-friendly reading tab with an explicit style toggle and
keyboard-reachable semantics. Hardened instructor capture so
`getDisplayMedia()` is invoked before awaited session creation, preserving the
browser's transient user activation for tab, window, and full-screen sharing;
the captured stream now waits for metadata before playback and keeps the chooser
source unconstrained. Added `docs/NEXT_STEPS.md` with the staged Canvas/RAG,
quality, Bedrock-agent, privacy-preserving session context, and asynchronous
review plans; camera and AWS remain explicit follow-ups.

**Checks:** typecheck and targeted capture/student/renderer tests pass. Full test
execution still has the repository's Windows `python3` launcher and generated
pack line-ending issues to resolve separately; no model or camera behavior was
claimed by this slice.

**Threads touched:** none.

**Next agent needs to know:** the local preview should be run from `master` after
`npm ci`. The two teammate documentation edits are intentionally kept in the
stash while product work proceeds directly on `master`.
### RL-058 — 2026-09-16 — Part 1 — Codex

**Landed:** added `docs/ADVANCED_FEATURES.md`, defining a non-recording Review
Mode built from approved documents and semantic lesson summaries; live focus,
repeat, captions, and bookmarks; private accessibility-safe quests; and a future
instructor/shared-device camera source for non-screen-shareable labs. The document
includes an organic-chemistry gesture-to-semantic-event example and explicitly
keeps camera input feeding Focus, Read, Hear, Dyslexic, and AR rather than adding
a camera-only student mode.

**Next agent needs to know:** these are future features, not current MVP claims.
Review Mode must not replay a professor or require raw recordings. Camera work
needs mentor/accessibility validation, explicit consent, local processing where
practical, and a manual camera-free fallback.

**Threads touched:** none.

### RL-059 — 2026-09-15 — Part 6 — Jacob

**Landed:** `workstream/6-authoring` branched from `workstream/2-pack-driven-rendering`.
Claims Part 6, the authoring pipeline and visualization system specified in
`docs/VISUALIZATION_SYSTEM.md`: one instructor upload produces one draft Access
Pack (slide PNGs, fingerprints, regions, descriptions, Polly audio, an
interactive visualization where one fits, and citations into the professor's
own course library), the instructor reviews and publishes, and the student
modes render from the published pack. The pipeline is an HTTP API first;
the extension is its first client. Adds `infra/` (CDK stack
`AccessLensAuthoring`), `services/`, `apps/viewer/`, `scripts/catalog/`, and
`docs/prompts/viz/`. AR is out of scope for this pipeline and `arScene` is
never written by it.
**Threads touched:** T-42, T-43, T-44, T-45, T-35 opened — the four cross-part
edits Part 6 needs (Part 1 contracts, Part 3 `packMedia.ts` and
`StudentExperience.tsx`, Part 1 shell entry point) and Part 6's creation of
`infra/` in Part 4's absence. Nothing closed.
**Next agent needs to know:** the pack contract changes are strictly additive
and optional (`visualization` and `references[]` per asset, `audioUri` per
region, plus a new standalone `ArtifactManifest` contract). `LiveEventSchema`
gains no types; `asset.changed` and `region.changed` already carry everything
the Visualize mode needs. Part 5's `check_contract_conformance.py` is kept
passing in the same commit as every schema change.

### RL-060 — 2026-09-16 — Part 6 — Jacob

**Landed:** the authoring API is a working product on AWS. Stack
`AccessLensAuthoring` (`us-east-1`): API Gateway + bearer token, S3 decks /
packs / catalog / artifacts, DynamoDB jobs, CloudFront serving packs, media
and the viewer sandbox, and a Step Functions Standard workflow
(`services/publish/workflow.ts`) over an ingest container (LibreOffice +
Poppler), the deck analyst, the pack author and Polly audio, five slides at
a time. Seven real jobs were run; the last (`9ec32fb5-918f-49f0-ad9f-30b7db5eff85`)
went upload → `review` in 42 s, was reviewed and published through the API,
and its execution ended `SUCCEEDED` at 77 s. Pack `hnsw-explainer` versions 1
and 2 are on CloudFront with every slide image and audio file answering 200,
and the extension's student view renders version 2 through the Part 2
renderers (`apps/extension/src/shell/App.published.test.tsx`, run live).
Model-behaviour evals on Bedrock: pack author 8/8 tuned and 7/7 held-out;
planner chooses `none` on title slides and `retrieve` elsewhere. Local
gates: `make check` green.
**Fixed on the way, each by a real invocation, not a guess:** ingest bundle
had to be CommonJS (V3); the Map died on an absent `instructorHint` (V4);
pack author, audio and publish Lambdas built no default AWS client (V3/V4);
the workflow never wrote slides onto the job record so review rejected every
asset (V4/V5); and two publishers (the route and a workflow stage) could
have written a second version from a poll race, now one publisher, the
route, with `PutObject` only under `packs/`, `media/`, `artifacts/` (D10).
**Not deployed:** the visualization branch (planner, route, adapter,
generator, critic, harness) — implemented, unit- and eval-tested, wired
conditionally in the workflow, held back because the catalog it retrieves
from is one template stamped 150 times (D6) and the harness Lambda's
Chromium image is unbuilt. Every slide reports `visualizationStatus:
"no-visual"`, the spec's designed absence.
**Threads touched:** T-42, T-43, T-45 exercised (contracts additive, remote
pack loader in `packMedia.ts` under D7, no shell entry point built since the
product is API-only under D2). T-35 escalated to D9: `origin/master` now
carries Part 4's own `infra/` CDK app and the IBM Plex interface rebuild
(merged directly, no PR). The user decided D9 and this branch merged
master: one CDK app (`infra/bin/accesslens.ts`) now carries both the Part 4
`AccessLensLiveSession` stack and Part 6's `AccessLensAuthoring`; Part 6's
threads were renumbered from T-25..T-32 to T-31..T-38 and its log entries
from RL-025/026 to RL-036/037 because master used those ids for other
threads. T-35 (Part 6 owning `infra/`) and T-38 (the RL-025 collision) are
closed by that merge. PR #12 also claims T-31..T-33 and must renumber when
it lands after this. D5 and D6 still await the user.
**2026-09-16 update, integrating onto `codex/demo-proof-sprint-qa`:** hit the
same collision a second time -- this branch's own T-31..T-38 and RL-034..043
were already taken by unrelated `codex/demo-proof-sprint-qa` threads/entries.
Renumbered again on the way in: threads to T-42..T-45 (see the register in
section 3) and log entries RL-034..043 to RL-057..066 below. T-17/T-24/T-38
already named this exact failure mode; a third collision on the next
cross-branch merge should not be a surprise.
**Next agent needs to know:** `docs/VIZ_HANDOFF.md` is the runbook for
picking this up; `docs/DEPLOY.md` §5 has the measured timings; every user
decision is in `docs/VIZ_DECISIONS.md`. The stack is `RemovalPolicy.DESTROY`
throughout and `make destroy` removes it (the authoring stack only; the
live-session stack is Part 4's to destroy).

### RL-061 — 2026-09-16 — Part 1 + Part 3 — Omar Rizwan

**Landed:** the extension UI now follows Blacksmith's site layout, not just its
tokens: yellow masthead with a pixel wordmark (`shell/Wordmark.tsx`, drawn from a
5x5 bitmap, not their logo), `/ LABEL ■` section rules, pill buttons, window cards
with hard shadows, bento mode tabs, halftone fields. `shell/ThemeToggle.tsx` adds a
light/dark switch that pins `<html data-theme>`; dark-only values are now tokens.
WCAG AA text contrast measured in a real browser: zero failures in both themes.
No button text, id, or role that tests query changed; `make check` green.
**Threads touched:** none opened or closed. T-25 note: `VITE_ACCESSLENS_WS_URL` in
a local `.env.local` is enough to put the dev server on the deployed relay
(integration test 12/12 on 2026-09-16); committed `dist/` is still built without it.
**Next agent needs to know:** the HNSW draft pack's slides 04 and 05 are 16 bits
apart, under the 2x-margin (28) rule `validate_pack.py` enforces for the bio pack,
so it would show Unmatched between those two on a real capture. Demo on the bio pack.

### RL-062 — 2026-09-16 — Part 2 + Part 1 — Omar Rizwan

**Landed:** window and whole-screen shares now sync. Reproduced first: on the
reviewed pack the whole-frame fingerprint of a slide in a viewer window was 31
bits from itself and a slide in half a screen 47-55, against a threshold of 26,
so only tab shares ever matched. `sources/screen/locate.ts` searches window and
screen frames for the slide rectangle when the browser reports those surfaces;
tabs keep the old path. Measured on synthesized frames: reviewed pack 25/25,
0 false matches in 117 non-slide frames (guards in the screen README). The host
now caps sampling at 1280 px wide, excludes AccessLens's own tab from the
chooser, offers "share this tab instead", and reports the surface, which the
instructor banner names with a fix-it hint on Unmatched. Also a header switch
for dyslexia-friendly text (bundled OpenDyslexic, sentence case, wider line
spacing), stored in localStorage only — the font half of AL-010.
**Threads touched:** T-25 and AL-001/AL-002 still OPEN: none of this has run
against a real `getDisplayMedia()` window or screen; the unit tests use
composed frames.
**Next agent needs to know:** the synthetic test pack's slides are simple enough
to be found inside `unknown-01` in a window share, so window-share tests use the
reviewed pack. The HNSW draft misses 9/40 located cases (pale slides, 04/05
near-duplicates). Run the AL-001 matrix with Window and Entire Screen before
claiming this in the demo.

### RL-063 — 2026-09-16 — Part 4 + Part 1 + Part 3 — Omar Rizwan

**Landed:** AWS models in the live product. `services/ai-gateway` (new package,
deployed by the existing CDK stack as an HTTP API beside the relay) verifies the
relay's HMAC capabilities and serves: `/ask`, grounded answers from reviewed
packs only via Claude Sonnet 4.6 on Bedrock (BM25 retrieval, forced strict tool,
citations checked after the call, declines instead of guessing, nothing logged);
`/speak`, reviewed region text through Polly (never free text); and
`/transcribe-url`, instructor-only presigned Transcribe streaming URLs. The
extension gains instructor live captions with voice-driven region sync
(`sources/voice/`, `instructor/SpeechCaptions.tsx`), student captions, "Ask this
class", and Polly in Hear mode. T-16 closed: `caption.appended` carries text.
`make check` green (extension 328, relay 53, gateway 19).
**Threads touched:** T-16 closed; T-39 opened (remote audio needs a second
reviewer); T-40 opened (built, not deployed: credentials expired).
**Next agent needs to know:** Bedrock, Polly and Transcribe have only been
exercised with fakes and a mocked browser run. Refresh credentials, build both
services, `cdk deploy`, set `VITE_ACCESSLENS_AI_URL`, then run the smoke test,
which streams Polly speech through Transcribe with the extension's own framing.
Chrome does not show a microphone prompt in the side panel; captions must be
started from "Open in a full tab".

### RL-064 — 2026-09-16 — Part 4 + Part 1 — Omar Rizwan

**Landed:** the AI routes and the caption-carrying relay are deployed to the
hackathon account (`cdk deploy AccessLensLiveSession`, added only the AI API,
Lambda, role, and log group; relay code updated in place). Verified against real
AWS: `services/ai-gateway/scripts/smoke-test.ts` and the relay
`integration-test.mjs` both pass, and the deployed relay delivers a text
`caption.appended` to a student while refusing one carrying audio.
`services/ai-gateway/scripts/local-server.ts` runs the Lambda's handler on
127.0.0.1 for testing before a deploy. Build fix: Vite inlined the caption audio
worklet as a `data:` URL, which the extension CSP blocks (confirmed in Chromium
with the unpacked extension), so `vite.config.ts` now never inlines
`*.worklet.js`, and the extension-assets plugin honours `--outDir`.
**Threads touched:** T-40 closed; T-39 still open (second reviewer for remote
audio before merge).
**Next agent needs to know:** captions worked on `npx vite` but would have failed
only inside the installed extension; test voice features from the unpacked
build, not just the dev server. Build a demo copy with endpoints via
`npx vite build --outDir .cache/demo-extension` (gitignored) and keep the
committed `dist/` free of endpoints. Hackathon credentials last a few hours.

### RL-065 — 2026-09-16 — Part 6 + Part 1 — Jacob

**Landed:** the shared authoring bearer token is gone (D12). The HTTP API's
authorizer is now API Gateway's JWT authorizer against Google
(`https://accounts.google.com`; audiences: the deployment's OAuth web client
id from `GOOGLE_CLIENT_ID` plus the Google Cloud SDK's public client so
`gcloud auth print-identity-token` works for scripts). Every route but health
then applies `ACCESSLENS_INSTRUCTORS` (emails and `@domains`, deployed as
`INSTRUCTOR_ALLOWLIST`) in `services/api/identity.ts`: 403
`not_an_instructor` otherwise, nobody when empty. Jobs carry `ownerSub`; the
job routes answer 404 for another instructor's job. Deleted: the bearer
Lambda authorizer, the SSM token custom resource, the `BearerToken` /
`TokenParameterName` outputs, and the dead copies of the draft/review/publish
handlers in `operations.ts`. The instructor panel signs in with Google
(`apps/extension/src/shared/googleSignIn.ts`: `chrome.identity` implicit
flow inside the extension, Google Identity Services button on a web page),
keeps the ID token in localStorage until expiry, and drops it on a 401.
`make deploy` refuses to run without `GOOGLE_CLIENT_ID` and
`ACCESSLENS_INSTRUCTORS`; `make smoke` and `docs/DEPLOY.md` use
`gcloud auth print-identity-token`. The OpenAPI contract's security scheme
now says Google ID token and documents 403.

**Not deployed yet:** the stack change is proven by synth only (JWT
authorizer on 17/17 routes, allowlist env on the 17 route Lambdas). Deploying
needs the OAuth client id from Google Cloud console, which only the account
owner can create; until then the live API still runs the bearer build.

**Next agent needs to know:** the OAuth client needs `http://localhost:5173`
and the CloudFront viewer URL as authorized JavaScript origins, and
`https://<extension-id>.chromiumapp.org/` as a redirect URI for the installed
extension. Old job records have no `ownerSub`, so nobody can read them
through the API after the deploy; they expire on their own TTL.

**Threads touched:** T-41 opened (Google sign-in built, not deployed: needs
the OAuth client id). T-39 still open.

### RL-066 — 2026-09-16 — Part 6 + Part 1 — Jacob

**Landed:** two roles and the course library (D13). Students never sign in;
any verified Google account is an instructor, and `GET /v1/me` creates the
account record (`instructors` table) on first call, no allowlist (D12's
allowlist is deleted). Spec section 9 is wired for real: the seven profile,
document and search routes answer instead of 501, each scoped to the
owning instructor; `services/library/src/handler.ts` is the indexer (rides
in the ingest image, `library.handler`; Poppler, LibreOffice for PPTX and
DOCX, Titan v2, S3 Vectors, page-one verification); `retrieveHandler.ts`
is the retrieval Lambda the workflow calls before the analyst (three deck
windows, k 8) and before each slide's pack author (k 4) when the job names
a profile. Stack: `AWS::S3Vectors::VectorBucket`, `Instructors` table,
`Profiles` with `ownerSub-index`, `LibraryDocuments` keyed by `docId` with
`profileId-index` (replaces the old profileId/docId table), per-route
grants; `make destroy` deletes vector indexes first. Panel: course library
(create course, add and remove materials, watch indexing) and a course
picker on the deck form. `make check` green (658 tests).

**Proven live (deploy 2026-09-16, placeholder client id, gcloud ID
token):** `GET /v1/me` without a token 401; with one, created the
instructor record. `POST /v1/profiles` created `72b989fa…` with its own
vector index. `lec05-slides.pdf` (30 pages) registered and `ready` in about
10 s; search "minimax search over a game tree with an adversary" returned
page 12 (0.718), 16 (0.508), 18 (0.461) with verbatim text. Job `618f2ac0`
against that profile: the execution shows `RetrieveForDeck` once and
`RetrieveForSlide` eight times, the draft has zero references, which is
right (an HNSW deck against an adversarial-search lecture clears nothing).
With the HNSW deck registered as "last year's slides" (8 pages, ready in
5 s), job `9bb663c0` produced six of eight assets with page-cited verbatim
quotes. First deploy failed verify with `s3vectors:GetVectors` missing
(QueryVectors with metadata needs it); granted and redeployed.

**Threads touched:** T-41 narrowed (API usable with gcloud tokens; only
the browser button waits on the client id). T-39 still open.

**Next agent needs to know:** the indexer bundles from the ingest
Dockerfile, so a change there rebuilds both images (same asset, one build).
The documents table changed its key schema, which CloudFormation does by
replacement: a deploy over the bearer build drops the old (empty)
`Documents` table. A deck job always sends `profileId` (null when none);
the retrieval Choice states depend on that field being present.

### RL-067 — 2026-09-16 — cross-cutting — Claude (integrated from `origin/integ/ui-api` and `origin/ui/blacksmith-revamp`, at Anurup's explicit direction)

**Landed:** merged `integ/ui-api` (111 commits: the Part 6 authoring/RAG
pipeline, Google sign-in, course library, artifact viewer, catalog, the AI
gateway) onto this branch in full, plus `ui/blacksmith-revamp`'s Whisper-on-
SageMaker captioning path (the one piece of its own AI gateway not already
covered by integ's). This is the model-invocation, Canvas/course-content-
adjacent, and remote-audio work `docs/INTEGRATION_SWOT_20260916.md` §2
explicitly flagged as needing institutional approval before merging, done
here anyway because the repository owner directed it, in chat, after being
told exactly that. Recorded so it is not mistaken for a team decision: no
team conversation happened, and `docs/TEAM_ALIGNMENT_CHECK.md`'s open items
are unaffected.

Conflict resolution kept both branches' functionality rather than picking a
winner: `caption.appended` now accepts an optional `assetId` and a 500-char
cap (widening 280/required-assetId), `AudioView` supports both the
student-selected `speechRate` fallback and the Polly/`speak` gateway path,
`captureController` keeps `sendCaption` (manual) and gained `caption`/
`getCapability` (streaming), and `App.tsx`/`StudentExperience.tsx` carry
both branches' UI (camera control, review surface, and captions-preference
toggle alongside authoring panel, sign-in, and the Visualize/Dyslexic tabs).
Two duplications were found and left unresolved rather than decided
unilaterally: `StudentExperience` now renders **both** the toggleable
caption track and `LiveCaptionsView` (independently built, still separate);
blacksmith's own AI gateway was skipped entirely as redundant with integ's
(same routes, same design) except for Whisper, which integ's did not have.

Fixed the "Dyslexic" tab landing from `integ/ui-api` on the way in — the
same AGENTS.md violation `docs/INTEGRATION_SWOT_20260916.md` §3 flagged for
`master` and `ui/blacksmith-revamp` — by renaming the visible label and copy
to "Reading spacing" (mode id and file name left as `dyslexic`/
`DyslexicTextView`, internal only, not shown to a student).

Renumbered a second `docs/CONTEXT_RELAY.md` collision (T-17/T-24/T-38's own
failure mode, hit again): integ's own T-31..T-34 and RL-034..043 already
collided with this branch's unrelated threads/entries of the same numbers.
Threads renumbered to T-42..T-45; log entries to RL-057..066.

`make check` is green except `services/ingest`'s PPTX acceptance test,
which needs a `soffice` (LibreOffice) binary this machine does not have —
an environment gap, not a regression; typecheck, build, and every other
test (758) pass. `infra` typechecks with the new `AccessLensWhisper` stack
wired in (`infra/bin/accesslens.ts`); not deployed.

**Threads touched:** T-39, T-40, T-41 (integ's own, renumbering not
needed — no collision), T-42, T-43, T-44, T-45 opened (was integ's own
T-31..34). No existing thread closed.

**Next agent needs to know:** this is a QA/integration checkpoint, not a
merge to `master` and not a team sign-off on Bedrock/Canvas/remote-audio
capability. Before anything here reaches a demo or `master`: (1) the team
needs the §2/§3 conversation `docs/INTEGRATION_SWOT_20260916.md` recommended
as P0 — it is now more urgent, not less, since the capability is one branch
closer to shipping; (2) T-39 (remote-audio second reviewer) is still open;
(3) the caption-UI duplication (toggleable track + `LiveCaptionsView`) needs
an actual product decision, not two widgets left running side by side;
(4) `AccessLensWhisper` is unreviewed, undeployed CDK — do not `cdk deploy`
it without the same review any other AWS spend would get.

### RL-068 — 2026-09-16 — Part 2 + Part 3 — Omar Rizwan

**Landed:** students follow the instructor's mouse, and students' own screen
readers are first-class. On a window or entire-screen share,
`sources/screen/pointer.ts` finds the mouse pointer in the captured frames (a
background of the recognised slide; the pointer is what moves) and the
controller moves students to the reviewed region under it once it stays for
two samples; only that region, with its reviewed centre, is sent, never the
mouse position (the semantic-pointer rule in `captureController.ts` holds).
Instructor toggle: "Move students to the part of the slide under my mouse".
Focus view: the highlight is a fixed yellow band edged in ink so it shows on
dark slides, and the pointer marker sits outside the region instead of covering
its text. Screen readers: a polite live region announces slide and region
changes (VoiceOver, NVDA, JAWS, Narrator, ChromeVox), a "Screen reader"
settings group, "Read descriptions with" AI voice / my screen reader / browser
voice (also in Hear), and a skip link. Also: the relay's capabilities now carry
`streamToken`, which the strict schemas refused (every session failed); it is
an optional pass-through field. Extension tests 413 pass; end to end against the
deployed relay, pointing at each HNSW region moved the student and announced it.
**Threads touched:** none opened.
**Next agent needs to know:** tab shares never include the mouse pointer, so
following needs a window or screen share. The tracker was measured on rendered
HNSW slides with a drawn Retina arrow (240/240 located, 0 false reports), not
yet on a real macOS capture; if a slide animates, the >1% changed-cells guard
treats it as content, not a pointer.

### RL-069 — 2026-09-16 — Part 2 — Kunj Rathod

**Landed:** Graceful handling of model-truncated SVG diagrams in `orb-explain` service (`splitSvg`) and preflight check for extension build endpoints (`deploy_preflight.py`).
**Threads touched:** none.
**Next agent needs to know:** Truncated SVG diagrams degrade cleanly to prose description so screen readers and panel layout are not broken by partial SVG markup.

### RL-070 — 2026-09-16 — Part 5 — Kunj Rathod

**Landed:** Instructor "Prepare media" tab (`apps/extension/src/mediaPrep/`): upload `.pptx`, `.png`, `.jpg`, `.mp3`, `.mp4`; Claude drafts alt text (short + long description, decorative flag) and automatic transcription drafts captions; nothing can be copied or downloaded until the instructor approves each picture or ticks that captions were reviewed (charter A3). Exports: the same deck with PowerPoint's own alt text field and decorative flag filled, `.vtt` plus `.txt` transcript, and an alt text CSV for images. New `services/media-access` Lambda (`alt-text` via Bedrock Converse forced tool call, `transcribe` via Transcribe streaming with word timings), added to `AccessibilityServicesStack` as `MediaAccess`; endpoint `VITE_ACCESSLENS_MEDIA_ENDPOINT` or `mediaEndpoint` in storage. Checks: root vitest 492 passed, `services/media-access` `npm run check` 14 passed; driven end to end in real Chrome against a mock endpoint with a real lecture deck, MP3 and MP4.
**Threads touched:** T-46 opened.
**Next agent needs to know:** Not deployed and never called against real Bedrock or Transcribe — no AWS credentials were available, so the first real deploy is also the first real test of the prompt and of streaming faster than real time. Office fills `descr` with its own auto alt text ("Description automatically generated"); a real deck had 12 of 14 pictures like that, so `isOfficeGeneratedAlt` treats it as missing, not reviewed. Root `tsc` currently fails only on the untracked `apps/canvas-lti` prototype, which is not part of this change.

### RL-071 — 2026-09-16 — Part 5 — Kunj Rathod

**Landed:** `.github/workflows/deploy.yml` now builds every `services/*` bundle, runs `cdk deploy` from `infra/`, and writes all seven endpoints into the extension build. `docs/DEPLOYMENT.md` "One-time setup: GitHub deploy role" is a copy-paste runbook for a repository admin or their agent, with a failure table.
**Threads touched:** T-47 opened.
**Next agent needs to know:** nothing deploys until a repo admin runs that runbook once. `cdk synth` succeeds for all four stacks at `ddd4b2c` once every bundle is built; the deploy itself has not been run by anyone.

### RL-072 — 2026-09-16 — Part 5 — Kunj Rathod

**Landed:** Live captions in a live class. While sharing, the instructor clicks "Start live captions": `sources/audio/microphone.ts` opens the mic, `sources/audio/segmenter.ts` cuts utterances at pauses (or at the quietest gap before a 5 s cap), `instructor/liveCaptions.ts` sends each in order to the existing `services/captions` Lambda (AWS Transcribe) and publishes final results through the new `captureController.appendCaption`, so captions share the controller's sequence and pass the relay's monotonic check. Students' existing Live captions panel renders them. Root vitest 510 passed; driven in real Chrome with a fake microphone playing recorded speech, a mock captions endpoint, and a separate student page that joined the session and received every caption.
**Threads touched:** none.
**Next agent needs to know:** never run against real Transcribe; needs `AccessLensAccessibility` deployed and `VITE_ACCESSLENS_CAPTIONS_ENDPOINT` set (the fixed deploy workflow now passes it). Captions arrive roughly one utterance (≤5 s) plus transcription time behind speech; lower latency needs a held-open streaming connection, which a Function URL cannot provide. The Chrome side panel may be unable to show a microphone prompt; "Open in a full tab" is the fallback the error message names.

### RL-073 — 2026-09-16 — cross-cutting — Omar Rizwan

**Landed:** `accesslens-extension-ar-pivot` (Kunj's integration line, through
PR #22) merged into `codex/demo-proof-sprint-qa` at `2932e9d`; 27 conflicted
files resolved. `caption.appended` is now the union of both contracts in Zod,
the JSON schema, the Python reference and the relay: text up to 2000
characters, optional `lang`, optional `assetId`, still strict. Both instructor
caption paths are kept: `SpeechCaptions.tsx` (Whisper or Transcribe through the
AI gateway, renamed from `LiveCaptions.tsx`, which differed from Kunj's
`liveCaptions.ts` only in case and resolved to the wrong module on macOS) and
`liveCaptions.ts` (the captions service, with a language). The student's "Show
instructor captions" preference also hides the accessibility bar's captions
panel. `make check` passes except the three `[slow]` ingest tests that need
Poppler and LibreOffice locally (CI installs them; they fail the same way
before the merge); in a browser against the deployed relay, a session, pointer
following, screen-reader announcements, Hear, Prepare media and the
accessibility bar all work.
**Threads touched:** Kunj's T-31/T-32 renumbered T-46/T-47 (both numbers were
taken here); his RL-034..037 are RL-069..072 above.
**Next agent needs to know:** the instructor panel now has two live-caption
controls and the student view two caption displays. That duplication is
deliberate for this merge, not a decision: the team should pick one path.
`accesslens-extension-ar-pivot` itself is unchanged; merging this branch into it
is now conflict-free.

### RL-074 — 2026-09-16 — Part 3 + Part 4 — Omar Rizwan

**Landed:** the student study chat. `services/ai-gateway/src/chat.ts` streams a
multi-turn conversation with Claude Sonnet 4.6 through the Bedrock Converse API,
screened by a new Bedrock Guardrail (`accesslens-study-chat`, synchronous stream
mode: content filters, a graded-work-answers denied topic, PII, profanity). It
runs as its own Lambda behind a `RESPONSE_STREAM` Function URL (`StudyChatUrl`
output) in `AccessLensLiveSession`, verifies the relay capability, rate-limits per
session, and grounds in the reviewed lesson (bundled or published
instructor-reviewed packs). `StudyChat.tsx` replaces "Ask this class" in the
student view when `VITE_ACCESSLENS_CHAT_URL` is set. Checked against real
Bedrock: first text about 1 s; a course-search round trip worked with a fake
source; end to end in a browser on the HNSW lesson.
**Threads touched:** none opened.
**Next agent needs to know:** retrieval is not implemented here by design. The
team's Knowledge Base plugs in with `cdk deploy -c studyChatKnowledgeBaseId=<id>`
(the model then gets a `search_course_materials` tool); any other retriever is
one `CourseKnowledge` implementation in `knowledge.ts`. Classic Bedrock Agents
are denied account-wide (`bedrock:CreateAgent`, even for the CDK role), which is
why the agent is the Converse tool loop; AgentCore Runtime is allowed if a hosted
agent is ever needed. The guardrail has not yet been exercised against real
student questions: check for false positives (especially the denied topic)
right after deploying.

### RL-075 — 2026-09-16 — Part 6 — Codex

**Landed:** AL-056's approval-gated class-assistant implementation: PDF
quarantine validation, per-class vector retrieval, Google-authenticated
membership with expiring/revocable invites, cited draft/published facts, and
local-only confirmed student tasks. The model flag is false by default; no
student question, answer, task, or preference is persisted by the service.

**Threads touched:** T-29 remains OPEN and non-blocking. Its evidence now
links the approval-ready synthetic/public implementation decision; it does not
approve real course content.

**Next agent needs to know:** `memory/episodic/0073-approval-gated-class-library-assistant.md`
has the exact test evidence and boundaries. Do not enable
`courseAssistantEnabled` or load real course material until the privacy,
retention, OAuth, and institutional-review prerequisites are explicitly met.

### RL-076 — 2026-09-16 — Part 6 — Codex

**Landed:** AL-057 adds a distinct student Class library surface: a separately
stored Google session, invite redemption, cited-or-declined asks scoped to one
membership, provisional labels, and private local tasks with removal. It does
not alter the live relay or enable the class-assistant feature flag.

**Threads touched:** T-29 remains OPEN and non-blocking; AL-057 continues the
synthetic/public-only boundary recorded by AL-056.

**Next agent needs to know:** this UI is ready for review with fake clients;
real use waits on the same OAuth and human activation prerequisites as AL-056.

### RL-077 — 2026-09-16 — Part 6 — Codex

**Landed:** AL-058 replaces synchronous class deletion with immediate archive
and access revocation, a durable one-per-class purge job, a separately
privileged cleanup worker, and an owner-only status route. The stored record
contains only opaque ids, owner subject, timestamps, state, and fixed failure
codes; it stores no source text, question, answer, task, or student identity.

**Threads touched:** T-29 remains OPEN and non-blocking. This retention
hardening does not approve real course content or change the disabled assistant
feature flag.

**Next agent needs to know:** AL-058 remains IN_REVIEW. Its worker reuses the
existing class document/vector/metadata teardown; physical per-instructor source
buckets and malware scanning remain separate hardening work. Real activation
still requires the documented privacy, retention, OAuth, and institutional
review prerequisites.

### RL-078 — 2026-09-16 — Part 6 — Codex

**Landed:** Review corrections for AL-056/058: invitation redemption now uses
one DynamoDB transaction, the disabled class-assistant boundary blocks new
membership/fact persistence and automatic fact extraction, archived classes
reject new indexing, and a deletion retry completes class metadata cleanup even
after an earlier worker removed the profile.

**Threads touched:** T-29 remains OPEN and non-blocking. These corrections do
not enable the feature or approve real-course material.

**Next agent needs to know:** source buckets are still shared by prefix; the
physical per-instructor-bucket and malware-scanning controls remain open
hardening work before any real-course activation.

### RL-079 — 2026-09-16 — Parts 2, 3, 4 — Jacob

**Landed:** live video of the instructor's tab or window to students,
per `docs/prompts/window-stream-build.md`. Relay (`f50ce29`): one Amazon
IVS Real-Time stage per session (`services/live-session/src/stage.ts`,
`ivsStage.ts`), `streamToken` beside the capability (publish for create,
subscribe-only for join), `stream.started {surface}` / `stream.stopped`
in Zod, JSON schema, Python reference and the relay rules, monitor
surface refused by all four, `latestStream` catch-up in sequence order,
stage deleted on `close`, `session.ended`, and by `StageSweeper` on the
sessions table's TTL stream. Deployed and probed: create and join carry
tokens that differ by role and carry no user id, `get-stage` finds the
stage, `ResourceNotFoundException` after close. Instructor (`be20ff5`):
Stream this window / Stop streaming, existing capture track reused, chooser
only in Slides-follow mode, whole monitor refused, stream ends before
`capture.stopped`. Student (`bdf251b`): `<video>` pane above the mode tabs,
muted inline, one-sentence failure, join-mid-stream from catch-up. Section
4 records the A2 decision. 534 + 63 tests, `dist/` rebuilt.
**Threads touched:** T-48 opened and closed the same day (hosted shell
redeployed from this lane once the product owner approved).
**Next agent needs to know:** the Lambda bundle now carries
`@aws-sdk/client-ivs-realtime` (CJS) inside ESM, which needs the
`createRequire` banner in `services/live-session/package.json`; without it
every route fails at init with "Dynamic require of node:https". IAM for
Real-Time uses the `ivs:` prefix, not `ivs-realtime:`. `resume` mints no
token: it runs on `$connect`, where nothing can be posted, and the client
keeps the token from create/join. Video actually rendering across two
devices was not verified from a terminal.

### RL-080 — 2026-09-16 — Part 3 — Jacob

**Landed:** screen readers hear the reviewed description. The student
shell's `role="status"` line (`apps/extension/src/student/liveState.ts`)
now speaks `"<region label>: <shortDescription>"` on `region.changed` and
`"Now on <slide title>."` on `asset.changed`, `aria-atomic`, once per event.
The Focus figure's description moved from `aria-label` to a `figcaption`
(`renderers/FocusView.tsx`) so say-all and line reading reach it. No
permissions, no dependencies; works in the extension and the hosted shell.
**Threads touched:** none.
**Next agent needs to know:** there is no Chrome-native screen reader
outside ChromeOS (ChromeVox is ChromeOS-only; `chrome.tts` is speech
output, not a reader; `accessibilityFeatures.spokenFeedback` is ChromeOS
only). The bar is "works with VoiceOver, NVDA/JAWS and ChromeVox", which
this markup meets by construction; an in-app keyboard reading mode over
`chrome.tts` is a separate, undecided feature.

### RL-081 — 2026-09-16 — Part 3 — Jacob

**Landed:** Hear mode is gone. `renderers/AudioView.tsx`,
`student/regionAudio.ts`, `regionAudioUrl` in `shared/packMedia.ts` and the
`speak` method on `shared/aiClient.ts` were deleted with their tests; the
`audio` value left the preferences enum, and a saved preference this build
no longer offers now falls back to the defaults instead of throwing on
load. The mode tabs carry a one-line hint that screen readers read every
description here. It also removes the double-voice problem reported today:
the Hear panel's own live region no longer competes with the screen reader.
**Threads touched:** none.
**Next agent needs to know:** the AI gateway's `/speak` route
(`services/ai-gateway`) still exists and is now unused by the shell; it
belongs to the gateway's owner to remove. `docs/ACCESSLENS_PROPOSAL.md`,
`ACCESSLENS_MVP_REVISION.md`, `DEMO_BRIEF.md`, `ADVANCED_FEATURES.md` and
`NEXT_STEPS.md` still describe Hear as a mode; they are historical planning
documents and were not rewritten.

### RL-082 — 2026-09-16 — Part 4 + Part 1 + Part 3 — Omar Rizwan

**Landed:** the automated live quality bench and extension load check
(`scripts/qa/`, results in `docs/qa/live-bench-results.md`), and fixes for what
they found. `WebSocketSessionClient` now re-joins a reconnected student so it
is caught up (the relay's resume catch-up is posted during `$connect` and never
arrives), keeps retrying for two minutes and again on the browser `online`
event instead of giving up after about 9 s, and waits for in-flight events to be
acknowledged before sending `close`, so End Session reaches students (6/6
through the client against the deployed relay, 2/6 before). In the installed
extension, running text now uses IBM Plex and the dyslexia font (Chrome's
extension stylesheet set `body` to system-ui at 75%), Zod no longer reports CSP
violations, and decorative CSS glyphs are out of accessible names. Extension
load check 12/12; live bench H04, E01, L09 now pass. No relay redeploy needed.
**Threads touched:** T-50 opened (silent stall shows "live"; needs a heartbeat
message in the frozen protocol, a team decision).
**Next agent needs to know:** P01 and P03 still fail by design of the check:
they drive the relay without the extension client, so they show the relay's
own behaviour that the client now works around. Test the unpacked build, not
only `npx vite`: three of these bugs existed only under the extension origin.

### RL-083 — 2026-09-16 — Part 5 — Kunj Rathod

**Landed:** Course materials, fully automatic. Professors create a class once, then drop in PDF, PPT/PPTX, DOC/DOCX, XLS/XLSX, images (including HEIC/SVG/TIFF) or audio/video; students enter the class code in the extension and read and watch them. `services/course-media` + `infra/lib/course-media-stack.ts` (`AccessLensCourseMedia`): presigned upload to S3 -> container worker (LibreOffice, poppler, ffmpeg, ImageMagick, libheif) renders pages and asks Claude on Bedrock for page and figure alt text, or extracts audio and starts a Transcribe job (language auto-detected, WebVTT) -> EventBridge -> `finish` writes the manifest. The worker image is built by CodeBuild during `cdk deploy`, so deploying needs no local Docker. Extension: `apps/extension/src/courseMedia/` for both roles; Live lesson and Course materials are tabs that stay mounted, which also fixes PR #19's tab switch ending screen sharing. Removed the review-gated upload flow and `services/media-access`. Checks: root vitest 486 passed, `services/course-media` 14 passed, extension and infra `tsc` clean, `cdk synth` for all five stacks; the professor and student flows were driven in real Chrome against a local mock of the API (upload, progress, page alt text, captions track, transcript seeking).
**Threads touched:** T-51 opened.
**Next agent needs to know:** never deployed. The first `cdk deploy` is the first build of `services/course-media/worker/Dockerfile` (CodeBuild, about 10–15 minutes) and the first time CodeBuild and ECR are used in the workshop account. If the image build fails, the stack rolls back with the CodeBuild log link in the error. Run `npm run build` in `services/course-media` before `cdk synth`/`deploy`; the worker asset is `worker/` including `worker/dist`.

### RL-084 — 2026-09-16 — cross-cutting — Claude (branch consolidation onto master, at Omar Rizwan's direction)

**Landed:** every branch with unmerged work is merged into `master`:
`codex/demo-proof-sprint-qa` (with `accesslens-extension-ar-pivot`),
`codex/class-library-deletion-jobs` (with `course-library-assistant` and
`student-course-experience`), `lane/screen-reader` (with `integ/ui-api` and
`lane/window-stream`), the parts of `ui/blacksmith-revamp` not already here
(the quality bench, RL-082), and `claude/accesslens-demo-proof-qa-31tqrj`
(already integrated; recorded with `-s ours`), then `accesslens-extension-ar-pivot`
again for PR #24 (Course materials, RL-083), which landed while this was under
way. Where two lines contradicted each
other the newer change was kept: Hear mode stays removed (RL-081), so the
Review surface lost its Hear tab and the student settings lost the read-aloud
voice and speed selects that only `AudioView` used; "Fix a wrong match" and
"Point students at a region" stay removed (`lane/screen-reader`). Everything else is the
union: screen analysis, captions (2000 characters with `lang`), pointer
following, Find AR, Slides following, live video, the class library, and Course
materials in place of Prepare media. The instructor's Live lesson and Course
materials tabs both stay mounted; the student's live lesson stays mounted behind
Review, Class library and Course materials. Log entries renumbered
RL-075..078, RL-079..081, RL-082 and RL-083; threads T-48, T-49, T-50 and T-51.
`make check` passes except the three `[slow]` ingest tests that need Poppler and
LibreOffice locally.
**Threads touched:** T-48..T-51 renumbered in (see above); none opened. T-46
still describes `services/media-access`, which PR #24 removed; its owner should
close or rewrite it.
**Next agent needs to know:** `codex/live-workspace-foundation` (three commits,
2026-08-28, the superseded Evidence Engine prototype) was deliberately not
merged. `scripts/qa/live-bench.cjs` and `extension-load.cjs` still drive the
removed "Indicate region" and "Apply correction" forms, so those steps fail
until the bench is pointed at pointer following or Slides following instead.
`ScreenAnalysisView` still has a `hear` branch that nothing selects.

### RL-085 — 2026-09-16 — Part 3 — Claude (at Omar Rizwan's direction)

**Landed:** the Focus outline lines up with its region again. Since RL-080 put the
reviewed description in a `figcaption` inside `.slide-figure`, the outline's
percentage bounds and its scrim were measured against the image plus the caption,
so on the HNSW deck `step-1-text` sat about 25 px low, ran into the level bars,
and the caption was dimmed under the scrim. `renderers/FocusView.tsx` now wraps
the image, outline and pointer in `.slide-frame`; the caption sits outside it with
its own background. Measured in a browser: outline top and height equal the
region's fractions of the image to within 0.01 px.
**Threads touched:** none.
**Next agent needs to know:** the HNSW pack splits each step into a text region
and a diagram region (`step-1-text` is the heading and sentence only;
`level-bar-chart` is the bars), so the outline covering only the text is the
pack's authoring, not a rendering fault.

### RL-086 — 2026-09-16 — Part 3 — Claude (at Omar Rizwan's direction)

**Landed:** Focus shows the whole slide, with no outline, until the instructor
points at a region (`renderers/FocusView.tsx`). A slide change names no region,
and Focus used to fall back to the pack's first region, which on the HNSW title
slide was the small "Engineering explainer" label, and a region id that is not on
the slide no longer falls back to another one. The instructor console now says
why pointing does nothing instead of offering the pointer checkbox where it
cannot work: Follow Google Slides reads only the tab URL and a tab share has no
mouse pointer; only a window or entire-screen share can move students to a
region.
**Threads touched:** none.
**Next agent needs to know:** pointer following has still never been measured on
a real macOS window capture, only on rendered slides with a drawn arrow
(RL-068). The published HNSW pack lists `title` in slide-01's reading order but
gives it no region, so the big title can never be outlined until the pack is
republished.

### RL-087 — 2026-09-16 — Part 4 — Claude (at Omar Rizwan's direction)

**Landed:** `npm run relay:local` (`scripts/local-relay.ts`) runs the same `Relay`
on `ws://localhost:8788` with the in-memory store and no video stage, reading
published packs from the asset distribution like the deployed relay. Point a
build at it with `VITE_ACCESSLENS_WS_URL=ws://localhost:8788` (for `npx vite`, a
gitignored `.env.development.local` does this). Also: ending a session no
longer leaves the page unable to open another. `wrapLiveRelayClient` takes a
factory and replaces a closed client on the next `create`/`join`; before, switching
packs with a session open made every later Start fail with "Could not open a
session" until reload. Checked against the local relay: create, close, create
again works; a student joining an HNSW session sees slide-06 with `step-1-text`
outlined at the pack's bounds.
**Threads touched:** T-49 recurs: the deployed `AccessLensLiveSession` returns no
`streamToken` and forwards no events for `introduction-to-hnsw` (a bundled
`bio-cell-demo` session works), so it was again deployed from a tree without
the pack resolver. Not redeployed here.
**Next agent needs to know:** capabilities from the local relay are signed with a
per-run secret, so the deployed AI gateway (study chat, Ask, Whisper captions)
refuses them unless `CAPABILITY_SECRET` is the deployed relay's. Live video
needs IVS and is unavailable locally.

### RL-088 — 2026-09-16 — Part 5 — Kunj Rathod

**Landed:** `AccessLensCourseMedia` is deployed (endpoint in the stack output `CourseMediaUrl`) and verified with real uploads: a 3-page PDF, a DOCX, an iPhone HEIC, a MOV and an MP3 all went from upload to ready in about 60 seconds, with page and figure alt text from Bedrock, a remuxed playable MP4, and Transcribe captions in auto-detected en-US. A student view in real Chrome against the deployed API showed the slide images with alt text and the MOV playing with 18 caption cues. Two fixes found by deploying: the image-build custom resource used one handler for onEvent and isComplete, so every poll started another CodeBuild build and the first deploy rolled back; and signed URLs now set `text/vtt`/audio content types, since S3 served captions as binary/octet-stream.
**Threads touched:** none.
**Next agent needs to know:** the extension download on CloudFront still predates this; rebuild with `VITE_ACCESSLENS_COURSE_MEDIA_ENDPOINT` set before anyone installs it. A test class `QPTBJ4ZL` with five items exists in the deployed table and expires with the 90-day retention.

### RL-089 — 2026-09-17 — cross-cutting — Codex

**Landed:** corrected the final first-deploy workflow blocker in
`codex/fix-deploy-service-loop`: service install/build loops now skip
`services/api/`, which is a root-bundled CDK handler rather than an npm package
and therefore has no lockfile. The GitHub Actions check job, deploy job, and
one-time role runbook now select the same six service packages.
**Threads touched:** T-47 remains OPEN until the OIDC role is created,
`AWS_DEPLOY_ROLE_ARN` is set, and the first Deploy workflow completes.
**Next agent needs to know:** merge this small P1 fix before triggering the
workflow; then execute `docs/DEPLOYMENT.md`'s one-time GitHub deploy-role
setup with fresh workshop credentials. Do not store the credentials in source,
GitHub Secrets, or a relay entry.

### RL-090 — 2026-09-17 — cross-cutting — Codex

**Landed:** corrected the GitHub OIDC trust subject in
`codex/fix-deploy-oidc-subject`. CloudTrail showed the current GitHub token
uses `repo:owner@owner-id/repo@repo-id:environment:aws`, not the legacy
`repo:owner/repo:*` form; the role now accepts either template while pinning
the visible owner/repository names and audience.
**Threads touched:** T-47 remains OPEN until the corrected role policy is
deployed and the Deploy workflow completes.
**Next agent needs to know:** merge this P1 policy correction, rerun the
single `AccessLensGitHubDeploy` stack, then rerun `deploy.yml`. The role must
not be widened to arbitrary repositories or an unconditioned OIDC principal.

### RL-091 — 2026-09-16 — cross-cutting — Claude (at Omar Rizwan's direction)

**Landed:** the Deploy workflow can deploy master and only master. Two branches
deployed the same stacks: at 19:10 local a push to `accesslens-extension-ar-pivot`
redeployed its `AccessLensLiveSession` (relay only, no `PACK_BASE_URL`, no IVS, no
AI or study chat functions) over master's, so every published pack such as
`introduction-to-hnsw` was refused. Meanwhile master never deployed: the workflow's
check job had no Poppler or LibreOffice, and from `infra/` the authoring stack
resolved its paths from the working directory. Fixed: `deploy.yml` triggers on
`master` only and installs Poppler and LibreOffice; the relay's `packBaseUrl` falls
back to the authoring distribution (a cross-stack import) when `.env.local` sets
none; the authoring stack finds the repository root from its own file, its
Node.js functions bundle from that root, and its Docker assets skip
`infra/cdk.out`; `AccessLensWhisper` is behind `-c withWhisper=true` so
`cdk deploy --all` never starts the hourly GPU endpoint. `cdk ls` from `infra/`
lists six stacks; the synthesized live-session template has four functions and
imports the distribution domain for `PACK_BASE_URL`.
**Threads touched:** T-49 cause found (two auto-deploying branches, see above);
T-47 still OPEN until a master Deploy run completes.
**Next agent needs to know:** deploy from master (push, or run the workflow). A push
to the integration line no longer deploys. Whisper is deployed and destroyed only
with the flag, as `services/ai-gateway/README.md` now shows.
### RL-092 — 2026-09-16 — deployment configuration — Codex

**Landed:** the post-deploy extension build now inlines `ApiUrl` and
`GoogleClientId` from `AccessLensAuthoring`, alongside the existing relay and
service endpoints. Before this correction, the downloadable extension had no
authoring API or Google sign-in configuration even though the stack exposed both
outputs, so the Upload slides panel correctly failed closed. The local Vite
preview was separately configured from its ignored `.env.local`; no credential,
student data, upload policy, or course-assistant activation changed here.
`docs/DEPLOYMENT.md` now records the completed OIDC setup and requires these two
outputs in a successful release summary.
**Threads touched:** none.
**Next agent needs to know:** deploy the workflow revision and install its newly
published extension artifact before testing Upload slides. Google sign-in still
depends on the Google Console origin and the deployed instructor allowlist; a
failed sign-in is not permission to weaken either boundary.

### RL-093 — 2026-09-16 — Part 3 + Part 4 — Claude (at Omar Rizwan's direction)

**Landed:** the study chat guardrail's denied-topic definition is under Bedrock's
200-character limit. Deploying `AccessLensLiveSession` from master failed on
`StudyChatGuardrail` ("topic definitions exceeds the maximum allowed length") and
rolled back to the relay-only stack, so the AI and study chat functions could not
come back; the Deploy workflow would have failed the same way.
**Threads touched:** T-47 still OPEN until a master Deploy run completes.
**Next agent needs to know:** keep the definition at 200 characters or fewer and
each example at 100 or fewer.
### RL-094 — 2026-09-16 — deployment configuration — Codex

**Landed:** the master deployment workflow reads `ApiUrl`, `GoogleClientId`, and
`AssetBaseUrl` from the existing `AccessLensAuthoring` stack before deploying
the other stacks. `AccessLensAuthoring` owns the OAuth client and hosted web
assets, so its own script remains responsible for deployment; the generic CDK
run creates only its required synth placeholders. The downloadable extension
then falls back to these public authoring outputs when `/tmp/outputs.json` does
not contain that separately managed stack. This resolves both the prior
`CannotFindAsset .../dist-web` failure and the missing Upload slides
configuration without inventing endpoints or weakening sign-in.
**Threads touched:** none.
**Next agent needs to know:** wait for a successful master deployment before
asking an instructor to retest Upload slides. A successful build exposes the
sign-in control; authorization still depends on the configured Google origin
and instructor allowlist.

### RL-095 — 2026-09-16 — deployment configuration — Codex

**Landed:** the deploy workflow now invalidates CloudFront's stable extension,
install-page, and demo-pack paths after publishing them. The master deployment
artifact contained the authoring API and Google client configuration, but the
public `accesslens-extension.zip` still served an older cache entry; a targeted
invalidation was issued to restore the current installer immediately. Future
deployments create that invalidation themselves, using the deploy role's
existing `cloudfront:CreateInvalidation` permission.
**Threads touched:** none.
**Next agent needs to know:** verify the public ZIP's hash or its embedded
authoring configuration after a deployment before telling an instructor to
reload. The workflow artifact alone is not proof that CloudFront is current.

### RL-096 — 2026-09-16 — deployment — Kunj Rathod

**Landed:** The master Deploy run after #31 deployed every stack and then failed publishing: the new cache invalidation looked the distribution up with `cloudfront:ListDistributions`, which `AccessLensGitHubDeploy` does not allow. `AccessLensDistribution` now outputs `DistributionId` and the workflow invalidates by that id, so no role change is needed.
**Threads touched:** none.
**Next agent needs to know:** the deploy role allows `cloudfront:CreateInvalidation` only; anything that needs to find AWS resources in CI should read stack outputs rather than list the account.

### RL-097 — 2026-09-16 — cross-cutting — Claude (live pairing with Anurup Kumar)

**Landed:** local dev (`http://localhost:5173` in real Chrome, no unpacked extension) now works end to end against the deployed AWS stacks. Found three separate causes: (1) the `npx vite` process on 5173 had silently died, started outside any tracked config in a terminal nobody could see — added an `accesslens-dev` entry to `.claude/launch.json` so it's a tracked, log-visible process; (2) `.env.local` never had `VITE_ACCESSLENS_AI_URL`/`VITE_ACCESSLENS_CHAT_URL`/`VITE_ACCESSLENS_COURSE_MEDIA_ENDPOINT`/`VITE_ACCESSLENS_ORB_ENDPOINT` set even though those backends are deployed and CORS-open — pulled current values from `aws cloudformation describe-stacks` and added them; (3) `vite.config.ts`'s `/ai` proxy target was stale (still `5skua1vus7...` from the T-49 incident recovery, itself since superseded by `nxhrvn0odk...`), confirmed dead/unused but fixed anyway. Verified live against real AWS, not mocked: relay create/join/event-delivery in under 2s, Ask-this-class answering with a correct citation and the Bedrock guardrail correctly declining an off-topic question, a valid signed Transcribe grant, `make pack-check` clean (70/70), and — on the user's actual Chrome — a full screen-share → join-code → student-join → unmatched-on-Discord → recognized-slide-sync round trip. Also added `packages/access-packs/bio-cell-demo/deck-preview.html`, a static click/arrow-key slideshow over the five reviewed slide PNGs, so one shared tab can stand in for a real presentation deck during local rehearsal instead of a single static image.
**Threads touched:** T-52 opened (local dev config has no redeploy-sync automation and this is the second time it's silently gone stale).
**Next agent needs to know:** `npm run test` has one pre-existing unrelated failure, `services/ingest/src/ingest.test.ts` needing `soffice`/LibreOffice installed locally for PPTX conversion — not a regression, doesn't block the live-session demo. "AI screen analysis is not configured" in the instructor panel is expected/correct: per `docs/IMPLEMENTED_FEATURES.md`, no generic screen-analysis Lambda has ever been deployed on master; the offline pack matcher is the intended fallback. Full account in `memory/episodic/0076-local-dev-e2e-debugging.md`.

### RL-098 — 2026-09-16 — deployment configuration — Claude (at Anurup Kumar's direction)

**Landed:** the deploy workflow's "Rebuild the extension against the deployed endpoints" step (`.github/workflows/deploy.yml`) wires `AccessLensLiveSession`'s captions/recap/translate/course-media/orb outputs into the built extension's config, but never included `AiApiUrl` or `StudyChatUrl` — the two endpoints Ask-this-class and Study Chat need. The real installed/downloadable extension has therefore never had either feature configured, on any past deploy. Added the two missing lines (`VITE_ACCESSLENS_AI_URL=${find("AiApiUrl")}`, `VITE_ACCESSLENS_CHAT_URL=${find("StudyChatUrl")}`), matching the existing pattern exactly; YAML validated with `python3 -c "import yaml; yaml.safe_load(...)"`.
**Threads touched:** none opened; relevant to T-40 (closed) in spirit but that thread was about the routes existing at all, not the extension build wiring them in.
**Next agent needs to know:** committed and pushed as `00dea5f`, but **no deploy has actually completed with this change yet** as of this entry — a triggered run was intentionally cancelled mid-check at the requester's instruction, before `cdk deploy` started. First real deploy after this lands should confirm Ask-this-class and Study Chat actually appear in the downloaded extension.

### RL-099 — 2026-09-17 — cross-cutting — Claude (live pairing with Anurup Kumar)

**Landed:** every published pack other than the two bundled demo packs failed to load in local dev with "Failed to fetch" — found live while QA-ing the Upload-slides pipeline with a real 23-slide instructor deck. Root cause was self-inflicted earlier the same session: `.env.local`'s `VITE_ACCESSLENS_ASSET_BASE_URL` had been set to the absolute CloudFront URL (RL-097, to fix the unrelated AI-screen-analysis message), which makes `remotePack.ts`'s `publishedPackUrl()` build a cross-origin URL that bypasses `vite.config.ts`'s same-origin `/packs` proxy entirely — sending the browser straight to CloudFront, where its CORS response turned out to be inconsistent across edges. Fixed by clearing the variable back to empty (its own code comment already said to); verified with the app's exact code path before confirming live with the instructor's real Chrome, on both a real 23-slide class deck and a synthetic test deck. Strengthened `.env.example`'s comment on this variable so the lesson survives even though `.env.local` itself is gitignored.
**Threads touched:** relates to T-52 (local dev config drift) but is a distinct failure mode — a value that is actively wrong for local dev, not merely stale.
**Next agent needs to know:** this almost certainly never affected the real deployed extension — a packaged Chrome extension's `host_permissions` (already listing `https://*.cloudfront.net/*`) bypass CORS entirely for its own fetches, a privilege a plain `npx vite` browser tab does not have. Not independently verified against a real installed build. Full debugging trail, including the dead ends chased first (a suspected CDN propagation delay, a cancelled-then-irrelevant CloudFront invalidation, a device-emulation red herring, Dark Reader ruled out via Incognito), is in `memory/episodic/0077-published-pack-cors-local-dev.md`.
