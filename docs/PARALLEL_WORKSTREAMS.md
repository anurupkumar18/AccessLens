# AccessLens Five-Person Parallel Build Plan

**Date:** September 15, 2026

**Integration branch:** `accesslens-extension-ar-pivot`

This plan divides the hackathon MVP into five workstreams that can be developed and
tested independently. Fill in each `Name` line before implementation begins.
Phase A0 is already complete; Parts 1–5 assign every remaining task A1–A17. Items
listed as deferred in the implementation plan are intentionally outside the
48-hour build unless the team explicitly changes scope.

## Ownership board

| Part | Owner | Primary outcome |
| --- | --- | --- |
| 1. Foundation and contracts | **Name: ____________________** | Installable extension shell and stable shared interfaces |
| 2. Instructor capture | **Name: ____________________** | Consent-based screen sharing, slide matching, and correction |
| 3. Student experience and AR | **Name: ____________________** | Synchronized accessible modes and required AR view |
| 4. AWS live service | **Name: ____________________** | Secure temporary sessions and ordered WebSocket relay |
| 5. Content, camera, and demo QA | **Name: ____________________** | Reviewed biology pack, advanced camera adapter, and integrated demo |

## Before splitting up: 45-minute contract freeze

All five owners should agree on and merge the smallest shared foundation first:

- repository folders and package-manager choice;
- `AccessPack`, `LiveEvent`, and session-message schemas from
  [`SYSTEM_DESIGN.md`](SYSTEM_DESIGN.md);
- a `SessionClient` interface with `create`, `join`, `send`, `subscribe`, and
  `close` operations;
- one valid `region.changed` fixture and one invalid-event fixture; and
- environment-variable names for the WebSocket endpoint and asset base URL.

Part 1 owns this first commit, but everyone reviews it immediately. After that
commit, each person works only in their assigned directories. No one changes a
shared schema without notifying all five owners and updating its contract tests.

## Part 1 — Extension foundation and shared contracts

**Name: ____________________**

**Implementation-plan tasks:** A1 and A2

**Owns:**

- root JavaScript/TypeScript workspace configuration;
- `apps/extension/manifest.json`;
- `apps/extension/src/shell/` and shared extension navigation;
- `apps/extension/src/shared/`;
- `packages/contracts/`; and
- common unit-test and build configuration.

**Build:**

- Create the Manifest V3 extension package using React, TypeScript, and Vite.
- Add Instructor and Student entry routes inside the same extension package.
- Add the side panel, accessible navigation, error boundary, and local settings
  wrapper.
- Implement Zod and JSON Schema validation for Access Packs, live events, role
  capabilities, and session messages.
- Provide an in-memory `SessionClient` so Parts 2 and 3 can work without AWS.
- Provide scripts to build, test, and load the unpacked extension.

**Done when:**

- the unpacked extension opens and switches between Instructor and Student roles;
- valid fixtures parse and prohibited or malformed fields fail deterministically;
- preferences use local extension storage only; and
- Parts 2 and 3 can exchange a fixture event through the mock client.

**Handoff:** Part 4 replaces the mock transport behind `SessionClient`; Parts 2 and
3 must not import AWS code directly.

## Part 2 — Instructor capture and approved-screen recognition

**Name: ____________________**

**Implementation-plan tasks:** A3, A4, and A5

**Owns:**

- `apps/extension/src/instructor/`;
- `apps/extension/src/sources/screen/`; and
- instructor capture and recognition tests.

**Build:**

- Add Start, Pause, Resume, Stop, and End Session controls.
- Open the browser's tab/window/screen chooser only after the instructor clicks
  Start.
- Sample the selected stream locally in an offscreen extension document.
- Match only the reviewed biology slides supplied by Part 5.
- Emit allowlisted `asset.changed`, `region.changed`, `source.unmatched`, pause,
  resume, and stop events through `SessionClient`.
- Add visible capture status and a manual source/region correction control.
- Keep raw frames on the instructor device and discard samples after matching.

**Done when:**

- no capture starts without the browser permission flow;
- five scripted slide changes match under demo conditions;
- an unknown slide produces `source.unmatched`, never an invented match;
- manual correction emits the intended reviewed asset/region ID; and
- stopping capture immediately stops event production.

**Independent test path:** send events to Part 1's in-memory client and inspect the
event log without waiting for AWS or the Student UI.

## Part 3 — Student extension, accessibility modes, and AR

**Name: ____________________**

**Implementation-plan tasks:** A9, A10, A11, A12, and A13

**Owns:**

- `apps/extension/src/student/`;
- `apps/extension/src/renderers/`;
- `apps/extension/src/ar/`; and
- student accessibility and AR tests.

**Build:**

- Add join-session and reconnecting/stale-state UI.
- Consume ordered events through `SessionClient` and load the exact Access Pack
  version.
- Implement Focus View, structured text, requested audio, and the semantic scene
  outline.
- Implement the required Three.js/React Three Fiber AR cell scene.
- Map each `regionId` and `arState.hotspotId` to the reviewed model node, camera
  target, highlight, and label supplied by Part 5.
- Support WebXR `immersive-ar` on compatible devices and the same spatial scene in
  an extension-owned viewport elsewhere.
- Keep mode and accessibility preferences local.
- Provide keyboard, touch, reduced-motion, and screen-reader routes to the same
  labels and biological relationships.

**Done when:**

- replaying fixture events updates every renderer automatically;
- selecting the mitochondrion in an event focuses the correct AR node and label;
- stale or out-of-order events do not overwrite newer state;
- AR has an equivalent semantic path; and
- no preference, diagnosis, grade, attention, or mastery signal is transmitted.

