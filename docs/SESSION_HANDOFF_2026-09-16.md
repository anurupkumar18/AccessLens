# AccessLens — full session handoff (2026-09-16)

**Purpose of this document:** a complete, chronological account of one long
working session on this repository — everything done, everything found,
everything decided and left undecided — written so that someone with no
prior context on AccessLens can read this alone and understand both the
product and exactly where it stands. If you only read one document to get
oriented, read this one, then follow its links.

**Who did what in this session:** the user (Anurup Kumar, Part 1 owner)
directed the work; Claude (this session) executed it, including code,
infrastructure changes, testing, git operations, and the research/critique
work in the second half. Four other people — Jacob Erard (Part 2), Kunj
Rathod (Part 5), Omar Rizwan (Part 4), Prachi Aswani (Part 3) — did real,
independent work on their own machines/sessions in parallel during the same
window; this document narrates from this session's point of view and
describes their work only as observed through git history.

---

## 1. What AccessLens is, in plain terms

AccessLens is a browser extension built for the **"Minds & Machines: AI in
Education Hackathon 2026."** The pitch: an instructor shares their screen
once; a browser extension recognizes which reviewed slide/region is showing
and emits a small, semantic, real-time event describing it (never the raw
video); every student's own extension receives that event and renders it
however works for them — a decluttered visual focus view, structured text,
spoken audio description, or a synchronized 3D model — without the student
ever disclosing a diagnosis or needing special hardware.

**The core loop:**
```
instructor consent → local slide/region matching → semantic LiveEvent
  → temporary AWS relay → every student's own accessible rendering
```

**The one-line differentiator, sharpened this session:** this is not a
better live-captioning tool (PowerPoint already does that, free, built-in —
see §4.12). It solves the part live captions cannot reach: describing what a
diagram's regions *are* and which one is currently being indicated, not just
transcribing what the instructor says.

## 2. Non-negotiable product invariants (the charter)

From `docs/PROJECT_CHARTER.md`, invariants A1–A11 — quoted here because they
govern almost every design decision made this session:

- **A1** — capture only starts after an explicit instructor action and the
  browser's own permission prompt. Never silent.
- **A2** — raw screen/audio/camera never leaves the source device by
  default; the backend receives semantic events, not a recording.
- **A3** — Access Packs (the reviewed lesson content) come only from
  instructor-approved or checked-in assets; anything AI-generated is a
  visible draft until a human approves it.
- **A4** — student accessibility preferences stay local to the extension;
  the server stores no diagnosis, disability label, or learner profile.
- **A5** — live sessions are temporary and role-scoped; a session code is
  not a general credential.
- **A6** — no Canvas/LMS scraping; production LMS access needs institutional
  approval and doesn't exist in this project.
- **A7** — every movement/audio/vision-dependent experience has an
  equivalent alternate path to the same meaning.
- **A8** — never grades, never infers mastery, attention, emotion, or
  **disability** from behavior. This is the single invariant most directly
  relevant to this session's language warning in §4.12.
