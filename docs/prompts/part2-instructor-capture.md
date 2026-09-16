# Part 2 build prompt: instructor capture and approved-screen recognition

Run this prompt in a Claude Code session opened at the repository root, working
alone. It completes Part 2 of `docs/PARALLEL_WORKSTREAMS.md` (implementation-plan
tasks A3, A4, and A5) test-first, with black-box tests.

---

## Precedence and identity

You are the Part 2 implementer for AccessLens. You build the instructor side of
the product: the professor clicks Start, shares a tab, window, or screen, the
extension recognizes which reviewed slide is on screen locally, and it emits
small semantic events through the shared `SessionClient`. You work alone in this
session. You do not spawn agents, delegate, or coordinate other workers.

When rules conflict, the higher item wins:

1. The Hard Rules at the end of this prompt.
2. The charter invariants in `docs/PROJECT_CHARTER.md`, especially A1 (capture
   only after a user action and the browser permission flow), A2 (raw media
   stays on the device; the live service sees only semantic events), and A3
   (only reviewed content reaches students).
3. The design decisions in this prompt.
4. The workflow in this prompt.
5. Your own habits.

Documents are authoritative over code. If a document and the code disagree,
name the discrepancy in your handoff and implement the documented behavior. If
two documents disagree, follow the resolution in the design decisions below; if
none exists, stop and report.

The one constraint that bounds everything else: the system never tells a student
something it cannot prove. An unrecognized screen produces `source.unmatched`,
never a best guess. A marginal match is an unmatched match.

## Role and goal

Your goal is a merge-ready `workstream/2-instructor-capture` branch on which:

- no capture starts without the browser permission flow;
- five scripted slide changes match under demo conditions;
- an unknown slide produces `source.unmatched`, never an invented match;
- manual correction emits the intended reviewed asset and region IDs;
- stopping capture immediately stops event production; and
- every one of those five claims is proven by a black-box test.

You are not responsible for student rendering (Part 3), the AWS relay (Part 4),
the reviewed biology pack or camera adapter (Part 5), or the shared schemas and
shell (Part 1). You consume their contracts; you do not change them.

## Input contract

Read these first, in this order. They are short.

1. `AGENTS.md`: working agreement, memory rules, and validation expectations.
2. `docs/PROJECT_CHARTER.md`: invariants A1 through A11 and the prohibited-data
   list.
3. `docs/IMPLEMENTATION_PLAN.md`, section "Phase 2": tasks A3, A4, A5 and
   their acceptance line.
4. `docs/PARALLEL_WORKSTREAMS.md`, section "Part 2": ownership, build list,
   done-when list, and the independent test path.
5. `docs/SYSTEM_DESIGN.md`, sections 5 (live flow), 6 (data contracts), 9
   (failure behavior), and 10 (security and privacy boundaries).
6. `docs/PART1_HANDOFF.md`: what Part 1 delivered and the LiveEvent contract
   matrix.
7. `apps/extension/src/shared/contracts.ts`: the Zod schemas, the
   `SessionClient` interface, and `InMemorySessionClient`.
8. `apps/extension/src/shared/fixtures.ts`, `apps/extension/src/shell/App.tsx`,
   and `apps/extension/src/shell/App.test.tsx`: the placeholder you replace and
   the test conventions you follow.
9. `memory/episodic/0039-part1-contract-gaps.md`: the latest handoff record and
   the shape yours must take.

Facts about the repository you can rely on without re-deriving them:

- Node 22 and npm 10 are installed. `node_modules/` is empty; run `npm install`
  before anything else.
- The Zod contracts live in `apps/extension/src/shared/contracts.ts`, not in
  `packages/contracts/`, which holds only JSON Schema mirrors and their tests.
- `LiveEventSchema` is a strict discriminated union. `asset.changed` carries
  only `assetId`. `region.changed` carries `assetId`, `regionId`, optional
  `pointer`, optional `arState`. `session.started`, `capture.paused`,
  `capture.resumed`, `source.unmatched`, `session.ended`, and
  `caption.appended` carry only the base fields (`schemaVersion`, `type`,
  `sessionId`, `packId`, `packVersion`, `sequence`, `sentAt`). There is no
  `capture.stopped` type.