**Independent test path:** replay Part 1's fixture event sequence locally without
the Instructor extension or AWS.

## Part 4 — AWS temporary session and real-time transport

**Name: ____________________**

**Implementation-plan tasks:** A6, A7, and A8

**Owns:**

- `infra/`;
- `services/live-session/`;
- AWS integration tests; and
- deployment and local-endpoint documentation.

**Build:**

- Define API Gateway WebSocket routes and Lambda handlers with AWS CDK.
- Implement create, join, relay, latest-state, disconnect, and close operations.
- Issue short-lived, role-scoped instructor and student capabilities.
- Validate schemas, allowed event types, pack versions, coordinate bounds, and
  monotonically increasing sequence numbers.
- Store only temporary session/connection state in DynamoDB with TTL and enforce
  expiry during reads.
- Relay the latest semantic state after a short student reconnect.
- Redact event bodies from CloudWatch logs and document deployment variables.

**Done when:**

- one instructor client drives two student clients over the deployed endpoint;
- a student cannot publish instructor events;
- malformed, stale, reordered, and raw-media-shaped events are rejected;
- closing or expiring a session prevents further delivery; and
- the real client can replace Part 1's mock without changing Parts 2 or 3.

**Independent test path:** use fixture WebSocket clients and contract payloads; no
browser extension is needed until integration.

## Part 5 — Biology Access Pack, camera adapter, and demo quality

**Name: ____________________**

**Implementation-plan tasks:** A14, A15, A16, and A17

**Owns:**

- `packages/access-packs/bio-cell-demo/`;
- `apps/extension/src/sources/camera/`;
- `tests/e2e/`;
- demo assets and fallback recording; and
- updates to [`DEMO_RUNBOOK.md`](DEMO_RUNBOOK.md).

**Build first — content and simulator:**

- Create the reviewed biology slide deck, fingerprints, reading order, regions,
  descriptions, and plain-language text.
- Add a lightweight licensed or original `.glb` cell model with stable node names.
- Map every demo `regionId` to one AR hotspot and equivalent semantic control.
- Build a small event-sequence simulator so Parts 2, 3, and 4 can test immediately.
- Record asset source/license information and review every student-facing statement.

**Build after the core demo works — advanced camera source:**

- Add an explicitly activated instructor/shared-device camera adapter for one
  physical lab object.
- Process frames locally, ignore faces, and emit the same reviewed semantic events
  as the screen-source adapter.
- Provide manual selection when recognition fails and never require student cameras.

**Own integration and QA:**

- Add the end-to-end happy path and permission, unmatched, stale-event, reconnect,
  pause, and stop scenarios.
- Run keyboard, axe, screen-reader, reduced-motion, and AR hotspot checks.
- Coordinate one accessibility/design-partner review if available.
- Rehearse the three-minute demo twice and produce a recorded fallback.

**Done when:**

- the pack passes contract and provenance checks;
- every scripted instructor action has deterministic text, Focus, audio, and AR
  output;
- the complete demo passes from a clean extension installation twice; and
- camera work cannot break or delay the screen-sharing demo.

**Independent test path:** validate the pack and replay the simulator before any
capture, student UI, or AWS component exists.

## Shared integration contract

```text
Part 5 Access Pack --------> Part 2 screen/camera matcher
         |                            |
         |                            v
         +--------------------> shared LiveEvent contract <---- Part 1
                                      |
                                      v
                               Part 4 AWS relay
                                      |
                                      v
                            Part 3 student + AR renderers
```

- Part 2 produces events; it does not know how students render them.
- Part 3 consumes events; it does not know whether screen, manual, or camera input
  produced them.
- Part 4 validates and relays events; it does not process media or accessibility
  preferences.
- Part 5 owns reviewed meaning and fixtures; it does not add backend behavior.
- Part 1 owns shared interfaces and final extension assembly.

## Merge and branch rules

Each owner creates a branch from `accesslens-extension-ar-pivot`:

```text
workstream/1-foundation
workstream/2-instructor-capture
workstream/3-student-ar
workstream/4-aws-live
workstream/5-content-camera-qa
```

Use small pull requests into `accesslens-extension-ar-pivot`. Before requesting a
merge, rebase or merge the latest integration branch, run the narrow checks for the
owned component, and include a short manual test note. Do not merge directly to
`master` during the build.

## Integration checkpoints

| Target | Required result |
| --- | --- |
| Hour 1 | Owners assigned; folders, schemas, fixtures, and interfaces frozen |
| Hour 8 | Extension shell loads; event simulator drives the Student renderers |
| Hour 18 | Instructor capture produces reviewed events; AWS relay works with fixture clients |
| Hour 30 | One instructor updates two Student extensions, including synchronized AR |
| Hour 40 | Failure paths and accessibility checks pass; camera spike may be integrated |
| Hour 46 | Feature freeze; only demo-blocking fixes after this point |
| Hour 48 | Two successful rehearsals and a verified fallback recording |

## Final team sign-off

- [ ] **Name: ____________________** confirms Part 1 is merged and tested.
- [ ] **Name: ____________________** confirms Part 2 is merged and tested.
- [ ] **Name: ____________________** confirms Part 3 is merged and tested.
- [ ] **Name: ____________________** confirms Part 4 is merged and tested.
- [ ] **Name: ____________________** confirms Part 5 is merged and tested.
- [ ] All five owners confirm the final demo still satisfies charter invariants
  A1–A11.
