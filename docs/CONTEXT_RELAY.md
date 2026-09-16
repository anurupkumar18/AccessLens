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

Integration branch: `accesslens-extension-ar-pivot`. Nothing merges to `master`
during the build.

| Part | Owner | Branch | State | Proof |
| --- | --- | --- | --- | --- |
| 1. Foundation and contracts | Anurup Kumar | merged as `38542ad` | Shell split, per-type discriminated-union event contract, `RoleCapabilitySchema`, frozen `SessionClient` (create/join/send/subscribe/close), local preferences, `.env.example`, ajv + typecheck in `npm run check`. Closed T-02, T-03, T-04. T-21's additive lifecycle correction is in review. Anurup's signed T-29 response is recorded; T-29 still awaits the other four contributors. | `npm run check`; `dist/` loads unpacked; `docs/TEAM_ALIGNMENT_CHECK.md`; `memory/episodic/0050-stop-versus-end-session-lifecycle.md` |
| 2. Instructor capture | Jacob | merged as `2e82db8` | A3 explicit capture, A4 matcher on Part 5's `dhash12` contract (byte-identical to the reviewed pack, thresholds read from `pack.matching`), A5 correction control with sticky anchor. Pack schema widened additively so the reviewed pack loads (T-05, closed). `BroadcastSessionClient` for same-machine testing. `scripts/build-pack.ts` drafts a pack from a `.pptx` with Sonnet 4.6 descriptions (A3 drafts, not reviewed). Brought Part 3's student experience in with it. | `make check`; `docs/PART2_HANDOFF.md`; `memory/episodic/0041-part2-instructor-capture.md` |
| 3. Student experience and AR | UNOWNED | merged, brought in via PR #8 | Code exists and is on the integration branch: `apps/extension/src/student/`, `src/renderers/`, `src/ar/` (direct Three.js, WebXR + non-immersive fallback), `docs/PART3_HANDOFF.md`, `memory/episodic/0040-part3-student-ar.md`. The branch never named its author in the relay, so the owner cell stays honest even though the code is in. Nobody has claimed Part 3; whoever picks it up inherits working code, not a blank directory. | `npm run check` on the integration branch (181 tests) |
| 4. AWS live service | Omar Rizwan | `workstream/4-aws-live` | **Built and deployed.** `services/live-session/` (server-side rules, HMAC role capabilities, DynamoDB state with TTL enforced on read, WebSocket handler, redacted logging, real `SessionClient`) and `infra/` (CDK: WebSocket API, Lambda, two tables, log group, generated secret). Live endpoint `wss://ktlrnmxq0f.execute-api.us-east-1.amazonaws.com/demo`. 49 unit tests, including per-event validator parity with Part 5's Python reference. Closed T-15, T-19; T-22 now enforced server-side. | `make live-session-check`; `node services/live-session/scripts/integration-test.mjs <url>` — 12/12 against real AWS |
| 5. Content, camera, and demo QA | Kunj Rathod | merged as `a881f11`, `82a1ef6`, `1b5ff73` | Reviewed pack, AR model, six event scenarios, ten rejection fixtures, E2E fixture replay against Part 1's real client, content review sheet for A15, runbook-versus-pack checks, and the relay gate itself. Camera adapter still deliberately not started (T-10). | `make pack-check`; `make check` |

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
| T-16 | `caption.appended` is base-only in the discriminated union, so a caption event cannot carry a caption or name its asset. Stretch scope, so it blocks nothing today, but the type exists in the enum without a payload. | Part 1 | Captions (stretch) | OPEN | `docs/PART5_CONTRACT_CONFORMANCE.md` §3 |
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
| T-29 | Two internal critiques of this project (a harsh criterion-by-criterion scorecard, and a proposed scope-narrowing revision responding to it) existed only on one person's machine, uncommitted, since 2026-09-15, and were never seen by any of the other four contributors. Nobody can be aligned on a decision they have never seen. Compounding it: the scorecard is now 24h stale against what's actually built, and needs updating with real external research before anyone acts on it. | All five parts | Tomorrow's in-person product-direction meeting | OPEN | `docs/TEAM_ALIGNMENT_CHECK.md` is now a non-blocking meeting agenda. Anurup has responded; Jacob, Kunj, Omar, and Prachi are invited to respond before or during the meeting. Scoped implementation against the current extension-first MVP may continue. |
| T-30 | The agent-first delivery system is additive: ticket files, claims, immutable updates, generated context, and validation must not become a second mutable product or risk register. Its initial portfolio intentionally keeps current-MVP proof P0 and durable identity/content work deferred behind human decisions. | Part 1 | Agent handoffs and release evidence | OPEN | `docs/AGENT_OPERATING_CONTEXT.md`; `docs/work/`; `make work-board-check`; AL-090 is in review |
| T-14 | `dist/` build output is committed and is not in `.gitignore`. Decide whether that is intentional (it makes the unpacked extension loadable without a build) or should be removed. | Part 1 | Nothing | OPEN | `git ls-files dist` |
| T-22 | Nothing stops a student from picking the instructor role. The shell's role switch is a plain toggle and `SessionClient.create` takes no credential, so anyone with the extension can start a session and broadcast events. **The relay half is now built:** every event type is instructor-only, roles come from an HMAC-signed capability the relay issues, and a student publishing is refused as `role-not-permitted-to-publish` — proven against the deployed endpoint. So a student cannot broadcast *through AWS*. What remains is client-side and still open: the shell toggle, and the fact that anyone who can reach the endpoint can still `create` a session, because there is no authorizer on `$connect` and the session id is the only secret. | Part 2 + Part 4 | Demo integrity | OPEN | `services/live-session/test/relay.test.ts` 'refuses a student publisher'; integration run. Shell side: `apps/extension/src/shell/App.tsx` role switch |
| T-21 | The event enum had no `capture.stopped`, so Part 2's Stop emitted `session.ended` and then reused the same session on the next Start. Students saw "session ended" for what was really stopped sharing. | Part 1 + Part 2 | Part 3 wording, Part 4 session lifecycle | IN PROGRESS | AL-003 adds base-only `capture.stopped`; controller, student state, relay lifecycle/latest-state, schemas, simulator, and parity tests pass locally. Shared-contract second review and deployed-relay update remain before closure. |
| T-15 | `sequence` is `nonnegative()` in Zod and unconstrained in the JSON Schema, so 0 is legal. Part 5's simulator starts at 1. Pin the first sequence number before Part 4 builds ordering logic. | Part 1 + Part 4 | Part 4 | CLOSED | Pinned to 1 by the relay, matching Part 5's reference: `sequence: 0` is refused as `sequence-not-a-positive-integer` (`services/live-session/src/rules.ts`, asserted by the parity test). The shared Zod contract still permits 0, so a client can construct one — the relay is what refuses it |

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