- **A9** — camera mode (if ever built) is opt-in and never required.
- **A10** — no false compliance claims (no "this is WCAG/ADA/FERPA
  compliant" language).
- **A11** — AR is a required student-facing renderer in the current MVP,
  with a required equivalent non-immersive route.

Both independent critical reviews of this project (§4.12) agreed these
invariants, taken together, are the project's single strongest asset — an
A+ nobody else in a typical hackathon field is likely to have. Protecting
them was a recurring theme of essentially every decision this session made.

## 3. Architecture at a glance

Five workstreams ("Parts"), a shared contract layer, and one deployed AWS
backend:

| Part | Owner | What it is |
| --- | --- | --- |
| 1 — Foundation & contracts | Anurup Kumar (this session) | Shared Zod/JSON schemas, the extension shell, local preferences, the `SessionClient` interface every transport implements. |
| 2 — Instructor capture | Jacob Erard | Real `getDisplayMedia()` capture, a perceptual-hash slide matcher (`dhash12`), the capture state machine, correction UI, a Bedrock-based pack-authoring CLI. |
| 3 — Student experience & AR | Prachi Aswani (claimed the previously-unowned Part 3 partway through this session) | Focus/Read/Hear/AR rendering, a Three.js + WebXR synchronized 3D scene, keyboard/screen-reader equivalents. |
| 4 — AWS live service | Omar Rizwan | A deployed, real WebSocket relay (API Gateway + Lambda + DynamoDB), HMAC-signed role capabilities, server-side event validation. |
| 5 — Content & demo QA | Kunj Rathod | The reviewed `bio-cell-demo` Access Pack, AR model, contract-conformance tooling, AWS deployment recon, the `docs/CONTEXT_RELAY.md` coordination system itself. |

**Contracts** (`apps/extension/src/shared/contracts.ts`, mirrored in
`packages/contracts/*.schema.json`): `LiveEventSchema` is a Zod discriminated
union — only `asset.changed` and `region.changed` may name a slide/region;
every other event type (crucially, `source.unmatched`) is structurally
forbidden from doing so, so an unmatched slide can never be reported as an
invented match. `SessionClient` is frozen at five methods:
`create/join/send/subscribe/close`, implemented today by three
interchangeable transports (`InMemorySessionClient` for tests,
`BroadcastSessionClient` for same-browser demos, `WebSocketSessionClient` for
the real deployed relay).

**Deployed AWS infrastructure** (`services/live-session/`, `infra/`): a real
API Gateway WebSocket API in front of a Lambda, two DynamoDB tables
(sessions, connections — both TTL'd, both `RemovalPolicy.DESTROY` since
everything here is intentionally temporary), a Secrets-Manager-held HMAC key
for signing role capabilities. Live endpoint:
`wss://ktlrnmxq0f.execute-api.us-east-1.amazonaws.com/demo` (temporary
Workshop Studio AWS account — will disappear when the event ends).

---

## 4. This session, chronologically

### 4.1 — Starting point: continuing Part 1 as a hardening task

The session opened by resuming AccessLens Phase 1 (A1/A2) from a prior
foundation commit, explicitly treating it as *not complete* rather than
done. Read `AGENTS.md`, `docs/PROJECT_CHARTER.md`, `docs/IMPLEMENTATION_PLAN.md`,
and the memory system in the order those documents specify, and found the
committed `LiveEventSchema` required `assetId` on **every** event type,
including `source.unmatched` — meaning the schema allowed a producer to
report an invented match for content that was never actually recognized,
directly contradicting the charter.

**Fix:** rebuilt `LiveEventSchema` as a Zod discriminated union so
`source.unmatched` (and every other non-content event) is structurally
incapable of naming an asset or region — enforced by the type system, not by
convention. Mirrored the same matrix in the JSON Schema file with
`ajv`-tested `if`/`then` rules. Also split the monolithic `main.tsx` into a
proper `shell/{App,RoleNav,ErrorBoundary}.tsx`, and added a local-only
`StudentPreferencesSchema` + `chrome.storage.local` wrapper. Verified in the
sandboxed browser pane (role switching, fixture events, no console errors).
Committed as `c3ddc27`.

### 4.2 — A self-review found the "done" work wasn't actually done

Applying `superpowers:verification-before-completion` against the project's
own written acceptance criteria (not just "does it pass") surfaced three
real gaps against `docs/PARALLEL_WORKSTREAMS.md`'s own contract-freeze
checklist: no signed role-capability schema existed at all (despite being
explicitly named in `IMPLEMENTATION_PLAN.md`'s A2), the `SessionClient`
interface was missing `create`/`join`/`close` (only had `send`/`subscribe`),
and the two environment-variable names the team was supposed to freeze
(`VITE_ACCESSLENS_WS_URL`, `VITE_ACCESSLENS_ASSET_BASE_URL`) had never been
written down anywhere.

**Fix:** added `RoleCapabilitySchema`, expanded `SessionClient`/
`InMemorySessionClient` to the full frozen five-method shape (`close()` now
actually invalidates the client — a further `send()` throws), and froze the
two env var names in a new `.env.example`. Added `@types/react`,
`@types/react-dom`, `@types/node` and wired `tsc --noEmit` into `npm run
check` — it had never actually been run, and went from 83 latent errors to
zero once wired in. Committed as `38542ad`.

### 4.3 — Housekeeping: fixed the user's local dev environment twice

Two unrelated local-machine issues were fixed on request, outside the git
history: a stale Xcode Command Line Tools license blocking `make`/`make
check` entirely (the user accepted it via `sudo xcodebuild -license accept`
in their own terminal; this session then verified `make check` was clean
afterward), and a dead `.claude/launch.json` entry pointing at
`scripts/web_tester.py` — a file deleted along with the entire superseded
"Evidence Engine" product this repo used to be. Removed the dead config
entry (local-only, not tracked in git) and confirmed the correct
`accesslens-dist-preview` config still worked.

### 4.4 — Merging everyone else's work into one coherent integration branch

By this point four pull requests had accumulated against the integration
branch `accesslens-extension-ar-pivot` (Kunj's two follow-up PRs, Jacob's
full instructor-capture implementation which had also absorbed the
previously-orphaned Part 3 branch, and Omar's AWS deployment-readiness
recon) — all still open, and every one of them had a **failing CI check**.

Merged all four, in order, resolving real conflicts along the way:

- **Two independent Node-version-related CI failures**, both traced to
  their actual root cause rather than just re-running: `undici`/`jsdom`
  needing Node 22 (CI was pinned to 20), and later `services/live-session`
  needing its *own* `npm ci` step that nobody had added to
  `.github/workflows/check.yml` when that package was created (same shape
  of bug happening twice — T-08, then T-27).
- **A stale `memory/INDEX.md` "current handoff" pointer** that was actually
  failing `make check` on the integration branch tip itself.
- **Three separate live thread-ID and episodic-filename collisions** — two
  different contributors independently using `T-20` for unrelated threads,
  two different people creating `memory/episodic/0040-*.md` files, and so
  on. None of these were caught by git's automatic merge (new, non-
  overlapping table rows don't conflict); each one had to be found by
  actually reading the merged result and renumbering by hand. This
  recurring failure mode is tracked as still-open threads **T-17** and
  **T-18** in `docs/CONTEXT_RELAY.md` — a structural problem in how the
  team's own coordination file works, not yet fixed.

After each merge, re-ran `make check` fresh (not trusted from before the
merge) and confirmed a real, passing CI run against the actual pushed commit
before moving to the next one — this discipline caught the CI-workflow gaps
above, which a "trust the last green run" approach would have missed.

### 4.5 — Part 4 arrived already built and deployed — wired it into the app

While the above was happening, Omar independently built and **deployed** the
entire AWS live-session backend (§3) directly to the integration branch.
Verified it was real by re-running its own `scripts/integration-test.mjs`
against the live endpoint fresh: 12/12 checks — instructor + two student
capabilities issued, 19 events relayed to both students in order, the
instructor never echoed its own events, and all five refusal checks
(student publishing, replayed sequence, raw-frame payload, wrong session,
post-close) held.

But nothing in the extension actually *used* it yet — `App.tsx`'s default
transport was still `BroadcastSessionClient` (same-browser-tab only).
**Built the missing wiring:** `createDefaultClient.ts` (picks the real relay
when `VITE_ACCESSLENS_WS_URL` is set, else falls back as before) and
`liveRelayClient.ts` — a validating wrapper, because
`WebSocketSessionClient` deliberately types events/capabilities as bare
`Record<string, unknown>` to avoid importing Part 1's schema package, so
without this wrapper nothing would actually check that data crossing the
real network matched the frozen contract.

**Then actually tested it against the real thing**, not a mock: built the
extension with the live URL, opened two real browser tabs in the sandboxed
preview, and drove it. The Instructor tab's Start button produced "Sharing
is required for live sync" rather than "Could not open a session" — which,
reading the source, only happens when `client.create()` already succeeded
against the real relay and it was the (unavailable-in-this-sandbox)
`getDisplayMedia()` permission that failed. The Student tab joined a
made-up session code and got a real "Could not join this session" — an
actual round-trip rejection from the live relay, not a canned message. The
deliberately-committed `dist/` build was rebuilt *without* the live URL
afterward, so the checked-in default artifact stays network-free.

### 4.6 — A real bug, found from a screenshot of teammates actually using it

The user shared a screenshot of a genuinely live moment: real teammates,
real Chrome, the real unpacked extension, a real Google Slides screen-share
about "How HNSW Works," and a join code — but the Student view read
**"Connection interrupted. Showing the last reviewed state"** with a "Stale"
badge, while the connection was, in fact, fine.

**Root cause, found by reading `StudentExperience.tsx`:** a 15-second
content-silence timer was standing in for an actual connection check. Any
instructor spending more than 15 seconds explaining one region — completely
normal teaching — was indistinguishable, to that timer, from a dropped
socket.

**Fix, done properly rather than papered over:** `WebSocketSessionClient`
already tracked real socket open/close internally and exposed none of it.
Added `onConnectionChange` (additive to the frozen `SessionClient`
interface — existing callers on `BroadcastChannel`/in-memory transports are
completely unaffected, since those transports have no real disconnect
concept to report and now correctly never go falsely stale). Threaded it
through `liveRelayClient.ts` to `StudentExperience.tsx`, replacing the timer
entirely. Added `markLiveStateReconnected` as the counterpart. 9 new tests
across the four touched files.

### 4.7 — A full, highly technical state-of-the-project report

At the user's request, produced a comprehensive technical accounting of the
entire system as it stood: exact schema shapes, the `dhash12` fingerprint
algorithm (12×12 luminance grid, 0.75-level tie epsilon, Hamming-distance
matching with a threshold+margin rule), the exact AWS CDK stack
(`infra/lib/live-session-stack.ts`), HMAC capability signing details
(`capability.ts`), the full server-side validation rule list, and the
396-test matrix across four separate test suites (Vitest for the extension,
Vitest for `services/live-session`, Python `unittest` for the Access Pack
content, Python `unittest` for the relay-doc's own structural tests).

**The single most important finding in that report:** `master` and
`accesslens-extension-ar-pivot` had **diverged** — a PR (#11, "pack-driven
rendering," a real and legitimate small feature by Jacob) had been merged
directly to `master`, which `docs/PARALLEL_WORKSTREAMS.md`'s own rules
explicitly forbid during the build. Neither branch is an ancestor of the
other; `master` is missing all of Part 4 entirely. **This is still
unresolved as of this document.**

### 4.8 — Brainstorming: live personalization via Bedrock + S3

The user asked how to make the live sync "richer" and more personalized
without breaking anything, invoking the `brainstorming` skill. Key findings
from that process, none of it built yet:

- Reframed "personalize for different disabilities" into something that
  doesn't violate A8: personalize by **mode** (the thing students already
  choose locally), making each mode's *content* genuinely optimized for the
  need it typically serves — Hear mode should get a Bedrock-authored,
  audio-first spatial description (not just today's browser-TTS reading of
  the visual text), Focus mode a concise single-idea variant, translations
  labeled honestly as machine-translated and unreviewed per the charter's
  A3 review requirement (which the team likely can't satisfy for languages
  nobody on the team reads).
- Proposed schema: an *additive* `regions[].personalization` block (mirrors
  how `arScene`/`matching`/`review` were already added without breaking
  anything), so packs that are never re-authored keep working unchanged.
- Proposed pipeline: extend the existing `scripts/build-pack.ts` Bedrock
  step with two more prompts per region, add a Polly step, and a **new S3
  bucket** to store the resulting audio — activating
  `VITE_ACCESSLENS_ASSET_BASE_URL`, an env var Part 1 had frozen in
  `.env.example` back in §4.2 specifically for this and never used since.
- **Not written to a spec file. Not built. Explicitly on hold** — see §7 and
  §8.

### 4.9 — Brainstorming: instructor content-upload infrastructure

The user's own separate assignment: build the upload pipeline for course
material, and decide what information to capture/store. This reopened the
identity question directly. Through four rounds of clarifying questions, the
following was settled (again: **design only, nothing built**):

| Decision | Answer |
| --- | --- |
| Timeline | Longer-runway real assignment, not a rushed hackathon hack |
| Who uploads | Instructors, self-serve |
| File types | PDF and images only — explicitly **not** PowerPoint (avoids needing LibreOffice as a hosted service) |
| Identity | **Required** — a genuinely new subsystem. Institutional OAuth (Google/Microsoft work account) via Amazon Cognito |
| Stored instructor profile | Email, display name, institution/department |
| Pack visibility | Private per instructor by default |
| Original file retention | Kept (S3), so regeneration doesn't require re-upload |
| Service boundary | A **separate** backend/CDK stack from `services/live-session` — persistent instructor data must never share a `cdk destroy` blast radius with the deliberately-ephemeral live-session stack |
| Generation trigger | Explicit "Generate draft" click, not automatic on upload |
| Review surface | A new "My Packs" screen inside the extension |
| Content safety | **Bedrock Guardrails** scan on upload; a flagged file is blocked entirely, nothing stored, instructor told why |
| Deletion/retention | Instructor can self-delete their account + everything; approved packs and drafts never auto-expire otherwise |
| Organization | Flat list with a title field — no course/class hierarchy (deliberate YAGNI) |

A consequence surfaced during design, not before: private per-instructor
libraries make the current build-time-bundled pack loading
(`import reviewedBioPack from '.../pack.json'` in `App.tsx`) impossible —
packs must move to a runtime fetch.

### 4.10 — "How can we add more AWS, and what should change"

A direct follow-up question, answered with real justification for each
addition (not AWS-for-its-own-sake): **CloudFront** (long-planned, now
actually load-bearing once packs are runtime-fetched), **Amazon Translate**
alongside Bedrock (better tool for straight translation than prompting an
LLM), **Textract** for scanned/image-heavy uploads specifically, **KMS pack
signing** (a gap `capability.ts`'s own code comments already flagged as
unbuilt, newly relevant now that packs leave the repo at runtime), **Cognito
Hosted UI**, and a **CloudWatch dashboard** for judge-facing latency/sync
evidence. Explicitly recommended *against* adding Step Functions/EventBridge
or WAF right now — flagged as "later, if needed," not day-one requirements.

Also named concrete required changes to the existing codebase: pull
`build-pack.ts`'s Bedrock logic out of a throwaway CLI script into a shared
package so the new upload Lambda doesn't duplicate it; keep instructor/
ownership metadata **out of** `AccessPackSchema` entirely (it's authoring
metadata, not instructional content — never send it to a student); reuse
**one** Cognito pool for both content-ownership and gating live-session
`create()`, closing the still-open **T-22** ("nothing stops a student from
picking the instructor role") as a side effect instead of building identity
twice; make `infra/` a multi-stack CDK app rather than a second toolchain;
and — explicitly, learning from §4.4 — wire `services/content-authoring`'s
`npm ci` into CI in the *same commit* that creates the package, not as a
followup discovered by a red run.

### 4.11 — Web research and a harsh re-scoring against the hackathon's own critique

The user revealed two documents that had existed only on their local
machine since the previous day, never committed, never seen by the other
four contributors: `HACKATHON_CRITIQUE.md` (an internal review scoring the
original plan **C+ overall**, with "Build a working demo" at **D** and "Use
AI meaningfully" at **D+**, written when zero code existed) and
`docs/ACCESSLENS_MVP_REVISION.md` (a response proposing to cut the browser
extension, automatic capture, and required AR entirely — never decided,
and built *against* the whole time since).

Asked to be harsh, and researched rather than asserted:

- **Re-scored every criterion** against what's actually built and deployed
  today. "Build a working demo" moves from D to a *conditional* B+ — real,
  but contingent on rehearsals that have no recorded evidence of having
  happened, and on the `master`/integration split from §4.7 not being what
  a judge happens to clone. "Use AI meaningfully" stays weak: Bedrock is
  real and working, but the pack actually used in the flagship demo
  (bio-cell-demo) was not Bedrock-generated — if the live demo never shows
  Bedrock running, a judge sees zero AI. "Show measurable impact" is
  **unchanged at C** — nobody has interviewed a single student with a
  relevant access need or an accessibility professional; this remains the
  cheapest, highest-leverage thing left undone.
- **Found the real, dangerous competitor the original critique missed**:
  PowerPoint's built-in Live Captions — free, ubiquitous, already does
  real-time transcription + 60-language translation. The honest,
  structurally-true differentiator: captions transcribe what's *said*, not
  what's *on the slide*.
- **Found real third-party evidence to cite** instead of inventing impact
  numbers: institutions fully implementing multimodal (UDL) instruction
  measured a 37.4% increase in overall learner performance, 42.8% for
  "disengaged learners"; a separate study found a large effect size
  (d=1.59) for multimodal vs. text-only delivery — with the explicit caveat
  that this is evidence the *architecture* is sound, not a claim about
  AccessLens's own measured results.
- **Found a real overclaim risk**: accessibility research on 3D/spatial
  content for blind students specifically favors physical, audio-annotated
  tactile models — a screen-rendered WebGL AR scene is not usable by
  someone who can't see a screen at all. The AR mode genuinely helps
  low-vision/sighted students and WebXR headset users; for a fully blind
  student, the *audio description of the same event* is the actual
  accessible artifact. Claiming "our AR helps blind students" in a pitch
  is a claim an accessibility-literate judge could reasonably challenge.
- **Flagged a language risk directly**: the user's own phrase "cater to
  their medical conditions" (used casually, in this same conversation)
  contradicts the project's single highest-scoring asset — that AccessLens
  never diagnoses or medicalizes a student. Framing it that way out loud in
  front of a judge would cost more than any code bug.

### 4.12 — Committing the hidden critique and forcing a team alignment check

At the user's explicit direction, and being upfront about what's actually
achievable (there is no way to reach into another person's already-running
AI session directly — that limit was stated plainly, not worked around):

- Committed and pushed both previously-invisible documents.
- Wrote `docs/TEAM_ALIGNMENT_CHECK.md` — the updated scorecard, the research
  above with citations, the language warning, and 14 questions covering
  timeline, the cheap fixes still undone, the undecided MVP-revision
  question, AI visibility in the actual demo, and whether to keep building
  the unbuilt §4.8/§4.9 design before judging. Pre-named a Responses section
  for all five actual contributors (from real commit authorship).
- **Hard-stopped it in two places**: a new STOP section inserted above
  `AGENTS.md`'s existing read-order list (not folded into it, so it can't be
  skipped past), and a brand-new `CLAUDE.md` — which didn't exist before —
  since that file is auto-loaded by any Claude Code session regardless of
  whether an agent chooses to read `AGENTS.md`.
- Opened **T-29** in `docs/CONTEXT_RELAY.md`: `OPEN`, owner "all five
  parts," blocks "any further implementation." Deliberately **not** wired
  into any CI gate (that would block unrelated work); it relies on the same
  read-first convention the team has already followed all session for
  `AGENTS.md` and the relay doc itself.
- The user then told the team directly, outside of git, that this exists.

### 4.13 — Where the user was told to focus next

Given the team had just been told "don't build more until you've answered,"
it would have been inconsistent to hand over a list of new things to build.
The actual recommendation given: get one real person with a relevant access
need (or an accessibility professional) to try the product, timed,
before/after — the single cheapest, highest-leverage action left, blocked by
nothing; run the two full timed rehearsals `docs/DEMO_RUNBOOK.md` already
requires; watch for responses on T-29 rather than assume they'll arrive
unprompted; and explicitly hold off on §4.8/§4.9's design work until the
team has actually weighed in. The `master`/integration branch reconciliation
from §4.7 was offered as the one thing worth fixing regardless of which
direction the team lands on — **still not done as of this document; the
user has not yet said go.**

---

## 5. Current, verified state of the system (fresh, as of this document)

- **Branch:** `accesslens-extension-ar-pivot` at commit `fd63b67`, pushed,
  CI green (confirmed with a real run against that exact commit, not
  inferred).
- **`master`:** diverged at `d6fda7e`, missing all of Part 4, still
  unreconciled.
- **Tests, freshly re-run for this document:** 259/259 (extension, Vitest,
  28 files), 52/52 (`services/live-session`, Vitest, 5 files), 61/61 (Access
  Pack content, Python), 24/24 (relay-doc structure, Python). **396 total,
  all green.** `tsc --noEmit` clean in both TypeScript packages.
- **Deployed:** the AWS relay is live at
  `wss://ktlrnmxq0f.execute-api.us-east-1.amazonaws.com/demo` and was
  re-verified working minutes before this document was written.
  `.env.local` is not present locally, so the committed `dist/` stays
  network-free (`BroadcastChannel`) by default, as intended.
- **T-29:** open, zero responses recorded yet in
  `docs/TEAM_ALIGNMENT_CHECK.md`.

## 6. Open threads and unresolved decisions (do not silently pick one)

- **T-29** — the alignment check itself; blocks further implementation
  until Jacob, Kunj, Omar, and Prachi have each responded.
- **The `master`/integration branch divergence** — real, live, unreconciled.
- **The MVP-revision question** (§4.11 origin) — still genuinely undecided.
  Whoever builds next needs to know which architecture they're building
  toward.
- **T-17 / T-18** — the recurring episodic-filename and thread-ID collision
  problem; a real process gap, still open, still unfixed structurally.
- **T-22** — nothing currently stops a student from selecting the
  Instructor role and starting a session; a real, known, still-open gap.
- **"Measurable impact" (critique criterion 3)** — still C. No student or
  accessibility-professional review has happened.

## 7. Explicitly designed but NOT built — do not assume this exists

- The Bedrock+S3 mode-optimized personalization work (§4.8): no code, no
  schema change, no spec file.
- The entire instructor content-upload/identity subsystem (§4.9): no code,
  no Cognito pool, no new AWS stack, no spec file.
- Any of the "more AWS" additions from §4.10 (CloudFront, Translate,
  Textract, KMS pack signing, Cognito Hosted UI, CloudWatch dashboard): none
  exist yet.

All of the above are real, thought-through designs — reread §4.8–§4.10 (and
the conversation itself, if this document isn't enough detail) before
building any of it, and get the team's input via T-29 first per the user's
own stated decision in §4.13.

## 8. Concrete next actions

In the priority order given to the user, unchanged since §4.13:

1. Get one real person with a relevant access need, or an accessibility
   professional, to try the product and time it — cheapest, highest-leverage,
   blocked by nothing.
2. Run the two full timed rehearsals `docs/DEMO_RUNBOOK.md` requires.
3. Watch `docs/TEAM_ALIGNMENT_CHECK.md` for responses; follow up directly,
   since nothing mechanical will prompt anyone.
4. Decide, and get an explicit go-ahead, on reconciling `master` with the
   integration branch.
5. Hold off on §4.8/§4.9's build until responses land.
6. Once responses are in: reconcile any disagreement (especially on the
   MVP-revision question) and replan the remaining time against what's
   actually true then.

## 9. Where to find things (file map)

| Looking for | File |
| --- | --- |
| The working agreement / mandatory read order | `AGENTS.md` |
| Claude Code's auto-loaded entry point | `CLAUDE.md` |
| Current team status, open threads, decision log | `docs/CONTEXT_RELAY.md` |
| This session's alignment gate and questions | `docs/TEAM_ALIGNMENT_CHECK.md` |
| The original harsh critique | `HACKATHON_CRITIQUE.md` |
| The proposed (undecided) scope-narrowing revision | `docs/ACCESSLENS_MVP_REVISION.md` |
| Non-negotiable data/privacy contract | `docs/PROJECT_CHARTER.md` |
| Extension/event/AWS architecture | `docs/SYSTEM_DESIGN.md` |
| Phases and task IDs | `docs/IMPLEMENTATION_PLAN.md` |
| Who owns which directories | `docs/PARALLEL_WORKSTREAMS.md` |
| Shared schemas | `apps/extension/src/shared/contracts.ts`, `packages/contracts/*.schema.json` |
| The deployed AWS backend | `services/live-session/`, `infra/` |
| The reviewed demo content | `packages/access-packs/bio-cell-demo/` |
| Per-part handoffs | `docs/PART1_HANDOFF.md`, `docs/PART2_HANDOFF.md`, `docs/PART3_HANDOFF.md` |
| Every past session's compact log | `memory/episodic/`, indexed in `memory/INDEX.md` |

## 10. Patterns worth remembering from this session

- **A merge that looks clean can still be silently wrong.** Three separate
  ID collisions this session were invisible to git itself (non-overlapping
  table rows don't conflict) and were only found by actually reading the
  merged result, not trusting a clean `git merge` exit code.
- **"Tests pass" and "CI is green on the actual pushed commit" are
  different claims.** Every merge in §4.4 was re-verified with a fresh
  `make check` and a real polled CI run against the exact commit hash
  before being called done.
- **A guess standing in for a real signal fails in front of real users.**
  Both CI-workflow gaps (T-08/T-27) and the false-stale-connection bug
  (T-28, §4.6) were the same underlying mistake: something approximate
  shipped where a real check was available and cheaper to build correctly
  than to debug later.
- **A document nobody has seen isn't a decision — it's a liability.** The
  critique and revision doc sat unseen for over a day while four people
  built in a direction one of those documents explicitly argued against.
