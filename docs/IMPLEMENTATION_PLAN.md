# AccessLens Implementation Plan

**Revision:** 2

**Date:** September 15, 2026

**Status:** Current hackathon plan; replaces the Evidence Engine phase plan

## 1. Product loop

`instructor consent -> capture locally -> transient AWS screen analysis (when enabled) -> emit semantic event -> student-selected rendering`

Capture, recognition, live transport, accessible rendering, and AR interaction
remain separate modules so privacy or recognition failures do not silently become
student-facing misinformation.

## 2. Hackathon scope

### Must have

- Manifest V3 browser extension with Instructor and Student modes;
- explicit instructor tab/window/screen sharing;
- one checked-in biology Access Pack;
- transient screen analysis through the configured AWS Textract/Bedrock adapter;
- temporary live session with ordered semantic events;
- automatic student following;
- Focus, structured-text, audio, and synchronized AR modes;
- two simulated student views; and
- a rehearsed failure state and manual instructor correction.

### Stretch

- normalized pointer/region synchronization;
- live captions;
- approved terminology or language support;
- opt-in camera mode for one laboratory demonstration.

### Deferred

- production Canvas/LTI integration;
- general screen understanding for arbitrary software;
- automatic remediation of an entire course;
- student analytics or profiles;
- automatic grading or mastery estimates; and
- continuous camera or screen recording.

## 3. Phased tasks and acceptance criteria

Team ownership, directory boundaries, independent test paths, and integration
checkpoints are defined in
[`PARALLEL_WORKSTREAMS.md`](PARALLEL_WORKSTREAMS.md). Its five parts map the tasks
below onto five people without changing their acceptance criteria.

### Phase 0 — Product reset

- **A0 — AccessLens source-of-truth reset:** replace active product, charter,
  architecture, and demo documents; remove coding-specific implementation from the
  active tree; preserve historical decisions only in memory and Git history.

**Acceptance:** all active documentation names AccessLens as the product; no active
application or guide instructs teammates to build or demo the coding engine.

### Phase 1 — Extension shell and contracts

- **A1 — Manifest V3 shell:** side panel with Instructor and Student roles, local
  preferences, and accessible keyboard navigation.
- **A2 — Shared contracts:** versioned `AccessPack`, `LiveEvent`, and session-token
  schemas with fixture validation.

**Acceptance:** unpacked extension loads; both roles render; invalid packs and events
are rejected deterministically; student preferences never leave local storage.

### Phase 2 — Instructor capture and recognition

- **A3 — Explicit capture:** instructor clicks Start and chooses a tab, window, or
  screen through the browser-provided chooser.
- **A4 — Screen analysis:** instructor-side capture sends transient frames only
  when the instructor enables AI analysis; the configured AWS adapter returns a
  validated accessibility object and raw pixels are discarded.
- **A5 — Correction control:** instructor can override a wrong match or pause
  sharing immediately.

**Acceptance:** no capture begins without a user gesture; raw frames do not reach the
backend; five scripted slide transitions match correctly under demo conditions;
stop sharing terminates event production.

### Phase 3 — Temporary live synchronization

- **A6 — Session API:** create/join/close session with signed role capabilities.
- **A7 — WebSocket relay:** sequence-check and relay allowlisted semantic events.
- **A8 — Expiry and reconnect:** temporary connection state expires and student
  clients recover the latest event after a short disconnect.

**Acceptance:** two student extensions follow one instructor; reordered or
unauthorized events are rejected; no raw frame field exists in the event contract.

### Phase 4 — Accessible student rendering

- **A9 — Focus mode:** display the approved current region with reduced clutter and
  clear context.
- **A10 — Structured text:** render reading order, headings, terminology, and
  captions from the reviewed pack.
- **A11 — Audio mode:** play concise, student-requested reviewed descriptions without
  continuously talking over the instructor.
- **A12 — Synchronized AR view:** render the reviewed cell model in the Student
  extension and drive its camera, highlight, label, and hotspot state from the same
  ordered asset/region event used by every other mode.
- **A13 — Equivalent interaction:** provide keyboard, touch, voice, and
  non-immersive controls for the same labels and biology relationships exposed in
  AR.

**Acceptance:** student modes update automatically from the same event; keyboard and
screen-reader checks pass; the AR model highlights the instructor-selected
organelle; its equivalent route exposes the same meaning; mode choice stays local;
no automatic grade or attention signal is produced.

### Phase 5 — Demo hardening

- **A14 — Failure tests:** permission denial, wrong match, rapid navigation,
  disconnect, stale event, and instructor stop.
- **A15 — Accessibility review:** test with at least one relevant student/design
  partner and one accessibility or instructional-design professional if available.
- **A16 — Presentation:** two timed live rehearsals and a recorded fallback.

**Acceptance:** the three-minute demo works twice from a clean extension install;
known limits and evidence sources are stated accurately.

### Phase 6 — Camera and physical-world stretch

- **A17 — Camera feasibility spike:** opt-in instructor or shared-device camera for
  one non-shareable lab object, with local processing and a manual fallback.

**Acceptance:** camera permission is explicit, faces are ignored, raw frames are not
stored or relayed, and students without cameras receive the same semantic event.

Phase 6 begins only after Phases 1–5 are demo-ready.

## 4. Test strategy

- Contract tests for Access Packs and live events
- Permission-state tests for capture start/stop
- Fixture-based recognition tests
- AR contract tests mapping each demo region to a valid model node and hotspot
- AR synchronization tests for region change, stale event, and reconnect
- Keyboard and screen-reader tests for the equivalent semantic scene outline
- WebSocket authorization, ordering, reconnect, and expiry tests
- Axe and keyboard navigation checks
- Screen-reader smoke test
- Privacy tests that reject prohibited fields
- Manual poor-lighting and occlusion tests only if camera stretch begins

## 5. Risk register

| Risk | Mitigation |
| --- | --- |
| Screen capture cannot start silently | Make the instructor's one-time Start action part of the product story; browsers intentionally require it. |
| Arbitrary screen recognition is unreliable | Match only one reviewed biology deck in the MVP and provide instructor correction. |
| Audio competes with the lecture | Make descriptions student-requested, concise, and headphone-oriented. |
| Extension permissions alarm users | Prefer `activeTab` and explicit capture; document each permission in plain language. |
| Canvas approval is unavailable | Use session codes and checked-in mock content; production Canvas remains deferred. |
| Accessibility claims exceed evidence | Validate with design partners and label prototype evidence honestly. |
| Camera consumes the schedule | Camera is Phase 6 and cannot block the extension demo. |
| Slide fingerprints flip on flat artwork | Neighbouring cells of a flat slide region tie exactly, so a bare greater-than comparison is decided by floating-point rounding and by compression noise. The pack's hash resolves ties to 0 and requires a 0.75-level difference to set a bit; measured worst-case drift on a distorted capture fell about fourfold, from 38 bits to 10 of 132. Any reimplementation of the matcher must keep the tie rule. |
| A near-duplicate slide silently breaks matching | `validate_pack.py` fails when two reviewed slides sit closer than twice the configured margin, so the problem surfaces when the slide is added rather than during the demo. |

## 6. Immediate next task

Start **A1 + A2** as one bounded vertical slice: load an unpacked extension, switch
between Instructor and Student roles, and render one validated checked-in Access Pack
without any network or capture permission.
