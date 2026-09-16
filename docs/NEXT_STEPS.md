# AccessLens next steps

This is the implementation backlog after the live classroom MVP. It separates
working behavior from placeholders and keeps the privacy charter intact. Camera
input and AWS deployment are intentionally later phases; neither is faked by the
current extension.

## Current live MVP (now)

- Instructor explicitly chooses a tab, window, or full screen through the browser
  chooser.
- The instructor device samples the shared view locally and matches it against a
  reviewed Access Pack.
- Only ordered semantic events (asset, region, pointer, captions, lifecycle) are
  sent to students.
- Student extensions automatically update Focus, Read, Hear, Dyslexic, and AR
  representations from the same event.
- Students choose preferences locally. The system does not diagnose, grade, score
  attention, or require a camera.
- The local BroadcastChannel transport supports same-browser rehearsal. The AWS
  WebSocket client and relay are available behind configuration for the later
  multi-device rehearsal.

## 1. Give the class access to course materials (Canvas + RAG)

**Goal:** let the instructor approve the Canvas materials for one course so the
agent can ground descriptions and questions in that course rather than generic
knowledge.

**Plan:**

1. Obtain institutional approval for a read-only Canvas/LTI integration and write
   the allowlist before requesting any token.
2. Limit retrieval to instructor-approved syllabus, modules, slide decks, and
   reference documents. Exclude assignments, submissions, quizzes, discussions,
   grades, answer keys, and private student content.
3. Add a `CourseMaterialProvider` interface and a Canvas adapter placeholder. The
   extension should continue to run with the checked-in biology pack when no
   provider is configured.
4. Ingest approved documents into an AWS retrieval index only after the data-flow,
   retention, deletion, and vendor review are approved.
5. Return source IDs and citations with every generated description; mark generated
   text as draft until an instructor publishes it into an Access Pack.

**Acceptance:** a test course can retrieve only allowlisted material; prohibited
Canvas resource types are rejected in code; no Canvas token or raw course document
is sent to a model outside the approved retrieval boundary; the local demo still
works with the Canvas adapter disabled.

## 2. Quality-check the extension

**Task:** debug and test the full extension with real capture, multiple student
accounts, and the eventual AWS endpoint.

**Plan:**

- Run the permission matrix for tab, window, entire-screen, denial, browser stop,
  and source switching.
- Rehearse one instructor plus two students on separate browser profiles/devices.
- Verify five slide transitions, manual region indication, unmatched content,
  correction, pause/resume/stop, stale state, reconnect, and session expiry.
- Test keyboard-only navigation, screen-reader labels, 200% text, reduced motion,
  Dyslexic mode, high-contrast settings, and narrow side-panel layouts.
- Record a deterministic fallback event replay and compare it with the live run.
- File each failure with the source, event sequence, expected state, and whether
  the issue is capture, matching, transport, or rendering.

**Acceptance:** two clean rehearsals pass from an unpacked extension; two students
follow the same instructor event stream; no raw media appears in network payloads;
the failure fallback is recorded and honest about which side is simulated.

## 3. Connect AWS models and Bedrock agents (placeholder)

**Goal:** add model-backed capabilities such as approved descriptions, voice,
translation, and course-grounded explanations without putting an LLM in the live
event relay.

**Placeholder interfaces:**

```ts
interface BedrockAgentGateway {
  createDraft(input: { packId: string; assetId: string; sourceIds: string[] }): Promise<unknown>;
  requestVoiceDescription(input: { eventId: string; text: string; voice: string }): Promise<unknown>;
  answerCourseQuestion(input: { courseId: string; question: string; sourceIds: string[] }): Promise<unknown>;
}
```

**Plan:**

- Keep the interface behind an explicit feature flag and a human review gate.
- Use Bedrock for authoring or on-demand assistance, not for deciding whether a
  student passed, what they know, or what they are allowed to access.
- Keep raw capture on the source device; send only the minimum reviewed semantic
  context needed for the requested operation.
- Show a visible draft/pending-review state and preserve the reviewed pack as the
  source of truth during class.
- Add prompt-injection, source-grounding, latency, cost, and fallback tests before
  enabling a model in the demo.

**Acceptance:** disabling the gateway leaves the live extension functional; every
  model output has provenance and review state; no student identity, preference,
  raw frame, or private conversation is sent to Bedrock by default.

## 4. Record useful context from each session

**Goal:** improve AccessLens over time without building a student surveillance
database.

**Plan:**

- Default to no recording of chats, audio, screen, camera, or student responses.
- Keep the current event state and accessibility preferences client-side for the
  active session only.
- Offer a separate, explicit opt-in research toggle. Explain exactly what is shared,
  how long it is retained, and how to withdraw.
- Share only anonymous aggregate signals such as mode usage, event latency,
  unmatched rate, correction count, and explicitly submitted feedback text after
  local scrubbing.
- Generate instructor/IT suggestions from cohorts, never individual student
  profiles. Do not infer disability, attention, emotion, mastery, or weakness from
  behavior.
- Require institutional privacy and research review before collecting anything
  beyond operational error metrics.

**Acceptance:** opt-out is the default; deleting local history removes pending
  records; no names, IDs, emails, diagnoses, grades, raw media, or private chats are
  present in the export; the privacy statement and retention period are visible.

## 5. Add an asynchronous student view

**Goal:** support students who review the lesson later, not only students attending
  the live session.

**Plan:**

1. Add a separate **Review** route, clearly distinct from the live status view.
2. Replay reviewed semantic events from an instructor-published session summary,
   not from raw screen recordings.
3. Let students pause, step backward, change mode, request audio, or open AR at
   their own pace.
4. Provide a text transcript/reading-order timeline with citations to the approved
   pack and course sources.
5. Keep private student notes local unless the student explicitly exports them.
6. Add an instructor publish/unpublish control and a retention/expiration policy.

**Acceptance:** Review mode works with the network disconnected once the approved
  pack is cached; it never exposes a private live chat or raw recording; it keeps
  the same Focus/Read/Hear/Dyslexic/AR meaning as the live event; live and review
  routes cannot be confused by their status labels.

## Recommended order

1. Finish real-device quality checks and the capture permission matrix.
2. Wire the configured AWS WebSocket endpoint and rehearse two devices.
3. Add the Bedrock gateway placeholder and one visible, reviewed authoring beat.
4. Complete Canvas approval and the read-only CourseMaterialProvider adapter.
5. Add opt-in anonymous research export with privacy review.
6. Build Review mode after the live demo is stable.
7. Start the camera feasibility spike only after all of the above is reliable.