- `InMemorySessionClient.send()` validates with `LiveEventSchema.parse` and
  fans out synchronously. It does not assign `sequence`, `sessionId`, or
  `sentAt`. It keeps no log; tests observe by subscribing.
- `AccessPack.assets[].fingerprint` is an untyped non-empty string. Its meaning
  is undefined until you define it below.
- Tests are Vitest. There is no `vitest.config`; React tests opt into jsdom
  with a `// @vitest-environment jsdom` first line and drive the DOM with
  `react-dom/client`, `act`, and `dispatchEvent`. There is no Testing Library
  and you do not add one.
- `npm run check` runs typecheck, tests, and the Vite build. `make check` adds
  `scripts/memory_check.py`, which fails if `memory/INDEX.md`'s "Current
  handoff" line does not name the newest file in `memory/episodic/`.
- `dist/` is committed. `npm run build` rewrites it.
- `apps/extension/src/instructor/` and `apps/extension/src/sources/` do not
  exist yet.
- The reviewed biology pack from Part 5 does not exist yet. You build against
  synthetic slides you generate and check in.
- No tool in this environment can drive Chrome. Anything that needs a real
  `getDisplayMedia()` chooser is verified by a human, and your handoff says so.

## Design decisions

These are settled. Implement them; do not reopen them. If one proves impossible,
stop and report why rather than substituting your own design.

### Directory layout and public surfaces

```text
apps/extension/src/sources/screen/
  index.ts              public surface of the screen source
  fingerprint.ts        pure pixel-array to fingerprint string
  matcher.ts            pure fingerprint to match decision
  captureHost.ts        CaptureHost and CaptureStream port types
  displayMediaHost.ts   production CaptureHost using getDisplayMedia()
  sampler.ts            bounded-rate frame loop over a CaptureStream
  README.md             the fingerprint contract, written for Part 5
  fixtures/
    slides/*.png        generated synthetic slides and demo-condition variants
    test-pack.json      AccessPack whose fingerprints match the clean slides
  *.test.ts

apps/extension/src/instructor/
  index.ts              public surface of the instructor module
  captureController.ts  session and capture state machine; owns event emission
  InstructorPanel.tsx   the side-panel UI
  *.test.ts, *.test.tsx

scripts/
  generate-slide-fixtures.ts   deterministic PNG generator (pngjs)
  fingerprint-pack.ts          CLI that fills fingerprints into a pack JSON
```

Tests import only from the two `index.ts` files, `shared/contracts.ts`, and the
fixtures. Anything a test needs to reach must be reachable through those
surfaces or the rendered DOM. If you find yourself importing `fingerprint.ts`
from a controller test, the surface is wrong, not the test.

### Fingerprint contract

The `fingerprint` field is a difference hash, formatted as the literal prefix
`dhash-v1:` followed by sixteen lowercase hexadecimal characters.

Algorithm, exactly:

1. Convert the frame to luminance with Rec. 601 weights
   (`0.299 R + 0.587 G + 0.114 B`) on 8-bit values.
2. Downsample to a 9-wide by 8-high grid by area averaging over the full
   frame. Do not crop.
3. For each of the 8 rows, for each of the 8 adjacent column pairs left to
   right, emit bit 1 when the left cell is brighter than the right, else 0.
4. Pack the 64 bits row-major, most significant bit first, into 16 hex digits.

Matching compares Hamming distance between the frame hash and every asset hash
in the pack. A frame matches asset X only when X's distance is at or below the
threshold and every other asset's distance is at least the ambiguity margin
farther away. Otherwise the frame is unmatched. Start with a threshold of 10
bits and a margin of 4 bits. You may tune both from test evidence; you may not
tune them until a wrong fixture passes, and the final values and the reasoning
go in the README.

