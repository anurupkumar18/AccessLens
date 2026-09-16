# Cross-branch integration, QA, and priority assessment — 2026-09-16

**Scope:** a full survey of every remote branch against
`codex/demo-proof-sprint-qa`, what was safe to integrate and what wasn't,
and a prioritized list of what's actually next. Written after a session that
also landed AL-046 through AL-055 (camera consent, live captions end to end,
a security fix, a real sharing bug fix, and the integration work below).
This is a snapshot, not a standing document — treat it the way
`docs/TEAM_ALIGNMENT_CHECK.md` is treated: informative, not authoritative
over `docs/CONTEXT_RELAY.md`, which remains the live state of record.

**Rule followed while doing this:** integrate without moving anyone's work
off their own branch and without force-pushing or otherwise disturbing a
branch someone else may still be using. Every merge below is additive —
teammates' branches were only read, never written to.

## 1. Branch survey

14 remote branches besides this one. Full detail in
`memory/episodic/0070-window-and-screen-share-matching.md`.

| Branch | Unique commits | Disposition |
| --- | --- | --- |
| `workstream/2-instructor-capture` | 0 | Already fully absorbed |
| `workstream/3-student-ar` | 0 | Already fully absorbed |
| `workstream/4-aws-live` | 0 | Already fully absorbed |
| `docs/aws-access-verification` | 0 | Already fully absorbed |
| `fix/ci-pnpm-corepack-order` | 0 | Already fully absorbed |
| `claude/product-vision-scope-2uxb6j` | 0 | Already fully absorbed (its content was committed into this branch's history separately, as `docs/ACCESSLENS_MVP_REVISION.md`) |
| `codex/live-workspace-foundation` | 3 | Superseded Evidence Engine product, predates the AccessLens pivot (T-12). Not merged; recommend deletion, not my call to make unilaterally |
| `claude/accesslens-demo-proof-qa-31tqrj` | 1 | **Merged.** AL-003's independent contract review — exactly the prerequisite the team's own process named |
| `ui/blacksmith-revamp` | 14 | **Partially merged** (AL-053, AL-054, AL-055 below). Real bug fixes cleanly separated from AI-gateway/dyslexic content, which was not merged |
| `master` (docs-only commits) | 6 | Reviewed, not merged (see §3) |
| `workstream/2-pack-driven-rendering` | 2 | Both are launch prompts for the Part 6 initiative below — see `integ/ui-api` |
| `workstream/6-authoring` | 94 | Same effort as `integ/ui-api` (it's an ancestor of it) — see below |
| `integ/ui-api` | 111 | **Not merged.** Flagged for a team decision — see §2 |

## 2. The big flag: an unapproved RAG/Bedrock pipeline already exists

`integ/ui-api` (and its ancestor `workstream/6-authoring`) is Jacob Erard's
"Part 6" initiative: a single-upload authoring pipeline that is API-first,
does document ingest, chunking, vector retrieval, and calls AWS Bedrock for
real — plus a CDK deployment stack for it. Commit titles alone tell the
story: *"Part 6 spec and build prompt: single-upload authoring pipeline,
API-first, course-profile RAG"*, *"V2: add authoring API and CDK deployment
stack"*, *"R1 R2: add course library chunking retrieval and vectors"*,
*"Evals: the runner that scores real Bedrock output against those
properties."*

This is real, substantial, already-working engineering — not a stub. It is
also exactly what this branch's own boundaries (`docs/PROJECT_CHARTER.md`,
`AGENTS.md`, and the disabled placeholders AL-042/AL-045 were built to
enforce) say needs institutional approval before it exists at all: model
invocation, Canvas/course-content retrieval, and a retention/retrieval
index. **It was not merged here.** Bringing 111 commits of a live Bedrock/
RAG system onto this branch unilaterally would be adopting a product and
privacy decision no one has actually made together — the same category of
mistake `CLAUDE.md` already warns against for `master`'s narrowed-scope
revision, just in the opposite direction (more capability, not less).

Separately, `ui/blacksmith-revamp` has its own, smaller version of the same
problem: a live "AWS AI gateway" for grounded answers, reviewed speech, and
Polly-based audio (*"Add the AWS AI gateway: grounded answers, reviewed
speech, caption streams"*, *"AccessLens is live on AWS"*). Not merged either.

**This needs the team's own alignment process, not a unilateral merge from
either direction.** Recommend it becomes an explicit agenda item alongside
whatever `docs/TEAM_ALIGNMENT_CHECK.md` still has open.

## 3. The smaller flag: a team-wide "Dyslexic" mode naming pattern

Independently, on **both** `master` (one code commit, `231d1fb`) and
`ui/blacksmith-revamp`, and throughout `docs/ADVANCED_FEATURES.md` and a
draft `docs/DEMO_BRIEF.md`, a fifth student rendering mode is named
"Dyslexic" — a student-facing tab labeled with a diagnosis rather than the
feature it provides (larger spacing, a dyslexia-friendly font stack).

This isn't one person's slip: it's used consistently by two different
contributors across code and docs. But this branch's own `AGENTS.md` states
the rule plainly: *"Say 'student-selected local preferences,' never
medical-condition framing."* A mode a student clicks that's literally
labeled with a condition name reads as exactly that framing, regardless of
intent.

Concretely, `master`'s `docs/DEMO_BRIEF.md` instructs a live presenter to
click into a "Dyslexic" tab that does not exist on this branch — merging it
as-is would have been a false operational claim the moment it landed here.
It was drafted, then reverted before pushing, once this was noticed.

**Not a rejection of the feature** — reading-presentation controls are
clearly valuable and this branch already has real ones (font, spacing,
contrast, width — see `apps/extension/src/shared/preferences.ts`). The
question is naming: something like "Reading spacing" or "Comfortable read"
describes what it does without labeling who it's for. Worth a two-minute
team decision, not a blocker to keep building around.

## 4. What was actually integrated this session

| Ticket | What | Source | Risk |
| --- | --- | --- | --- |
| — | AL-003's independent contract review | `claude/accesslens-demo-proof-qa-31tqrj` | None — docs only |
| AL-053 | Window/screen share slide matching (previously only tab shares synced at all) | `ui/blacksmith-revamp` `8fde5aa` | Low — isolated, one additive test conflict |
| AL-054 | Zod CSP violation, body font inheritance, decorative-glyph accessible names | Reimplemented after finding `94f0047` entangled with the UI restyle | Low — hardening only |
| AL-055 | WebSocket reconnect catch-up, extended retry, `close()` race fix | `ui/blacksmith-revamp` `94f0047`, scoped-extracted | Low — isolated file, clean apply |

All four are `make check` green, each in its own commit with a ticket,
episodic record, and relay log entry per the existing delivery workflow.
Full detail: `memory/episodic/0070` through `0072`, `docs/CONTEXT_RELAY.md`
RL-052 through RL-055.

## 5. SWOT

### Strengths
- The privacy/governance discipline held under real pressure. Two separate
  teammates independently built real AI/Bedrock capability; both were
  caught and flagged rather than silently merged, because the charter's
  boundaries are concrete enough to check against, not just aspirational.
- The contract-and-relay-parity pattern (Zod schema, JSON Schema mirror,
  Python reference validator, TypeScript relay rules, all cross-checked by
  a parity test) has now caught two real defects: this session's own
  caption-shape gap (AL-050) and, independently, the same class of gap in
  `capture.stopped` found by `claude/accesslens-demo-proof-qa-31tqrj`'s
  review (T-31, still open). The pattern works.
- Real-browser testing (loading the built `dist/` and running `axe-core`
  with `color-contrast` enabled, which jsdom cannot compute) found two
  genuine accessibility defects this session that the entire existing unit
  suite had missed — the "Higher contrast" toggle was making contrast
  *worse* in dark mode, and had *no effect at all* on the Review route.
- The delivery-board process (ticket → checkpoint/handoff → episodic
  record → relay log) has now survived 43 tickets and 55 relay entries
  without losing track of state, across at least six independent
  contributors and agent sessions.

### Weaknesses
- **No real device testing has happened at all.** Every capture, camera,
  and multi-device claim in this repository is simulated or unit-tested.
  AL-001's matrix (tab/window/display × permission/denial/switching) has
  never run against a real `getDisplayMedia()` grant, in this session or
  (per the relay log) any prior one.
- **The deployed AWS endpoint is stale** and rejects `capture.stopped`
  (`event-type-not-allowlisted`), confirmed independently twice now (once
  by `claude/accesslens-demo-proof-qa-31tqrj`'s review, once implicitly by
  every AWS-dependent item in this session being blocked on missing
  credentials). Nothing currently deployed reflects this branch's actual
  lifecycle contract.
- **`Relay.resume()` has zero test coverage** (T-32) despite being the only
  path a real network blip or instructor reconnect goes through in
  production. AL-055 works around the symptom client-side; the server path
  itself is still unverified.
- **Ownership gaps persist**: Part 3 (student experience/AR) has no named
  owner in `docs/CONTEXT_RELAY.md` despite the code existing and working.
  Six threads (T-01, T-07, T-12, T-13, T-17, T-18) remain unowned.
- **Two teammates built the same feature (live captions) independently** —
  this session's AL-048/049/050 and `ui/blacksmith-revamp`'s `e63d188`
  ("Let caption.appended carry caption text (T-16)"). Both closed the same
  thread separately, with different designs. That's wasted effort a
  five-minute sync would have caught.

### Opportunities
- The window/screen capture matching fix (AL-053) directly unblocks the
  most-requested untested item: the Windows tab/window/display matrix can
  now actually be run, since window and screen shares can match a slide at
  all for the first time.
- The reconnect/close fixes (AL-055) mean a real two-device rehearsal, once
  the endpoint is redeployed, is much more likely to survive an actual
  network blip instead of surfacing a reconnect bug mid-demo.
- AL-006's mentor-feedback kit is fully written and verified against the
  charter — the only remaining step is finding one real, consenting
  mentor and running a three-minute demo. This is the cheapest remaining
  high-value task on the whole board.
- The disabled-placeholder pattern for Canvas/Bedrock (AL-042, AL-045) is
  now proven out twice over by real parallel implementations existing on
  other branches — when institutional approval does arrive, there's a
  concrete reference for what "enabled" would actually look like, reviewed
  by someone who already built it.

### Threats
- **Governance drift risk.** Two independent, complete implementations of
  institutionally-gated features (RAG/Bedrock ingest, AI gateway/Polly)
  already exist and work. The longer the team goes without an explicit
  decision, the stronger the pull to just merge what's already built and
  ask forgiveness later — which is precisely the failure mode the charter
  exists to prevent.
- **Demo claim risk.** With `ui/blacksmith-revamp`'s "AccessLens is live on
  AWS" and `master`'s demo brief both describing capabilities (live AI
  gateway, Dyslexic mode) that don't exist on the branch actually being
  prepared for demo, anyone pulling from the "wrong" branch or doc under
  time pressure could overclaim what's real without realizing it.
- **Untested capture path.** Every fix to the matching/capture pipeline
  this session (AL-053, and this session's own AL-051) is locally verified
  only. If the real Windows/browser matrix surfaces a problem this late,
  there's limited runway to fix it before a demo.
- **Single point of relay staleness.** As long as the deployed endpoint
  rejects `capture.stopped`, no live multi-device rehearsal can happen at
  all — every downstream item (T-32 real-world verification, AL-004's
  bench against a current release, the two-device rehearsal) is blocked
  behind one redeploy that needs AWS credentials no current session has.

## 6. Priority list

**P0 — cheapest, highest-value, fully unblocked right now:**
1. A team decision on §2 and §3 (RAG/Bedrock pipeline, AI-gateway, and the
   "Dyslexic" naming pattern). Fifteen minutes of conversation unblocks or
   explicitly defers a large amount of already-built work.
2. Find one mentor and run AL-006's kit. Already written and verified;
   needs a person, not more code.
3. Authorize and run the AWS redeploy so `capture.stopped` stops being
   rejected — this single action unblocks T-31, T-32 verification, AL-004's
   bench, and the two-device rehearsal all at once.

**P1 — needs a human with the right hardware/access:**
4. Run AL-001's real-device capture matrix (tab/window/display × the seven
   documented cases) — now meaningfully more likely to pass given AL-053.
5. Two-device rehearsal once the endpoint is current, exercising AL-055's
   reconnect fix for real.
6. Real screen-reader pass over the caption track (AL-049), the high-
   contrast fix (AL-052), and the camera consent control (AL-046) — none of
   this session's real-browser testing substitutes for an actual screen
   reader.

**P2 — engineering work, unblocked, not yet started:**
7. T-31: enforce `capture.stopped`'s `assetId`/`regionId` pack-membership
   server-side (the same class of gap AL-050 closed for `caption` this
   session — a template exists to copy).
8. T-32: add real test coverage for `Relay.resume()` and the `$connect`
   route, including instructor-role reconnect recovery.
9. Resolve the T-17/T-18/T-24 relay-log conflict-magnet proposals (split
   the append-only log into per-entry files, as already proposed twice) —
   process debt that keeps costing real merge time, including some of this
   session's own conflict resolution.

**Blocked on institutional/human decision, do not start without one:**
- Canvas/RAG integration (AL-045 remains the disabled boundary; `integ/ui-api`
  is the unapproved built version).
- Bedrock/model invocation (AL-042 remains the disabled boundary;
  `ui/blacksmith-revamp`'s AI gateway is the unapproved built version).
- Camera recognition/gesture mapping (AL-046 remains consent-only;
  needs an approved physical scenario and a second privacy/accessibility
  reviewer before any recognition code).
- Anonymous session-context recording (no consent/retention/deletion
  policy exists yet).
