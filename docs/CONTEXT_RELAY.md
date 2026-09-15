# AccessLens context relay

**Purpose:** one file an incoming contributor — human or agent — reads to pick up
this project mid-flight, and appends to on the way out. It exists so that context
travels between sessions and between people, and so that nothing quietly falls
through the gap at the end of the hackathon.

**State as of:** `0771bce` (Jacob takes Part 2), September 15, 2026.

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
| 1. Foundation and contracts | Anurup Kumar | merged as `38542ad` | Shell split, per-type discriminated-union event contract, `RoleCapabilitySchema`, frozen `SessionClient` (create/join/send/subscribe/close), local preferences, `.env.example`, ajv + typecheck in `npm run check`. Closed T-02, T-03, T-04. | `npm run check`; `dist/` loads unpacked |
| 2. Instructor capture | Jacob | not yet created | Owner assigned in `0771bce`. No code yet under `apps/extension/src/instructor/` or `src/sources/screen/`. Everything needed to start is listed in section 6. | — |
| 3. Student experience and AR | UNOWNED | — | Not started. Nothing exists under `apps/extension/src/student/`, `src/renderers/`, or `src/ar/`. | — |
| 4. AWS live service | UNOWNED | — | Not started. No `infra/` or `services/live-session/`. | — |
| 5. Content, camera, and demo QA | Kunj Rathod | `workstream/5-content-camera-qa`, PR #4 open | Reviewed pack, AR model, six event scenarios, ten rejection fixtures, E2E fixture replay against Part 1's real client, and a content review sheet for A15. Camera adapter still deliberately not started (T-10). | `make pack-check`; `npm run check` |

**The single largest risk in this project is still the second column**, though it
moved today: Part 2 now has an owner. Parts 3 and 4 do not. Part 3 is the student
experience and the required AR renderer, which is most of what the demo shows, and
Part 4 is the transport it all runs over. Part 5 exists precisely so 2, 3, and 4
can each start without waiting for the other two — see section 6.

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
| T-05 | `access-pack.schema.json` now sets `additionalProperties: false` on the **asset** object too, which makes `arScene` illegal. AR is a required renderer and `SYSTEM_DESIGN.md` §6's own pack example contains `arScene`, so the pack cannot carry the scene the MVP requires. Also blocks `mediaUri`, `subtitle`, region `label`, and the four root blocks. | Part 1 | Part 3, Part 5 | OPEN | `docs/PART5_CONTRACT_CONFORMANCE.md` §1–2 |
| T-06 | `hotspotId` is scoped per asset (`cell-slide-03:mitochondrion`) because one region appears on several slides. Needs acknowledging in the shared contract, which cannot express it until T-05 lets the pack carry `arScene`. | Part 1 + Part 3 | Part 3 | BLOCKED | Blocked on T-05 |
| T-07 | CI does not run on the integration branch. `.github/workflows/check.yml` pushes only on `[main, master]`, and no check has run on PR #4 or #5 either. The branch the whole hackathon lives on is unwatched. Manually verified green at `0771bce` (RL-013), so the risk has not bitten yet — but that was a person choosing to look, which is not a process. PR #5 fixes the trigger. | UNOWNED | Everyone | UNOWNED | `gh pr checks 4` reports no checks; RL-013 |
| T-08 | `c3ddc27` wired `npm run check` into `make check`, but `.github/workflows/check.yml` still has no `setup-node` and no `npm ci`. `make check` therefore **fails** in CI: `sh: vitest: command not found`. Worse than before — the shared check is now broken rather than merely incomplete. | Part 5 | Everyone | IN PROGRESS | Reproduced by hiding `node_modules` and running `npm run check`; fix in PR #5 |
| T-09 | A15: no external biology instructor or accessibility professional has reviewed the pack, so it must not be described as expert-reviewed or accessibility-audited. The Part 5 side is now unblocked — `review/content-review-sheet.html` draws every region on its slide beside the exact words a student gets, so there is something to review. **What remains needs a person: finding the two reviewers.** | Part 5 | Demo claims, charter A11 | OPEN | `packages/access-packs/bio-cell-demo/review/content-review-sheet.html` |
| T-10 | A17 camera adapter not started. Phase 6 by plan; must not delay or destabilise the screen-sharing demo. | Part 5 | Nothing | ACCEPTED | `docs/IMPLEMENTATION_PLAN.md` §3 Phase 6 |
| T-11 | End-to-end suite. First slice landed now that `SessionClient` is frozen: `tests/e2e/fixture-replay.test.ts` covers fixture replay, reconnect idempotence, and session close. The rest — failure paths through a real UI, axe, screen-reader, rehearsals — still needs the student renderers. | Part 5 | Demo readiness | IN PROGRESS | `tests/e2e/fixture-replay.test.ts`, 7 tests |
| T-12 | `codex/live-workspace-foundation` is 3 commits ahead and 64 behind, last touched 2026-08-28, from the superseded Evidence Engine product. Salvage or delete before the repo is handed over. | UNOWNED | Nothing | UNOWNED | `git log origin/codex/live-workspace-foundation` |
| T-13 | Nobody owns merging `accesslens-extension-ar-pivot` into `master`, and no moment is defined for it. The build rule forbids merging to `master` during the hackathon, so this must happen deliberately at the end. | UNOWNED | Final handover | UNOWNED | `docs/PARALLEL_WORKSTREAMS.md`, merge and branch rules |
| T-16 | `caption.appended` is base-only in the discriminated union, so a caption event cannot carry a caption or name its asset. Stretch scope, so it blocks nothing today, but the type exists in the enum without a payload. | Part 1 | Captions (stretch) | OPEN | `docs/PART5_CONTRACT_CONFORMANCE.md` §3 |
| T-17 | Episodic record numbers collide across parallel branches. It has happened **twice in one afternoon** with only two active workstreams: Part 5's records were renumbered `0038→0040` and `0039→0041`. Proposal: allocate a hundred-block per part (Part 1 → `01xx`, Part 5 → `05xx`), which needs no tooling change. | UNOWNED | Nothing | UNOWNED | `0038-part1-hardening.md` and `0039-part1-contract-gaps.md` vs the twice-renamed Part 5 records |
| T-18 | `memory/INDEX.md` has a single "current handoff" pointer that `memory_check.py` requires to name the newest record, so every parallel branch conflicts on that one line. Hit **four times** across the `c3ddc27` and `38542ad` merges of #4 and #5. Proposal: let the pointer be a list, one line per part, and have `memory_check.py` require each part's newest record rather than one global newest. | UNOWNED | Nothing | UNOWNED | Four conflicts on the same line in one afternoon |
| T-19 | Schema validation cannot detect a stale `packVersion`: Zod types it as any positive integer, so a mismatched version passes cleanly. `SYSTEM_DESIGN.md` §9 requires rendering to stop and refetch when the pack version differs, so someone must hold the session's expected version and compare. If the relay does not, every student renderer must, separately. | Part 4 | Part 3, Part 4 | OPEN | `tests/e2e/fixture-replay.test.ts`, "records which rejections need pack awareness" |
| T-14 | `dist/` build output is committed and is not in `.gitignore`. Decide whether that is intentional (it makes the unpacked extension loadable without a build) or should be removed. | Part 1 | Nothing | OPEN | `git ls-files dist` |
| T-15 | `sequence` is `nonnegative()` in Zod and unconstrained in the JSON Schema, so 0 is legal. Part 5's simulator starts at 1. Pin the first sequence number before Part 4 builds ordering logic. | Part 1 + Part 4 | Part 4 | OPEN | `apps/extension/src/shared/contracts.ts` |

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