This choice replaces the OpenCV.js line in the system-design stack table. It is
pure JavaScript, deterministic, needs no native dependency, and is what makes
"five scripted transitions match" a unit test instead of a hope. Record the
substitution in the handoff so Part 5 and Part 1 see it.

`scripts/fingerprint-pack.ts` is the deliverable Part 5 uses to produce real
fingerprints: it takes a pack JSON and a directory of slide PNGs named by
`assetId`, writes the computed fingerprint into each asset, and validates the
result with `AccessPackSchema`. The README documents its invocation.

### Capture host

`CaptureHost.requestStream()` is the only path that can start capture. The
production implementation calls `navigator.mediaDevices.getDisplayMedia()` from
the side-panel document, plays the stream into a detached video element, and
samples it through a canvas. Nothing constructs or calls a host except the
controller's `start()`, which runs only from the Start button's click handler.

The system design describes sampling in an offscreen extension document. That
is deliberately out of scope for this run: it requires `offscreen` and
`desktopCapture` manifest permissions and a second Vite entry, both owned by
Part 1, and it cannot be verified here without a human in Chrome. The
`CaptureHost` port exists so the offscreen host is a later swap with no change
to the controller, the panel, or the tests. Name this in the handoff as the
next action, with the manifest and Vite changes it will need.

`CaptureStream` exposes `sampleFrame()` returning a `Frame` (`width`,
`height`, `data` as RGBA `Uint8ClampedArray`) or `null` when no frame is
available, `stop()`, and `onEnded(listener)` for the browser's own "Stop
sharing" bar. Tests use a fake host that serves PNG fixtures from a queue and
records every call.

### Frame handling

A frame lives for exactly one `sampleFrame()` to fingerprint pass. The
controller state, the panel state, and every emitted event contain identifiers
and strings only. The sampler runs at a bounded rate through an injected
scheduler so tests never use real timers; two samples per second is the
production default.

### Event mapping

Every emission goes through `SessionClient.send()`. The controller owns
`sessionId`, a per-session `sequence` counter starting at 1 and incrementing by
exactly 1 per emitted event, and `sentAt` from an injected clock. `packId` and
`packVersion` come from the loaded pack. Emit only on change; a repeated match of
the current asset emits nothing.

| Instructor action or observation | Emitted |
| --- | --- |
| Start clicked, capability created, stream granted | `session.started`, then sampling begins |
| Start clicked, chooser dismissed or denied | nothing; status explains sharing is required; state returns to idle |
| Sampler matches an asset different from the current one | `asset.changed` |
| Sampler sees three consecutive unmatched samples while the current state is a matched asset or a fresh session | `source.unmatched`, once, until the state changes again |
| Pause clicked | `capture.paused`; sampling halts; the stream is retained |
| Resume clicked | `capture.resumed`; sampling continues |
| Stop clicked, or the browser ends the stream | `session.ended`; sampling halts; the stream is released; the session client stays open so Start can begin again |
| End Session clicked | Stop behavior if sharing, then `SessionClient.close()` |
| Instructor corrects to asset X | `asset.changed` for X |
| Instructor corrects to asset X and region R | `asset.changed` for X if X is not current, then `region.changed` for X and R |
| Instructor indicates region R on the current asset | `region.changed` for the current asset and R |

The three-sample unmatched debounce exists so a slide transition frame does not
flash students to Unmatched; it must still fire for a genuinely unknown slide,
and the tests prove both.

The Stop mapping is a documented discrepancy: the workstream doc asks for a
stop event and the frozen schema has none. `session.ended` is the closest
honest meaning for students ("close the live view"). Record it in the handoff as
a question for Part 1: add `capture.stopped`, or confirm this mapping.

A manual correction is sticky. After the instructor corrects to X, the sampler
does not emit automatically until the observed fingerprint moves more than the
threshold away from the fingerprint seen at the moment of correction. This is
what makes correction useful when the matcher is consistently wrong about the
slide on screen.

### Region indication

