# Part 2 handoff: instructor capture and approved-screen recognition

Implementation-plan tasks A3 (explicit capture), A4 (mock slide matcher), and
A5 (correction control) are implemented on `workstream/2-instructor-capture`,
test-first with black-box tests. This document tells the other Part owners
what exists, what they must decide, and what a human still has to verify in
Chrome.

## Integration status (after merging Parts 3 and 5)

Branch `workstream/2-instructor-capture` now contains the integration branch
(Part 5's reviewed pack) and `workstream/3-student-ar` (Part 3's student
experience). Decisions made during that merge, all reflected in code:

1. **Fingerprint contract is `dhash12`, Part 5's definition.** Part 2's
   `dhash-v1` was removed, not bridged. `sources/screen/fingerprint.ts` is a
   port of `bio-cell-demo/tools/imagehash.py`, tested byte-for-byte against the
   reviewed pack and cross-checked against the Python on the synthetic slides.
   Thresholds come from `pack.matching` (26 / 14 in the reviewed pack).
2. **`AccessPackSchema` and `access-pack.schema.json` were widened
   additively** (Part 1's files) to close gaps 1 and 2 of
   `PART5_CONTRACT_CONFORMANCE.md`: optional `review`, `matching`,
   `arCameras`, `reservedReadingOrderIds`, `assets[].mediaUri`,
   `assets[].subtitle`, `assets[].arScene`, `regions[].label`. Required fields
   are unchanged; the strict denylist tests still pass; Part 5's Python
   conformance check reports those gaps as closed. Part 1 should review the
   exact shapes, especially `arCameras` (a record of `{position, target, fov}`)
   and the AR hotspot fields.
3. **Shell:** instructor branch is `InstructorPanel`, student branch is Part
   3's `StudentExperience` unchanged. The default pack is the reviewed
   bio-cell-demo pack; the HNSW draft pack is selectable and labelled as a
   draft. Part 3's component styles were ported onto the shared dark tokens.
4. **Transport for local testing:** `shared/broadcastSessionClient.ts`
   implements the frozen `SessionClient` over `BroadcastChannel`, so an
   instructor tab and student tabs in one browser profile follow each other
   with no network. Part 4's relay replaces it behind the same interface.
5. **Automated pack authoring:** `scripts/build-pack.ts` turns a `.pptx` into
   a draft pack with Claude Sonnet 4.6 descriptions on Bedrock. Output is
   always `pack.draft.json`; the instructor review is the rename to
   `pack.json` (charter A3, and the human review gate for automated content
   generation applies).

Still open for other owners: the instructor/student authorization gate
(anyone can open the Instructor view; enforcement belongs in Part 4's relay
with a shell gate on the capability role), `capture.stopped` versus
`session.ended` for Stop, and the offscreen sampling host.

## What was built and where

| Path | What it is |
| --- | --- |
| `apps/extension/src/sources/screen/` | The screen source: `dhash-v1` fingerprint, matcher with threshold and ambiguity margin, `CaptureHost`/`CaptureStream` port types, the production `getDisplayMedia()` host, a bounded-rate sampler, and a README that is the fingerprint contract for Part 5. |
| `apps/extension/src/sources/screen/fixtures/` | Nine deterministic synthetic 1920x1080 slides (six approved, one unknown, two near-duplicate twins), six 1280x720 demo-condition variants, `test-pack.json` (`bio-cell-demo` v1, eight assets with reading order and regions), and the test doubles (`FakeCaptureHost`, `FakeScheduler`, `FakeClock`, `fixedIds`). |
| `apps/extension/src/instructor/` | `createCaptureController` (session, sequence, recognition, correction, pause/stop state machine; owns every emission) and `InstructorPanel` (Start, Pause, Resume, Stop, End Session, `role="status"`, join code, correction and region-indication forms). |
| `scripts/generate-slide-fixtures.ts` | Deterministic PNG generator (pngjs). Re-running reproduces the checked-in bytes. |
| `scripts/fingerprint-pack.ts` | The CLI Part 5 uses to fill fingerprints into a real pack. |
| `apps/extension/src/shell/App.tsx`, `App.test.tsx` | The one Part 1 edit: the instructor branch renders `InstructorPanel`; the shell test drives a correction instead of the removed "Send fixture event" button. |

Tests import only `sources/screen/index.ts`, `instructor/index.ts`,
`shared/contracts.ts`, and `sources/screen/fixtures/`, and observe only the
session-client subscription, the DOM, the controller's state snapshot, and
the fake host's call log.

## Fingerprint contract summary and CLI usage (for Part 5)

`fingerprint` is `dhash12:` plus thirty-three lowercase hex characters, Part
5's definition: Rec. 601 luminance, 12x12 block means over the full frame, 132
left-brighter-by-more-than-0.75 bits, row-major, MSB first. Matching is
Hamming distance against `pack.matching.maxHammingDistance` and
`pack.matching.minMargin`; anything not clearing both is `source.unmatched`.
Full algorithm and evidence are in `apps/extension/src/sources/screen/README.md`.

```sh
npx tsx scripts/fingerprint-pack.ts packs/bio-cell/pack.json packs/bio-cell/slides
```

`slides/` holds `<assetId>.png` per asset. The CLI writes the fingerprints
back into the pack (or to `--out <path>`), validates with `AccessPackSchema`,
and is a byte-for-byte no-op when nothing changed. Then replace the
`syntheticPack` import in `App.tsx` with the reviewed pack.

## Event mapping implemented

| Instructor action or observation | Emitted |
| --- | --- |
| Start, capability created, stream granted | `session.started`, then sampling at 2 Hz |
| Start, chooser dismissed or denied | nothing; status says sharing is required; idle |
| Match of an asset different from the current one | `asset.changed` |
| Three consecutive unmatched samples from a matched or fresh state | one `source.unmatched` |
| Pause / Resume | `capture.paused` / `capture.resumed` |
| Stop, or the browser's Stop sharing bar | `session.ended`; stream released; session stays open |
| End Session | Stop behaviour if sharing, then `SessionClient.close()` |
| Correct to X (and optionally region R) | `asset.changed` for X if not current, then `region.changed` |
| Indicate region R on current asset | `region.changed` |

The controller owns `sessionId`, a per-session `sequence` starting at 1 and
incrementing by exactly 1, and `sentAt` from an injected clock. Start after
Stop reuses the open session and continues the sequence (students keep the
same join code; the relay's monotonic-sequence check stays satisfied).

## Manual Chrome verification checklist (human, not yet done)

No tool in this environment can drive Chrome or a real `getDisplayMedia()`
chooser. Everything below is **unverified** until a human runs it.

1. `npm run build`, then in `chrome://extensions` enable Developer mode and
   Load unpacked on `dist/`.
2. Open any PNG from `apps/extension/src/sources/screen/fixtures/slides/`
   (for example `slide-03.png`) in a separate Chrome window or an image
   viewer, sized so the slide fills the window.
3. Click the AccessLens action to open the side panel. Confirm the status
   reads "Not sharing" and only **Start** is shown. Confirm no chooser has
   appeared yet.
4. Click **Start**. Confirm the browser's tab/window/screen chooser appears
   (charter A1). Cancel it once: confirm nothing is emitted, the status says
   sharing is required, and Start is shown again.
5. Click **Start** again and share the window showing the slide. Confirm the
   status reads "Sharing", a join code is shown, and within about two seconds
   the status names "The mitochondrion" (for `slide-03`).
6. Switch the shared window to `slide-05.png`. Confirm the status changes to
   "Ribosomes and the endoplasmic reticulum". Switch to `unknown-01.png` and
   confirm the status reads "Unmatched" after about 1.5 seconds and never
   names a slide.
7. In "Correct the slide" choose "The nucleus" and region "nucleolus", click
   **Apply correction**. Confirm the status names the nucleus and nucleolus.
8. Click **Pause**: status reads "Paused", Resume/Stop/End Session shown.
   Click **Resume**.
9. Use Chrome's own **Stop sharing** bar. Confirm the status returns to
   stopped, the join code is still shown, and Start and End Session are
   offered.
10. Click **End Session**. Confirm "Session ended" and no controls remain.
11. Open the Student route in the same panel during steps 5 to 7 (Part 3 will
    replace this view) and confirm it follows the region correction.

## Discrepancies and decisions flagged for other owners

1. **Stop event mapping (Part 1).** `docs/PARALLEL_WORKSTREAMS.md` asks Part 2
   to emit a stop event; the frozen `LiveEventSchema` has no `capture.stopped`.
   Stop and the browser's Stop sharing bar emit `session.ended`, the closest
   honest meaning for students ("close the live view"). Question for Part 1:
   add `capture.stopped` to the schema and the JSON mirror, or confirm this
   mapping. If added, only `endSharing()` in `captureController.ts` changes.
2. **Offscreen sampling host deferred (Part 1).** `docs/SYSTEM_DESIGN.md`
   samples in an offscreen extension document. This run samples in the side
   panel document through `displayMediaHost.ts`. The `CaptureHost` port makes
   the offscreen host a drop-in swap with no controller, panel, or test
   change. It needs, all Part 1 owned: `"offscreen"` and `"desktopCapture"`
   in `manifest.json` `permissions`; a second Vite entry (for example
   `apps/extension/offscreen.html` plus `src/offscreen/main.ts`) declared in
   `vite.config.ts` `build.rollupOptions.input`; and a message channel from
   the service worker to create the offscreen document with reason
   `USER_MEDIA`/`DISPLAY_MEDIA`. Verification is Chrome-only.
3. **OpenCV.js substitution (Parts 1 and 5).** The system-design stack table
   lists OpenCV.js for matching. Part 2 uses the pure-JavaScript `dhash12`
   contract instead: deterministic, no native dependency, unit-testable.
   Update the stack table when convenient.
4. **Synthetic pack in the shell (Part 5).** Until the reviewed biology pack
   exists, `App.tsx` loads `sources/screen/fixtures/test-pack.json`
   (`bio-cell-demo` v1 with eight synthetic assets). The old
   `shared/fixtures.ts` `validPack` (`cell-slide-03` with a placeholder
   fingerprint) is no longer referenced by the shell; it still backs contract
   tests and was not edited.
5. **Dev dependencies added:** `pngjs`, `@types/pngjs`, `@types/chrome`,
   `tsx`. No runtime dependencies. The production bundle contains no pngjs.
6. **Role switch releases capture silently (Parts 1 and 3).** The shell's
   RoleNav unmounts `InstructorPanel` when switching to the Student view, and
   unmount disposes the controller: sampling halts and the stream is released
   with no event. This keeps the shell test's student-follows-instructor
   assertion valid and leaks no media, but students would not receive a
   `session.ended`. Once Part 3 gives students their own route, either hoist
   the controller above `RoleNav` or accept the behaviour.
7. **Region indication uses select plus button, not select alone.** Emitting
   on `change` would fire a `region.changed` on every arrow-key step for
   keyboard and screen-reader users, so the panel requires an explicit
   "Indicate region" or "Apply correction" activation.
8. **Fixture layouts, not thresholds, were tuned.** The first fixture set had
   cross-slide distances of 7 to 11 bits, within the threshold. The layouts
   were redesigned as (8,4) Hamming codewords over a 4x2 macro grid; the
   threshold and margin stayed at 10 and 4. Evidence is in the README.

## Next action

Human runs the Chrome checklist above and records the result in a new
episodic memory. Then Part 1 answers the `capture.stopped` question and, when
ready, lands the offscreen host with the manifest and Vite changes in item 2.
Part 5 runs the CLI on the reviewed slides, records the real distance table
per the README's "Known limitation" section, and swaps the pack import in
`App.tsx`.
