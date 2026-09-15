# AccessLens context relay

**Purpose:** one file an incoming contributor — human or agent — reads to pick up
this project mid-flight, and appends to on the way out. It exists so that context
travels between sessions and between people, and so that nothing quietly falls
through the gap at the end of the hackathon.

**State as of:** `df80b5d` (Part 1 foundation), September 15, 2026.

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
| 1. Foundation and contracts | Anurup Kumar | merged as `df80b5d` | Extension shell, Zod + JSON Schema contracts, `InMemorySessionClient`. Contract has two open bugs, T-02 and T-03. | `npm test` (3 tests); `dist/` loads unpacked |
| 2. Instructor capture | UNOWNED | — | Not started. Nothing exists under `apps/extension/src/instructor/` or `src/sources/screen/`. | — |
| 3. Student experience and AR | UNOWNED | — | Not started. Nothing exists under `apps/extension/src/student/`, `src/renderers/`, or `src/ar/`. | — |
| 4. AWS live service | UNOWNED | — | Not started. No `infra/` or `services/live-session/`. | — |
| 5. Content, camera, and demo QA | Kunj Rathod | `workstream/5-content-camera-qa`, PR #4 open | Reviewed pack, AR model, six event scenarios, ten rejection fixtures, 37 tests. Camera adapter and E2E deliberately not started (T-10, T-11). | `make pack-check` |

**The single largest risk in this project is the second column.** Three of five
parts are unowned, and Parts 2 and 3 are on the critical path to the demo. Part 5
exists precisely so 2, 3, and 4 can each start without waiting for the other two —
see section 6.

---

## 3. Open threads

Every loose end lives here. `scripts/relay_check.py` enforces that each row has a
valid status, that nothing is `CLOSED` or `ACCEPTED` without evidence, and that
`UNOWNED` is used honestly rather than a name being invented.

Status vocabulary: `UNOWNED`, `OPEN`, `IN PROGRESS`, `BLOCKED`, `CLOSED`,
`ACCEPTED` (a deliberate decision not to do it).

| ID | Thread | Owner | Blocks | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| T-01 | Parts 2, 3, and 4 have no owner. The contract freeze in `PARALLEL_WORKSTREAMS.md` cannot complete without them. | UNOWNED | Everything downstream of the shell | UNOWNED | — |
| T-02 | `assetId` is `required` on every `LiveEvent`, so `source.unmatched` cannot be expressed. Violates charter A9 and breaks the runbook's 2:00–2:30 beat. 15 fixture events fail on it. | Part 1 | Parts 2, 3, 4, 5 | OPEN | `docs/PART5_CONTRACT_CONFORMANCE.md` §1 |
| T-03 | `live-event.schema.json` sets `additionalProperties: false` but omits `regionId` and `pointer`, which the Zod schema accepts. Part 1's own `validEvent` fixture fails Part 1's own JSON Schema. | Part 1 | Part 4 | OPEN | `docs/PART5_CONTRACT_CONFORMANCE.md` §3 |
| T-04 | The event contract has no `arState`, but AR is a required renderer (A10, A12) and `SYSTEM_DESIGN.md` §6's own example includes it. | Part 1 + Part 3 | Part 3 | OPEN | `docs/PART5_CONTRACT_CONFORMANCE.md` §2 |
| T-05 | `AccessPackSchema` is strict at the top level and rejects the pack's `review`, `matching`, `arCameras`, and `reservedReadingOrderIds` blocks. | Part 1 | Part 5 | OPEN | `docs/PART5_CONTRACT_CONFORMANCE.md` §4 |
| T-06 | `hotspotId` is scoped per asset (`cell-slide-03:mitochondrion`) because one region appears on several slides. Needs acknowledging in the shared contract. | Part 1 + Part 3 | Part 3 | OPEN | `docs/PART5_CONTRACT_CONFORMANCE.md` §4 |
| T-07 | CI does not run on the integration branch. `.github/workflows/check.yml` pushes only on `[main, master]`, and no check ran on PR #4. The branch the whole hackathon lives on is unwatched. | UNOWNED | Everyone | UNOWNED | `gh pr checks 4` reports no checks |
| T-08 | Part 1's `npm run check` never runs in CI. `make check` is Python-only, so the extension tests and build are not verified on any PR. | UNOWNED | Part 1 | UNOWNED | `.github/workflows/check.yml` runs `make check` only |
| T-09 | A15: no external biology instructor or accessibility professional has reviewed the pack. The pack must not be described as expert-reviewed or accessibility-audited until this closes. | Part 5 | Demo claims, charter A11 | OPEN | `packages/access-packs/bio-cell-demo/PROVENANCE.md` |
| T-10 | A17 camera adapter not started. Phase 6 by plan; must not delay or destabilise the screen-sharing demo. | Part 5 | Nothing | ACCEPTED | `docs/IMPLEMENTATION_PLAN.md` §3 Phase 6 |
| T-11 | End-to-end suite (A14–A16 integration, axe, screen-reader, rehearsals) not started; needs the shell and a real `SessionClient`. | Part 5 | Demo readiness | BLOCKED | Blocked on Parts 1–4 wiring |
| T-12 | `codex/live-workspace-foundation` is 3 commits ahead and 64 behind, last touched 2026-08-28, from the superseded Evidence Engine product. Salvage or delete before the repo is handed over. | UNOWNED | Nothing | UNOWNED | `git log origin/codex/live-workspace-foundation` |
| T-13 | Nobody owns merging `accesslens-extension-ar-pivot` into `master`, and no moment is defined for it. The build rule forbids merging to `master` during the hackathon, so this must happen deliberately at the end. | UNOWNED | Final handover | UNOWNED | `docs/PARALLEL_WORKSTREAMS.md`, merge and branch rules |
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
Mind T-04: `arState` is what you need and the contract does not accept it yet.

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