Pointer and region detection from cursor position is stretch scope. Regions are
indicated manually: the panel lists the current asset's regions and the
instructor selects one. The correction control lets the instructor pick any
asset in the pack and optionally one of its regions. Both use native form
controls with visible labels so they are keyboard and screen-reader operable.

### Panel requirements

Buttons named exactly Start, Pause, Resume, Stop, and End Session, each
rendered only when its action is valid in the current state. A `role="status"`
region that always states the capture state and, when matched, the current
asset title and region. A visible Unmatched state. The correction control. The
session join code shown while a session is open, since students need it.

### Shell integration

Replace the instructor branch of `apps/extension/src/shell/App.tsx` with
`<InstructorPanel />` receiving the session client, the pack, and the capture
host. This is the one edit you make in Part 1's directory, and it is glue only.
Update `App.test.tsx` so it drives the new panel instead of the removed "Send
fixture event" button; the student-follows-instructor assertion it makes must
still hold, now through a correction that emits `region.changed`. Until Part 5
delivers the reviewed pack, the shell loads the synthetic test pack, and the
handoff says so.

### Dependencies you may add

Dev dependencies only: `pngjs` and `@types/pngjs` for fixture generation and
decoding, `@types/chrome` for the extension API types, and `tsx` to run the two
scripts. Nothing else. No runtime dependencies.

## Tool usage

Use Bash for `npm`, `npx vitest run <path>`, `npm run check`, `make check`, and
git. Use the file tools for reading and editing. Prefer running the single test
file you are working on over the whole suite until a slice is green, then run
the whole suite before committing.

You have no browser. Do not attempt to install or drive one, and do not mark a
Chrome-dependent claim as verified.

## Workflow

Work in slices. Each slice is test-first: write the black-box tests for the
slice, run them and confirm they fail for the right reason, implement until
green, refactor with the tests still green, then commit with a message that
names the task ID. Never write implementation ahead of a failing test.

### Slice 0: baseline

1. `git checkout -b workstream/2-instructor-capture` from the current
   integration branch.
2. `npm install`, then add the dev dependencies above.
3. `npm run check` must pass before you change anything. If it does not, stop
   and report; you are not here to fix Part 1.

### Slice 1: fixtures and the fingerprint contract

Write `scripts/generate-slide-fixtures.ts` to produce, deterministically:

- six approved slides, `slide-01.png` through `slide-06.png`, at 1920 by 1080,
  each a distinct high-contrast layout (title band, one or two large filled
  shapes at different positions, stripe blocks standing in for text) so that
  their hashes are far apart;
- one unapproved slide, `unknown-01.png`, in the same style;
- for every approved slide, a demo-condition variant under
  `fixtures/slides/demo/`: rescaled to 1280 by 720, mild deterministic noise,
  a slight brightness shift, and a thin bezel border, simulating what a shared
  window looks like after browser scaling and compression;
- two near-duplicate approved slides, `twin-a.png` and `twin-b.png`, that
  differ only in a small detail, used to prove the ambiguity rule.

Write `fixtures/test-pack.json` as a valid `AccessPack` with `packId`
`bio-cell-demo`, `version` 1, one asset per approved slide plus the two twins,
each with a title, reading order, and at least one region with normalized
bounds and descriptions. Generate its fingerprints with
`scripts/fingerprint-pack.ts`, then check both the PNGs and the JSON in.

Tests for this slice, all through `sources/screen/index.ts`:

- the fingerprint of a fixture matches the format `dhash-v1:` plus sixteen
  lowercase hex characters;
- a slide's fingerprint equals its own entry in the test pack, and a second
  computation is identical;
- every demo-condition variant matches its own asset;
- `unknown-01.png` is unmatched against the pack;
- a frame of a twin slide is unmatched, because two assets sit inside the
  ambiguity margin;
- a solid black frame and a solid white frame are both unmatched;
- the CLI, run on the clean slides, reproduces the checked-in fingerprints
  byte for byte.

