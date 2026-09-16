# Local camera consent lifecycle

## Goal

Build the opt-in, instructor-only camera permission and stop foundation for a
future physical-content source without transmitting or interpreting camera data.

## Changed files

- Added a local `getUserMedia` camera source that requests video without audio,
  samples frames on demand, and releases tracks deterministically.
- Added a visible instructor camera control with explicit start/stop, denied, and
  browser-ended states.
- Kept manual reviewed-region selection as the stated fallback; no semantic camera
  event or recognition exists.

## Validation evidence

Focused host/control/App tests passed eight tests and extension typecheck passed.
The full repository batch is deferred to the next independent slice.

## Data and scope boundary

Camera stream and transient frames stay local. No raw frame, recording, audio,
face/object/gesture label, identity, student camera, analytics, storage, or relay
payload exists.

## Blocker

A second privacy/accessibility reviewer and physical shared-device QA are required
before merge or any camera/physical-object demo claim. Recognition and semantic
mapping remain separate work.

## Owner

Codex, at Anurup Kumar's direction (AL-046 review-gated stretch foundation).

## Next action

Run the full check batch, then get human review and real permission/revocation/
low-light/occlusion evidence before progressing to confirmed physical semantics.
