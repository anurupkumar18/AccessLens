---
id: AL-046
title: Local camera consent lifecycle
status: IN_REVIEW
priority: P1
depends_on: []
task_ids: [A17]
threads: [T-10]
affected_paths: [apps/extension/src/sources/camera,apps/extension/src/instructor,apps/extension/src/shell]
contract_impact: none; camera foundation emits no live events
data_impact: local-only
demo_impact: Proves an instructor-only local camera permission and stop boundary, not reliable physical-object recognition.
human_decision: user-directed feature-branch prototype; second privacy/accessibility review is required before merge or demo claim
---

## Outcome

Add an instructor-only camera lifecycle that can be started only by an explicit
click, visibly reports camera state, samples locally through the source boundary,
and stops all tracks immediately.

## Scope

Use `getUserMedia({ video, audio: false })` only inside the click-controlled host.
Keep the stream and transient frames in the source document. The UI must make
camera-on/off clear and direct an instructor to existing reviewed-region controls
as the manual semantic fallback.

## Non-goals

Do not send frames, stream video, store a recording, recognize faces, infer
gestures/attention/emotion/identity, require student cameras, add a camera event,
or claim physical-object matching is complete.

## Acceptance criteria

Constructing the host starts nothing; the explicit control invokes permission,
shows a persistent local-only state after grant, handles denial/source ending, and
stops local tracks on request or unmount.

## Test plan

Add host and component tests for permission order, denied state, browser-ended
state, explicit stop, and the absence of transport/events. Run focused tests and
the next full repository batch before review.

## Failure behavior

Show a clear unavailable message and preserve manual reviewed-region selection;
never substitute a guessed object/gesture or a remote fallback.

## Handoff requirements

Require second privacy/accessibility review and physical low-light/occlusion/
permission-revocation QA before merge or a camera demo claim.