### Slice 2: the capture controller

Tests drive `createCaptureController` from `instructor/index.ts` with an
`InMemorySessionClient`, a fake `CaptureHost`, a fake clock, a fake scheduler,
and a fixed ID generator. They observe only the client's subscription, the
controller's public state snapshot, and the fake host's call log.

- Constructing the controller and loading the pack calls nothing on the host.
- `start()` calls `requestStream()` exactly once and, on success, emits
  `session.started` with sequence 1 before any sample is taken.
- When the fake host rejects with a `NotAllowedError`, nothing is emitted, the
  state is idle with an explanation, and `requestStream()` was still called
  exactly once.
- Feeding the six approved demo-condition frames in a scripted order produces
  exactly five `asset.changed` events for the five transitions, in order, with
  sequence numbers increasing by one, and no event for repeated frames of the
  same slide.
- Feeding a single unknown frame between two approved frames emits nothing
  extra; feeding three consecutive unknown frames emits exactly one
  `source.unmatched`; feeding thirty more emits nothing further.
- `pause()` emits `capture.paused` and frames queued afterwards are never
  sampled; `resume()` emits `capture.resumed` and sampling continues.
- `stop()` emits `session.ended`, calls `stop()` on the stream, and frames
  queued afterwards produce no events even when the scheduler is advanced
  many times; the host's `onEnded` firing has the same effect.
- `endSession()` after a stop closes the client so a further `send` throws.
- `correct({ assetId })` emits `asset.changed` for that asset;
  `correct({ assetId, regionId })` emits `asset.changed` then `region.changed`
  carrying both IDs; `indicateRegion(regionId)` on a current asset emits
  `region.changed` with the current asset ID.
- After a correction, identical frames continue to produce no events; a frame
  of a clearly different approved slide produces `asset.changed` again.
- Every emitted event passes `LiveEventSchema.safeParse`, and serialising the
  controller's state snapshot contains no key named `data`, `frame`, or
  `pixels` and no `Uint8ClampedArray`.

### Slice 3: the instructor panel

Tests render `InstructorPanel` with the same fakes and drive it through the
DOM only: find buttons by their visible text, dispatch clicks, read
`role="status"` text, change the correction selects and submit.

- Before Start is clicked, the fake host has no calls, and Pause, Resume, Stop,
  and End Session are not rendered.
- Clicking Start calls the host once, the status reports sharing, the join
  code is visible, and the subscription received `session.started`.
- Denied capture shows the explanation in the status region and Start is
  rendered again.
- With the fake stream serving a demo-condition frame and the scheduler
  advanced, the status names the matched asset's title.
- With three unknown frames, the status reads Unmatched.
- Choosing an asset and region in the correction control and confirming emits
  the expected events and the status names the chosen region.
- Pause, Resume, Stop, and End Session each emit their event and the rendered
  button set changes to match the new state.
- Every button and form control has an accessible name.

### Slice 4: shell integration and production host

Wire the panel into `App.tsx` as described, update `App.test.tsx`, and implement
`displayMediaHost.ts`. The production host has no unit test beyond "constructing
it calls nothing"; its verification is the human checklist in the handoff.

### Slice 5: finish

1. Write `apps/extension/src/sources/screen/README.md`: the fingerprint
   algorithm, the format, the threshold and margin with the evidence that set
   them, and how Part 5 runs the CLI.
2. Write `docs/PART2_HANDOFF.md` per the output contract.
3. Write `memory/episodic/0040-part2-instructor-capture.md` with the headings
   `## Goal`, `## Changed files`, `## Validation evidence`, `## Blocker`,
   `## Owner`, `## Next action`, and update the "Current handoff" line in
   `memory/INDEX.md` to name it.
4. Run `npm run check` and then `make check`. Both must pass.
5. Rebuild `dist/` with the final build and commit it in the last commit only.
6. Run `git status`. Anything modified outside the paths in this prompt is a
   defect; revert it or explain it.

## Output contract

The run ends when all of the following exist on `workstream/2-instructor-capture`
and `make check` passes:

- the two new source directories with their tests, fixtures, and README;
- the two scripts;
- the glue edit in `App.tsx` and the updated `App.test.tsx`;
- `docs/PART2_HANDOFF.md` containing, under these headings: what was built and
  where; the fingerprint contract summary and CLI usage for Part 5; a numbered
  manual Chrome verification checklist for the human (load unpacked, click
  Start, see the chooser, share a window showing a fixture slide, watch the
  status change, use the browser's Stop sharing bar, confirm the status);
  discrepancies and decisions flagged for other owners (the Stop event
  mapping for Part 1, the offscreen host deferral with the exact manifest and
  Vite changes it needs, the OpenCV.js substitution, the synthetic pack in the
  shell until Part 5 lands, the dev dependencies added); and the next action;
- the episodic record and the INDEX pointer;
- a rebuilt `dist/`.

Your final message to the user follows AGENTS.md: changed files, the checks
you ran with their pass counts pasted from the output, the evidence each
done-when criterion rests on, risks, and the next action. Report only what you
verified. A Chrome-dependent claim is reported as unverified.

## Anti-patterns

### Don't tune thresholds until the fixtures pass

Why: a threshold that makes a wrong fixture pass has been fitted to the test,
and the demo slide it was supposed to reject will pass too.

Instead: when a fixture fails, decide whether the fixture is unrealistic or the
algorithm is inadequate, fix that, and record any threshold change with the
distance table that justified it.

### Don't let a marginal match through

Why: a student hearing the wrong organelle described is worse than a student
seeing Unmatched. The design's whole trust story rests on never inventing.

Instead: when the best distance is within the margin of the second best, return
unmatched and let the instructor correct.

### Don't reach past the public surface in tests

Why: a test that imports `matcher.ts` into a controller test proves the
internals, not the behavior, and it breaks the moment the internals change.

Instead: if the behavior cannot be observed through the index modules, the
subscription, the DOM, or the fake host's log, add the observation point to the
public surface and justify it in the README.

### Don't hold a frame anywhere but the stack

Why: a frame reference in React state, a closure, or a log is a raw-media
retention path, and invariant A2 has no exception for "temporarily".

Instead: sample, fingerprint, drop. The state snapshot test enforces this.

### Don't use real timers or real dates in tests

Why: timing-dependent tests flake, and a flaky privacy test is a privacy test
nobody trusts.

Instead: every time source and every scheduled tick goes through the injected
clock and scheduler.

### Don't mock the schema

Why: `LiveEventSchema` is the contract other workstreams validate against. A
mocked schema lets an invalid event through the tests and into the relay.

Instead: send through a real `InMemorySessionClient` and let its `parse` be the
gate.

## Hard rules

1. Nothing calls `requestStream()` except `start()`, and `start()` runs only
   from the Start button's click.
2. Frames exist only for the duration of one fingerprint pass and never appear
   in state, events, or logs.
3. A match is emitted only when it clears the threshold and the ambiguity
   margin; everything else is unmatched.
4. Every emitted event is built by the controller, validated by the real
   session client, and carries a sequence exactly one greater than the last.
5. Pause, Stop, and stream end halt sampling synchronously; no event follows.
6. Tests import only the two index modules, the shared contracts, and the
   fixtures, and observe only through the subscription, the DOM, and the fake
   host.
7. Every slice starts with failing tests.
8. You do not edit `contracts.ts`, `fixtures.ts`, the JSON schemas, the
   manifest, or `vite.config.ts`; the only Part 1 edits are the `App.tsx`
   instructor branch and `App.test.tsx`.
9. Only the listed dev dependencies are added; no runtime dependencies.
10. Thresholds change only with recorded evidence.
11. Chrome-dependent behavior is reported as unverified.
12. `make check` passes, `git status` is clean, and the memory pointer names
    the new episodic record before you report done.
13. If a design decision cannot be implemented as written, stop and report
    rather than substitute.
